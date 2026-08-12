# 代码检索地图

> 用途:"要改 X,去哪个文件"的检索入口,按包 → 目录/文件族 → 关键符号组织。真源是代码,本图只到文件族与关键符号粒度;边界与不变量的裁决见 [modules-and-boundaries.md](modules-and-boundaries.md)。更新时机:新增模块、移动文件族或公开面变化时。

## packages/core — 纯逻辑内核

唯一运行时依赖 zod;`test/` 目录同构镜像 `src/`(找某模块的测试直接对路径)。公开面 = `src/index.ts` 全量 re-export + `./node` 子导出。

| 目录/文件 | 管什么 | 关键文件(符号) |
|---|---|---|
| `auth/` | SK 与权限判定 | `scope.ts`(Scope 判定,deny 优先→allow→默认拒)、`authorizer.ts`(`Authorizer.Check` 唯一判定入口)、`registerPath.ts`(registerPaths 收紧规则)、`sk.ts`(SK 签发、sha256 哈希、`normalizeExpiresAt` 带时区 ISO→UTC 规范化、历史非法过期时间 fail closed) |
| `tree/` | 树与注册表 | `path.ts`(TreePath 规则/保留段/保留根)、`registry.ts`(`NodeRegistryStore`:Write 幂等 upsert、中间 directory 自动物化、级联回收、Resolve 最长前缀)、`visibility.ts`(可见性裁剪) |
| `htbp/` | 协议编解码 | `model.ts`(`HelpModel`)、`helpDsl.ts`(DSL 渲染,属性行顺序)、`negotiate.ts`(内容协商)、`tree.ts`(`~tree` 构建,depth/node 预算) |
| `secret/` | 上游凭证 | `secretStore.ts`(`SecretStoreImpl`,AES-256-GCM 只写不读,`resolve()` 内部专用) |
| `builtin/` | `system/*` 管理面 | sk / secret / registry / status / plugin / federation / annotation 七模块的 cmd 表 + `dispatch`(`types.ts`/`util.ts` 为公共骨架;`plugin.ts` = plugin/v2 write/update/list/get/health/delete,注册只抓 `~describe` exports,bearer auth 使用 `secretRef`;`federation.ts` = remote host 白名单增删,合并 env 基线 + `tool/allowlist.ts` 的 RemoteAllowlistStore;`annotation.ts` = Path 补充说明 set/get/remove/list,set/remove 需 admin) |
| `annotation/` | Path 补充说明存储 | `store.ts`(`AnnotationStore`:`annotation:<path>` 每 path 一条覆盖写,text ≤2000;独立于 TreeNode,工具子路径可标注;`~help` 渲染为 `note` 行/字段) |
| `feedback/` | Agent 反馈存储 | `store.ts`(`FeedbackStore`:`feedback:<path>` 单 key 数组;submit/vote/get/listViews/remove + `helpItems` 排序/阈值/top-5 唯一真源;`selectFeedbackSearchText` 仅投影 owning node 的非隐藏 top 5 title/detail并清理/截到 256 UTF-8 bytes;owner 投票去重、每 path 每 owner ≤10 防刷) |
| `search/` | 全局工具搜索共享 contract | `types.ts`(`ToolSearchOptions{mode,limit,cursor}`、轻量 candidate、只读 `SearchIndex` + `MutableSearchIndex.replace/remove/removePrefix/rebuild`;description 1024 UTF-8 bytes、完整 ToolSpec digest、default50/max200、batch100/work400、500-node audit/20 KiB lightweight snapshot、AES-GCM cursor;长词 FTS+短词 LIKE hybrid AND);`test/search/searchIndex.fixture.ts` 为 D1/SQLite v3 共用 contract并含长描述目录 |
| `tool/` | 工具层纯逻辑 | `httpTool.ts`(HttpToolDef 拼装、`{param}` 占位)、`virtualize.ts`(prefix/rename/hide/describe)、`mcpSchema.ts`(mcp schema→HelpModel)、`remote.ts`(路径改写/白名单)、`via.ts`(X-TB-Via 环检测)、`upstreamError.ts`(上游错误归一) |
| `context/` | Context 层纯逻辑 | `types.ts`(ContextEntry)、`objectStore.ts`(ObjectStore 接口 + Memory 实现)、`objectProvider.ts`(四动词语义)、`path.ts`(穿越防护)、`ttl.ts`(懒回收)、`help.ts`(静态 cmd 表) |
| `skillhub/` | Skillhub 层纯逻辑(内容型 kind,复用 context 存储) | `frontmatter.ts`(SKILL.md YAML frontmatter 最小解析,无 yaml 依赖)、`provider.ts`(`createSkillhubProvider`:以 `<id>/` 分组 + frontmatter 目录;List/Get/GetFile/Search/Publish/Remove;单文件 inline/`$ref` 复用 objectProvider)、`help.ts`(静态 cmd 表 + `SKILLHUB_CAPABILITIES`) |
| `device/` | 设备通道纯逻辑 | `frames.ts`(`DeviceFrame` 编解码;ping/pong 是稳定字面量,供 DO autoResponse 精确匹配)、`session.ts`(网关侧状态机 `DeviceGatewaySession`,含 `restoreReady` 休眠恢复)、`client.ts`(设备侧 `DeviceClient`,重连后自动重发 hello)、`shellAllow.ts`(shell 白名单匹配)、`helpModel.ts` |
| `plugin/` | Plugin 纯逻辑 | `manifest.ts`(zod 校验)、`envelope.ts`(X-TB-Context 信封编解码)、`dedupe.ts`(`RequestDedupe`)、`contract.ts`(契约校验) |
| `node/` | `./node` 子导出(唯一含 Node API) | `fsObjectStore.ts`(FsObjectStore,realpath 防逃逸)、`shellExecutor.ts`(有界缓冲、超时后等 exit 结算) |
| 顶层 | 横切 | `errors.ts`(`TBError`)、`store.ts`(`StateStore` 接口 + 内存实现 + KV key 布局注释)、`types.ts`(Node/SecretKey/Scope 等)、`version.ts`(`HTBP_VERSION`/`HTBP_HELP_HEADER`) |

