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
| `builtin/` | `system/*` 管理面 | sk / secret / registry / status / plugin / federation / annotation 七模块的 cmd 表 + `dispatch`(`types.ts`/`util.ts` 为公共骨架;`federation.ts` = remote host 白名单增删,合并 env 基线 + `tool/allowlist.ts` 的 RemoteAllowlistStore;`annotation.ts` = Path 补充说明 set/get/remove/list,set/remove 需 admin) |
| `annotation/` | Path 补充说明存储 | `store.ts`(`AnnotationStore`:`annotation:<path>` 每 path 一条覆盖写,text ≤2000;独立于 TreeNode,工具子路径可标注;`~help` 渲染为 `note` 行/字段) |
| `feedback/` | Agent 反馈存储 | `store.ts`(`FeedbackStore`:`feedback:<path>` 单 key 数组;submit/vote/get/listViews/remove + `helpItems` 排序/阈值/top-5 唯一真源;owner 投票去重、每 path 每 owner ≤10 防刷;消费面是网关 `~feedback` 保留段路由) |
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
| `tbApp.ts` | **宿主中立 `createTbApp(deps)`**:认证中间件、`~help`/`~tree`/`~skill`/`~describe`/`~register`/`~feedback`(splitFeedback + GET/POST/DELETE 三 handler,权限判定落目标 path)/数据面路由、remote 聚合、两级 `~help` 披露、`enrichHelp`(~help 注入 annotation note + feedback 头部条目,失败降级)、`/ui` 转发、`/~ref` |
| `bootstrap.ts` | 首请求惰性引导:Admin SK + `system` 七 builtin 物化(promise 防重入 + KV 幂等标志;已引导实例升级自动补挂新模块) |
| `deviceHello.ts` | **宿主中立 `processDeviceHello`**:设备 hello 验证 + 落库的单一真源,DO 与 server DeviceHub 共用(防两宿主树形态漂移) |
| `kvStateStore.ts` | StateStore 的 KV 实现(list 跳 null、子树前缀扫描,头注释有约束说明) |
| `deviceSession.ts` | `DeviceSession` DO 胶水:WS hibernation、待决表、`setWebSocketAutoResponse`、惰性会话重建(协议行为在 deviceHello.ts) |
| `refToken.ts` | `$ref` 网关中转的 HMAC token 签发/校验 |
| `providers/` | 全部上游 I/O:`mcp.ts`(SDK Streamable HTTP,会话复用 + 404 重握手一次;auth:'oauth' 挂 `../oauth.ts` 的 authProvider)、`http.ts`、`remote.ts`、`toolCache.ts`、`r2Object.ts`、`s3Object.ts` + `s3Sign.ts`(aws4fetch)、`pluginClient.ts`(`upstreamAuthRef` → resolve 后经 `X-TB-Upstream-Auth` 注入,失败 → unavailable)+ `pluginTool.ts` + `pluginContext.ts` |
| `test/` | 9 个集成测试(gateway/tool/context/device/deviceNodes/plugin/ui/oauth/meta `.integration.test.ts`;meta = annotation + ~feedback 端到端),真实 workerd;`scripts/` 有 echo-mcp / s3-mock / stub-provider 兜底上游 |
| `wrangler.jsonc` | 绑定 TB_KV / TB_R2 / TB_DEVICE(DO)/ ASSETS(dashboard dist,`run_worker_first`)+ `account_id` + custom domain |

## packages/cli — `tb`(npm 发布物)

- 框架 commander,**严格解析是刻意的**(未知 flag/子命令、flag 缺值、多余 positional 一律报错并带拼写建议——防拼错 flag 被静默吞掉导致 shell 白名单等权限误配)。
- `index.ts` 薄入口(仅 parseAsync);`program.ts`(`buildProgram()` 装配 20 个命令,`.helpCommand(false)` 保留业务 `tb help [path]`);`commands/` 每命令一文件、导出工厂函数 `xCommand(): Command`(status/login/whoami/use/sk/secret/federation/note/feedback/ls/tree/help/call/tool/server/ctx/connect/device/mount/plugin);`--no-shell` 用 commander 原生否定(`opts.shell === false`)。
- 横切:`config.ts`(XDG 配置、多 profile)、`http.ts`(API 客户端)、`output.ts`(`--json`)、`args.ts`(`withGlobalOpts` 挂全局 --json/--base-url/--sk、`collect` repeatable 收集器、`resolveTarget({baseUrl, sk})` camelCase)、`scope.ts`、`registry.ts`(节点管理助手,rm 前 kind 校验)、`deviceRuntime.ts`(`tb connect` 长驻:partysocket 重连 + 30s 心跳判死链)、`deviceId.ts`。
- 测试基建:`test/cliHarness.ts`(runCli/parseError;exitOverride 须逐层应用,commander 不向子命令继承)+ `test/strictParsing.test.ts`(拼错 flag 事故回归 + 全部叶子命令的未知 flag 矩阵)。

