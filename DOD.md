# DOD(Definition of Done)

> 本文是 tool-bridge 实现阶段的**完成标准**:项目分几个 Phase、每个 Phase 在什么条件下算完成、用什么手段验证。它是驱动持续开发 loop 的验收真源——loop 的每一轮都应对照本文判断"当前 Phase 是否闭环、下一步做什么"。
>
> 规格真源:[docs/Vision.md](docs/Vision.md)(User Case)、[docs/Architecture.md](docs/Architecture.md)(模块)、[docs/Proto.md](docs/Proto.md)(接口契约)、[docs/Plugin.md](docs/Plugin.md)(插件契约)、[docs/Reference.md](docs/Reference.md)(外部事实)。**实现与文档冲突时,以 docs 为准;发现 docs 自身错误时,先修 docs 再写码。**

## 0. 全局完成定义

整个项目 Done = 以下五条同时成立:

1. **七个 User Case 的 E2E 全部通过**(§9 的 E2E-1 ~ E2E-7,跑在真实 Cloudflare 部署 + 真实 Docker 容器 + 真实上游 MCP server 上);
2. **每个 Phase 的 DoD 清单全部勾选**,且勾选依据是可重跑的命令(测试/脚本),不是人工目测;
3. **`pnpm verify` 一键绿**:typecheck + lint + unit + integration 全过;
4. **从零部署可复现**:新环境 `tb init`(Cloudflare)与 `docker run`(自部署)都能在 30 分钟内拉起完整实例;
5. **CLI 覆盖全部管理面**:Proto 附A 命令矩阵中的每条命令可用,且 §9 的七条 E2E 全部以 CLI(`--json`)驱动断言——CLI 既是管理入口也是 DOD 的验证器。

**CLI 增量策略**:`tb` CLI 不是独立 Phase,而是**随各 Phase 生长**——每个 Phase 交付其模块对应的子命令,并从 Phase 1 起作为该 Phase 集成验证的默认驱动方式。CLI 是纯 API 客户端:如果某个能力 CLI 做不到而 Dashboard/直接 API 做得到,即视为"存在管理旁路",违反三入口对等原则,算作缺陷。

**SDK 增量策略(TB.md 注意 8)**:`packages/core` 从 Phase 1 起就是网关与 SDK 的公共内核;每个 Phase 新增的接口面同轮保持"core 纯逻辑可独立实例化"——Phase 5 只是补齐 SDK 的公开封装与文档,不是从头适配。

## 1. 通用验收规则(适用于每个 Phase)

每个 Phase 声明 Done 前,必须满足:

- [ ] **契约一致**:实现的接口签名、错误码、`~help` 输出与 Proto.md 对应章节一致;偏离处已回写 docs 并说明理由。
- [ ] **单元测试**:本 Phase 新增模块的核心逻辑有单测覆盖(scope 判定、路径规则、协议编解码、`~help` 生成这类纯逻辑 **100% 分支覆盖**;I/O 胶水层不强制);使用 Vitest + `@cloudflare/vitest-pool-workers`(DO/Worker 在真实 workerd 里测)。
- [ ] **集成测试**:本 Phase 的对外行为有至少一条穿透测试(HTTP 进 → 存储/上游/设备出),跑在 vitest-pool-workers 或 `wrangler dev` 环境。
- [ ] **可部署**:`pnpm deploy:all` 成功,部署后冒烟脚本(`scripts/smoke.ts`)通过。
- [ ] **回归不破坏**:此前所有 Phase 的测试仍然全绿。

## 2. Phase 0 — 工程骨架与部署管道

**目标**:拿到一个"能部署、能测试、能回滚"的空网关。

**范围**:monorepo(pnpm workspaces:`core` / `gateway` / `cli`,后续 Phase 增包);`tb-gateway` Worker 骨架(`/healthz`、根 `/~help` 占位);wrangler.jsonc(KV/R2/DO 绑定占位);Vitest 配置;`pnpm verify` / `pnpm deploy:all` / `scripts/smoke.ts`;`.dev.vars` 从 `.env` 生成;**CLI 骨架**(`packages/cli`:命令框架、`--json` 全局开关、`TB_BASE_URL`/`TB_SK` 读取、`tb status` 打 healthz)。

