# Guide:Docker/Node 宿主(docker-host)

> 用途:改 `packages/server`(`@tool-bridge/server`)或做 Docker 部署前必读的一篇通:配置面、数据布局、本地开发、Docker 验收、与 CF 宿主的行为差异、发布。文件级检索见 [../architecture/code-map.md](../architecture/code-map.md) 的 server 段。

## 形态一句话

`@tool-bridge/server` = Node 宿主胶水:复用 gateway 宿主中立 `createTbApp` + `runBootstrap`,注入 SQLite StateStore + FS ObjectStore + ws DeviceHub,产出单进程 HTTP 服务(bin `tool-bridge-server`)与官方镜像 `ghcr.io/tokenrollai/tool-bridge`。与 CF 宿主产出同一棵树。根 `docker-compose.yml` 是另行编排的 localhost 开发栈,不改变生产单容器镜像。

## 环境变量面(configFromEnv,`src/config.ts`)

TB_* 变量与 CF 宿主同名同义(`TB_BOOTSTRAP_ADMIN_SK` / `TB_SECRET_ENCRYPTION_KEY` 等),Node 宿主新增:

| 变量 | 默认 | 说明 |
|---|---|---|
| `TB_PORT` | 8787 | 0 = 临时端口(测试用) |
| `TB_HOST` | — | 监听地址 |
| `TB_DATA_DIR` | `/data`(容器);本地回退 `./data` | 数据根目录 |
| `TB_UI_DIR` | — | 覆盖 Dashboard 静态目录;不设则解析 `@tool-bridge/dashboard` 包 dist,再无则 `/ui` 404 降级 |
| `TB_ALLOW_INSECURE_BOOTSTRAP` | `false` | 默认缺 `TB_BOOTSTRAP_ADMIN_SK` 时拒绝首次启动;仅设为 `true` 才随机生成并打印一次 Admin SK,只限本地/一次性开发 |

## `/data` 布局

- `state.sqlite3` — better-sqlite3 单表 kv(WAL);**强一致**,SK 吊销即时生效。
- `objects/` — FsObjectStore('r2' provider 落点);key 出入口由前缀适配器加/剥 `objects/` 首段。

## 本地开发与测试

