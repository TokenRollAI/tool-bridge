# 代码检索地图

> 用途:"要改 X,去哪个文件"的检索入口,按包 → 目录/文件族 → 关键符号组织。真源是代码,本图只到文件族与关键符号粒度;边界与不变量的裁决见 [modules-and-boundaries.md](modules-and-boundaries.md)。更新时机:新增模块、移动文件族或公开面变化时。

## packages/core — 纯逻辑内核

唯一运行时依赖 zod;`test/` 目录同构镜像 `src/`(找某模块的测试直接对路径)。公开面 = `src/index.ts` 全量 re-export + `./node` 子导出。

| 目录/文件 | 管什么 | 关键文件(符号) |
|---|---|---|
| `auth/` | SK 与权限判定 | `scope.ts`(Scope 判定,deny 优先→allow→默认拒)、`authorizer.ts`(`Authorizer.Check` 唯一判定入口)、`registerPath.ts`(registerPaths 收紧规则)、`sk.ts`(SK 签发、sha256 哈希) |
| `tree/` | 树与注册表 | `path.ts`(TreePath 规则/保留段/保留根)、`registry.ts`(`NodeRegistryStore`:Write 幂等 upsert、中间 directory 自动物化、级联回收、Resolve 最长前缀)、`visibility.ts`(可见性裁剪) |
| `htbp/` | 协议编解码 | `model.ts`(`HelpModel`)、`helpDsl.ts`(DSL 渲染,属性行顺序)、`negotiate.ts`(内容协商)、`tree.ts`(`~tree` 构建,depth/node 预算) |
| `secret/` | 上游凭证 | `secretStore.ts`(`SecretStoreImpl`,AES-256-GCM 只写不读,`resolve()` 内部专用) |
| `builtin/` | `system/*` 管理面 | sk / secret / registry / status / plugin 五模块的 cmd 表 + `dispatch`(`types.ts`/`util.ts` 为公共骨架) |
| `tool/` | 工具层纯逻辑 | `httpTool.ts`(HttpToolDef 拼装、`{param}` 占位)、`virtualize.ts`(prefix/rename/hide/describe)、`mcpSchema.ts`(mcp schema→HelpModel)、`remote.ts`(路径改写/白名单)、`via.ts`(X-TB-Via 环检测)、`upstreamError.ts`(上游错误归一) |
| `context/` | Context 层纯逻辑 | `types.ts`(ContextEntry)、`objectStore.ts`(ObjectStore 接口 + Memory 实现)、`objectProvider.ts`(四动词语义)、`path.ts`(穿越防护)、`ttl.ts`(懒回收)、`help.ts`(静态 cmd 表) |
| `device/` | 设备通道纯逻辑 | `frames.ts`(`DeviceFrame` 编解码;ping/pong 是稳定字面量,供 DO autoResponse 精确匹配)、`session.ts`(网关侧状态机 `DeviceGatewaySession`,含 `restoreReady` 休眠恢复)、`client.ts`(设备侧 `DeviceClient`,重连后自动重发 hello)、`shellAllow.ts`(shell 白名单匹配)、`helpModel.ts` |
| `plugin/` | Plugin 纯逻辑 | `manifest.ts`(zod 校验)、`envelope.ts`(X-TB-Context 信封编解码)、`dedupe.ts`(`RequestDedupe`)、`contract.ts`(契约校验) |
| `node/` | `./node` 子导出(唯一含 Node API) | `fsObjectStore.ts`(FsObjectStore,realpath 防逃逸)、`shellExecutor.ts`(有界缓冲、超时后等 exit 结算) |
| 顶层 | 横切 | `errors.ts`(`TBError`)、`store.ts`(`StateStore` 接口 + 内存实现 + KV key 布局注释)、`types.ts`(Node/SecretKey/Scope 等)、`version.ts`(`HTBP_VERSION`/`HTBP_HELP_HEADER`) |

## packages/gateway — Workers 胶水(可发布 Worker library)

exports `.` / `./tbApp` / `./bootstrap` / `./deviceHello`(供 SDK 与 server 复用,宿主中立)。