**DoD**:
- [x] `pnpm verify` 本地绿(哪怕只有 1 个占位测试)。
- [ ] `pnpm deploy:all` 部署到 `CLOUDFLARE_ACCOUNT_ID` 指定账户成功。
- [ ] `curl ${TB_BASE_URL}/healthz` 返回 200 + 版本号。
- [ ] `tb status` 对部署环境返回健康摘要(`--json` 可解析)。
- [ ] KV/R2 资源已由幂等脚本创建并绑定(`wrangler kv namespace list` 等可见)。

## 3. Phase 1 — Auth(SK)+ HTBP 核心树(横切地基)

**目标**:Proto §0/§1/§2/§3 落地——一切后续模块都依赖 SK 判定与 NodeRegistry。

**范围**:TBError↔HTTP 映射中间件(§0.2,含 401/501);SK 模型 + `sha256` 存取 + `Authorizer.Check`(§2,含 deny 优先、glob 匹配、注册路径规则 §2.4);Admin SK 引导;SecretStore(§2.5:AES-256-GCM + env 主密钥,只写不读);`NodeRegistry`(§3,含中间 directory 自动物化与回收);`~help`/`~skill`/`~tree?depth` 生成(directory + builtin 节点);内容协商(§1.2:markdown 默认 / json 声明);builtin 节点 `system/status`、`system/sk`、`system/secret`、`system/registry`;可见性裁剪;**CLI**:`tb login` / `tb whoami` / `tb use` / `tb sk list|create|rm` / `tb secret set|ls|rm` / `tb ls` / `tb tree` / `tb help <path>`。

**DoD**:
- [ ] 判定算法单测覆盖:allow/deny 优先级、`*`/`**` glob 语义、无匹配默认拒、disabled/过期 SK、registerPaths 收紧(注意 2)、未声明 registerPaths 时保留根路径拒绝(注意 3)、同路径他人节点 conflict——**每条 §2.2/§2.4 规则至少一个正/反用例**。
- [ ] 树单测:注册 `a/b/c` 后 `a`、`a/b`、`a/b/c` 三级 `~help` 都可达(注意 4);卸载后空中间节点回收;`~tree` 的 depth 钳制与节点上限;保留段/保留根路径拒绝注册。
- [ ] 内容协商单测:同一 `~help` 的 DSL 与 JSON 两种表现字段等价;无 Accept 时默认 markdown/plain(注意 6)。
- [ ] 集成:部署后 Admin SK 引导 → `tb login` → `tb whoami` 显示 admin → `tb sk create`(限定 scope 的新 SK)→ 用新 SK `tb tree` 只见其可见子树;无 SK 调用返回 401 裸 TBError。
- [ ] SecretStore:单测——`Set` 后节点面(`List`/`~help`/返回值)不回显明文、`resolve` 不暴露为节点 cmd、未配置主密钥 `TB_SECRET_ENCRYPTION_KEY` 时 `Set` 返回 `unavailable`;集成——`tb secret set` 后 `tb secret ls` 只见名字与时间戳。
- [ ] 吊销传播:集成——本地宿主 `tb sk rm` 后立即被拒;部署环境脚本轮询断言被吊销 SK 在 60s 窗口上限内开始被拒(Proto §2.3 的可脚本化验收)。

## 4. Phase 2 — Tool Layer(M2)

**目标**:上游工具进得来、调得通、`~help` 不漂移;外部 HTBP 服务能联邦成子树。

**范围**:mcp Provider(官方 SDK Streamable HTTP client、会话重建、schema→`~help` 派生与缓存失效);http Provider(HttpToolDef 拼装、authRef 凭证注入);remote 节点(Proto §3.4:联邦任意 HTBP 服务——`~help`/调用透传、skRef 凭证换发、baseUrl 白名单、`X-TB-Via` 环检测,TB.md "Custom HTBP Server"/"Add TB Server");工具虚拟化(prefix/rename/hide/describe);调用点 Check(call 动作);**CLI**:`tb tool mount|rm` / `tb server add|ls|rm` / `tb call`。