```sh
TB_BOOTSTRAP_ADMIN_SK=… TB_SECRET_ENCRYPTION_KEY=… \
  pnpm --filter @tool-bridge/server start      # 本机起服(默认 :8787,数据落 ./data)
pnpm --filter @tool-bridge/server test         # 纯 Node vitest(不需要 workerd)
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

首次引导缺 `TB_BOOTSTRAP_ADMIN_SK` 时 server 在监听前退出非 0,不生成或打印最高权限凭证。显式预置会只存 hash;`TB_ALLOW_INSECURE_BOOTSTRAP=true` 是本地逃生阀,会恢复随机生成并打印一次的旧行为,生产禁用。宿主中立 `runBootstrap` 和未传 `adminSk` 的 SDK 仍保留随机兼容路径,这不改变 Node/Docker 默认 fail closed。

## Compose 三跳开发栈(2026-08-11 实跑通过)

根 `docker-compose.yml` 的常驻链路是 gateway → 真实 plugin-feishu Wrangler Worker → 受认证 mock TAT/MCP upstream;`smoke` 是独立 profile 的 one-shot 消费者。gateway 构建根 Dockerfile final stage,plugin/upstream/smoke 复用 workspace build-stage dev image;生产 Dockerfile final stage和 `CMD ["node","/app/dist/main.js"]` 不变。

```sh
pnpm compose:up       # build + 后台启动 gateway/upstream/plugin
pnpm compose:smoke    # docker compose run --rm smoke,同步返回三跳结果
pnpm compose:down     # 清容器/网络,保留 gateway-data
pnpm compose:reset    # down -v,删除 gateway-data 与固定 fixture
```

只有 gateway 发布 `127.0.0.1:${TB_COMPOSE_GATEWAY_PORT:-8787}`;plugin/upstream 只 `expose` 到 Compose 内网。默认 Admin SK、plugin token、app credential与 TAT 是可提交的确定性 fixture,**仅允许隔离 localhost 开发**,不得复制到生产、绑定 `0.0.0.0`、接反向代理或共享到其它网络。修改 Admin SK 或 encryption key不会迁移既有卷;改值后出现 401/密文解不开时用 `compose:reset`,或走管理面显式轮换。

smoke 从 gateway 公共入口 set 两个 secret,注册 plugin/v2并校验 `actions/tools/v1`,挂载 `compose/tools`,最后断言 mock upstream 生成的精确 `compose-roundtrip`。验收已覆盖 fresh volume、同卷重复、gateway restart、用全新错误 app id绕过 TAT cache后的 upstream 401 → gateway 503/nonzero、恢复后再通过,以及 `HostIp=127.0.0.1`、final image CMD与 teardown。三个 healthcheck 只负责等待,不能替代这条调用证据。

当前边界:echo mock新增 route 尚无独立单测;compose smoke的 fetch尚无逐请求 AbortSignal;固定 dev image tag在并行 worktree并发 build/run时可能串 source,即使 `COMPOSE_PROJECT_NAME` 与宿主端口不同也不能完全隔离。这些是后续增强,当前本地证据不代表生产凭据、真实飞书、跨主机网络或生产部署已验证。

## 与 CF 宿主的行为差异

| 维度 | CF(Workers) | Node(server 包) |
|---|---|---|
| StateStore 一致性 | KV 最终一致,跨边缘通常约 60s、也可能更久 | SQLite 强一致,吊销即时 |
| 设备幂等结果表 | DO storage,跨休眠可回放 | 进程内存,**不跨进程重启**(有意分叉) |
| 设备断线回收 | DO alarm | `devicemeta:<id>` 持久 meta + 进程内 timer + 启动 `sweepOrphans`(崩溃孤儿按启动时刻起算) |
| 设备探活 | DO autoResponse(hibernation) | ws 协议层 ping 踢半开连接 |
| `/ui` 静态托管 | Static Assets binding | TB_UI_DIR → dashboard 包 dist 解析 → 404 降级 |
| `$ref` 大对象 | R2 presign 或 `/~ref` 中转 | FS 无 presign,固定走 `/~ref` 中转 |
| 首次 bootstrap | 缺 `TB_BOOTSTRAP_ADMIN_SK` fail closed | 缺 Admin SK 默认 fail closed;仅显式 insecure bootstrap逃生阀随机打印 |

设备协议行为不分叉:hello 验证+落库统一走 gateway `src/deviceHello.ts`(`processDeviceHello`),DO 与 DeviceHub 只是宿主胶水。当前两宿主都在每次 invoke 前调用 `identify`;disabled 回归已有测试,delete/expiry 由同一 active-key 判定处理。但重验跨 await 后尚未复核 active connection,也未校验 scope/registerPaths 收紧,提交前复审已把它列为待修安全缺口,不能据此承诺所有既有连接都可靠失效。

## 已知限制

- **bootstrap 兼容边界:**Node/Docker 默认已 fail closed;生产必须显式预置 `TB_BOOTSTRAP_ADMIN_SK`,不得开启 `TB_ALLOW_INSECURE_BOOTSTRAP`。宿主中立 `runBootstrap` 与 SDK 未传 `adminSk` 时仍可随机生成并写本地 stdout,嵌入方须自行决定是否接受该兼容行为。
- **设备重验缺口:**`DeviceHub.invoke` 在等待 StateStore 认证期间可被新连接替换,恢复后可能向旧连接发送一次调用;需在 await 后复核 active connection,并补 barrier 并发测试。
- 反向代理后 `/~ref` 中转 URL 的 origin 取自请求 URL,代理须透传 `Host` / `X-Forwarded-Proto`(未来可加 `TB_PUBLIC_ORIGIN`)。
- 设备幂等结果表不跨进程重启(见上表,有意分叉)。

## 发布

- tag `server-v*` 同时触发两个 workflow:`publish-server.yml`(npm Trusted Publishing,含 dist 起服冒烟)+ `publish-docker.yml`(GHCR `ghcr.io/tokenrollai/tool-bridge:{version}` + `:latest`,buildx amd64/arm64,GITHUB_TOKEN)。
- 新包首发走两段式(见 [npm-publish.md](npm-publish.md));**npm 安装形态要求 dashboard 先发布**(dashboard 是 server 的 regular dependency)。
- 发布 bundle 坑:tsup `dts.resolve` 须收窄为数组(core/gateway),`resolve: true` 会把 `node:http` 类型降级 undefined。