## packages/app — 宿主中立应用层(npm 发布物)

**这一层是"改协议行为"的默认落点**:tbApp / bootstrap / deviceHello / providers 都在这里,gateway、server、SDK 三个宿主包只做 env→deps 适配。tsconfig 刻意 `types: []`(不引 workers-types,也不引 @types/node)——写出 `KVNamespace`/`process` 会直接编译失败,中立性由类型系统兜底而非人工纪律。公开面 = `src/index.ts`(分组 barrel)。

**协议行为按关注点分文件**(2026-08-12 从 2948 行的 `tbApp.ts` 拆出,纯移动):`tbApp.ts` 只剩装配,handler 在 `routes/*`,跨路由纯函数在 `paths`/`federation`/`deviceNodes`/`toolNodes`/`contextNodes`/`helpModel`/`responses`,注入面形状在 `deps.ts`。找 handler 先看 `tbApp.ts` 的分派表定位到 `routes/` 的哪个文件。

| 文件 | 管什么 |
|---|---|
| `tbApp.ts` | **`createTbApp(deps)`——只剩装配,144 行**:构造 Hono、建 `RouteEnv`,按顺序挂安全头中间件 → 树外免认证路由 → 认证中间件 → `/~mcp`、`/~search`、设备 WS → GET/DELETE/POST 三个通配分派 → notFound/onError。**路由顺序即安全语义**(免认证路由必须在认证中间件之前),改路由先读这里的顺序注释 |
| `deps.ts` | 宿主注入面形状 + 请求期公共类型:`TbAppDeps`(五注入点 + pluginBindings/assets/encryptionKey/… )、`DeviceChannel`、`LocalProviderHooks`、`Vars`/`AppContext`/`TbHono`、`TOOL_CACHE_TTL_DEFAULT`。**只放形状,不放行为** |
| `responses.ts` | 表现层:`tbErrorResponse`、`withSecurityHeaders`、`runHandler`、`renderHelp`/`enrichHelp`/`renderResult`/`renderTreeDsl` |
| `paths.ts` | 路径与可见性纯函数:保留段切分(`splitReserved`/`splitFeedback`)、`decodePath`、`assertRegisterPath`(注册路径规则)、`toEntry`、`filterListVisible`、`indexByParent` |
| `federation.ts` | remote 联邦:`remotePassthroughIfMatch`(命中 remote 节点或其后代即改写透传)、`remoteTreeChildren`、路径规范化/本地化、`resolveRemoteSettings`(env 基线 ∪ 运行时白名单)、`assertRemoteConfigAllowed` |
| `deviceNodes.ts` | 设备通道转发(`requireDevice`/`invokeDevice`)与 device 节点标记(`deviceMarkerOf`/`deviceToolMarker`/`relativeDevicePath`/`assertNoDeviceMarker`) |
| `toolNodes.ts` | mcp/http/tool 节点:`providerFor` 装配、`upstreamTools`(走 toolCache)、`requirePluginExport`、`mountCallContext`、工具级两级披露 `toolHelpModelFor`、动态搜索/工具缓存刷新、`assertToolConfig` |
| `contextNodes.ts` | context/skillhub:配置校验与 s3 连通探测、对象存储装配与 key 前缀、四动词/skillhub 动词分发、ttl 懒回收(`assertContextAlive`/`pruneExpiredContext`)、`parseS3Credentials` |
| `helpModel.ts` | `helpModelFor`:一个出口覆盖全 kind 的 HelpModel 组装(builtin/directory/device tool/mcp·http·tool/device/context/skillhub);remote 在调用点已透传,不进此函数 |
| `routes/env.ts` | `RouteEnv`:一次构造、全路由复用的请求外状态(`deps`/`builtinsOf`/`globalSearchCapabilities`/`searchSync`)。**handler 签名统一为 `(c, env)`**,不再靠闭包捕获 |
| `routes/publicRoutes.ts` | 树外免认证路由:`/healthz`、`/~ref/:token` 大对象中转、`/ui` Dashboard 静态资源与 SPA 回退、根路径浏览器跳转、`/~oauth/callback` |
| `routes/mcp.ts` | `/~mcp` 无状态投影桥:控制面三工具 + 树上可见节点命令/工具现算清单;调用回灌 `app.request` 复用认证链;远端发现有请求/节点/深度预算 |
| `routes/search.ts` | root-only `POST /~search`:索引命中后按 read+call 复判、kind/virtualize 裁剪,再从 canonical 工具表水合;空可见页不回 cursor |
| `routes/tree.ts` | `~tree`:一次读整棵子树后内存建 parent→子 索引;子树根须真实存在;remote 在深度边界直接标 truncated 免探测 |
| `routes/help.ts` | `~help`:根级虚拟 directory、节点级 HelpModel、非注册路径的工具级两级披露;不可见一律 404 |
| `routes/describe.ts` | `~skill`(remote 透传 / 本地 501)与 `~describe`(根回全局搜索能力,context/skillhub 回 provider 自报能力,其余 404) |
| `routes/feedback.ts` | `~feedback` GET/POST/DELETE:权限判定落目标 path 本身;写路径经 dirty marker 喂搜索派生态 |
| `routes/register.ts` | `POST ~register`(等价 NodeRegistry.Write)与 `POST ~authorize`(mcp 托管 OAuth 发起)。**顺序是硬约束**:权限判定 → Secret Reference 授权 → 出站探测 → 落库 → 失效缓存 |
| `routes/invoke.ts` | `POST /<path>` 数据面总入口(信封 `{tool,arguments}` 与直连工具路径)。**分支顺序即语义优先级**:remote 透传 → device 自定义 tool 标记 → mcp/http/tool 上游 → device shell → context/skillhub 动词 → builtin |
| `bootstrap.ts` | 首请求惰性引导:Workers 缺 `TB_BOOTSTRAP_ADMIN_SK` fail closed + `system` 七 builtin 物化(promise 防重入 + KV 幂等标志);`runBootstrap` 默认保留随机生成并向本地 stdout 展示一次的 SDK兼容路径,Node server 另以 `requireAdminSk` 默认收紧;已引导实例升级自动补挂新模块 |
| `deviceHello.ts` | **`processDeviceHello`**:设备 hello 验证 + 落库的单一真源,DO 与 server DeviceHub 共用;有 MutableSearchIndex 时 seed/mark 后批量 rebuild 派生索引 |
| `mcpServer.ts` | 无状态 `/~mcp` 桥:官方 MCP SDK server,投影 `tb_search`/`tb_help`/`tb_list_nodes` 三个稳定工具并回入同一 Hono 路由,复用既有认证/权限链 |
| `oauth.ts` | mcp 托管 OAuth 授权码流程(SDK auth() 编排 discovery+DCR+PKCE;state 为 AES-GCM 加密自包含载荷零存储;token/client/discovery 落 `mcpoauth:*`;callback HTML 实体编码 + `default-src 'none'` CSP) |
| `refToken.ts` | `$ref` 网关中转的 HMAC token 签发/校验(HMAC 用途域分离) |
| `search/synchronizer.ts` | `SearchSynchronizer`:StateStore/registry/tool cache/feedback → SearchIndex 派生投影;固定 node/subtree pending markers,hot reconcile + 每次搜索 500-node canonical audit;`canonicalSearchTools`批量权威水合;overflow seed/LKG/fail-closed/回落恢复与超额节点排除 |
| `providers/` | 除 CF binding 外的全部上游 I/O:`mcp.ts`(SDK Streamable HTTP,会话复用 + 404 重握手一次;auth:'oauth' 挂 `../oauth.ts` 的 authProvider)、`http.ts`、`remote.ts`、`toolCache.ts`、`s3Object.ts` + `s3Sign.ts`(aws4fetch)、`pluginClient.ts`(`upstreamAuthRef` → resolve 后经 `X-TB-Upstream-Auth` 注入,失败 → unavailable;`binding:<name>` 走进程内 fetch handler)+ `pluginTool.ts` + `pluginContext.ts` + `types.ts` |
| 发布形态 | tsup `platform: 'neutral'`,bundle core;**下游三个宿主包一律 `noExternal` 这个包**,理由见 [modules-and-boundaries.md](modules-and-boundaries.md) 依赖方向要点 |