**DoD**:
- [ ] 单测:HttpToolDef 拼装({param} 占位、query/body 分配)、虚拟化映射(rename 后原名不可调、hide 不可见)、mcp schema→Help DSL 生成、上游 TBError 透传形状。
- [ ] 单测:remote 透传的路径改写、本地调用者 SK 不外传(仅 skRef 换发)、白名单拒绝、`X-TB-Via` 环检测。
- [ ] 集成:`tb tool mount --kind mcp` 挂一个真实上游 MCP server → `tb help <path>` 输出其工具 → `tb call` 成功;挂一个 http endpoint(如 postman-echo)→ `tb call` 返回预期。
- [ ] 集成:`tb server add` 联邦一个外部 HTBP 服务(可用第二个本地 dev 实例充当)→ 其子树出现在 `tb tree` → 经本实例透传调用成功;白名单外 baseUrl 被拒;环(A 联 B、B 联 A)不死循环。
- [ ] 权限:无 call 权限的 SK 对同一节点 `tb call` → 403,且 `tb ls` 不可见(可见性即权限的机制预演)。
- [ ] `~help` 输出经 Help DSL 最小 parser 断言(cmd 行完整、scope 声明存在)。

## 5. Phase 3 — Context Layer(M3)

**目标**:四动词统一读写面 + Search + namespace 挂载(Case 2 的机制)。

**范围**:`ContextProvider` 四动词语义(§5.1:Write 幂等 upsert、Update not_found、ifVersion conflict);内置 r2 / s3(aws4fetch)Provider;`Search(mode:keyword)` 内置基线;大对象 `$ref` 预签名(经 R2 S3 兼容端点 + aws4fetch——R2 binding 不支持 presign,凭证由 `tb init` provision 并入 SecretStore;未配置时走网关中转下载,Proto §5.2);ttl 回收与 readOnly;挂载即 `NodeRegistry.Write{kind:'context'}`;**CLI**:`tb ctx ls|cat|put|patch|search|mount|unmount`。

**DoD**:
- [ ] 单测:四动词语义逐条(幂等 Write、not_found、conflict)、readOnly 拒写、ttl 到期回收、路径穿越拒绝(file provider 的规范性义务,实现在 core 供 Phase 4/6 复用)。
- [ ] 集成:`tb ctx mount` 挂 r2 namespace → 经 CLI 走完 put→ls→cat→patch 全循环;挂一个真实 S3 兼容端点(AK/SK 经 authRef)→ 同循环通过;`tb ctx search --mode keyword` 召回已写条目。
- [ ] 大对象:>1 MiB 条目 `Get` 返回 `$ref` 预签名 URL 且可下载。
- [ ] 三入口对等预演:同一 namespace 经 CLI 与直接 HTTP(curl)读写结果一致。

## 6. Phase 4 — Device Gateway(M4,反向注册)

**目标**:Case 3 全链路——机器接得进来、掉线不悬挂、Agent 无差别访问。

**范围**:`DeviceSession` DO(WS hibernation、待决表、心跳 autoResponse);帧协议(§6.2:hello/ready/call/result/ping/cancel、requestId 幂等、60s 超时);设备侧实现(core 复用:shell executor + file provider);挂载/下线/回收生命周期(§6.3);**CLI**:`tb connect`(长驻)/ `tb device ls` / `tb mount fs`。

**DoD**:
- [ ] 单测:帧编解码与状态机(未 hello 先 call → 拒;重复 requestId 幂等;超时 → unavailable+cancel 帧)、注册路径规则与 §2.4 联动、断线节点 offline 语义、shell 契约(`~help` 含 effect destructive)。
- [ ] 集成(vitest-pool-workers 内真实 DO):模拟设备 WS 接入 → `device/<id>/shell` 与 `/fs` 节点出现在树上 → 经 HTTP 调用 shell echo 成功 → 断开 WS → 调用返回 503 retryable → 重连恢复。
- [ ] 真实环境:本机 `tb connect ${TB_BASE_URL}` → 另一终端 `tb call device/<id>/shell --tool exec --args '{"command":"echo hi"}'` 返回 stdout;`tb ctx cat device/<id>/fs/<file>` 读到真实文件。
- [ ] 权限:registerPaths 限定的 SK 只能挂在指定前缀下(注意 2 的线上验证)。

## 7. Phase 5 — SDK + Plugin(M6 + M8)

**目标**:能力以库与插件形态开放(TB.md 注意 8 的兑现)。

**范围**:`@tool-bridge/sdk` 公开面(§7:createToolBridge / registerTool / registerContext / connect);`PluginRegistry` + 契约校验(探活 + `~help`/`~describe` 核对);Plugin 传输契约(§8.3:X-TB-Context、X-TB-Request-Id 幂等、$ref 大载荷);**CLI**:`tb plugin register|list|health`。