## packages/sdk — 薄装配层(npm 发布物,4 个源文件)

- `toolBridge.ts`:`createToolBridge(config)` → `{ fetch, registerTool, registerContext, connect }`(装配 core + gateway 的 createTbApp/bootstrap)。
- `connect.ts`:反向连接(ws→网关设备通道)。
- `index.ts`:公开面 + 再导出 core 类型与内存宿主(MemoryStateStore 等);`types.ts`。
- 发布形态:tsup bundle,dts 经 `tsconfig.build.json` paths 内联(见 [../guides/npm-publish.md](../guides/npm-publish.md))。

## packages/dashboard — React SPA(可发布纯静态产物包,经 `/ui`)

- `pages/`:LoginPage / OverviewPage / NodePage + `pages/system/`(SkPage / RegistryPage / DevicesPage / SecretsPage / PluginsPage / FederationPage)。
- `components/`:`layout/`(AppShell/TreeNav)、`node/`(CmdPanel/ContextBrowser/ResultView/CliHint/NoteCard(补充说明展示+admin 编辑)/FeedbackPanel(反馈 tab:列表/详情/投票/提交/删除);ContextBrowser 支持条目 metadata 编辑、`$ref` 大对象经 Update 只改 metadata、Search mode 切换)、CommandPalette(⌘K)、`ui/`(shadcn)。
- `lib/`:api.ts(同源 `baseUrl:''`)、queries.ts、schemaForm.ts(@rjsf)、session.tsx(SK 多 profile,localStorage)、history.ts。
- 无自有测试;行为由 gateway 的 `ui.integration.test.ts` 覆盖。

## packages/plugin-feishu — 飞书 tool-provider Plugin(private,CF Worker)

飞书官方远程 MCP(`https://mcp.feishu.cn/mcp`)的 tool-provider/v1 plugin,解决 TAT(tenant_access_token,约 2h 过期)人工续期问题:自部署进用户 CF 账户,经 `tb plugin register` 注册后 `kind:'tool'` 挂载。首个 in-repo plugin 参考实现;背景见 [../guides/mcp-upstream-pitfalls.md](../guides/mcp-upstream-pitfalls.md) 飞书小节。

| 文件 | 管什么 |
|---|---|
| `src/index.ts` | 契约面 GET `/healthz` / `/~describe` / `/~help`(negotiate DSL/JSON,复用 core 渲染器)+ POST `/` envelope(List/Get/Call;Get 由 List 过滤实现);`PLUGIN_TOKEN` Bearer 鉴权(未配置时仅要求非空);`RequestDedupe` 幂等;**上游凭证不自持**:从 `X-TB-Upstream-Auth` 读(base64url JSON `{"app_id","app_secret"}`,缺头 → unavailable 503 报"挂载须配 authRef",坏形状 → invalid_argument 400);**上游 401 → 强制重换发 TAT 重试一次**(`withTatRetry`) |
| `src/tat.ts` | TAT 换发(app_id/app_secret → token+expire)+ isolate 内存缓存(**按 app_id 键控**,同一部署可服务多凭证挂载不串号;刷新余量 5min);`force` 绕过缓存(纠错路径不回读缓存,教训同 mcp 空列表防御) |
| `src/feishuMcp.ts` | MCP SDK Streamable HTTP client:每趟请求带 `X-Lark-MCP-TAT`(原样)+ `X-Lark-MCP-Allowed-Tools`;isolate 内存会话复用(**按 app_id 键控**;400/404 清会话重握手一次);401 原样抛出;`CfWorkerJsonSchemaValidator`(workerd 禁 eval,同 gateway 坑) |
| `test/plugin.integration.test.ts` | 8 例集成测试(vitest-pool-workers 真实 workerd;mock 换发接口与 MCP 上游,默认离线),含吊销 token 后 401 强制重换发自愈、凭证头缺失/坏形状、多租户不串号 |
| env(`wrangler.jsonc`) | secrets:仅 `PLUGIN_TOKEN`(飞书凭证不落 plugin,由挂载 authRef 经 `X-TB-Upstream-Auth` 注入);vars:`FEISHU_ALLOWED_TOOLS`(默认白名单 8 工具;search-user/search-doc 仅 UAT 不列)、`FEISHU_MCP_URL` / `FEISHU_AUTH_URL`(测试 override) |

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