| `test/` | **中立层自己的验证面**(普通 Node vitest,12 文件 121 例约 1.2s):经 `app.request()` 直打 createTbApp,不经任何宿主适配器——中立性因此是被执行验证的,不只是被 `types: []` 静态约束的。`harness.ts` 的 `createTestApp()` 复刻文件级单实例语义(对齐原 `SELF.fetch`),deps 取值与 gateway miniflare bindings 一致以便两宿主对照;`memorySearchIndex.ts` 是 `MutableSearchIndex` 的内存实现(复用 core 的序列化/digest/query 预处理/cursor 加解密,只把全文匹配换成子串),`/~search` 与 `/~mcp` 的 `tb_search` 投影靠它。**test/ 也在 `types: []` 约束内**:测试跑 Node 但不得用 Node 专属 API |

**哪些用例不在这里**:真吃 CF 语义的(DO WS hibernation、真实 D1、R2/KV binding、Static Assets)与靠 env binding 开关的 opt-in 路径留在 gateway 的 workerd 套件。

## packages/gateway — Workers 宿主适配器(可发布 Worker library)

只剩真正吃 CF binding 的代码(约 1200 行);`exports` 仅 `.`(`createApp` + `type Env` + DO)。**改协议行为请去 `packages/app`。**

| 文件 | 管什么 |
|---|---|
| `app.ts` | Workers Env→deps 适配(入口薄层;规范化 `TB_CANONICAL_ORIGIN`;可选 `TB_SEARCH: D1Database` 存在时注入 `D1SearchIndex`,缺 binding 不注入 search capability) |
| `kvStateStore.ts` | StateStore 的 KV 实现(list 跳 null、子树前缀扫描,头注释有约束说明) |
| `deviceSession.ts` | `DeviceSession` DO 胶水:WS hibernation、待决表、`setWebSocketAutoResponse`、惰性会话重建;设备子树回收同步 SearchIndex;休眠恢复与每次 invoke 重验 SK/keyId/scope/registerPaths,跨 KV await 后重读 activeConnId,`markDisconnected` 按 connId 条件清理避免旧连接覆盖新 meta。共享开发环境已通过 155s hibernation、同 ID replacement 与 allow/deny registerPaths(协议行为在 app `deviceHello.ts`) |
| `providers/r2Object.ts` | R2 binding 的 ObjectStore 实现(binding 不支持 presign,`$ref` 走 `/~ref` 中转) |
| `search/d1SearchIndex.ts` | D1 keyword v3 adapter:lightweight path/name/description/feedback FTS(10/3/1)+ meta revision/cursor secret + full ToolSpec digest/path capacity trigger;JSON1 chunks、candidate/cursor、same-digest no-op;并发500-path cap,cold query formula43≤50;v2表不迁入v3 |
| `test/` / `scripts/` | workerd 集成测试族(6 文件 76 例),**只覆盖 CF 宿主这一层**——树本身的行为在 app 的 Node 套件里:`device`/`deviceNodes` 钉 DO WS hibernation 与设备注册;`d1SearchIndex.integration.test.ts` 复用 v3 contract 并经真实 D1 执行 exact query、容量并发与 43-query 预算;`ui.integration.test.ts` 每次 fresh build;`tool.integration.test.ts` 用 `env.TB_KV` 造脏数据并挂 opt-in 真实 MCP/HTTP E2E;`context.integration.test.ts` 挂 opt-in 真实 S3 端点。`scripts/echo-mcp.ts` 兼 Compose mock,`compose-smoke.ts` 走三跳 |
| `vitest.config.ts` | 在 gateway 测试启动前无条件从当前 Dashboard source 执行 build,避免 `ui.integration.test.ts` 误验陈旧 `dist` |
| `wrangler.jsonc` | 绑定 TB_KV / TB_R2 / TB_DEVICE(DO)/ ASSETS(dashboard dist,`run_worker_first`)及 `TB_SEARCH` → `tb-search` D1(当前真实 UUID `f788b779-ec1c-4fba-ac1f-b780fab990fc`,由 provision 幂等回填)+ `account_id` + custom domain;禁 `workers_dev`/Preview URLs,用 `TB_CANONICAL_ORIGIN` 固定 OAuth callback origin |

