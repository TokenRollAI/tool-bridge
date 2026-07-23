# Guide:Docker/Node 宿主(docker-host)

> 用途:改 `packages/server`(`@tool-bridge/server`)或做 Docker 部署前必读的一篇通:配置面、数据布局、本地开发、Docker 验收、与 CF 宿主的行为差异、发布。文件级检索见 [../architecture/code-map.md](../architecture/code-map.md) 的 server 段。

## 形态一句话

`@tool-bridge/server` = Node 宿主胶水:复用 gateway 宿主中立 `createTbApp` + `runBootstrap`,注入 SQLite StateStore + FS ObjectStore + ws DeviceHub,产出单进程 HTTP 服务(bin `tool-bridge-server`)与官方镜像 `ghcr.io/tokenrollai/tool-bridge`。与 CF 宿主产出同一棵树。

## 环境变量面(configFromEnv,`src/config.ts`)

TB_* 变量与 CF 宿主同名同义(`TB_BOOTSTRAP_ADMIN_SK` / `TB_SECRET_ENCRYPTION_KEY` 等),Node 宿主新增:

| 变量 | 默认 | 说明 |
|---|---|---|
| `TB_PORT` | 8787 | 0 = 临时端口(测试用) |
| `TB_HOST` | — | 监听地址 |
| `TB_DATA_DIR` | `/data`(容器);本地回退 `./data` | 数据根目录 |
| `TB_UI_DIR` | — | 覆盖 Dashboard 静态目录;不设则解析 `@tool-bridge/dashboard` 包 dist,再无则 `/ui` 404 降级 |

## `/data` 布局

- `state.sqlite3` — better-sqlite3 单表 kv(WAL);**强一致**,SK 吊销即时生效。
- `objects/` — FsObjectStore('r2' provider 落点);key 出入口由前缀适配器加/剥 `objects/` 首段。

## 本地开发与测试

```sh
pnpm --filter @tool-bridge/server start        # 本机起服(默认 :8787,数据落 ./data)
pnpm --filter @tool-bridge/server test         # 5 文件 24 例,纯 Node vitest(不需要 workerd)
```

线上/本机验收沿用 `pnpm smoke` / `verify-device.ts` / `verify-plugin.ts`(传 `TB_BASE_URL=http://127.0.0.1:<port>` + `TB_SK`)。

## Docker 验收命令(2026-07-08 实跑通过)

```sh
docker build -t tool-bridge .                                  # 根 Dockerfile,多阶段
docker run -d --name tb -p 8787:8787 -v tbdata:/data \
  -e TB_BOOTSTRAP_ADMIN_SK=… -e TB_SECRET_ENCRYPTION_KEY=… tool-bridge
TB_BASE_URL=http://127.0.0.1:8787 pnpm smoke                   # 冒烟
docker restart tb                                              # 重启后:已注册节点仍在 + 引导幂等(bootstrapped 日志仅一条)
```

Dockerfile 要点:node:22-bookworm 构建 → slim 运行时(**不用 alpine**——better-sqlite3 musl 无官方 prebuild);`pnpm --filter @tool-bridge/server --prod deploy --legacy /out` 产出运行时;USER node / VOLUME /data / HEALTHCHECK / EXPOSE 8787。

## 与 CF 宿主的行为差异

| 维度 | CF(Workers) | Node(server 包) |
|---|---|---|
| StateStore 一致性 | KV 最终一致,跨边缘通常约 60s、也可能更久 | SQLite 强一致,吊销即时 |
| 设备幂等结果表 | DO storage,跨休眠可回放 | 进程内存,**不跨进程重启**(有意分叉) |
| 设备断线回收 | DO alarm | `devicemeta:<id>` 持久 meta + 进程内 timer + 启动 `sweepOrphans`(崩溃孤儿按启动时刻起算) |
| 设备探活 | DO autoResponse(hibernation) | ws 协议层 ping 踢半开连接 |
| `/ui` 静态托管 | Static Assets binding | TB_UI_DIR → dashboard 包 dist 解析 → 404 降级 |
| `$ref` 大对象 | R2 presign 或 `/~ref` 中转 | FS 无 presign,固定走 `/~ref` 中转 |

设备协议行为不分叉:hello 验证+落库统一走 gateway `src/deviceHello.ts`(`processDeviceHello`),DO 与 DeviceHub 只是宿主胶水。当前两宿主都在每次 invoke 前调用 `identify`;disabled 回归已有测试,delete/expiry 由同一 active-key 判定处理。但重验跨 await 后尚未复核 active connection,也未校验 scope/registerPaths 收紧,提交前复审已把它列为待修安全缺口,不能据此承诺所有既有连接都可靠失效。

## 已知限制

- **生产 bootstrap 缺口:**Node/Docker 未配置 `TB_BOOTSTRAP_ADMIN_SK` 时仍默认随机生成 Admin SK 并写 stdout。部署时必须显式配置;代码层 fail-closed 尚待补齐,只有 SDK/显式开发模式适合保留随机兼容路径。
- **设备重验缺口:**`DeviceHub.invoke` 在等待 StateStore 认证期间可被新连接替换,恢复后可能向旧连接发送一次调用;需在 await 后复核 active connection,并补 barrier 并发测试。
- 反向代理后 `/~ref` 中转 URL 的 origin 取自请求 URL,代理须透传 `Host` / `X-Forwarded-Proto`(未来可加 `TB_PUBLIC_ORIGIN`)。
- 设备幂等结果表不跨进程重启(见上表,有意分叉)。

## 发布

- tag `server-v*` 同时触发两个 workflow:`publish-server.yml`(npm Trusted Publishing,含 dist 起服冒烟)+ `publish-docker.yml`(GHCR `ghcr.io/tokenrollai/tool-bridge:{version}` + `:latest`,buildx amd64/arm64,GITHUB_TOKEN)。
- 新包首发走两段式(见 [npm-publish.md](npm-publish.md));**npm 安装形态要求 dashboard 先发布**(dashboard 是 server 的 regular dependency)。
- 发布 bundle 坑:tsup `dts.resolve` 须收窄为数组(core/gateway),`resolve: true` 会把 `node:http` 类型降级 undefined。