| 文件 | 管什么 |
|---|---|
| `app.ts` | Workers Env→deps 适配(入口薄层) |
| `tbApp.ts` | **宿主中立 `createTbApp(deps)`**:认证中间件、`~help`/`~tree`/`~skill`/`~describe`/`~register`/数据面路由、remote 聚合、两级 `~help` 披露、`/ui` 转发、`/~ref` |
| `bootstrap.ts` | 首请求惰性引导:Admin SK + `system` 五 builtin 物化(promise 防重入 + KV 幂等标志) |
| `deviceHello.ts` | **宿主中立 `processDeviceHello`**:设备 hello 验证 + 落库的单一真源,DO 与 server DeviceHub 共用(防两宿主树形态漂移) |
| `kvStateStore.ts` | StateStore 的 KV 实现(list 跳 null、子树前缀扫描,头注释有约束说明) |
| `deviceSession.ts` | `DeviceSession` DO 胶水:WS hibernation、待决表、`setWebSocketAutoResponse`、惰性会话重建(协议行为在 deviceHello.ts) |
| `refToken.ts` | `$ref` 网关中转的 HMAC token 签发/校验 |
| `providers/` | 全部上游 I/O:`mcp.ts`(SDK Streamable HTTP,会话复用 + 404 重握手一次;auth:'oauth' 挂 `../oauth.ts` 的 authProvider)、`http.ts`、`remote.ts`、`toolCache.ts`、`r2Object.ts`、`s3Object.ts` + `s3Sign.ts`(aws4fetch)、`pluginClient.ts` + `pluginTool.ts` + `pluginContext.ts` |
| `test/` | 8 个集成测试(gateway/tool/context/device/deviceNodes/plugin/ui/oauth `.integration.test.ts`),真实 workerd;`scripts/` 有 echo-mcp / s3-mock / stub-provider 兜底上游 |
| `wrangler.jsonc` | 绑定 TB_KV / TB_R2 / TB_DEVICE(DO)/ ASSETS(dashboard dist,`run_worker_first`)+ `account_id` + custom domain |

## packages/cli — `tb`(npm 发布物)

- 框架 commander,**严格解析是刻意的**(未知 flag/子命令、flag 缺值、多余 positional 一律报错并带拼写建议——防拼错 flag 被静默吞掉导致 shell 白名单等权限误配)。
- `index.ts` 薄入口(仅 parseAsync);`program.ts`(`buildProgram()` 装配 17 个命令,`.helpCommand(false)` 保留业务 `tb help [path]`);`commands/` 每命令一文件、导出工厂函数 `xCommand(): Command`(status/login/whoami/use/sk/secret/ls/tree/help/call/tool/server/ctx/connect/device/mount/plugin);`--no-shell` 用 commander 原生否定(`opts.shell === false`)。
- 横切:`config.ts`(XDG 配置、多 profile)、`http.ts`(API 客户端)、`output.ts`(`--json`)、`args.ts`(`withGlobalOpts` 挂全局 --json/--base-url/--sk、`collect` repeatable 收集器、`resolveTarget({baseUrl, sk})` camelCase)、`scope.ts`、`registry.ts`(节点管理助手,rm 前 kind 校验)、`deviceRuntime.ts`(`tb connect` 长驻:partysocket 重连 + 30s 心跳判死链)、`deviceId.ts`。
- 测试基建:`test/cliHarness.ts`(runCli/parseError;exitOverride 须逐层应用,commander 不向子命令继承)+ `test/strictParsing.test.ts`(拼错 flag 事故回归 + 全部叶子命令的未知 flag 矩阵)。

## packages/sdk — 薄装配层(npm 发布物,4 个源文件)

- `toolBridge.ts`:`createToolBridge(config)` → `{ fetch, registerTool, registerContext, connect }`(装配 core + gateway 的 createTbApp/bootstrap)。
- `connect.ts`:反向连接(ws→网关设备通道)。
- `index.ts`:公开面 + 再导出 core 类型与内存宿主(MemoryStateStore 等);`types.ts`。
- 发布形态:tsup bundle,dts 经 `tsconfig.build.json` paths 内联(见 [../guides/npm-publish.md](../guides/npm-publish.md))。