## packages/cli — `tb`(npm 发布物)

- 框架 commander,**严格解析是刻意的**(未知 flag/子命令、flag 缺值、多余 positional 一律报错并带拼写建议——防拼错 flag 被静默吞掉导致 shell 白名单等权限误配)。
- `index.ts` 薄入口(调用 `runMain`);`main.ts`(生产解析入口:递归 `exitOverride`,Commander help/version/解析错误纳入人类/`--json` 统一输出与退出码;JSON 模式按解析后的 option value/source 判断,不扫描裸 argv);`program.ts`(`buildProgram()` 装配命令族、根全局参数与 preAction 合并,递归开启组级 `showGlobalOptions`,`.helpCommand(false)` 保留业务 `tb help [path]`);`commands/` 每命令一文件、导出工厂函数 `xCommand(): Command`(status/login/whoami/use/sk/secret/federation/note/feedback/ls/tree/search/help/call/tool/server/ctx/skill/connect/device/mount/plugin);`commands/search.ts` 直连 root `/~search`,构造 `{query,opts:{mode?,limit?,cursor?}}`,JSON 保留 Page、人类输出工具表与 next cursor;`--no-shell` 用 commander 原生否定(`opts.shell === false`)。`skill`(skillhub 命令族)镜像 `ctx`:mount/unmount 走 `~register`/`system/registry`,数据面 ls/get/search/publish/rm 走 `{tool,arguments}` 信封;`publish <dir>` 递归读本地文本文件、`get --out <dir>` 逐文件落盘(遇 `$ref` 提示)。
- 参数横切:`args.ts`(`configureGlobalOpts` + `withGlobalOpts`:根/组/叶子位置等价且叶子 help 自包含;`parsePageOpts`/`withPageOpts`:limit 1..200 + cursor;`parseIsoTimestamp`:带时区 ISO→UTC;`collect`;`resolveTarget`);`config.ts`(XDG 配置、多 profile);`http.ts`(统一 API 客户端与 AbortSignal timeout,status/login/tool auth 等一次性 HTTP 不再裸 fetch);`output.ts`(`--json`);`markdown.ts`(`printMarkdown`:TTY → marked-terminal ANSI 渲染,管道/NO_COLOR → 裸 markdown);`scope.ts`;`registry.ts`(节点管理助手,rm 前 kind 校验);`deviceRuntime.ts`(`tb connect` 长驻:partysocket 重连 + 30s 心跳判死链);`deviceId.ts`。
- 管理面对等:`commands/sk.ts` 覆盖 list/get/create/update/enable/disable/rm;`ctx.ts` 覆盖 Delete(`ctx rm`)并支持 context-provider Plugin;`tool.ts` 支持 `kind:'tool'` 的 tool-provider Plugin;`server.ts` 用 `--remote-url` 表达联邦目标(`--base-url` 只指当前网关)。返回 Page 的 SK/Secret/Plugin/Context/Skill/Server/Device list/search 统一暴露分页并保留 cursor。
- 测试基建:`test/cliHarness.ts`(runCli/parseError;exitOverride 须逐层应用,commander 不向子命令继承)+ `test/strictParsing.test.ts`(拼错 flag 事故回归 + 从 `buildProgram()` 动态枚举全部叶子路径的未知 flag 矩阵,新增命令不会静默漏测)+ `test/search.test.ts`(root URL/POST/opts 信封、JSON/人类输出与本地参数拒绝)+ `test/argSemantics.test.ts`(根/组/叶参数化、JSON/`--` 边界、条件参数、tree/timeout、分页、默认描述与管理面对等)+ `test/helpContract.test.ts`(组级 Global Options、依赖/互斥/范围/默认值/迁移/fallback;`addHelpText` 追加段用 `outputHelp()` 捕获)+ `test/phase2.test.ts`/`ctx.test.ts`(迁移与 HTTP 负载回归)。