**DoD**:
- [ ] 单测:manifest 校验(interfaceVersion 与方法集合不符 → 拒)、传输 envelope 编解码、Request-Id 重试去重。
- [ ] 集成:用 SDK 在 Node 进程内 `createToolBridge` + `registerTool`(一个本地函数工具)→ 本地 HTTP 可调;同一实例 `connect` 到已部署网关 → 该工具出现在远程树上并可经远程调用(HTTP→WS 的全链路)。
- [ ] 集成:实现 Plugin.md §4 的示例 Provider(可用 stub 数据)→ `tb plugin register` → 契约校验通过 → `NodeRegistry.Write` 引用挂载 → 四动词经树可用;`tb plugin health` 反映探活状态。
- [ ] 文档核对:SDK 公开面与 Proto §7 签名一致;Plugin.md 调试清单 **1~6 条**对示例 Provider 逐条通过(第 7 条"LLM 只靠 `~help` 调对"为非阻塞质量参考——不可确定性重跑,客观兜底由 E2E-5① 的 fetch-only 脚本承担)。

## 8. Phase 6 — Dashboard + Docker 自部署 + 初始化闭环(M9 + M10)

**目标**:三入口补齐(Dashboard),两条部署路径补齐(Docker),Case 1 全流程闭环。

**范围**:Dashboard(**与 gateway 同 Worker 一体部署**,Workers Static Assets 挂 `/ui`,不额外增加 Pages/Worker:`~tree` 导航、`~help` 表单渲染、调用与返回展示、`system/*` 管理视图;技术栈按 Reference §5——React 19 + Vite + Ant Design + @rjsf + TanStack Query,**禁止以裸 index.html 交付**);`tb init` 向导(wrangler auth 检查 → provision → 部署 → Admin SK 输出 → 可重入);Docker 镜像(node adapter + SQLite StateStore + FS ObjectStore + ws 通道 + Dashboard 静态托管);**CLI**:`tb init` 完整化。

**DoD**:
- [ ] 前置 spike:目标版本组合(React 19 + antd v5 + `@ant-design/v5-patch-for-react-19` + `@rjsf/antd`)渲染一个 inputSchema→表单的最小 demo 通过;不通过则启用兜底(@rjsf/mui 或裸 antd Form 手接)并回写 Reference §5。同一 spike 验证 Static Assets 路由次序(SPA 回退严格限定 `/ui`,`run_worker_first` 或等价配置,不吞根 `~help`/树路由/`system/*`,Architecture M9)。
- [ ] `tb init` 在干净账户上 30 分钟内完成:输出 BaseURL + Admin SK → `tb login` → `tb status` 绿(Case 1 的命令行路径)。
- [ ] Dashboard:输入 SK+BaseURL → 树导航与任意节点表单可用 → 对一个工具节点发起调用并展示 markdown 返回;`system/sk` 视图可签发/吊销 SK。
- [ ] Docker:`docker run -v tb-data:/data tool-bridge` → healthz 200 → 首次启动输出 Admin SK → 对同一容器跑通 mount(file)+ call + ctx 四动词冒烟;重启后数据仍在。
- [ ] 三入口对等:抽查三条操作(挂载 context、签发 SK、调用工具)分别经 CLI / Dashboard / 直接 API 完成,行为与(若已实现审计)留痕主体一致。

## 9. Phase 7 — E2E 验收(最终 DoD)

七条 E2E 对应 Vision §3 的七个 User Case,脚本化(`pnpm e2e`),跑在**真实 Cloudflare 部署 + 真实 Docker + 真实上游 MCP**上。**E2E 脚本以 `tb` CLI(`--json`)为默认驱动器**;只有 CLI 覆盖不到的动作(Dashboard 表单点击)走浏览器自动化或人工步骤。