## packages/dashboard — React SPA(可发布纯静态产物包,经 `/ui`)

- `pages/`:LoginPage / OverviewPage / NodePage + `pages/system/`(SkPage / RegistryPage / DevicesPage / SecretsPage / PluginsPage)。
- `components/`:`layout/`(AppShell/TreeNav)、`node/`(CmdPanel/ContextBrowser/ResultView/CliHint;ContextBrowser 支持条目 metadata 编辑、`$ref` 大对象经 Update 只改 metadata、Search mode 切换)、CommandPalette(⌘K)、`ui/`(shadcn)。
- `lib/`:api.ts(同源 `baseUrl:''`)、queries.ts、schemaForm.ts(@rjsf)、session.tsx(SK 多 profile,localStorage)、history.ts。
- 无自有测试;行为由 gateway 的 `ui.integration.test.ts` 覆盖。

## packages/server — Node/Docker 宿主胶水(npm 发布物,bin `tool-bridge-server`)

改宿主行为前先读 [../guides/docker-host.md](../guides/docker-host.md)(env 面、差异表、验收命令)。

| 文件 | 管什么 |
|---|---|
| `sqliteStateStore.ts` | better-sqlite3 单表 kv(WAL,强一致);list 用 key 范围扫描(不用 LIKE,规避 `_`/`%` 通配符);cursor/排序与 MemoryStateStore 契约对拍 |
| `config.ts` | `configFromEnv`:TB_* 与 CF 同名同义 + TB_PORT(默认 8787,0=临时)/ TB_HOST / TB_DATA_DIR(默认 /data,本地回退 ./data)/ TB_UI_DIR |
| `objects.ts` | `createDataObjectStore`:FsObjectStore('r2' provider 落点)前缀适配器,key 出入口加/剥 `objects/` 首段;无 presign → `$ref` 走 `/~ref` 中转 |
| `deviceHub.ts` | ws `DeviceChannel`:http 'upgrade' + ws handleUpgrade;认证双点(升级前 identify 401 + processDeviceHello 权威判定);复用 core `DeviceGatewaySession`;ws ping 踢半开;断线回收 = `devicemeta:<id>` 持久 meta + 进程内 timer + 启动 `sweepOrphans`;幂等结果表仅内存(有意分叉) |
| `assets.ts` | `/ui` 静态托管:TB_UI_DIR 覆盖 → dashboard 包 dist 解析 → 404 降级;contentType 复用 core fsContentTypeOf |
| `server.ts` | `createTbServer`:构造 TbAppDeps(对位 gateway app.ts),start() 直调 runBootstrap + hub.sweepOrphans |
| `main.ts` | bin 入口(shebang),SIGINT/SIGTERM 优雅关闭 |
| `test/` | 5 文件 23 例:sqlite 契约对拍、HTTP 面(重启持久/吊销即时)、device 8 例、ui 5 例、context 3 例 |
| 发布形态 | tsup bundle core+gateway(`dts.resolve` 须收窄为数组,`true` 会把 node:http 类型降级 undefined);better-sqlite3/ws/hono/@hono/node-server 留 external;publishConfig 覆盖指 dist |

## scripts/ 与 CI

- `scripts/`:gen-dev-vars.mjs(.env→.dev.vars)、provision.mjs(幂等建 KV/R2)、smoke.ts(只读冒烟)、verify-revocation.ts / verify-device.ts / verify-plugin.ts(可重跑生产验收)。
- `.github/workflows/`:publish-{cli,sdk,gateway,dashboard,server}.yml(tag `<pkg>-v*`,npm Trusted Publishing)+ publish-docker.yml(tag `server-v*`,GHCR 镜像,buildx amd64/arm64)。
- 仓库根:`Dockerfile`(多阶段 node:22-bookworm→slim,`pnpm --filter @tool-bridge/server --prod deploy --legacy /out`)+ `.dockerignore`。