## packages/sdk — 薄装配层(npm 发布物,4 个源文件)

- `toolBridge.ts`:`createToolBridge(config)` → `{ fetch, registerTool, registerContext, connect }`(装配 core + app 的 createTbApp/bootstrap)。
- `connect.ts`:反向连接(ws→网关设备通道)。
- `index.ts`:公开面 + 再导出 core 类型与内存宿主(MemoryStateStore 等);`types.ts`。
- 发布形态:tsup bundle,dts 经 `tsconfig.build.json` paths 内联(见 [../guides/npm-publish.md](../guides/npm-publish.md))。

## packages/dashboard — React SPA(可发布纯静态产物包,经 `/ui`)

- `App.tsx`:认证内外路由边界;页面全部 `React.lazy`。`main.tsx` 外包 `AppErrorBoundary`,动态 chunk/runtime 失败可刷新恢复。
- `components/layout/AppShell.tsx`(`AppShell`):ActivityRail / ExplorerPanel / Workspace 的组合与生命周期边界,管理 Explorer 折叠、移动 Dialog 焦点恢复和 CommandPalette。
- `components/layout/ActivityRail.tsx`(`ActivityRail`):桌面全局/管理导航及 health/theme/profile 入口;`ExplorerPanel.tsx`(`ExplorerPanel`):过滤、当前路径、TreeNav 与移动端资源/管理/账户面板;`navigation.ts`(`MANAGE_LINKS`)为两者共用的管理导航元数据。
- `components/layout/TreeNav.tsx`(`TreeNav` / `TreeBranch` / `localizeSubtree` / `handleTreeKeyDown`):根树 depth=1、本地截断懒取 depth=1、remote 及后代纯透传 depth=3、仅非空过滤走 root depth=8;同一受控状态维护展开、过滤后的可见顺序与 ARIA tree 键盘焦点。
- `pages/`:LoginPage / OverviewPage;`SearchPage.tsx` 是独立 root tool search 页,提交查询后展平 cursor pages,区分权限/404/空态并把结果链接到 NodePage的 `?tool` 预选;`NodePage` 是未知节点的通用协议回退并编排命令、Context、帮助、Note/Feedback tabs,直接 import `pages/system/forms/MountDialog`而不依赖 Registry route module。`pages/system/` 的 RegistryPage 协调 registry list/mutation与详情展示,PluginsPage 另保留 health/详情 dialog,SkPage 另保留创建 dialog与状态展示;DevicesPage / SecretsPage / FederationPage 承载其余已知 builtin 工作流。
- `pages/system/forms/`:三套系统表单的独立所有权边界。`registryConfig.ts` 是六 kind + virtualize 的纯 wire builder,`RegistryKindFields.tsx`/`MountDialog.tsx` 分别负责 kind 字段与挂载生命周期;`pluginManifest.ts` 是 plugin/v2 纯 builder,`PluginManifestFields.tsx`/`PluginFormDialogs.tsx` 负责字段与注册/编辑 dialog;`skConfig.ts` 是 SK wire builder,`SkFormFields.tsx` 负责 scope/registerPaths 字段。共用 section 在 `components/FormSection.tsx`。
- `components/node/CommandWorkspace.tsx`(`CommandWorkspace`):只挂载当前命令的 CmdPanel,并消费 `?tool` 做搜索结果预选;`CmdPanel.tsx`(`CmdPanel`):schema 表单、tool-level `~help`、调用与 mutation→invalidate Promise 链;`ContextBrowser.tsx`(`ContextBrowser`):桌面 master-detail/移动 dialog,List/Search/cursor/metadata/`$ref` 和原子 content/version/`$ref` 编辑基线。`ResultView` / `CliHint` / `SchemaFormRenderer` / `NoteCard` / `FeedbackPanel` 分别承载结果、CLI 提示、lazy RJSF、注解与反馈。
- `components/PageHeader.tsx` / `EmptyState.tsx` / `PaginationFooter.tsx` / `ConfirmAction.tsx` + `components/ui/table.tsx`:系统页共用的页面头、空态、分页、确认和表格骨架;`CommandPalette.tsx`、`AppErrorBoundary.tsx` 与 `components/ui/` 为横切组件。
- `lib/`:api.ts(同源 `baseUrl:''`,含直连 root `searchTools` 且节点 API 统一调用 `encodeTreePath`)、queries.ts(`usePagedBuiltin` + `useToolSearch`,query key 隔离 profile/BaseURL/revision/query/mode/limit,cursor 仅作 pageParam)、path.ts(`encodeTreePath`:逐 raw segment 编码但保留 `/`)、schemaForm.ts、session.tsx(SK 多 profile;换凭据/删档案清 Query/Mutation cache)、history.ts(v2 metadata allowlist,不持久化调用参数)。
- `vitest.config.ts` 使用 Node environment;`test/systemForms.test.ts` 10 cases 直接断言 Registry/Plugin/SK builder 的 wire shape与 fail-closed 分支。Dashboard `test` script 已加入根 `test:unit`;不含 DOM/React render,不能替代 dialog 生命周期、分页、草稿保留与一次性敏感值的组件/浏览器证据。协议/静态接线另由 gateway fresh-source `ui.integration.test.ts` 覆盖。产品级可重跑浏览器回归仍缺;Round 25 真实浏览器核对 desktop/mobile 无横向溢出且 console 0。验收矩阵见 [../guides/verification-and-commit-practices.md](../guides/verification-and-commit-practices.md)。