| # | 场景(对应 Vision §3) | 通过判据(全部满足) |
|---|---|---|
| E2E-1 | Admin 初始化 | ① 干净环境 `tb init` 成功产出 BaseURL + Admin SK;② `tb login` 后 `tb whoami`/`tb status --json` 正确;③ Admin SK 明文仅出现一次(重跑 init 不重复输出) |
| E2E-2 | 添加 Context | ① 经 CLI 配置 AK/SK 挂载 S3 namespace;② CLI(`tb ctx cat`)、直接 API(curl)、Dashboard 三入口都能读写同一条目;③ 凭证不出现在任何 `~help`/返回值中 |
| E2E-3 | 反向注册 | ① 真实机器 `tb connect` 后 `tb device ls` 可见且 online;② `device/<id>/shell` 执行命令返回 stdout、`device/<id>/fs` 读写真实文件;③ 三级路径 `~help` 全可达;④ 断线后调用 503 retryable,重连恢复;⑤ registerPaths 受限 SK 在越界路径注册被拒,未声明 registerPaths 的 SK(带 register scope)挂 `device/<id>` 通过(§2.4b 正例) |
| E2E-4 | 自部署 | ① Docker 单容器拉起,healthz 200;② 同一套冒烟(mount/call/ctx 四动词/SK 签发)在容器上全过;③ 重启数据持久 |
| E2E-5 | Agent 使用 | ① 一个**只会 HTTP fetch 的最小 Agent 脚本**(不含任何 TB SDK)凭 SK+BaseURL 从 `/~help` 渐进发现并成功调用一个 mcp 工具 + 读一个 context 条目;② 默认返回 markdown,声明 `Accept: application/json` 得到等价 JSON;③ 无权节点在其 `~help` 中不可见;④ 经 `tb server add` 联邦的外部 HTBP 服务子树同样可发现、可透传调用(Custom HTBP Server 支柱) |
| E2E-6 | Dashboard 使用 | ① 输入 SK+BaseURL 后树与表单渲染;② 对一个工具节点表单发送 → 展示返回值;③ 对一个 context 节点完成 put/cat;④ 经 Dashboard 表单(`system/registry`)填 AK/SK 挂载一个 context namespace 成功,凭证不出现在任何 `~help`/返回值(Case 2 的 Dashboard 写路径) |
| E2E-7 | CLI 使用 | ① `tb tree --json` / `tb help <path> --json` 输出可解析;② `tb call` 与 `tb ctx` 全动词跑通;③ 全部命令在无权 SK 下行为正确(403/裁剪) |

**E2E 通过 = 项目 Done。** 之后进入维护态:新能力(如 MCP server 下游暴露、semantic search plugin、审计面)走同样的 Phase→DoD→E2E 流程增量推进。

**已知外部前置(动工前核实,记入 PROGRESS.md)**:
- Cloudflare 凭据:`CLOUDFLARE_API_TOKEN`(Account-scoped)验证一律用 `wrangler whoami`,勿用 `/user/tokens/verify`(对 Account token 必然误报,Watt 已踩坑)。
- 一个可用的真实上游 MCP server(Streamable HTTP)作为 Phase 2/E2E-5 的测试对象;无外部依赖时用自建 echo MCP(官方 SDK server 十行内)兜底。
- 一个 S3 兼容端点(R2 的 S3 API 即可当作"外部 S3"测试 Case 2)。
- R2 Access Key(S3 兼容凭证):`tb init`/provision 创建——r2 provider 的 `$ref` 预签名依赖它(R2 binding 不支持 presign);未配置时走网关中转下载。
- Docker 运行环境(Phase 6)。

## 10. Loop 运行约定(给持续开发 Agent 的执行契约)

驱动 loop 的 prompt 应遵循(完整契约见 [LOOP.md](LOOP.md)):

1. **每轮开场**:读本文 + `PROGRESS.md`(loop 自维护的进度账本),确定本轮唯一目标(一个未勾选的 DoD 项)。
2. **实现顺序**:写测试 → 实现 → `pnpm verify` → 勾选 DoD 项并更新 PROGRESS.md。禁止跳过测试直接勾选。
3. **验证凭据**:一切外部验证用 `.env` 中的凭据;消耗真实外部资源的测试打 tag,每轮每 tag 最多跑一次。
4. **CLI 同步生长**:实现或修改某接口时,同轮交付/更新对应 `tb` 子命令;集成验证优先用 CLI 驱动——CLI 跑不通即视为该能力未完成。
5. **卡住即上报**:同一 DoD 项连续 3 轮未闭环,停止重试,在 PROGRESS.md 记录 blocker 并请求人工介入。
6. **docs 是宪法**:偏离 Proto 的实现必须先改 docs(并说明理由)再改代码;每完成一个 Phase,回查 docs 与实现的漂移。
7. **Phase 关门**:宣布 Phase 完成前,重跑该 Phase 全部 DoD 命令 + 全量回归,输出勾选证据(命令 + 结果摘要)到 PROGRESS.md。
