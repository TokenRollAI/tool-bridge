# 当前状态(MUST)

> 用途:每次会话开场必读的易变状态快照(部署、代码现状、凭据配置、工具链、未竟事项)。更新时机:部署/凭据/工具链/能力面变化时,由当轮 Agent 更新本文件。最后核实日期:2026-07-10。

## 项目状态

- **初步实现阶段已完成**(2026-07-07 "破壳"):SK 鉴权与作用域、HTBP 核心树与内容协商、Tool 层(mcp/http/remote 联邦 + 虚拟化)、Context 层(r2/s3 四动词 + Search + `$ref` 大对象)、设备反向注册(DO WebSocket hibernation)、SDK、Plugin 系统、Dashboard 均已落地并经生产验证。
- 2026-07-07:修复"挂载 MCP 过一段时间失效"生产故障(不合规上游对过期会话回 200+空列表,见 [../guides/mcp-upstream-pitfalls.md](../guides/mcp-upstream-pitfalls.md))。2026-07-08 同故障复发:初版防御的重试回读 KV 被边缘读缓存击穿(拿回刚删的旧会话),已改为重试强制完整重握手(`forceFresh`,PR #8)并补钉死用例,**已部署上线**且经塞伪 session 复现验证自愈(工具列表恢复、KV 回填新会话)。
- 2026-07-08:`~help` 可读性重构:新增 `Accept: text/markdown` 可读表现(renderHelpMarkdown)、`hint` 行/字段(下一步指引)、索引形态 h 一句话摘要(此前上游 mcp 整篇多行 description 原样撑爆索引并破坏 DSL 行结构)、DSL 多行值安全化(node 行折叠单行、多行 h 续行缩进)、`tb help --md`;契约见 [../reference/protocol-contract.md](../reference/protocol-contract.md)。**已部署上线**(smoke 通过;生产实测根/mcp 索引/单工具三级 markdown 与索引一句话化均生效)。
- **Docker/Node 宿主部署路径已落地**(2026-07-08):`@tool-bridge/server` 包(SQLite + FS + ws DeviceHub)+ 根 Dockerfile + GHCR/npm 双发布 workflow;本机与 Docker 验收全过(smoke/verify-device/verify-plugin/重启持久)。见 [../guides/docker-host.md](../guides/docker-host.md)。
- 2026-07-08:**Path 补充说明 + Agent 反馈能力**落地(本轮)——①builtin `system/annotation`(七模块):admin 对任意 path(含工具子路径、根=全树公告)写补充说明,网关 `enrichHelp` 注入该 path `~help`(DSL `note` 行 / JSON `note` / Markdown Notes 节);②**`~feedback` 新保留段**(per-path 一级协议能力,非 builtin):`GET /<path>/~feedback`(列表,?hidden=1)/`GET .../<id>`(详情)/`POST`(提交 {title≤80,detail≤500},call scope)/`POST .../<id>`(投票 up|down|clear,每 owner 一票可改票)/`DELETE .../<id>`(admin);净分>-3 前 5 条注入 `~help` feedback 块(带 use 指引行,未知行忽略通道,DSL↔JSON 等价);权限判定落目标 path(窄 scope SK 天然可用);存储 `annotation:<path>` 单条 + `feedback:<path>` 单 key 数组(KV last-write-wins 接受并发窗口);CLI `tb note`/`tb feedback` + Dashboard NodePage(NoteCard + 反馈 tab)三入口对等;根 `~help` hint 与 `tb --help` 尾部文案双向引导 feedback 习惯(用前查经验、踩坑后回馈)。契约见 [../reference/protocol-contract.md](../reference/protocol-contract.md)。**已部署上线**(首次随 Worker version 43 生效;2026-07-10 生产只读复验 `GET /system/annotation/~help` 与节点 `GET /~feedback` 均为 200;此前本机 Node 宿主全链路 E2E 与 Dashboard 实操均已通过)。
- 2026-07-16:**skillhub 新 kind 落地**(本轮,与 context/device 并列的一等内容型 kind:Agent Skill 仓库)——每个 skill = 一个目录 `<id>/SKILL.md`(Claude 约定的 frontmatter name/description)+ 若干 UTF-8 文本文件;发布到平台自带 R2(provider r2,**无需外部凭证**;s3 可 opt-in)。存储引擎完全复用 context 的 ObjectStore/ObjectContextProvider(etag 版本、`$ref`/`~ref` 大对象、按 `skills/<path>` 前缀隔离、ttl/readOnly);唯一净新逻辑是 core `skillhub/`(frontmatter 最小解析器 + `createSkillhubProvider` 的"以 skill 为单位"分组)。数据面动词:`List`/`Get`(含 `{id,file}` 取单文件)/`Search`(read)+ `Publish`(整体替换,校验含 SKILL.md 且 name/description 必填)/`Remove`(write);服务端解析 frontmatter → `List` 目录(id/name/description/version)、`Search` 覆盖 name/description(渐进式发现)。三入口对等:CLI `tb skill mount/publish/ls/get --out/search/rm/unmount`(`get --out` 把 skill 落到本地 `.claude/skills/<id>/` 直接可用)+ Dashboard(KindBadge/NodePage SkillBrowser/RegistryPage 挂载表单全集成)+ API。核心接线与既有 `tool` kind 同路径(`types.ts` NodeKind/NODE_KINDS/NodeConfig + 网关 handleInvoke/helpModelFor/handleDescribe/assertSkillhubConfig/`~ref` 泛化);`~skill` 保留段(节点使用指南)与 `skillhub` kind 语义正交,不冲突。新增 gateway `skillhub.integration.test.ts`(9 例,真实 workerd + 本地 R2)+ cli `skillhub.test.ts`(12 例);`~skill` 保留段本地仍 501 占位未变。**尚未部署/发布**(本地 verify 全绿)。
- bootstrap 期过程文档已归档 `archive/`;知识真源 = 代码 + llmdoc(见 [project-brief.md](project-brief.md))。
- 2026-07-08:**CLI 与 API 描述面向 Agent 重整**(本轮)——①builtin 七模块(sk/secret/registry/status/plugin/federation/annotation)每 cmd 补 `h` 一句话说明,inputSchema 属性全量补 `description`(owner ref 格式、Scope 结构 items schema、opts 分页语义等;新增 `util.ts` `LIST_OPTS_SCHEMA` 共用分页 schema,sk/registry 的 write/update.patch 共享字段 schema 常量);②context 六动词 `h` 与 device shell(`describeAllow`/exec/`SHELL_DESCRIPTION`)文案由中文改英文(~help 消费方是任意 Agent,统一英文口径;shellExecutor permission_denied 消息同步,4 处钉住测试已同步);③CLI:顶层 description 加起步指引(login→ls/help→call),call/sk create/tool mount/ctx/connect 补 `addHelpText` Examples,whoami 描述去噪。**已发布/部署**(CLI 由 npm 0.6.1 承载,API 描述首次随 Worker version 43 生效)。
- 2026-07-08:**CLI markdown 终端富渲染**(本轮)——`tb help` 与 `tb call`(人类模式)的 markdown 输出按 stdout 形态分流:TTY → marked-terminal 渲染 ANSI 富文本(标题着色、表格盒线、代码高亮),管道/重定向/Agent 捕获或 `NO_COLOR` → 裸 markdown 原样(对机器最优形态);`tb help --md` 语义从"无操作别名"变为**强制裸 markdown**(TTY 下也不渲染,便于复制/落文件)。落点 `cli/src/markdown.ts`(`printMarkdown`/`shouldRenderAnsi`,渲染失败降级裸输出);新依赖 marked@15(marked-terminal peer 上限 <16,勿升 16+)+ marked-terminal@7(@types/marked-terminal 的返回类型标错需断言桥接)。**已发布**(`@tool-bridge/cli` 0.6.1;verify 全绿,TTY/管道双形态已实测)。
- 2026-07-08:**直连工具调用**上线(PR #9)——`POST /<node>/<tool>` body 即 arguments 本体,`~help` 宣告直连路径(CmdSpec `flatBody`);信封入口 `POST /<node>` + `{tool,arguments}` 保留。CLI(`tb call <node>/<tool>`,--tool 变 optional)与 Dashboard(CmdPanel 按 cmd.path 判别、CliHint 同步)同轮对齐。已部署上线并经生产直连调用实测。
- 2026-07-08:**mcp 托管 OAuth 上线并经真实上游验证**——`config.auth:'oauth'` 的 mcp 挂载由网关全托管授权码流程(SDK auth() 编排 discovery+DCR+PKCE;`POST /<path>/~authorize` 发起、`GET /~oauth/callback` 回调,state 为 AES-GCM 加密自包含载荷零 KV 存储;token/client/discovery 落 `mcpoauth:*`,SDK 自动刷新;CLI `tb tool mount --auth oauth` + `tb tool auth`;Dashboard 挂载面认证三选 + 列表钥匙按钮)。**严格上游降级通道**:Bytebase 等上游 DCR 硬编码 redirect 白名单只放行 loopback/知名客户端(不可配置),`~authorize` 可带 body `{redirectUri}`(仅 loopback)+ `tb tool auth --local`(本机临时端口收回跳,code 转交网关兑换)。已部署并经生产 Bytebase 实测全链路(--local 授权 → 工具列表 → 真实调用)。已知限制:refresh token rotation 上游 + 多 isolate 并发刷新可能互相作废(失败回「重新授权」指引可自救)。
- 2026-07-08:**内容协商默认翻转为 markdown**——所有端点默认(无 Accept/`*/*`/未知类型)返回 `text/markdown`,声明 `Accept: application/json` 才回 JSON;紧凑 Help DSL 保留但降为显式通道(`Accept: text/plain`;`~tree` 同理,markdown 表现为 code fence 包缩进树)。归类唯一入口 core `htbp/negotiate.ts`。CLI:`tb help` 默认 markdown、新增 `--dsl`、`--md` 变默认别名;Dashboard:节点页「~help 原文」DSL tab 换成「~help 文档」markdown tab(react-markdown 渲染)。内部消费不受影响(plugin 契约抓取与 Dashboard 表单显式 Accept json;remote 透传原样转发 Accept)。契约见 [../reference/protocol-contract.md](../reference/protocol-contract.md)。**已部署上线**(2026-07-08:smoke 通过含新双表现断言;生产 curl 实测默认 markdown / text/plain DSL / json / ~tree fence 四形态均生效)。
- 2026-07-08:remote 联邦 host 白名单从"部署期 env-only"扩为"env 基线 ∪ 运行时可增删"——新增 builtin `system/federation`(admin scope)+ `RemoteAllowlistStore`,三入口对等(`tb federation ls|add|rm` + Dashboard「联邦白名单」页 + API);env 基线条目只读不可删。**已部署上线**(evilstar 账户)。
- 2026-07-08:Dashboard 树发现性能修复(远端联邦树慢)——根因是根 `~tree` 聚合 remote 子树时 `getChildren` 对**每个**远端节点单独 fetch 上游(N+1,首屏 21s;上游自身仅 1.8s)。修复两处:①前端 TreeNav 改**懒加载**(首屏 depth=1 不碰远端,展开某节点按需拉;remote 节点/其后代走纯透传 depth=3,本地目录 depth=1 免 N+1;NodePage/TreeNav 对纯透传返回的远端 path 做 localize 补挂载前缀);②core `buildTree` 加 `opaqueKinds`——深度边界(`depthLeft<=0`)对 remote 节点免 fetch 直接标 truncated(gateway 传 `{'remote'}`),消除边界探测的远端往返。实测首屏 21s→<1s(热)、展开 remote 目录 7s→<1s。**已部署上线**。
- **npm 已发布**(四包均经 CI Trusted Publishing;core 为 private 不发布):`@tool-bridge/cli` 0.7.0(2026-07-10,Agent 体验修复:positional args / retryable / --timeout / feedback hint;tag `cli-v0.7.0`,run `29092102298` 成功且 npm `latest=0.7.0`)、`@tool-bridge/sdk` 0.4.0、`@tool-bridge/gateway` 0.4.0、`@tool-bridge/dashboard` 0.6.0(2026-07-10,tree-first 整站大修;tag `dashboard-v0.6.0`,Trusted Publishing run `29068385868` 成功且 npm `latest=0.6.0`)。gateway/dashboard 的 Trusted Publisher 已配置生效;`@tool-bridge/server` 0.1.0 可发布,**待手动首发 + 配 Trusted Publisher**。发布流程见 [../guides/npm-publish.md](../guides/npm-publish.md)。**坑:一次推多个 tag(`git push origin tag1 tag2 …`)不触发 tag workflows,须逐个 push**(2026-07-08 实测:四 tag 同推零触发,删除后逐个重推全部触发;同日逐个推四 tag 复验全部正常触发)。
- 2026-07-08:**mcp 上游自定义请求头**落地——mcp NodeConfig 新增 `authHeader`/`authScheme`(与 http 同语义)与静态明文 `headers`(凭证头覆盖同名),动机是接入飞书官方 MCP(`X-Lark-MCP-UAT/TAT` 原样注入 + 必带 `X-Lark-MCP-Allowed-Tools`,见 [../guides/mcp-upstream-pitfalls.md](../guides/mcp-upstream-pitfalls.md));CLI(`--auth-header/--auth-scheme` 变 mcp/http 共用、`--header` 仅 mcp)与 Dashboard 挂载表单同轮对等。**已部署上线**(2026-07-08 随 0.3.0 内容协商部署一并上线);飞书未走直挂形态(生产采用 plugin-feishu,见下条),直挂静态凭证通道保留未实际使用。该扩展保留不回滚:直挂静态凭证的 MCP 上游仍是合法路径。
- 2026-07-08:**plugin-feishu 新包**(commit ae8ab02)——飞书官方远程 MCP 的 tool-provider/v1 plugin(CF Worker,自部署进用户 CF 账户),动机:TAT 约 2h 过期,plugin 内自动换发 + 上游 401 强制重换发自愈,免人工 `tb secret set` 续期;凭证会过期的上游推荐此形态,直挂 kind:mcp + 静态 TAT 适合一次性验证。**已部署已注册已挂载**(2026-07-08 实测)——Worker `tb-plugin-feishu` @ https://tb-plugin-feishu.shuaiqijianhao.workers.dev(DJJ 账户);生产网关 `tb plugin register`(id=feishu,platform-token)+ 挂载树节点 `feishu`(kind:tool,authRef=feishu-app);`tb help feishu` 经完整链路(网关→plugin→TAT 换发→飞书 MCP)列出 8 工具;**业务调用已生产复验通过**(2026-07-08,用户开通 docx 应用权限后):create-doc 建档、fetch-doc 读回、update-doc append 追加(注意 `mode` 参数必填)全链路成功;list-docs 仍差 drive:drive 权限(99991672,用户按需开通)。**注意**:TAT 应用身份创建的文档归属应用,用户账号默认不可见,须 create-doc 传 `folder_token`/`wiki_node` 落到用户可见目录(应用需先被加为该目录协作者)或经 add-comments @用户 分享。
- 2026-07-08:**plugin 上游凭证边界重构**(commit 8af6914,已生产迁移 + 终验)——plugin 上游凭证(飞书 app_id/app_secret)不再由 plugin Worker secret 自持,改存平台 SecretStore,kind:'tool' config 新增 `authRef`,网关每次调用 resolve 后经新头 `X-TB-Upstream-Auth`(base64url)注入 plugin(resolve 失败 → unavailable 快速失败);动机:公网 endpoint 的 plugin 自持凭证时 PLUGIN_TOKEN 泄漏即凭证可用、换凭证须重部署,现在 plugin 无凭证即空壳,轮换只需 `tb secret set`。plugin-feishu 同步:TAT 缓存与 MCP 会话按 app_id 键控(多凭证挂载不串号,有测试钉住)。生产迁移完成:网关与 plugin 重部署、plugin 三 secret 删至仅剩 PLUGIN_TOKEN、挂载节点 `feishu` 配 `authRef:"feishu-app"`、`tb secret set feishu-app`(JSON {app_id,app_secret})后 create-doc 经新路径写团队 wiki 终验通过。
- 2026-07-10:**Dashboard 0.6.0 整站大修已发布并在生产生效**——信息架构重整为 `ActivityRail` + 可折叠 `ExplorerPanel` + 全宽 Workspace,移动端资源抽屉关闭后恢复焦点;TreeNav 保持 root depth=1、本地截断懒取 depth=1、remote 及后代纯透传 depth=3、仅非空过滤取 root depth=8,并以受控展开/可见顺序/焦点状态实现 ARIA tree roving focus。`NodePage` 继续作为通用协议回退,`CommandWorkspace` 只挂当前 `CmdPanel`,Context 使用桌面 master-detail/移动 dialog 且保持正文/version/`$ref` 原子基线;六个系统页对齐 builtin/CLI 的已知工作流、cursor 边界与危险操作 Promise 结算,历史/session/lazy route 安全边界延续 0.5.0。真实浏览器终验覆盖桌面/移动全部路由、树请求边界与键盘导航,无 document 横向溢出且 console 无 error/warning;SK 一次性值、Secret upsert 与 Registry replace 警告均已实操。`pnpm verify` 全仓 **1005 passed / 7 skipped**,退出码 0。发布证据:commit `e363e01`,tag `dashboard-v0.6.0`,Actions run `29068385868` 成功,npm `@tool-bridge/dashboard` 的 `latest=0.6.0`;生产 `/ui/` 首次由 Worker version 44(`eb4e8daf-7b5d-44ff-a91b-5b8074348854`)承载,HTML SHA-256 为 `2420378ce98842928fdad91c5ad87ae2f3956bb83c2853c929f1abd7d550a264`,生产 smoke 通过。后续纯文档提交可能生成内容等价的新 Worker version,故当前部署序号应以 `wrangler deployments list` 为准;Gateway `/healthz` 版本仍为 0.4.0。
- 2026-07-10:**CLI Agent 体验修复**(本轮,源自真实 agent 使用反馈:参数试错/超时不可控/retryable 丢失/feedback 机制零使用)——①`tb call` 第二 positional 收裸 JSON arguments(`tb call <path> '{...}'`;与 `--args`/`--args-file` 三源互斥,误写 `--json '{...}'` 形态自然工作,严格解析不破坏:第三个 positional 仍硬失败);②CLI 错误呈现 TBError `retryable`(此前在 `toCliError` 被丢弃):人类模式加 `(retryable — try again)` 尾注、`--json` 错误对象带 `retryable` 字段;③全局 `--timeout <seconds>`(默认 120s,`AbortSignal.timeout` 实现,超时报 retryable 错误并提示加大 --timeout);④**失败现场 feedback 引导**:`tb call` 失败(unavailable/internal/invalid_argument/rate_limited)时尽力拉取该 path `~feedback`(限时 5s、失败静默),有条目 stderr 列 top 3 + `tb feedback get` 下钻命令(--json 带结构化 `feedback`),无条目引导 `tb feedback submit`——把已建成但闲置的经验闭环推到 agent 注意力所在的报错现场;⑤core 上游错误 message 英文化(upstream unavailable/returned HTTP N,统一英文口径)。落点:cli `http.ts`(CliError+retryable/hint/feedback、apiFetch 超时)/ `args.ts`(--timeout)/ `output.ts`(reportError)/ `commands/call.ts`(positional+attachFeedbackHint)、core `tool/upstreamError.ts`。新增 `test/callUx.test.ts`(16 例),CLI 178 测试全绿,verify 全仓通过;生产实测 positional 双形态/超时/invalid_argument 触发 submit 引导。**已发布**(`@tool-bridge/cli` 0.7.0,PR #22 merge 后 tag `cli-v0.7.0` 触发 run `29092102298` 成功,npm `latest=0.7.0`)。

## 已部署资源(DJJ 账户)

| 资源 | 名称/地址 | 备注 |
|---|---|---|
| Worker | `tb-gateway` @ https://tool-bridge.pdjjq.org | custom domain(zone pdjjq.org);`wrangler.jsonc` 已写死 `account_id`;DO `DeviceSession` 绑定 `TB_DEVICE`(migration v1,sqlite);Dashboard 经 Static Assets 挂 `/ui`(`run_worker_first: true`);Dashboard 0.6.0 的上线证据为 Worker version 44(`eb4e8daf-7b5d-44ff-a91b-5b8074348854`),后续内容等价部署不改变该发布事实;运行时 `/healthz` 版本属 Gateway 0.4.0,Static Assets 中 Dashboard 为 0.6.0(两者版本归属不可混用) |
| Worker secrets | `TB_BOOTSTRAP_ADMIN_SK` / `TB_SECRET_ENCRYPTION_KEY` | 已 `wrangler secret put`;前者是 Admin SK 明文(引导时 sha256 入库) |
| KV | `tb-kv`(id `d18c93de33cf4ba2b1fbf7d26fd742f1`) | 绑定名 `TB_KV`;id 已回填 wrangler.jsonc |
| R2 | `tb-r2` | 绑定名 `TB_R2` |
| Worker | `tb-plugin-feishu` @ https://tb-plugin-feishu.shuaiqijianhao.workers.dev | 飞书 MCP tool-provider plugin,secrets 仅 `PLUGIN_TOKEN`(飞书凭证存平台 SecretStore `feishu-app`,经挂载 authRef 注入),生产网关注册 id=feishu、挂载路径 `feishu`(authRef=feishu-app) |

## 代码现状(pnpm monorepo,测试数为 2026-07-10 实跑)

- `packages/core` — 纯逻辑内核(唯一运行时依赖 zod),**681 个单测**,模块族:
  - `auth/`(scope 判定 / authorizer / 注册路径规则 / sk 签发与哈希)、`tree/`(path 规则 / NodeRegistryStore / visibility 裁剪)、`htbp/`(helpDsl / helpMarkdown / summary / HelpModel / negotiate / tree 构建)、`secret/`(AES-256-GCM 只写不读)
  - `builtin/`(**七模块**:sk / secret / registry / status / plugin / federation / annotation 的 cmd 表 + dispatch)、`annotation/`(AnnotationStore)、`feedback/`(FeedbackStore:排序/阈值/top-5 选条真源)
  - `tool/`(HttpToolDef 拼装、虚拟化、mcp schema→HelpModel、remote 路径/白名单/Via、上游错误归一、**RemoteAllowlistStore** 运行时白名单存储)
  - `context/`(四动词 objectProvider / objectStore 接口 / path 穿越防护 / ttl)
  - `device/`(帧编解码 / 会话状态机 / 设备侧 client / shell 白名单 / helpModel)
  - `plugin/`(manifest 校验 / envelope 编解码 / RequestDedupe / 契约校验)
  - `node/`(`./node` 子导出:FsObjectStore realpath 防逃逸 + shellExecutor 有界缓冲)
  - 顶层 `errors.ts`(TBError)/ `store.ts`(StateStore 接口 + 内存实现)/ `types.ts`。
- `packages/gateway` — Workers 胶水(可发布 Worker library:tsup 单文件 ESM bundle core,`src/index.ts` 另 export `createApp` 与 `type Env`;dev exports 指 src(含 `./deviceHello`)、发布形态 publishConfig 覆盖指 dist),**119 个默认集成测试 + 6 个 opt-in skipped**(真实 workerd;含 mcp 过期会话空列表防御、自定义认证头与托管 OAuth 全链路的 mock 上游用例、system/federation 运行时白名单叠加用例、annotation/~feedback 端到端 meta 用例):`app.ts`(Env→deps 适配)/ `tbApp.ts`(**宿主中立 createTbApp**,路由/认证/HTBP/remote 聚合,SDK 复用;remote 白名单经 `resolveRemoteSettings` 取 env 基线 ∪ 运行时条目)/ `bootstrap.ts` / `deviceHello.ts`(宿主中立 processDeviceHello,DO 与 Node DeviceHub 共用)/ `oauth.ts`(mcp 托管 OAuth:加密 state + OAuthClientProvider + 发起/回调编排)/ `kvStateStore.ts` / `refToken.ts`(`$ref` 中转 token)/ `deviceSession.ts`(DeviceSession DO 胶水)/ `providers/`(mcp / http / remote / pluginTool / pluginContext / pluginClient / r2Object / s3Object / s3Sign / toolCache);`wrangler.jsonc` 在此包内。
- `packages/cli` — commander 框架(严格解析:未知 flag/子命令报错,防权限误配),**178 个单测**(含拼错 flag 事故回归 strictParsing、callUx 的 positional/feedback-hint/timeout 回归),**20 个命令**:status / login / whoami / use / sk / secret / federation / note / feedback / ls / tree / help / call / tool / server / ctx / connect / device / mount / plugin;全局 `--json` / `--timeout`;配置 `~/.config/tool-bridge/config.json`(XDG,多 profile)。
- `packages/sdk` — 薄装配层(4 个源文件),**12 个单测 + 1 个 opt-in**;公开面 `createToolBridge(config)` → `{ fetch, registerTool, registerContext, connect }`,复用 core + gateway 的 createTbApp;再导出内存宿主实现(MemoryStateStore 等)。
- `packages/dashboard` — React 19 + Vite + Tailwind 4 + shadcn/ui + @rjsf + TanStack Query SPA(可发布纯静态产物包:只发 dist,依赖全在 devDependencies):tree-first 工作台由 `AppShell` 组合 `ActivityRail`、可折叠 `ExplorerPanel` 与 Workspace,移动端资源抽屉保持关闭焦点恢复;`TreeNav` 按 root=1/local=1/remote=3/nonempty-filter=8 的查询边界懒取并 localize remote path,受控状态统一 expanded、可见顺序与 ARIA tree roving focus。`NodePage` 是未知节点的通用协议回退,`CommandWorkspace` 只挂当前 `CmdPanel`,`CmdPanel` 的 mutation→invalidate 由独立 `mutateAsync` Promise 链结算;Context 浏览器为 master-detail/dialog,List/Search/cursor/metadata/`$ref` 与正文/version/`$ref` 原子基线同在。SK·Registry·Devices·Secrets·Plugins·Federation 六页对齐 builtin/CLI 的已知工作流、cursor 知识边界和危险/并发操作语义(Registry 全 NodeConfig/OAuth/virtualize,Plugins 六动作,SK scope 全面,Devices 不虚构递归删除,Federation env 只读);调用历史 v2、profile/BaseURL/revision 隔离、路由 lazy 与 `AppErrorBoundary` 安全边界继续保留。无专用后端(同源消费 HTBP),行为由 gateway 的 `ui.integration.test.ts` 覆盖;`pnpm deploy:all` 先 build dashboard 再部署 gateway。
- `packages/plugin-feishu` — 飞书 tool-provider plugin(private,CF Worker),**8 个集成测试**(真实 workerd,mock 换发接口与 MCP 上游,默认离线):TAT 自动换发与缓存、契约面/envelope、401 强制重换发自愈、凭证头缺失/坏形状、多租户按 app_id 键控不串号;文件职责见 code-map。
- `packages/server` — Node/Docker 宿主胶水(可发布 bin `tool-bridge-server`,0.1.0),**23 个测试**(5 文件,纯 Node vitest):`sqliteStateStore.ts`(better-sqlite3 单表 kv,WAL,强一致)/ `config.ts`(configFromEnv,TB_PORT/TB_HOST/TB_DATA_DIR/TB_UI_DIR)/ `objects.ts`(FsObjectStore 前缀适配)/ `deviceHub.ts`(ws 设备通道,复用 core DeviceGatewaySession + gateway processDeviceHello)/ `assets.ts`(/ui 静态托管)/ `server.ts` + `main.ts`;tsup bundle core+gateway,better-sqlite3/ws/hono 等留 external;根 Dockerfile 产出镜像。详见 [../guides/docker-host.md](../guides/docker-host.md)。
- `scripts/` — `gen-dev-vars.mjs` / `provision.mjs` / `smoke.ts`(healthz + 无 SK 401 + 带 SK 200)+ 三个可重跑生产验收脚本:`verify-revocation.ts`(吊销传播,实测 0.3s)/ `verify-device.ts`(设备 shell/fs/registerPaths 全链路,可选跨休眠用例)/ `verify-plugin.ts`(Plugin 注册→挂载→四动词全流程)。
- CI(.github/workflows/):`publish-cli.yml`(tag `cli-v*`)/ `publish-sdk.yml`(tag `sdk-v*`)/ `publish-gateway.yml`(tag `gateway-v*`)/ `publish-dashboard.yml`(tag `dashboard-v*`)/ `publish-server.yml` + `publish-docker.yml`(同 tag `server-v*`:npm 发布 + GHCR 镜像 `ghcr.io/tokenrollai/tool-bridge`),npm Trusted Publishing(OIDC);**无主干测试 CI**。
- 工具链:lint 用 biome;测试 vitest 4 + @cloudflare/vitest-pool-workers 0.18(API 变更注意见 [../guides/workers-kv-pitfalls.md](../guides/workers-kv-pitfalls.md))。

## 常用命令

- `pnpm verify` — typecheck + lint + 单测 + 集成测试一把过(Dashboard 0.6.0 发布前于 2026-07-10 实跑:681 core + 162 cli + 12 sdk + 119 gateway + 23 server + 8 plugin-feishu = **1005 passed**;SDK 1 + gateway 6 opt-in = **7 skipped**;根 `test:integration` 含 gateway + server + plugin-feishu)。
- `pnpm deploy:all` — 幂等 provision + dashboard build + 部署 gateway。
- `pnpm --filter @tool-bridge/server start` — 本机起 Node 宿主(默认 :8787,数据落 ./data;env 面见 [../guides/docker-host.md](../guides/docker-host.md))。
- `docker build -t tool-bridge . && docker run -p 8787:8787 -v tbdata:/data …` — Docker 路径,验收命令全套见 [../guides/docker-host.md](../guides/docker-host.md)。
- `TB_BASE_URL=https://tool-bridge.pdjjq.org pnpm smoke` — 线上冒烟(**smoke 不读 .env,须显式传 TB_BASE_URL 与 TB_SK**)。
- `npx tsx scripts/verify-revocation.ts` / `verify-device.ts` / `verify-plugin.ts` — 可重跑生产验收(需 TB_BASE_URL + TB_SK,消耗真实资源)。
- `TB_TEST_MCP_URL=http://127.0.0.1:39002/mcp TB_ALLOW_INSECURE_HTTP=true pnpm --filter @tool-bridge/gateway test -- tool.integration.test.ts` — opt-in MCP E2E(先 `ECHO_MCP_PORT=39002 pnpm --filter @tool-bridge/gateway echo-mcp` 起兜底上游)。
- `TB_TEST_LIVE_HTTP=1 pnpm --filter @tool-bridge/gateway test -- tool.integration.test.ts` — opt-in 真实 HTTP 上游(postman-echo)。
- `TB_TEST_S3_* + TB_ALLOW_INSECURE_HTTP=true … context.integration.test.ts` — opt-in s3(本地 s3rver:`pnpm --filter @tool-bridge/gateway s3-mock`)。
- `TB_TEST_SDK_REMOTE=1 pnpm --filter @tool-bridge/sdk test` — opt-in SDK 反向连接生产全链路。

## .env 凭据状态(只记变量名与状态,绝不写值)

| 变量 | 状态 | 备注 |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | 已配置 | DJJ 账户;验证用 `wrangler whoami`,勿用 `/user/tokens/verify` |
| `CLOUDFLARE_API_TOKEN` | 空缺(注释掉) | 预期内:本地开发靠 wrangler OAuth,CI 时才需要 |
| `TB_DOMAIN` / `TB_BASE_URL` / `TB_NAME_PREFIX` | 已配置 | zone pdjjq.org;生产 BaseURL;资源命名前缀(=tb) |
| `TB_SECRET_ENCRYPTION_KEY` | 已配置(32B base64url) | SecretStore env-only 信任根;已同步 `wrangler secret put` |
| `TB_SK` | **已配置(= Admin SK)** | CLI/smoke/verify-* 脚本的默认凭证 |
| `TB_TEST_MCP_URL` / `TB_TEST_MCP_BEARER` | 空缺(注释掉) | opt-in MCP 测试用;见下方兜底 |
| `TB_TEST_S3_ENDPOINT` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` / `_BUCKET` | 空缺(注释掉) | opt-in s3 测试用;见下方兜底 |
| `TB_R2_ACCESS_KEY_ID` / `TB_R2_SECRET_ACCESS_KEY` | 空缺(注释掉) | `$ref` 预签名用;创建后 presign 主路径可 opt-in 复验 |

## 已知兜底路径(缺外部资源时)

- **真实上游 MCP 空缺** → `pnpm --filter @tool-bridge/gateway echo-mcp` 自建 echo MCP 兜底。
- **外部 S3 空缺** → 本地 s3rver mock opt-in 可重跑;或用 DJJ 账户 R2 的 S3 兼容 API 当"外部 S3"。
- **R2 预签名 AK 空缺** → 大对象走 `/~ref` 网关中转下载路由,功能不缺(生产实测通过)。

## 本机工具链(2026-07-06 核实)

| 工具 | 版本/状态 |
|---|---|
| node | v26.4.0 |
| pnpm | 11.10.0 |
| wrangler | 4.107.0,已 OAuth 登录(可访问 DJJ 与 Lightspeed 两账户) |
| gh | 2.96.0,已登录 Disdjj(有 repo scope,可访问 v1 私有仓库) |
| docker | CLI 29.2.1,守护进程可用(2026-07-08 核实;build/run/restart 镜像验收已过) |

**注意**:wrangler OAuth 下有多账户,所有 wrangler 命令须显式指定账户(`wrangler.jsonc` 已写 `account_id`;脚本内用 `CLOUDFLARE_ACCOUNT_ID`),否则报多账户歧义错误。

## 未竟事项(路线图,非进度账本)

- **server 首发**:`@tool-bridge/server` 0.1.0 待用户手动 `npm publish` 首发 + npmjs.com 配 Trusted Publisher(workflow `publish-server.yml`);**server 的 npm 安装形态依赖 dashboard 已发布**(regular dependency,dashboard 0.2.0 已在 npm),见 [../guides/npm-publish.md](../guides/npm-publish.md)。
- **tool-bridge-template 模板仓库**(未动工):公开仓库挂 Deploy to Cloudflare 按钮——3 行 `src/index.ts`(import app + `DeviceSession` from `@tool-bridge/gateway`)+ 无 account_id/routes 的干净 wrangler.jsonc(KV/R2/DO 由 Deploy 按钮自动创建回填)+ copy-ui 脚本(dashboard 包 dist → public);presign/ASSETS/TB_BOOTSTRAP_ADMIN_SK 在运行时均可选且已优雅降级,无需改运行时代码。
- **`tb init` 向导**:干净账户一条命令拉起(wrangler auth 检查 → provision → 部署 → Admin SK 输出,可重入);当前部署路径是 `pnpm deploy:all`。
- **plugin-feishu 遗留**:list-docs 需 drive:drive 应用权限(用户按需开通)。文档落点已定型团队 wiki(2026-07-08 实测):应用加入知识库成员并授**可编辑**(仅可阅读时 CreateWikiNode 报 131006)后,`create-doc` 传 `wiki_node` URL 建档/append/读回全通;团队 wiki 节点 https://awaken-intelligence.feishu.cn/wiki/AhxNw8VDAi0obtkqioyceAYgnZJ(Tool-Bridge)。可选优化:plugin 加 `FEISHU_DEFAULT_WIKI_NODE` 默认落点,待用户拍板。
- **端到端验收系统化**:七个 User Case 的脚本化 E2E(CLI `--json` 驱动 + Dashboard 浏览器侧)未拉通;现有 smoke + 三个 verify-* 脚本覆盖主链路。Dashboard 0.6.0 有高价值真实浏览器终验,但仍缺可重跑回归来固化树 depth/localize 与 ARIA 键盘状态、workspace 卸载后的 mutation/invalidation、Plugin 并发行操作、一次性值/待决 dialog,以及 cursor 边界上的冲突与 replace/upsert 警告。
- **遗留小项**:CLI deviceRuntime 迁移为 SDK 消费者;R2 Access Key 创建后 presign 主路径 opt-in 复验;生产 `device/demo-mac` 疑似测试残骸待确认清理;dashboard 本地开发流程(vite dev + wrangler dev 联调)下次涉及时补 guide。Dashboard 的 Registry/Plugins/SK 大页仍混合查询编排、config builder、表单状态与视图,后续宜拆纯 builder、kind 子表单与共用 section。

## 遗留注意

- opt-in MCP E2E 退出码为 0,但 workerd 会打印 SDK sourcemap 诊断与一次 `Network connection lost` 文本,属 harness 噪声,不作为失败依据。
- 本机主 checkout(`~/.superset/projects/tool-bridge`)工作区有一份未提交 WIP(deviceSession→deviceHello 抽取重构);**部署必须从与 origin/main 零差异的干净工作区执行**(2026-07-07 部署即为避开该 WIP 从干净 worktree 出发)。