## packages/plugins/src/feishu — 飞书 tool-provider Plugin(private,CF Worker)

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
| `sqliteSearchIndex.ts` | Node keyword v3 adapter:与StateStore共用`state.sqlite3`文件但用独立连接/独立表;lightweight source/FTS/meta/full-spec digest snapshot,事务化replace/rebuild+500-path trigger,candidate/AES-GCM cursor,复用shared contract且忽略旧full-row表 |
| `config.ts` | `configFromEnv`:TB_* 与 CF 同名同义 + TB_PORT(默认 8787,0=临时)/ TB_HOST / TB_DATA_DIR(默认 /data,本地回退 ./data)/ TB_UI_DIR;`TB_ALLOW_INSECURE_BOOTSTRAP` 仅显式放行随机 Admin SK兼容路径,默认 false |
| `objects.ts` | `createDataObjectStore`:FsObjectStore('r2' provider 落点)前缀适配器,key 出入口加/剥 `objects/` 首段;无 presign → `$ref` 走 `/~ref` 中转 |
| `deviceHub.ts` | ws `DeviceChannel`:http 'upgrade' + ws handleUpgrade;认证双点(升级前 identify 401 + processDeviceHello 权威判定),每次 invoke 重验 SK/keyId/scope/registerPaths并在 await 后复核 `activeByDevice` generation;复用 core `DeviceGatewaySession`;ws ping 踢半开;断线回收 = `devicemeta:<id>` 持久 meta + 进程内 timer + 启动 `sweepOrphans`;幂等结果表仅内存(有意分叉) |
| `assets.ts` | `/ui` 静态托管:`TB_UI_DIR` override优先且须含index.html,否则fail closed;未设时才解析dashboard包dist;contentType复用core fsContentTypeOf。production Docker final固定指向真实目录 `/app/dashboard` |
| `server.ts` | `createTbServer`:构造 TbAppDeps(对位 gateway app.ts),注入 `SqliteSearchIndex`;start() 默认以 `requireAdminSk:true` 直调 runBootstrap后再 hub.sweepOrphans,显式 insecure escape才放宽;close() 关闭 search/state 的独立 SQLite 连接 |
| `main.ts` | bin 入口(shebang);bootstrap 失败在监听前退出非 0并给出安全指引;SIGINT/SIGTERM 优雅关闭 |
| `test/` | `bootstrap.test.ts` 钉 Node bootstrap;`device.integration.test.ts` 用 barrier+mutation钉连接代际;`sqliteSearchIndex.test.ts` 复用 v3 lightweight shared contract;`server.integration.test.ts` 在重启后真实 TCP/SQLite执行两个 exact query,先用 admin证明 visible+hidden入索引,再用窄 `read+call` SK精确裁剪;server 全包当前 38 passed |
| 发布形态 | tsup bundle core+app(两者均 noExternal;`dts.resolve` 须收窄为数组且与 `tsconfig.build.json` 的 paths 一一对应,漏配会在 d.ts 留下悬空 import,`true` 会把 node:http 类型降级 undefined);better-sqlite3/ws/hono/@hono/node-server 留 external;publishConfig 覆盖指 dist |

## scripts/ 与 CI

- `scripts/`:gen-dev-vars/provision/smoke及可重跑验收脚本。`verify-mcp.ts` 用官方 SDK做admin/narrow双连接与双call;`verify-search.ts` 是根 `verify:search` 入口,构建CLI后只读执行 `日程`/`create document`,admin/narrow各沿opaque cursor拉全(200/页,最多20页),拒绝重复项/cursor,再验证窄结果非空、TreePath段前缀、admin子集和严格缩小;必填 `TB_BASE_URL`/admin SK/`TB_SEARCH_NARROW_SK`/`TB_SEARCH_ALLOWED_PREFIX`,不创建fixture或修改目标环境状态。Round 32 已在共享开发环境以临时 fixture/SK 验证并清理。
- `.github/workflows/`:publish-{cli,sdk,app,gateway,dashboard,server}.yml(tag `<pkg>-v*`,npm Trusted Publishing)+ publish-docker.yml(tag `server-v*`,GHCR 镜像,buildx amd64/arm64)。
- 仓库根:`Dockerfile`(production多阶段node:22-bookworm→slim;legacy deploy的Dashboard workspace symlink在final会悬空,故显式COPY fresh `dashboard/dist`→`/app/dashboard`并设`TB_UI_DIR`;单容器CMD仍为`node /app/dist/main.js`)+`.dockerignore`;`docker-compose.yml`另组localhost gateway+内网plugin/upstream+profile smoke。`compose-smoke.ts`先断言`/ui/`与`/ui/manage/registry`为Dashboard HTML,再跑三跳业务链。
