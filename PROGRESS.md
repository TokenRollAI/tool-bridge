# PROGRESS(进度账本)

> 每轮结束在末尾追加一条 Round 记录(格式见 LOOP.md)。当前 Phase 与 blocker 在此维护。

## ⏸ PENDING(挂起,不阻塞后续 Phase)

- ~~**P1-0 · PR #32 合并**~~ —— **已完成**(2026-08-10,rebase 合并进 main:`28f1f57` / `e91680b`
  / `7095860` / `033ebab` / `d400cd9`)。Phase 2 分支已 rebase 到 main,git 自动跳过 5 个
  已应用的 Phase 1 提交,零冲突,树内容与 rebase 前一致。
- **P1-1 · Phase 1 项 6「部署解冻」** —— 仍挂起。代码已在 main,但**尚未部署**:需从与
  `origin/main` 零差异的干净工作区执行 `pnpm deploy:all` + `TB_BASE_URL=… pnpm smoke`。
  属外向不可逆动作,待用户授权。**不构成后续 Phase 的代码依赖。**
- **P1-2 · Phase 1 遗留的生产验证** —— 跨休眠窗口(≥150s)与真实连接替换竞态须线上验证,
  随 P1-1 部署后一并做(`npx tsx scripts/verify-device.ts`)。
- **P2-1 · Phase 2 项 7 的「生产复验」半边** —— 飞书 plugin 的**重写已完成并全绿**(Round 12),
  但 DoD 还要求"重新部署 + 生产 create-doc/fetch-doc/update-doc 实调留证"
  (`npx tsx scripts/verify-plugin.ts`,需 TB_BASE_URL + TB_SK + 真实飞书凭证)。
  属外向不可逆动作且依赖生产环境,待用户授权;**不构成后续 Phase 的代码依赖**。
  按"证据即判据"纪律,项 7 在拿到生产证据前不勾选。
- **P3-1 · Phase 3 项 5 的「部署 + 生产 MCP smoke」半边** —— 官方 SDK 生产验收脚本
  `pnpm verify:mcp` 已在 Round 18 就位,本地 `pnpm verify` 全绿;尚需从与 `origin/main`
  零差异的干净工作区执行 `pnpm deploy:all`,再以 admin / narrow 两把生产 SK 运行
  `TB_BASE_URL=… TB_SK=… TB_MCP_NARROW_SK=… pnpm verify:mcp`。属外向动作且当前 Phase 3
  代码尚在功能分支,待用户授权及合并;**不构成 Phase 4 编码依赖**。生产证据前项 5 不勾选。
- **P4-1 · Phase 4 项 1 的「真实 D1 provision + 部署」半边** —— `TB_SEARCH` 绑定、D1
  幂等 provision 与隔离回归已在 Round 19 完成,Wrangler dry-run 也成功识别 D1 binding;
  尚需干净主分支上对真实账户连续运行两次 `node scripts/provision.mjs`(确认只创建一次
  `tb-search`)并执行 `pnpm deploy:all`。属生产资源创建/部署外向动作,待用户授权;**D1 绑定
  与本地 Miniflare 已就位,不构成后续 Search 编码依赖**。真实证据前项 1 不勾选。
- **P4-2 · Phase 4 项 2 的「HTBP Draft 外部同步」半边** —— 本仓 core/gateway、
  `llmdoc/reference/protocol-contract.md` 与契约测试已在 Round 20 完成;真正的 HTBP Draft
  位于外部 `TokenRollAI/HTBP` 仓库 `docs/rfcs/RFC-0001-htbp-core.md`,当前 Draft 尚未加入
  `~search`。跨仓提交/PR 属外向动作,待用户授权;本仓 `archive/docs/Proto.md` 已明确是历史
  资料,不能冒充外部 Draft 同步证据。**不构成 SearchIndex 实现的代码依赖**,外部变更证据前
  项 2 不勾选。
- **P4-3 · Phase 4 项 7 的「部署 + 生产 Search smoke」半边** —— Round 24 已完成
  `pnpm verify` 全阶段回归;`tb search` 与 Dashboard `/ui/search` 本地消费面也已闭环。
  尚需在 P4-1 真实 D1 provision 后从干净主分支执行 `pnpm deploy:all`,再对生产
  `/~search` 各跑一次中文两字词与英文词 smoke。属外向生产动作,待用户授权;
  **不构成 Phase 4.5 编码依赖**,生产证据前项 7 不勾选。

## 当前状态
- 当前 Phase:**Phase 4.5 — D:组件抽象收尾**(Round 25 起;Phase 4 可做项已清空,外向半边见 P4-1/P4-2/P4-3)
- Phase 3 已勾选:项 1(官方 MCP 测试 client + 本地 initialize,Round 14)、项 2(认证后的动态 tools/list + tools/call,Round 15)、项 3(scope 收窄钉死,Round 16)、项 4(三入口对等审计,Round 17)
- Phase 3 待办:**仅剩待授权的外向动作** — 项 5 已完成生产脚本与全量回归,真实部署/生产 MCP smoke → P3-1
- Phase 4 已勾选:项 3(CF D1 + Node SQLite SearchIndex,FTS5/trigram,Round 21)、项 4(trigram 短词 escaped LIKE 兜底,Round 22)、项 5(加权索引、自动同步、权限后处理分页与 opaque cursor,Round 23)、项 6(`tb search` + Dashboard `/search`,Round 24)
- Phase 4 遗留:项 1 真实 provision/deploy → P4-1;项 2 外部 HTBP Draft → P4-2;项 7 已完成 `pnpm verify` 半边,生产 deploy + 中英文 search smoke → P4-3。三者均为外向流程动作,不构成 Phase 4.5 编码依赖。
- Phase 2 已勾选:项 1(OperationRegistry)、项 2(Plugin v2 多 export,Round 13 补齐三入口对等后成立)、项 3(Context 按 handler 推导能力)、项 4(`@tool-bridge/plugin-sdk` 可发布)、项 5(样例 plugin 双 export)、项 6(删净 legacy 面)
- Phase 2 待办(**全部为待授权的外向动作**):项 7 飞书重写复验(代码已完成,只差生产实调 → P2-1)/ 项 8 部署上线
- Phase 1(代码完成,部署挂起见 PENDING)
- 已勾选:项 1(Secret Reference 使用授权,Round 1 → Round 4 补第三写入口后成立)、项 2(DO/Node 连接替换 TOCTOU,Round 2 → Round 4 补 registerPaths 后成立)、项 3(Node/Docker bootstrap fail closed)、项 4(canonical origin 对等)、项 5(`pnpm verify` 全绿)
- 未勾选:项 6(部署解冻 smoke)—— 被 P1-1 / P1-2 卡住,见上
- 已提交:`4e59750` core 原语 / `3867a30` 宿主接线(四个阻断项)/ `a9fcba4` lockfile / `3b42eda` 规划文档
- Blockers(从 DOR.md 继承,不阻塞全局开工,只缩小对应 Phase 可推进范围):
  - ~~**C-1**(Phase 4):D1 绑定与 provision 幂等分支尚未建立。~~ **代码 blocker 已解决**(Round 19):`TB_SEARCH` D1 binding + 幂等 provision + 隔离回归 + Wrangler deploy dry-run 均就位;真实账户 provision/deploy 仅作为流程动作挂 P4-1。
  - ~~**E-1**(Phase 3):缺一个 MCP client 做 tools/list + tools/call 验收。~~ **已解决**(Round 14):官方 `Client` + `StreamableHTTPClientTransport` 已经真实 `SELF.fetch` 连本地 endpoint 完成 initialize;Round 15 为避免与树节点冲突,把最初的 `/mcp` 纠正为保留控制段 `/~mcp`,并复用同一 client 验收 list/call。

## 开跑提示
- 执行顺序 A→B→E→C→D,不可跳 Phase(依赖:B 改 ToolSpec 派生形态 → C 索引 ToolSpec 必须在 B 后;E 只读 tool list 亦在 B 后;D 依赖 B/C 接口定稿)。
- Phase 1 是所有部署的前置,卡死不得跳过。
- 起点建议:Phase 1 第一项(Secret Reference 使用授权),它同时为 Phase 2 Plugin SDK 清授权地基;先读 `llmdoc/architecture/modules-and-boundaries.md`「两条注册通道」与「Provider 边界细则」+ `DECISIONS.md` 已拍板项 1/2。

## Round 日志

<!-- agent 每轮追加,最新在末尾 -->

## Round 1 — 2026-08-10
- 目标:Phase 1 DoD 项 1 — Secret Reference 使用授权(`~register` 与 system/registry write/update 校验写入者对 skRef/authRef 的使用权;resolve 失败 fail closed)
- 动作:
  - 新增 core `auth/secretRef.ts`:`secretRefsInConfig`(从 NodeConfig 抽 authRef/skRef,mcp auth:oauth 忽略 authRef)+ `assertSecretRefUse`(绑定引用须持 `system/secret` admin,复用 checkScopes;资源固定 SECRET_VAULT_PATH),core index 导出。授权模型 = 绑定 secret 引用与创建 secret 同权(admin on system/secret),精确堵 confused-deputy;更细 per-secret ACL 记为后续增强。
  - gateway `tbApp.ts`:两条注册通道(handleInvoke 的 registry write/update 分支 + handleRegister)在 assertRegisterPath 之后、落库之前插入 `assertSecretRefUse(ctx.scopes, config)`。
  - fail-closed resolve:`providers/remote.ts`(skRef)、`providers/mcp.ts`(静态 authRef)、`providers/http.ts`(authRef)三处把"resolve 返回 undefined 时静默匿名出站"改为 throw `unavailable`(pluginClient 原已 fail closed,未动)。
- 验证:
  - `pnpm --filter @tool-bridge/core test`(secretRef 单测)→ 710 passed(+11)。
  - `pnpm --filter @tool-bridge/gateway test -- secretRef.integration` → 138 passed | 6 skipped(+7:5 授权门 + 2 fail-closed);修正点:system/registry 管理通道下 confused-deputy 的真实身份是"广权注册者(register on **,无 admin)"而非窄 scope(窄 scope 看不见 system/registry 会先 404),已按此钉死。
  - `pnpm verify`(全量)→ typecheck 7 包 + lint clean + **1125 passed / 7 skipped**(core 710 + cli 233 + sdk 12 + plugin-feishu 8 + gateway 138 + server 24),退出码 0。lint 首跑 2 个 import 排序错,`eslint --fix` 已修。
- 勾选:Phase 1 DoD 项 1(Secret Reference 使用授权)。
- 遗留:下一轮起点 = Phase 1 DoD 项 2(DO/Node 连接替换 TOCTOU)。先读 `guides/do-websocket-hibernation.md` + `deviceSession.ts`(DO)与 server `deviceHub.ts` 的 invoke 重验路径;安全属性见 2026-07-24 反思「在异步重验中忽略连接代际」。改动未 commit(逐阶段 PR:Phase 1 全部 DoD 勾完再开 PR;当前工作区含本轮改动 + 五份 motocortex 文档 + 两份未提交 review 文档)。

## Round 2 — 2026-08-10
- 目标:Phase 1 DoD 项 2 — DO/Node 连接替换 TOCTOU(invoke 跨 await 后复核活动连接 + 校验 scope/registerPaths 收紧;堵旧连接接收调用、陈旧 meta 覆盖新连接两个竞态)
- 动作:
  - DO `deviceSession.ts`:①新增 `reverifyConn(meta, attachment)` 统一重验——connId 代际 + identify 凭据/keyId + `check(authCtx, mountPath, 'register')`(scope/registerPaths 收紧);invoke 热路径与 hibernation 唤醒(initSession restoreReady 前)共用。②`activeSocket` 重验通过后再读一次 meta,确认 activeConnId 仍是本连接才返回 socket(堵重验期间被新连接顶替)。③`markDisconnected(deviceId, connId)` 改为条件执行:重读 meta,仅当 activeConnId 仍等于被拆连接才下线清空(堵陈旧 meta 覆盖新连接把在线设备误标离线)。三处 caller(initSession/closeSocket/activeSocket)同步新签名。
  - Node `deviceHub.ts`:`Conn` 加 `mountPath`;`invoke` 重验加 `check(authCtx, mountPath, 'register')`,并在 identify await 后复核 `activeByDevice.get(deviceId) === conn` 才下发(onClose 原已有该 guard,未动)。`acceptHello` 落 `conn.mountPath`。
  - 授权模型:重验同时含凭据有效性 + 连接代际 + 当前授权(scope/registerPaths),与 hello 落库判定序一致(2026-07-24 反思 Stable Promotion #4)。
- 验证:
  - 新增 scope 收紧回归(两宿主对称):SK 初始能在 mountPath 注册、连上后 update 改窄 scope 移除该 register → 下一次 invoke 503 + 设备收到 `permission_denied` error 帧不下发。gateway `device.integration` +1、server `device.integration` +1。
  - `pnpm verify`(全量)→ typecheck 7 包 + lint clean + **1127 passed / 7 skipped**(core 710 + cli 233 + sdk 12 + plugin-feishu 8 + gateway 139 + server 25),退出码 0。
  - 已知局限(照 guide 与反思):stale-meta 覆盖 / 连接代际的**时序竞态**在 miniflare/ws 本地 harness 无法确定性复现(DO 不驱逐、无边缘掐断);修复由 connId 条件写 + 事后复核以代码不变量保证,scope 收紧路径有确定性用例钉死。跨休眠窗口(≥150s)与真实连接替换竞态须线上验证,留待 Phase 1 部署解冻后的生产 verify-device。
- 勾选:Phase 1 DoD 项 2(DO/Node 连接替换 TOCTOU)。
- 遗留:下一轮起点 = Phase 1 DoD 项 3(Node/Docker bootstrap fail closed)。落点 server `main.ts`/`server.ts` + gateway `bootstrap.ts` 的 `runBootstrap`(当前 Node 默认 `requireAdminSk:false` 随机生成写 stdout);须让 server 缺 TB_BOOTSTRAP_ADMIN_SK 时拒绝启动、退出非 0、不打印明文,并留 SDK/显式 insecure dev 逃生阀。改动未 commit。

## Round 3 — 2026-08-10
- 目标:Phase 1 DoD 项 3 — Node/Docker bootstrap fail closed(缺 TB_BOOTSTRAP_ADMIN_SK 拒绝启动、退出非 0、不随机生成写 stdout)
- 动作:
  - server `config.ts`:新增 `allowInsecureBootstrap`(env `TB_ALLOW_INSECURE_BOOTSTRAP=true`)作为逃生阀,默认 false。
  - server `server.ts`:`runBootstrap` 由不传 `requireAdminSk`(默认 false → 随机生成)改为 `requireAdminSk: !config.allowInsecureBootstrap`,即默认 fail closed。
  - server `main.ts`:捕获引导失败 → stderr 打印可操作指引(不含任何明文)→ `process.exit(1)`;成功路径不变。
  - 逃生阀语义:仅本地/一次性开发用,保留旧的"随机生成 + 打印一次"路径(SDK 内嵌宿主的 `runBootstrap` 默认值未动,兼容不破)。
- 验证:
  - 新增 `packages/server/test/bootstrap.test.ts`(3 例):缺 SK 且未开逃生阀 → `start()` 抛错且日志无明文;逃生阀开启 → 可启动且打印一次;显式预置 → 干净启动不打印。
  - DoD 验收命令实跑:`env -u TB_BOOTSTRAP_ADMIN_SK … npx tsx packages/server/src/main.ts` → `exit=1`,无明文泄漏。
  - `pnpm verify`(全量)→ **1130 passed / 7 skipped**(server 25→28),退出码 0。
- 勾选:Phase 1 DoD 项 3(Node/Docker bootstrap fail closed)。
- 遗留:本轮结束后应用户要求先做了一轮自查 review(见 Round 4),暂缓项 4。新增 env `TB_ALLOW_INSECURE_BOOTSTRAP` 需在 `guides/docker-host.md` 的 env 面补文档(留待 llmdoc:update)。

## Round 4 — 2026-08-10(自查 review + 整体修复)
- 目标:对 Round 1–3 的改动做批判性 review 并修复发现;修正被推翻的勾选。
- 发现与修复(6 项):
  1. **严重 · 授权门漏第三个写入口**:`registry.write` 实为 4 个入口(`~register` / `system/registry` / `bootstrap` / **`deviceHello`**),Round 1 只堵了前两个。设备 hello 的 `expose.nodes` config 由设备端提供且帧 schema 是 `.passthrough()`(frames.ts:103),`customNodeInput` 只并入转发 marker、**保留 authRef/skRef**;调用时 `provider:'s3'` 不走 device marker 分支 → `s3StoreConfig` → `secrets.resolve(authRef)` 用上他人凭证(`kind:'remote'`+`skRef` 同理)。**修复**:`assertSecretRefUse` 下沉进宿主中立的 `processDeviceHello`,DO 与 Node 两侧一次覆盖。
  2. **中 · reverifyConn 名不副实**:注释/账本写"scope/registerPaths",代码只有 `check()`(仅 scopes),而 `identify` 本就填了 `ctx.registerPaths`(sk.ts:227)。**修复**:两宿主改用 hello 落库同一个 `checkRegisterPath`(existing:null),scope + registerPaths 一次覆盖。
  3. **中 · 文档契约冲突**:`SecretStoreImpl.resolve` 注释写"由 Provider 侧降级(避免抛 unavailable)",与 Round 1 的 fail-closed 相反。**修复**:改写为"消费侧必须 fail closed"的显式契约。
  4. **中低 · 引导文案宿主错配**:core 抛 "first **Worker** bootstrap … `wrangler secret put`",在 Docker 上误导。**修复**:改为同时覆盖两宿主的中立文案(Workers 无 wrapper,该消息会直接作为 HTTP TBError 返回)。
  5. **低 · Node invoke fail open**:`conn.mountPath === undefined || check(...)` 未就绪时跳过授权。**修复**:改为 `!== undefined &&`,默认拒。
  6. **低 · 测试质量**:空 `try/finally`;用例名称称"不监听"却无对应断言(改为断言 `KEY_BOOTSTRAPPED` 未落库,且修正了我原先写错的 key 名 `'bootstrapped'` → `sys:bootstrapped`);`~register` 用例补断言 message 含 secret 名,以区分是授权门还是别的 permission_denied。
- 验证:
  - **回归有效性证明**(关键):临时注释掉 `assertSecretRefUse` 后,新增的设备 hello 用例确实 FAIL —— `AssertionError: expected { type: 'ready' } to match { type: 'error' }`,即恶意节点真的挂上了树,确认漏洞真实存在;恢复后 29 passed。这条测试是有效回归,不是同义反复。
  - `pnpm verify`(全量)→ typecheck 7 包 + lint clean + **1131 passed / 7 skipped**(core 710 + cli 233 + sdk 12 + plugin-feishu 8 + gateway 139 + server 29),退出码 0。
  - 项 3 验收命令改文案后复跑:`env -u TB_BOOTSTRAP_ADMIN_SK … npx tsx packages/server/src/main.ts` → `exit=1`,两宿主指引齐全,`grep -c "shown once"` = 0。
- 勾选:项 1(补齐第三写入口后成立)、项 2(补齐 registerPaths 后成立)。项 3 维持。
- 教训(供 llmdoc:update):**"堵住某类漏洞"必须先枚举该操作的全部入口再逐个验证**,不能因为改了最显眼的两条通道就宣布完成;设备 hello 是 NodeConfig 的第三个写入口,且其 config 来自不可信端并且帧 schema 是 passthrough。另:安全修复的新增测试必须做"摘掉修复看是否 FAIL"的有效性验证,否则可能是同义反复。
- 遗留:下一轮起点 = Phase 1 DoD 项 4(canonical origin 对等:非法配置不静默回退,Node/SDK 与 Workers 对齐)。落点 gateway `app.ts` 的 `TB_CANONICAL_ORIGIN` 规范化 + server `config.ts` 对等。改动未 commit。

## Round 5 — 2026-08-10
- 目标:Phase 1 DoD 项 4(canonical origin 对等)+ 项 5(verify 全绿)+ 项 6(部署解冻)
- 动作:
  - 取证发现两处缺陷:①Workers 的 `normalizeOrigin` 在「配置了但非法」时返回 undefined,调用点直接跳过赋值 → **静默回退**到每请求 origin(运维以为钉住了 OAuth redirect,实际没有);②Node/SDK **完全没有** canonical origin 配置面。
  - 新增 core `origin.ts`(`normalizeCanonicalOrigin`,宿主中立单一真源):未配置 → undefined(显式选择不钉);配置了但非法/非 http(s) → 抛 `invalid_argument`(fail closed)。core tsconfig 不引 DOM/node lib,按 `secretStore.ts` 既定做法用模块作用域最小 `URL` 声明补类型。
  - Workers `app.ts` 删掉本地 `normalizeOrigin` 改用 core 真源;Node `config.ts` 新增 `canonicalOrigin`(解析期抛 → 进程拒绝启动,比每请求抛更早),`server.ts` 接进 `deps.canonicalOrigin`。
- 验证:
  - core `origin.test.ts` 7 例(未配置/合法取 origin 丢 path/带端口/三类非法/非 http(s));server `bootstrap.test.ts` 追加 3 例配置面对等。
  - `pnpm verify`(全量)→ typecheck 7 包 + lint clean + **1141 passed / 7 skipped**(core 717 + cli 233 + sdk 12 + plugin-feishu 8 + gateway 139 + server 32),退出码 0。
  - 过程故障:本轮遭遇多次文件系统抖动(Write 报成功但未落盘、`ls <file>` 说不存在而 `ls *.ts` 列得出、Edit 工具间歇报 cwd 错)。`origin.ts` 因此丢失过一次,由 vitest 的 `Cannot find module './origin'` 暴露;改用 heredoc 重建并**立即 `wc -c` 校验**后正常。教训:该环境下写文件后必须立刻验证落盘,不能只信工具回报。
- 勾选:项 4(canonical origin 对等)、项 5(`pnpm verify` 全绿)。
- 提交(4 个,工作区已干净):`4e59750` core 原语 → `3867a30` 宿主接线 → `a9fcba4` lockfile → `3b42eda` 规划文档。pre-commit hook 每次跑全量 typecheck 均通过。
- **未勾选且卡住:项 6(部署解冻)**。两个需人拍板项见本文件顶部 P1-1 / P1-2。按 LOOP「Phase 被卡死(终止)」:停下交人,不跳到 Phase 2 绕过前置。
- 待办(留给 `llmdoc:update`):新增 env `TB_ALLOW_INSECURE_BOOTSTRAP` 与 Node 侧 `TB_CANONICAL_ORIGIN` 需补进 `guides/docker-host.md` 的 env 面;`modules-and-boundaries.md` 的「两条注册通道」应改为**三条**(设备 hello 是第三条 NodeConfig 写入口)并记录 Secret Reference ACL;`current-state.md` 的安全阻断项状态需更新。

## Round 6 — 2026-08-10(Phase 2 开工)
- 目标:Phase 2 DoD 项 1 — OperationRegistry 落地(Zod 驱动;自动完成 z.infer 推导 / safeParse / ZodError→invalid_argument / Zod→JSON Schema / List·Get·Call / 裸返回值包装)
- 前置动作:
  - 按用户新指令改 LOOP 状态机:「Phase 卡死即停机」→「**PENDING 挂起并继续下一 Phase**」,判据是**代码依赖而非流程依赖**。据此把 Phase 1 项 6(部署)挂起为 P1-1 —— 它是流程动作,Phase 2 依赖的 Phase 1 **代码**已在分支历史上,不构成阻塞。
  - 新开分支 `phase2-plugin-sdk`(从 Phase 1 分支切出),避免 PR #32 继续增长影响用户合并。
- 选型(纪律「成熟框架优先」):Zod→JSON Schema **不引新依赖、不手写转换器** —— 实测已锁的 `zod@3.25.76` 自带 `./v4` 子路径,官方 `z.toJSONSchema()` 输出正是所需形状(含 `.describe()` 派生 description、required、additionalProperties)。作者侧约定 `import { z } from 'zod/v4'`。
- 动作:新增 core `operation/registry.ts`:
  - `register(name, spec, handler)`;`inputSchema` 收完整 Zod schema **或** MCP 风格 raw shape,另留 `rawInputSchema` 作 JSON Schema 逃生阀(互斥,冲突即 invalid_argument);
  - 自动派生 ToolSpec,剥掉 `$schema` 顶层键以与既有 mcp/http 的裸 JSON Schema 形状一致(避免 `~help`/表单出现两种形状);
  - `call()` safeParse,失败转 `invalid_argument` 且消息含字段路径;handler 裸返回值自动包成 ToolResult,已是 ToolResult 形状(含 isError)则原样透传;
  - `list/get/names/has` 覆盖 v1 `ToolProvider` 三动词的全部行为,作者不再实现协议适配器;重名/空名快速失败。
- 验证:
  - 新增 `core/test/operation/registry.test.ts` **12 例**;core 测试 717 → **729 passed**。
  - **z.infer 推导由编译期保证**:已核实 core `tsconfig.include` 覆盖 `test/`,测试中 `const n: number = input.n`、`input.tags[0]`、`.repeat()` 等在推导退化时无法通过 tsc;`npx tsc --noEmit` 退出 0。
  - 过程修正两处:`noUncheckedIndexedAccess` 下属性断言改整对象 `toEqual`;解构剔除 `$schema` 触发 no-unused-vars,改用仓库既有 `omit()` helper(与 `refactor(core): 抽 omit helper` 既定做法一致)。
- 勾选:Phase 2 DoD 项 1。提交 `d13f799`,pre-commit 全量 typecheck 通过。
- 遗留:下一轮起点 = Phase 2 项 3(Context 按 handler 推导能力,core 侧自包含)→ 再做项 2(Plugin v2 多 export,跨 core+gateway)。项 7/8 依赖生产,预计挂 PENDING。

## Round 7 — 2026-08-10
- 目标:Phase 2 DoD 项 3 — Context 按 handler 推导能力(handler 全可选、存在性推导 methods/capabilities、无写动词自动只读、修 Watch 假能力、修 connect() 语义丢失)
- 动作:
  - **core**:新增 `context/capabilities.ts`(`contextMethodsOf` / `isReadOnlyProvider` / `contextCapabilitiesOf`);`ContextProvider` 六动词**全改可选**;`contextHelpModel` 新增 `methods` 过滤(只列真实存在的动词,readOnly 在其上再收紧);`ObjectContextProvider` 收紧为 `Required<ContextProvider>`,内置 r2/s3 与其消费方免逐个判空。
  - **Watch 假能力清除**:此前 `ContextProvider.Watch?` 存在、`OPTIONAL_METHOD_BY_CAPABILITY` 有 `watch→Watch` 映射,但 `grep Watch packages/gateway/src/` **零命中** —— 无 cmd、无 scope、无派发。三处死面一并删除。
  - **gateway**:`dispatchContextCmd` 六个动词逐个判存在性,未实现即 `unknown cmd`(与"~help 只列真实存在的操作"对齐,宣告动词表与可调用集合始终吻合);`~help`/`~describe` 的本地 provider 分支改用 core 推导真源(`contextMethodsOf`/`isReadOnlyProvider`/`contextCapabilitiesOf`),消除与 `~describe` 两处漂移。
  - **sdk connect 语义保真**:取证确认本地落库(`ensureReady` flush)保留 `meta.virtualize`/`meta.config`,而 `defaultExpose` 上报时**硬编码 config 且丢掉 virtualize/readOnly** —— 正是"本地正常、连远程后 help 与权限变了"的成因。抽出共用的 `nodeInputOf(reg)`,两条路径同一构造;context 的只读性按 handler 推导后一并上报。
- 验证:
  - core 新增 `test/context/capabilities.test.ts` **8 例**(只读单动词 / 纯搜索 / append-only 三种此前表达不出来的形态,各自的 methods、只读判定与 `~help` cmd 表);core 729 → **737 passed**。
  - sdk 新增 `test/registration.test.ts` **5 例**(wire 层):只读 provider → `config.readOnly` 自动 true、`~help` 只列 Get/List、`~describe` capabilities 为空;`virtualize` 落进节点且对外只暴露前缀名。sdk 12 → **17 passed**。
  - `pnpm verify` 全量 → typecheck 7 包 + lint clean + **1166 passed / 7 skipped**,退出码 0。提交 `1bde4fc`。
  - 诚实边界:上报侧的保真现在是**结构性保证**(两条路径共用 `nodeInputOf`),而非独立断言;真实远端链路仍由 opt-in 的 `connect.remote.test.ts` 覆盖(需 `TB_TEST_SDK_REMOTE=1` 与生产端点,本轮未跑)。
- 勾选:Phase 2 DoD 项 3。
- 遗留:下一轮起点 = Phase 2 项 2(Plugin v2 多 export:`kind` 移出 manifest、`/~describe` 返回 exports 数组、挂载配置加 `export` 字段),跨 core + gateway + CLI/Dashboard 三入口对等。

## Round 8 — 2026-08-10
- 目标:Phase 2 DoD 项 2 — Plugin v2 多 export(`kind` 移出 manifest、`/~describe` 返回 exports、挂载配置加 `export`)
- 动作(跨 core / gateway / plugin-feishu / CLI 五包):
  - **core `plugin/manifest.ts`**:删 `kind` 与 `interfaceVersion`,改 `protocolVersion: 'plugin/v2'`。manifest 只描述**部署与生命周期**。
  - **core `plugin/contract.ts` 重写**:`~describe` → `{protocolVersion, exports[]}`,每个 export 声明 `id/profile/description?/methods?/capabilities?`;`PluginProfile = tools/v1 | context/v1`;新增 `resolvePluginExport`(显式 id → 校验 profile 与节点 kind 相符;省略且恰一个 → 取它;省略但多个 → **拒绝并要求显式指定,不猜**)。校验含:protocolVersion 一致、export id 唯一、context 动词合法、capability 与 methods 不得自相矛盾。
  - **不再抓 `~help`**:export 自报 methods,注册少一次上游往返,也不再受 help 表现形态影响(`fetchPluginContract` 同步简化)。
  - **core `plugin/package.ts`**:市场条目同样删 kind —— 一个包可能同时导出 tools 与 context,索引不该预先钉死。
  - **core `types.ts`**:tool/context NodeConfig 加 `export?`;`CallContext` 加 `exportId`(v2 路由载体,随 envelope 到达 plugin)。
  - **gateway**:`requirePlugin` → `requirePluginExport`(manifest + describe 缓存 + 选中 export),六处调用点(providerFor / assertToolConfig / assertContextConfig / context 数据面 / `~help` / `~describe`)全部改为按选中 export 取 capabilities;`mountCallContext` 透传 exportId。
  - **plugin-feishu**:`/~describe` 改 v2 形态(单 export `actions`,profile tools/v1)。
  - **CLI(三入口对等)**:`tb tool mount --export` 与 `tb ctx mount --export`;`--export` 对 mcp/http/r2/s3 无意义时本地拒绝不发请求。**若不补此参数,多 export plugin 只能经 `tb call` 裸调 registry 挂载 = 管理旁路,按纪律属缺陷。**
- 验证:
  - core 契约测试重写为 v2(单 plugin 同时导出 tools+context 通过、protocolVersion 不符、export id 重复、未知 profile、context 未知动词、capability 与 methods 矛盾;`resolvePluginExport` 五种分支);gateway plugin 集成测试 stub 与断言改 v2;feishu 契约测试改 v2;CLI 新增 4 例 export 参数用例。
  - `pnpm verify` 全量 → typecheck 7 包 + lint clean + **1155 passed / 7 skipped**(core 726 + cli 237 + sdk 17 + plugin-feishu 8 + gateway 139 + server 32),退出码 0。提交 `3fabf7a`。
  - 说明:core 测试数 737→726 是**有意减少** —— 删掉的是 v1 专属用例(kind↔interfaceVersion 一致性、`~help` 数方法),换成 v2 的等价校验,不是覆盖退化。
- 勾选:Phase 2 DoD 项 2。
- 已知未完成(不静默):**Dashboard 挂载表单尚未加 export 字段**。CLI 与 API 已可设,Dashboard 暂只能挂单 export plugin —— 按三入口对等这是缺口,列入下一轮随项 4/5 一并补。
- 遗留:下一轮起点 = Phase 2 项 4(`@tool-bridge/plugin-sdk` 可发布,Web 标准兼容、接管 envelope/auth/dedupe/health/describe/help/Zod/错误归一)+ 项 5(样例 plugin 双 export 零样板)+ Dashboard export 字段。

## Round 9 — 2026-08-10
- 目标:Phase 2 DoD 项 4 — `@tool-bridge/plugin-sdk` 可发布(Web 标准兼容,接管 envelope/auth/dedupe/health/describe/help/Zod 校验/JSON Schema/错误归一)
- 取证:先确认平台真实 wire 契约 —— gateway `pluginTool.ts` **只发 `List` 与 `Call`,从不发 `Get`**,印证评审「ToolProvider.Get 是纯样板」,故新 SDK 不实现 Get。
- 动作:新增 `packages/plugin-sdk`(第 8 个包):
  - 作者面:`createPlugin({ token })` → `.tools(id).register(name, spec, handler)` 链式 + `.context(id, handlers)`;`export default plugin` 即 Worker 入口。
  - SDK 接管:健康检查 / `/~describe`(v2 exports;context 的 methods+capabilities 按 handler 存在性推导,与平台侧 Round 7 同语义)/ `/~help` / envelope 编解码 / Bearer 鉴权 / `X-TB-Request-Id` 去重 / `X-TB-Upstream-Auth` base64url 解包 / Zod 校验与 JSON Schema 派生 / 错误归一 / export 路由(单 export 可省 exportId;多 export 缺失即拒,不猜)。
  - **构建刻意 Web 标准**:`platform:'neutral'`、`target:es2022`、tsconfig `lib:[ES2023,DOM]` 且 **`types:[]`**(不引 @types/node,防 Node 全局漏进产物);core 经 noExternal bundle,dts 用 paths 内联(core 是 private 包,不内联则发布物类型入口悬空)。
  - 顺带修一处**真 bug**:`exportId` 此前只加了类型、没加进 envelope 的 zod codec,传输中被剥离 → 多 export 路由根本不可能工作。本轮补进 `callContextSchema`。
  - 顺带修一处**流程缺口**:根 `test:unit` 未含新包,`pnpm verify` 会静默漏测它;已补进 filter。
- 验证:
  - 新增 `test/plugin.test.ts` **18 例**,全部经 `fetch(Request)` 走 wire(与平台真实调用等价):契约三端点、鉴权失败、缺 X-TB-Context、List 的 inputSchema 由 Zod 自动派生(断言 required 与 `.describe()` 派生 description)、Call 校验+裸值包装+上游凭证送达、schema 不合报字段名、Get 属未知方法、同 requestId 重放只执行一次、context 已实现/未实现动词、export 路由四分支、重复 export id 声明期失败。
  - `pnpm verify` 全量 → typecheck 8 包 + lint clean + **1179 passed / 7 skipped**,退出码 0。
  - 发布物验证(DoD 要求):`pnpm build` 成功(22.8 KB ESM + 6.8 KB dts);`npm pack --dry-run` 通过(files = dist/index.js + dist/index.d.ts + package.json,33 KB);产物 `grep node:` **零 Node 内建**;dts 内 `@tool-bridge/core` 引用数 **0**(类型已内联)。
- 勾选:Phase 2 DoD 项 4。提交 `903c569`。
- 遗留:下一轮 = 项 5(样例 plugin 双 export 零样板 —— 用飞书 plugin 重写来兼做项 7 准备)+ Dashboard export 字段 + 项 6(删净 legacy 面;`ToolProvider.Get` 已确认平台从不调用,可安全移除)。

## Round 10 — 2026-08-10
- 目标:Phase 2 DoD 项 5 — 样例 plugin 双 export 零样板(一个 plugin 同时注册 tools 与 context,不写任何 JSON Schema 与协议样板)
- 动作:
  - 新增 **`packages/plugin-example`**(第 9 个包,private,不发布):`actions`(tools/v1:create_note / count_notes)+ `notes`(context/v1:只实现 list/get/write/search)。148 行里**零协议代码** —— 健康检查、`~describe`、`~help`、envelope、鉴权、去重、上游凭证、校验、错误归一、export 路由全在 SDK。存储用进程内 Map,样例可独立跑,不引 KV/D1 绑定。tsconfig 与 SDK 同姿势(`lib:[ES2023,DOM]`、`types:[]`),样例若用上 Node 内建就不再是"贴着真实运行时"的样例。
  - **plugin-sdk 改工作区内可直接 import**:`main`/`exports` 指向 `src/index.ts`,发布形态用 `publishConfig` 字段覆盖回 `dist`(仓库既有惯例)。取证确认了配套纪律:**`npm pack/publish` 不应用 publishConfig,只有 `pnpm pack` 会**(`llmdoc/guides/npm-publish.md` 已记),故发布必须 `pnpm pack` + `npm publish <tarball>`;本轮用 `pnpm pack` 复验发布物仍是 dist 形态。
  - **SDK 补两处作者面缺口**(都是写样例时暴露的,不是臆测):① 未导出 `TBError`,作者只能抛裸 Error → 语义在传输层丢成 internal 500;现导出 `TBError` 与 `ToolResult`/`ToolSpec` 类型。② context handler 入参里 `entry`/`patch`/`opts` 是 `Record<string, unknown>`,作者每个 handler 都要手动断言回去;现直接复用平台的 `ContextEntryInput`/`ContextPatch`/`ListOptions`/`SearchOptions`,样例里 `entry.metadata?.title` 直接可用。
  - **修一处真契约违反(样例把它逼了出来)**:gateway 的 plugin-backed context provider 无视 export 自报的 `methods`,一律按"四核心动词 + capabilities"构造 —— 于是这个只实现 list/get/write/search 的 plugin 在平台上被宣告成**可 Update**,`~help` 列出 Update,数据面也真的会把 Update 打到 plugin。已在两处按自报 `methods` 裁剪:`pluginContext.ts`(数据面 provider 按声明逐个装配)与 `tbApp.ts` 的 `~help` 分支;未自报 `methods` 的 export(v2 允许省略)退回旧默认,不改变既有 plugin 行为。
  - gateway 加 devDep `@tool-bridge/plugin-example`(仅测试用)。
- 验证:
  - 新增 **`packages/gateway/test/pluginExample.integration.test.ts` 5 例**。关键取舍:**不 stub 协议** —— 把网关的出站 `fetch` 直接接到样例真实的 `fetch(Request, Env)`,于是这条测试是 gateway↔SDK 的**跨包契约回归**,而非网关自说自话。覆盖:注册 → `~describe` 得两 export(`[['actions','tools/v1'],['notes','context/v1']]`,ctx methods `['List','Get','Write','Search']`,capabilities `['search']`)→ 用 `config.export` 双挂载 → 工具级 `~help` 断言 Zod 派生的 schema(properties body/tags/title、required body+title、`title.description === '笔记标题'`、effect write)→ 调 create_note → context Get 拿到内容与 `node://docs/notes/weekly-plan` → Search/List;缺必填参数 → 400 invalid_argument 且消息含 'body';`TBError.notFound` → 404 not_found;Update/Delete 既不出现在 `~help`(`['Get','List','Search','Write']`)也打不到 plugin;context Write 后工具 count_notes === 1(两 export 共享同一后端)。
  - **回归有效性自证**(沿用 Round 4 的做法):临时回退 `~help` 修复 → 该测试 FAIL(`+ "Update"`);只回退数据面一半 → FAIL(`expected 1 to be +0`,Update 真打到了 plugin)。两次都已还原并复跑。
  - `pnpm verify` 全量 → typecheck + lint clean + **1182 passed / 7 skipped**(core 726 + plugin-sdk 18 + cli 237 + sdk 17 + plugin-feishu 8 + gateway 144 + server 32),退出码 0;gateway 139 → 144。
  - 发布物复验:`pnpm --filter @tool-bridge/plugin-sdk build` → ESM 22.82 KB + dts 10.24 KB;`pnpm pack` 产物 = `package/dist/index.js` + `package/dist/index.d.ts` + `package/package.json` + `package/LICENSE`;`grep -c "node:" dist/index.js` = **0**;`grep -c "@tool-bridge/core" dist/index.d.ts` = **0**。
- 勾选:Phase 2 DoD 项 5。
- 已知未完成(不静默,继续挂账):**Dashboard 挂载表单仍缺 export 字段**(Round 8 起的三入口对等缺口,CLI/API 已可设)。
- 遗留:下一轮起点 = Phase 2 项 6(删净 legacy 面:legacy provider API / `ToolProvider.Get` / 强制四方法接口;`ToolProvider.Get` 已取证确认平台从不调用)+ Dashboard export 字段;项 7(飞书 plugin 重写复验)依赖生产、项 8(部署)属外向动作,预计挂 PENDING。
- 待办(留给 `llmdoc:update`):plugin-sdk 的 publishConfig 覆盖形态 + **必须 `pnpm pack` 发布**这条纪律;新包 `plugin-example` 的定位;gateway 按 export 自报 `methods` 裁剪 context 动词这条契约。

## Round 11 — 2026-08-10
- 目标:Phase 2 DoD 项 6 — 删净 legacy 面(legacy provider API / `ToolProvider.Get` / 强制四方法接口)
- 取证(先确认哪些是真死面,不凭印象删):
  - core `tool/types.ts` 的 `ToolProvider`(List/Get/Call 三动词)**没有任何实现者与消费者** —— 全仓 `grep` 只命中它自己的定义与两处注释;网关侧真正被实现的是异步的 `UpstreamProvider`(list/call 两动词)。它是"看起来像契约、实际没人用"的误导面。
  - sdk `ToolProviderLike` **强制** `Get`,但 `upstreamOf` 只映射 `List`/`Call`,`Get` 从注册到调用全程无人读 —— 嵌入方每写一个工具源都要多写一个永不执行的方法(README 与三处测试里都有这行样板)。
  - 「强制四方法接口」指 context 的 List/Get/Write/Update,Round 7 已改全可选;本轮复核无残留(`ObjectContextProvider` 用 `Required<ContextProvider>` 是**实现**收窄,不是对外强制)。
- 动作:
  - **删** core `ToolProvider` 接口,原位留一段说明为什么删(平台从不发 Get;`~help` 的数据源是 List 的产物)。sdk 公开面同步去掉 `type ToolProvider` 再导出。
  - **删** `ToolProviderLike.Get`:手写工具源现在只有 `List` + `Call` 两个动词。
  - **补上被删面的替代品**:`registerTool` 现在除手写 Provider 外,**直接收一个 core `OperationRegistry`**(新类型 `ToolSource = OperationRegistry | ToolProviderLike`,注册期归一,下游只认一种形状)。于是嵌入式宿主与 plugin 作者共用同一套零样板内核 —— 用 Zod 声明入参,JSON Schema 派生 / 校验 / 裸返回值包装都不必自己写。删掉样板而不给替代路径,只是把成本转嫁给使用者。
  - 同步清理:root `README.md`、`packages/sdk/README.md` 示例里的 `Get:` 行;gateway `providers/types.ts` 的注释改为陈述唯一契约(list+call,并写明为什么没有 Get)。
- 验证:
  - **删除有效性由编译期证明**:去掉 `Get` 后,仍留着 `Get:` 的旧测试直接 `tsc` 失败 —— `test/connect.remote.test.ts(54,9): error TS2353: Object literal may only specify known properties, and 'Get' does not exist in type 'ToolSource'`。这条错误就是"强制契约已消失"的机器证据,随后按此清掉三处测试样板。
  - DoD 指定的验证命令:`grep -rn "ToolProvider" packages/*/src` → 残留命中全部是**注释、`ToolProviderLike`(两动词)、`ToolSource`、`createPluginToolProvider` 工厂名与 Dashboard 的同名表单变量**,无强制 Get 契约。
  - 新增 sdk 断言测试 **2 例**(走 HTTP wire,与 curl 等价):`registerTool` 收 `OperationRegistry` 后,`GET /tools/greet/greet/~help` 的 `inputSchema.required` 与 `properties.name.description` **全由 Zod 派生**(测试里没有一行手写 JSON Schema)、effect 透传;`POST` 调用裸返回值被包成结果,缺参数 → 400 且消息含字段名 `name`。sdk 17 → **19 passed**(+1 skipped)。
  - `pnpm verify` 全量 → typecheck 9 包 + lint clean + **1184 passed / 7 skipped**(core 726 + plugin-sdk 18 + cli 237 + sdk 19 + plugin-feishu 8 + gateway 144 + server 32),退出码 **0**。
- 判断留痕(不静默):保留 `OperationRegistry.get(name)`。它是**作者侧的查询便利**(与 `has`/`names` 同类),不是强加给实现者的协议方法;DoD 要删的是"强制四方法/三方法接口",不是类上的可选查询 API。
- 勾选:Phase 2 DoD 项 6。
- 遗留:Phase 2 只剩项 7(飞书 plugin 用新 SDK 重写并**生产**复验)与项 8(部署上线),两者都依赖外向动作;下一轮先做项 7 里**不依赖生产**的部分(用 plugin-sdk 重写 plugin-feishu 并补测试),生产实调与部署按纪律挂 PENDING。另仍挂账:Dashboard 挂载表单缺 `export` 字段。

## Round 12 — 2026-08-10
- 目标:Phase 2 DoD 项 7 — 飞书 plugin 用新 SDK 重写(**可做的那半边**;生产复验依赖真实环境,见 P2-1)
- 先解决一个真问题:飞书 plugin 是**代理**(工具表的真源在飞书上游,只有拿到凭证才能枚举),而 SDK 此前只有静态注册(`.tools().register()`)。照搬静态形态就得由 plugin 复述一份 schema —— 必然与上游漂移。故给 SDK 补第三种 export 形态:
  - **`plugin.proxyTools(id, { list, call })`**:工具表运行时枚举。`~describe` 与静态 tools export **同形**(profile `tools/v1`)—— 工具表怎么来的是 plugin 内部实现,平台不必知道;`~help` 则如实标 `dynamic: true` 且给空表(枚举需要凭证,而 `~help` 是不鉴权的生命周期端点,宁可说"经 List 才知道"也不编一份会过时的清单)。
  - 顺带把 `toToolResult` 从 core 的 registry 里导出复用:"裸值要包、已是结果就透传"这条规则只留一份,代理路径与静态路径同规则。
  - 顺带修 SDK 一处错误归类:`X-TB-Upstream-Auth` 坏 base64url 时 `atob` 抛裸 Error,被归一成 **internal 500** —— 把调用方送来的坏输入说成服务故障。现归 `invalid_argument`(400)。
- 动作:重写 `packages/plugin-feishu/src/index.ts`,**294 行 → 140 行**。删掉的全是协议样板:手写 `/healthz`、`/~describe`、`/~help`(含 HelpModel 常量与 Accept 协商)、envelope 解码、Bearer 校验、`X-TB-Request-Id` 去重、`X-TB-Upstream-Auth` base64url 解包、`json()`/`errorResponse()`、`invoke` 的方法分发与 `List/Get/Call` 参数校验。留下的全是飞书业务:TAT 换发与缓存、401 强制重换发重试、`annotations → effect` 的 ToolSpec 转换、凭证形状校验。`feishuMcp.ts` / `tat.ts` 未动。
- 验证:
  - plugin-feishu 集成测试**基本不改断言**地继续通过 —— 这正是"重写没有偷偷改契约"的证据:同一组经 wire 的断言(healthz / `~describe` v2 exports 逐字相等 / 无·错 Bearer → 401 / 缺 `X-TB-Upstream-Auth` → 503 且消息含 authRef 且不打飞书 / 坏头 → 400 / List 换发一次 TAT 且白名单头透传且 effect 正确 / 二次调用命中缓存 / Call 结果原样 + 同 requestId 重放零上游请求 / TAT 被吊销后强制重换发一次成功 / 多租户缓存不串号)在换了实现之后仍然成立。
  - 三处**有意**的行为变更,均已改测试并写明理由:① `Get` 不再是协议动词 → 400 unknown method 且不打上游(与 Round 11 一致);② `Call` 缺 name 的校验现由 SDK 统一做(plugin 不写这段);③ `~help` 由 SDK 统一为 JSON(不再有 Help DSL 与 Accept 协商),代理型 export 标 `dynamic`。平台自 Round 8 起不再抓 plugin 的 `~help`,故无消费方受影响。
  - **SDK 侧要求补齐**:测试 envelope 现必须带 `X-TB-Context`(平台真实调用一直带,旧手写实现漏读了它)。
  - plugin-sdk 新增 `proxyTools` 用例 **4 例**(describe/help 形状、List 拿到解包凭证 + Call 参数规整 + 已是 ToolResult 则不二次包装、缺 name 与 Get 都 400 且不进 handler、坏 upstream-auth → 400 含 'base64url');plugin-sdk 18 → **22 passed**,plugin-feishu 8 → **9 passed**。
  - `pnpm verify` 全量 → typecheck 9 包 + lint clean + **1189 passed / 7 skipped**(core 726 + plugin-sdk 22 + cli 237 + sdk 19 + plugin-feishu 9 + gateway 144 + server 32),退出码 **0**。
- 勾选:**无**。项 7 的 DoD 明确要求"重新部署 + 生产三动词实调留证",代码完成不构成证据 —— 按"DOD 是判据,不许编进度"挂 **P2-1** PENDING。
- 遗留:Phase 2 剩余全部是外向动作(P2-1 生产复验、项 8 部署)+ Dashboard `export` 字段。下一轮做 Dashboard 挂载表单的 `export` 字段(纯代码,补三入口对等),之后 Phase 2 的可做项即清空,按 LOOP 进 Phase 3。

## Round 13 — 2026-08-10
- 目标:Phase 2 DoD 项 2 —— Plugin v2 多 export 的**三入口对等收尾**(挂载配置的 `export` 字段在 Dashboard 上补齐)。开工取证后发现缺口远不止一个字段,见下。
- 取证(先拉真实状态,再动码):
  - Dashboard 挂载表单按 `p.kind === 'tool-provider'` / `'context-provider'` 过滤候选 plugin,但 `kind` **已随 Round 8 的 plugin/v2 从 manifest 移除**。也就是说两个下拉恒为空 —— Dashboard 自 Round 8 起**根本挂不了任何 plugin**,不只是"缺 export 字段"。
  - Dashboard 的 Plugin 页同样停留在 v1:注册表单填 `kind` + `interfaceVersion`(网关按未知字段静默丢弃)、详情页与列表渲染 `plugin.kind` / `plugin.interfaceVersion`(现在都是 `undefined`)、契约门写着"~describe 的 kind 与 interfaceVersion 必须和 manifest 一致"(已不是真规则)。
  - `tb plugin` 也停留在 v1:`ls` 有 KIND 列、`get` 打印 `kind:`/`interfaceVersion:`、`register`/`update` 回显 `(${reg.kind}, …)` —— v2 下这些全打印 `undefined`。
  - 根因是同一个:v2 把「这个 plugin 提供什么」从部署身份下沉到了 export,而**管理面拿不到 exports** —— `~describe` 只缓存在 `pluginmeta:<id>`,`system/plugin` 的 get/list 从不返回。于是 CLI 与 Dashboard 既答不出"它是什么",也无从知道挂载时 `config.export` 能填什么(多 export 必须显式指定)。
- 动作:
  - **core**:`system/plugin` 的 get/list/write/update 一律返回新的管理面投影 `PluginView = manifest + exports`,exports 直接读 `pluginmeta:<id>` —— 与网关挂载时 `requirePluginExport` 读的是**同一份缓存**,不另起真源。缓存缺失(老记录)时省略该字段而不是编空数组。`PluginRegistration` 从 manifest.ts 移到 builtin/plugin.ts 并改为 `PluginView + pluginToken`(manifest.ts 只描述部署身份,不该知道 exports)。
  - **CLI**:`plugin ls` 的 KIND 列 → EXPORTS(`notes:context/v1, actions:tools/v1`);`plugin get` 打印 protocolVersion + 逐个 export(含 methods/capabilities/description),**并为每个 export 给出它 profile 对应的挂载命令**(tools/v1 → `tb tool mount … --kind tool --export <id>`;context/v1 → `tb ctx mount … --export <id>`),用户不必自己换算;register/update 回显同步去 kind。
  - **Dashboard**:类型面 `PluginManifest` 升到 v2(`protocolVersion` + `exports?`,删 `PluginKind`);Plugin 页的 kind/interfaceVersion 表单项与展示全部换成 exports 徽标与 v2 契约门文案;挂载表单改为**按 export 的 profile** 过滤候选 plugin(一个 plugin 可同时出现在 tool 与 context 两处),并新增共用的 `ExportField`:候选来自缓存的 `~describe`,单 export 可留空(网关自动选中)、多 export 必选,缺缓存的老记录退回手填不把人挡在门外;换 provider 即清空 export。校验文案与 core `resolvePluginExport`、`--export` 同语义。
- 验证:
  - **缺陷是机器证明的,不是我说的**:Dashboard 类型面升到 v2 后,`pnpm --filter @tool-bridge/dashboard typecheck` 直接报 `src/pages/system/RegistryPage.tsx(250,49): error TS2339: Property 'kind' does not exist on type 'PluginManifest'`(两处)—— 这就是"挂载表单在按一个平台早已不返回的字段过滤"的编译期铁证。改完后 typecheck 干净。
  - core 新增 3 例:get/list 回 exports(与 `~describe` 逐字相等)、write/update 的返回也带 exports 且仅本地字段变更时**不重抓契约**(`fetchContract` 仍只调 1 次)、meta 缓存缺失 → 省略 exports 而非空数组。core 726 → **728 passed**。
  - gateway 新增 1 例(走真实 HTTP,与 curl 等价):一个双 export plugin 注册后,write/list/get 三处都回 `[actions:tools/v1, entries:context/v1]`,且响应里**不再有 kind / interfaceVersion**。gateway 144 → **145 passed**。
  - CLI 新增 2 例并改写 1 例:EXPORTS 列取代 KIND 列、`get` 逐个 export 列出并给出对应挂载命令且**输出中不含 'undefined'**(钉死 v1 字段回归)、缺 exports 缓存时列显示占位符。cli 237 → **239 passed**。
  - `pnpm --filter @tool-bridge/dashboard build` 通过(RegistryPage 37.47 kB / PluginsPage 29.42 kB)。
  - `pnpm verify` 全量 → typecheck + lint clean + **1194 passed / 7 skipped**(core 728 + plugin-sdk 22 + cli 239 + sdk 19+1 + plugin-feishu 9 + gateway 145+6 + server 32),退出码 **0**。
- 勾选:Phase 2 项 2(Plugin v2 多 export)—— 至此代码面与三入口对等都成立。
- **账本订正(不静默)**:发现 DOD.md 里 Phase 1 项 1–5 与 Phase 2 项 1–4 的复选框**从未被勾上**,尽管 Rounds 1–9 已逐条记了命令与输出(`git log -- DOD.md` 显示只有项 5/6 有过勾选提交,疑似早期某轮的编辑丢失)。本轮按「DOD 是法官、证据即判据」补勾这 9 项——**依据是既有 Round 记录里的证据,不是本轮新跑的**;唯一由本轮重新确认的是「全阶段回归绿:pnpm verify 退出码 0」。
- 遗留:Phase 2 可做项**已清空** —— 只剩 P2-1(飞书生产复验)与项 8(部署),两者都是待授权的外向动作。按 LOOP「Phase 内只剩 PENDING → 继续下一 Phase」进 **Phase 3(E:对外 MCP 出口)**,起点是 blocker E-1(用官方 `@modelcontextprotocol/sdk` 写测试 client)。跳过的是"部署/生产实调"这类流程动作,Phase 3 的编码依赖的是 Phase 2 的**代码**,而代码已在本分支上,不构成代码依赖。
- 待办(留给 `llmdoc:update`):`system/plugin` 管理面新增 exports 投影这条契约;plugin/v2 下"管理面如何回答『这个 plugin 提供什么』"的答案已从 manifest.kind 变为 export 列表。

## Round 14 — 2026-08-11
- 目标:Phase 3 DoD 项 1 — 测试 MCP client 就位(解 blocker E-1):用官方 `@modelcontextprotocol/sdk` client 连本地 gateway MCP endpoint 完成 initialize。
- 动作:
  - 新增宿主中立 `gateway/src/mcpServer.ts`:使用官方 `McpServer` + `WebStandardStreamableHTTPServerTransport` 提供无状态 `/mcp` Streamable HTTP endpoint;校验器使用 `CfWorkerJsonSchemaValidator`,避免 workerd 禁止动态代码生成的问题。无状态是刻意选择:每个 MCP HTTP 请求都重新经过 gateway Bearer 认证,不让 isolate 内会话替代身份边界。
  - `createTbApp` 在既有 Bearer 认证中间件之后注册 `/mcp`,因此无/错 SK 仍由现有 `identify` fail closed;本轮只交付 initialize,尚未注册 tools capability。
  - 新增可复用测试 client `test/mcpClient.ts`:官方 `Client` + `StreamableHTTPClientTransport`,Bearer SK 走 `requestInit`,实际 fetch 注入测试宿主。新增 `mcp.integration.test.ts` 通过 `SELF.fetch` 穿透本地 Worker,断言 serverInfo=`tool-bridge@0.4.0`、capabilities 为空。
  - 过程修正:首跑 initialize 已成功,但断言错误地要求空 capabilities 含 `tools:undefined`,且断言提前失败使 client 未 close,后台 SSE GET 被 workerd 判悬挂。改为断言 `{}` + `try/finally` 关闭;测试 harness 仅对 initialized 后的可选长驻 GET 返回 405,initialize/initialized POST 都真实穿透 gateway。产品 endpoint 仍完整支持 GET SSE。
- 验证:
  - `pnpm --filter @tool-bridge/gateway exec vitest run test/mcp.integration.test.ts` → **1 passed**,退出码 0;官方 SDK client 完成 initialize 并读回 serverInfo。
  - `pnpm --filter @tool-bridge/gateway typecheck` → 退出码 0。
  - `pnpm exec eslint packages/gateway/src/mcpServer.ts packages/gateway/src/tbApp.ts packages/gateway/test/mcpClient.ts packages/gateway/test/mcp.integration.test.ts` → 退出码 0(首跑 4 个 import 排序错误已由 `eslint --fix` 修复后复验)。
- 勾选:Phase 3 DoD 项 1(测试 MCP client 就位 / E-1 已解)。
- 遗留:下一轮 = Phase 3 项 2(MCP tools/list + tools/call):基于同一个按请求认证的 server factory,把当前 SK 的 `ctx` 注入工具枚举/调用;复用现有 registry/provider/virtualize/Authorizer.Check,不另造分发路径。

## Round 15 — 2026-08-11
- 目标:Phase 3 DoD 项 2 — gateway MCP server 动态 `tools/list` + `tools/call`,按当前 Bearer SK 裁剪并复用既有 HTBP 调用链。
- 动作:
  - endpoint 从 Round 14 的普通 `/mcp` 纠正为保留控制段 `/~mcp`,加入 `RESERVED_SEGMENTS`;仍位于统一 Bearer 中间件之后且每请求新建无状态官方 MCP Server/Streamable HTTP transport,无认证 initialize 在协议分派前 401。
  - `mcpServer.ts` 改用官方 low-level `Server` 的动态 list/call handler(现有 ToolSpec 持 JSON Schema,不适合高层 Zod `registerTool`):整棵本地 registry 投影 provider/device/builtin/context/skillhub 命令,remote 子树通过 `~tree`/`~help` 本地化;每条先 read、再按工具 call 或命令 action 做 `Authorizer.Check`。
  - 工具名 identity 改为无歧义 JSON tuple,UTF-8 字节编码成 MCP 安全字符;超长名保留前缀 + 完整 SHA-256,总长 128。重复 identity/name fail closed。schema 经官方 `ToolSchema` + `CfWorkerJsonSchemaValidator` 编译,call 前实际校验 required/type;畸形 provider schema 不进入 client。
  - 调用复用:本地 mcp/http/tool 在重新读取节点、复判 read+call、重新虚拟名反查后直达 typed `provider.call`,从而保留上游 MCP `isError`、image/content blocks 与 `structuredContent`;其余本地命令和 remote 继续走 Hono/HTBP 信封路径。所有返回再过 `CallToolResultSchema`。
  - 严格 investigator 两次复核发现并修复 6 类遗漏:①MCP 业务错误/多模态结果被 HTTP 渲染压扁;②low-level handler 未自动校验动态参数;③remote 缺固定 call 可见门;④remote 根下本地长前缀覆盖被误吞;⑤不可信 remote BFS 无预算;⑥恶意 remote child `../admin` 可经 URL 规范化逃出 baseUrl 路径且携带 skRef。remote 现按 registry 最长前缀(本地优先)并同时要求 read+call+command scope,深度 8/节点 500/发现请求 32 任一超限即 fail closed;`~tree`/`~help` path 另做 canonical、请求对应与直接父子/命令归属校验,点段在第二次 fetch 前拒绝。
  - recorder 同步 `llmdoc/reference/protocol-contract.md` 的 `POST /~mcp`、投影/命名/schema/结果与 remote 预算契约。
- 验证:
  - `pnpm --filter @tool-bridge/gateway exec vitest run test/mcp.integration.test.ts` → **12 passed**,退出码 0。覆盖 401、list 权限裁剪、HTTP call、参数拒绝且上游零调用、畸形 schema、MCP 原生错误/图片/structured result、remote 本地化与 no-call 零探测、本地覆盖 remote、32 请求预算、原始/一次编码/三次编码 `..` 逃逸均在首次 fetch 后拒绝、名称碰撞/长度。
  - `pnpm --filter @tool-bridge/gateway test` → **157 passed / 6 skipped**,退出码 0;`pnpm --filter @tool-bridge/core test` → **728 passed**,退出码 0。
  - `pnpm --filter @tool-bridge/gateway build` → ESM+DTS success(393.22 kB);gateway/core typecheck、目标文件 eslint、`git diff --check` 均退出码 0。
  - 过程证据:初版 direct `/<node>/<tool>` 自调用因精确 node scope 得到 not_found,改回节点信封后通过;严格复核后的首轮反例测试中畸形 schema 如期 fail closed,但同文件持久测试树污染后续列表,加入挂载路径逆序清理后 9/9 全绿。
- 勾选:Phase 3 DoD 项 2(MCP server endpoint:动态 list scope 裁剪 + call 成功)。
- 遗留:下一轮 = Phase 3 项 3(scope 收窄钉死):同一树用 admin 与窄 scope SK 分别连接,断言精确工具集差异;再用窄 SK 调 admin-only 工具名,必须不可见、不可调且上游零调用。

## Round 16 — 2026-08-11
- 目标:Phase 3 DoD 项 3 — 换窄 scope SK 后 `tools/list` 精确收窄,越权工具不可见且已知旧名称也不可调。
- 动作:
  - 在官方 SDK client 集成测试中挂同一前缀下 `allowed` / `admin-only` 两个 HTTP 工具节点;先以 admin 连接取得精确两项集合与各自 flat MCP 名称,再签发仅含 `mcp-round16/allowed` read+call 的窄 SK 重新连接。
  - 窄连接断言目标前缀工具集精确等于 `[allowed]`,且 allowed 名称与 admin 连接一致;随后故意提交 admin-only 的已知旧名称,验证 call 每次先按当前身份重建投影,返回 MCP `tool not found` 且上游调用计数仍为 0;最后 allowed 同连接真实调用成功且计数恰为 1。
- 验证:
  - `pnpm --filter @tool-bridge/gateway exec vitest run test/mcp.integration.test.ts` → **13 passed**,退出码 0。
  - `pnpm --filter @tool-bridge/gateway test` → **158 passed / 6 skipped**,退出码 0。
  - `pnpm --filter @tool-bridge/gateway typecheck`、目标文件 eslint、`git diff --check` 均退出码 0。
- 勾选:Phase 3 DoD 项 3(scope 收窄钉死)。
- 遗留:下一轮 = Phase 3 项 4(三入口对等审计):确认 `/~mcp` 是纯消费面、没有管理开关或持久配置,因此 API 不新增管理动作且 CLI/Dashboard 无对应动作缺口;用能力矩阵与代码搜索证据记入账本。

## Round 17 — 2026-08-11
- 目标:Phase 3 DoD 项 4 — 三入口对等审计,确认 MCP 出口不制造管理旁路,CLI/Dashboard 无需新增 MCP 管理动作。
- 动作:
  - investigator 与主 agent 独立搜索 Gateway/API、CLI、Dashboard。结论:`/~mcp` 只有一处固定路由,位于统一 Bearer 中间件之后;`mcpServer.ts` 无 StateStore 写删、无 endpoint 启停配置、无跨请求会话。CLI/Dashboard 对 `~mcp` 均无引用,三端一致地不存在“MCP 出口开关/配置”这项管理生命周期。
  - 能力矩阵:

| 能力 | Gateway API / MCP | CLI | Dashboard | 结论 |
|---|---|---|---|---|
| MCP 启停/配置/持久状态 | 固定认证路由,无配置读写 | 无 | 无 | 三端均无;无需新增开关 |
| 树发现与调用 | `~tree/~help/POST`;MCP list/call | `tb ls/tree/help/call` | TreeNav/NodePage/CmdPanel | 同一树与调用面 |
| `system/*` 管理命令 | 按当前 SK 的 command action scope 投影 | 专用命令族 + `tb call --tool` | 专用管理页 + 通用 CmdPanel | 能力对等,无旁路 |
| Registry/SK 管理 | `system/registry`、`system/sk` | tool/server/ctx/skill/sk 命令族 | RegistryPage、SkPage | MCP 只消费同一状态 |

  - 关键限定:“消费面”不等于只读。Admin SK 在 MCP 中能看到 `system/*` 是既有权限的另一协议表现;call 重新进入 HTBP builtin 分发,registerPaths、Secret Reference、remote/config 等附加安全校验仍执行,能力不超过同一 SK 经 API/CLI/Dashboard 已有权限。
- 验证:
  - `! rg -n "~mcp|mcpServer|MCP consumer" packages/cli/src packages/dashboard/src` → 无匹配,退出码 0。
  - `rg -n "app\\.all\\('/~mcp'|handleMcpRequest\\(" packages/gateway/src` → 仅 `tbApp.ts` 路由 + `mcpServer.ts` handler;`! rg -n "StateStore|\\.put\\(|\\.delete\\(|KEY_" packages/gateway/src/mcpServer.ts` → 无持久写面,退出码 0。
  - `rg -n "system/(sk|secret|registry|plugin|federation|annotation)" packages/cli/src packages/dashboard/src` 与源码核对 → 既有管理面均落同一 `system/*`;`rg -n "check\\(ctx|assertRegisterPath|assertSecretRefUse" packages/gateway/src/tbApp.ts` → MCP 投影 scope 与 builtin 附加校验链均存在。
- 勾选:Phase 3 DoD 项 4(三入口对等审计;无需新增 CLI/Dashboard 动作)。
- 遗留:下一轮 = Phase 3 项 5 的可做代码半边:新增可对生产运行的官方 SDK MCP smoke(`initialize → tools/list → tools/call`,并支持窄 SK 集合比较),随后跑 `pnpm verify`;真实 `deploy:all` + 生产 smoke 属外向动作,无授权则按纪律挂 PENDING 并进入 Phase 4。

## Round 18 — 2026-08-11
- 目标:Phase 3 DoD 项 5 — 完成全阶段回归与可复现的生产 MCP smoke;部署和真实生产调用按外向动作纪律判断。
- 动作:
  - 新增 `scripts/verify-mcp.ts` 与根命令 `pnpm verify:mcp`,直接使用官方 `Client` + `StreamableHTTPClientTransport` 连接 `POST /~mcp`。Admin 连接断言 initialize 后工具非空,默认选择只读 `system/registry:list` 完成真实 tools/call;可用 `TB_MCP_PATH` / `TB_MCP_COMMAND` / `TB_MCP_ARGS` 改目标。
  - 同一进程关闭 admin client 后以必填 `TB_MCP_NARROW_SK` 重连,断言窄工具名集合是 admin 的严格子集,并用一个已知 admin-only 旧名称验证 call 返回 `tool not found`。脚本不签发 SK、不创建或修改生产资源,日志不输出凭据。
  - 根工作区显式声明 `@modelcontextprotocol/sdk` 与 `@types/node`,避免生产验收脚本依赖子包的传递安装布局。真实 `deploy:all` + 生产连接需要生产授权、凭据且部署纪律要求分支先合并到 `origin/main`,故登记 P3-1;Phase 4 只依赖本分支已有代码,继续晋级。
- 验证:
  - `pnpm exec eslint scripts/verify-mcp.ts package.json` + 显式 NodeNext `tsc --noEmit … scripts/verify-mcp.ts` → 均退出码 0。
  - 缺参运行 `pnpm verify:mcp` → 预期退出码 1,仅输出 `MCP smoke FAILED: missing base URL…`,证明入口可执行且 fail closed;真实生产运行留 P3-1。
  - `pnpm verify` → 9 个 workspace typecheck + 全仓 lint + **1207 passed / 7 skipped**(core 728 + plugin-sdk 22 + cli 239 + sdk 19 + plugin-feishu 9 + gateway 158 + server 32),退出码 0。
- 勾选:无。Phase 3 项 5 的本地代码/回归半边已完成,但按证据纪律在 `deploy:all` 与生产 `verify:mcp` 成功前保持未勾。
- 遗留:P3-1 挂起且不构成代码依赖,按状态机进入 Phase 4。下一轮 = Phase 4 项 1(D1 binding + provision 幂等),先加载 Cloudflare/Wrangler 指南并解决 blocker C-1。

## Round 19 — 2026-08-11
- 目标:Phase 4 DoD 项 1 — 建立 D1 binding 与 provision 幂等分支,解除代码 blocker C-1;真实资源创建/部署按外向动作纪律判断。
- 动作:
  - 先加载 Cloudflare/Wrangler skill,以仓库锁定的 Wrangler `4.107.0` 的 `d1 list/create --help`、本地 config schema 与 CLI 实现核对当前契约:`d1 list --json` 返回含 `name` / `uuid` 的数组;在线文档检索端点返回 404,未据旧知识猜参数。
  - `wrangler.jsonc` 新增 `TB_SEARCH` / `tb-search` D1 binding 与合法 UUID 占位,Workers `Env` 同步声明 `D1Database`;`provision.mjs` 新增 `${TB_NAME_PREFIX}-search` 的 list→存在则同步 ID/skip→create→重新 list→正则回填 `database_id`。回填保持 JSONC 注释,找不到 binding 时 fail closed。
  - 增加根 `test:provision`:在临时目录生成假 Wrangler 与临时 config,真实 spawn `node scripts/provision.mjs` 两次,验证 KV/R2/D1 各只 create 一次、D1 list 三次、KV/D1 ID 均回填;纳入 `pnpm verify` 的 unit 阶段。未接触真实 Cloudflare 账户。
- 验证:
  - `pnpm test:provision` → **1 passed**,二次运行 D1 create 计数严格为 1。
  - `pnpm --filter @tool-bridge/gateway test` → **158 passed / 6 skipped**,证明 Miniflare 可从新配置启动本地 D1 binding;gateway typecheck 与目标 eslint、`git diff --check` 均退出码 0。
  - `pnpm --filter @tool-bridge/dashboard build` → Vite production build 成功;`pnpm --filter @tool-bridge/gateway exec wrangler deploy --dry-run --outdir <tmp>` → bundle 成功且绑定清单明确包含 `env.TB_SEARCH (tb-search) D1 Database`,未上传。
- 勾选:无。项 1 的代码/隔离幂等/dry-run 半边完成并解除 C-1,但真实账户二次 provision 与生产 deploy 证据前保持未勾。
- 遗留:P4-1 挂起且不构成代码依赖。下一轮 = Phase 4 项 2(`~search` 协议保留段 + `~describe` capability + mode 拒绝契约),先同步 protocol-contract 与 HTBP Draft,再补 gateway 契约测试。

## Round 20 — 2026-08-11
- 目标:Phase 4 DoD 项 2 — 固定 root `~search` 协议、真实 capability gating 与未声明 mode 拒绝;外部 HTBP Draft 同步按跨仓动作纪律判断。
- 动作:
  - core 新增公开 `SearchIndex`/`ToolSearchHit`/`SearchCapability` seam,并把 `~search` 显式加入 `RESERVED_SEGMENTS`;该接口只产 raw ToolSpec 候选,不把索引当授权源。
  - gateway `TbAppDeps` 增加可选第五注入点 `search`;只有真实注入同时声明 `search` 时,认证后的根 `POST /~search` 与根 `GET /~describe` 才存在,否则 404。Workers `TB_SEARCH` D1 与 Node SQLite 均未接线,现有生产面不会虚报能力。
  - 请求严格为 `{query,opts?:{mode?:'keyword'|'semantic'}}`:query trim 后非空,keyword 缺省;未知字段、提前使用 limit/cursor/filter、未知 mode 均 400。semantic 必须先声明 `search:semantic`,拒绝发生在索引调用前;本项返回只有 `{items:[{path,tool}]}`,主动丢弃底层 cursor。
  - raw hit 返回前统一过真实 SK 的 `read+call`、registry 同路径回读、本地 mcp/http/tool kind/config 与 `virtualizeTools`(hide/rename/prefix/description)后处理;不可见/隐藏/陈旧候选静默剔除。普通与百分号编码的 path-local `/<path>/~search` 均在数据面分发前 404。
  - llmdoc-update 同步 protocol-contract、模块边界、代码地图、current-state;新增反思 `llmdoc/memory/reflections/2026-08-11-search-capability-gating.md` 并写入 index。没有修改历史 `archive/docs/Proto.md`。
  - 复核外部 `TokenRollAI/HTBP` 的 Draft RFC 后确认其仍无 `~search`;未获跨仓提交/PR 授权,登记 P4-2,本地实现不能替代外部同步证据。
- 验证:
  - `pnpm --filter @tool-bridge/core test` → **730 passed**;core/gateway typecheck 与目标 eslint 均退出码 0。
  - `pnpm --filter @tool-bridge/gateway test` → **163 passed / 6 skipped**。新增 5 例覆盖:无注入 404、认证先于索引、root-only page + virtualize/hide、仅 read 无 call 的 SK 结果为空、未声明 semantic/未知 mode/提前分页零索引调用、声明 semantic 后成功。
  - `pnpm verify` → 9 workspace typecheck + 全仓 lint + provision **1 passed** + 包测试 **1214 passed / 7 skipped**(core 730 + plugin-sdk 22 + cli 239 + sdk 19 + plugin-feishu 9 + gateway 163 + server 32),退出码 0。
  - `git diff --check`(代码、测试、PROGRESS、5 份稳定/索引 llmdoc 与 1 份反思)→ 退出码 0。
- 勾选:无。项 2 的本仓实现/契约/测试已完成,但外部 HTBP Draft 尚未同步(P4-2),按证据纪律保持未勾。
- 遗留:P4-2 挂起且不构成代码依赖。下一轮 = Phase 4 项 3:实现同一 SearchIndex contract 的 CF D1 与 Node better-sqlite3(FTS5 + trigram tokenizer),分别注入 `app.ts`/`server.ts`,用同 fixture 做 core contract + Miniflare D1 + Node SQLite 双侧集成。

## Round 21 — 2026-08-11
- 目标:Phase 4 DoD 项 3 — 以同一可变 SearchIndex contract 落地 CF D1 与 Node better-sqlite3 的 FTS5/trigram 索引,并完成第五宿主注入点。
- 动作:
  - 先以当前 Wrangler `4.107.0` 的临时本地 D1 与 server 实际 better-sqlite3 探针验证 FTS5/trigram:英文和中文三字符命中、两字符为空;确认 D1 migration 文件不会由现有 provision/deploy 自动应用,故本轮 D1 adapter 用失败可重试的单飞 Promise 惰性执行幂等 schema。
  - core 保留只读 `SearchIndex`,新增 `MutableSearchIndex.replace(path,tools)/remove(path)/rebuild(hits)` 节点快照写面,防逐条 upsert 遗留旧工具;raw ToolSpec 统一校验/JSON 序列化,重复 path/name fail closed。专用 `ToolSearchOptions` 当前只声明 mode,不提前承诺 item 5 的 limit/cursor/filter。
  - 新增 `D1SearchIndex`:普通 source table + external-content FTS5 trigram table + insert/delete/update triggers;replace/rebuild 使用事务 batch,4 列多行 INSERT 每 statement 25 tools,单次 mutation 上限 1000 并在写库前拒绝。`TB_SEARCH` binding 存在才注入,发布模板/第三方宿主缺 binding 时 search capability 继续 404。
  - 新增 `SqliteSearchIndex`:与 `SqliteStateStore` 共用 `state.sqlite3` 文件但独立 connection/表/close ownership,同样使用 external-content FTS5 与事务快照;server 注入并在 state 前关闭 search,重启后索引持久。
  - 两端查询把 whitespace term 转成 FTS literal phrase并绑定参数;NUL、semantic 与 runtime 未知 mode 均 `invalid_argument`。正式分页前统一内部候选上限 40,给 gateway 每 hit registry/KV 权限后处理预留免费 Workers 50 子请求预算;不返回 cursor。
  - core 提供无宿主共享 contract fixture,D1/SQLite 对拍 schema 幂等、raw ToolSpec 往返、英文/中文三字符、replace 去旧、跨 path 隔离、remove/rebuild、NUL/mode 拒绝及 65→40 候选上限。gateway 另用真实 `SELF` 覆盖有/无 D1 binding、root describe/search 与 bulk cap;server 用真实 HTTP + close/reopen 覆盖同库持久。
  - 严格复核先后发现并闭环 capability fail-open、NUL MATCH 500、lint、D1 query budget、候选 KV 子请求预算和 options 过宽六类问题;最终报告 `.llmdoc-tmp/phase4-search-index-review.md` 结论无阻断。数据库 trigger/batch 中途故障注入仍是非阻断测试增强,事务形状与正常/输入失败路径已验证。
- 验证:
  - core/gateway/server 定向 typecheck 与共享/宿主测试全绿;Miniflare D1 真实执行 schema、trigger、多行 batch、FTS rebuild 与 1001 条 fail-fast,Node SQLite 同库双连接和重启持久全绿。
  - `pnpm verify` → 9 workspace typecheck + 全仓 lint + provision **1 passed** + 包测试 **1224 passed / 7 skipped**(core 734 + plugin-sdk 22 + cli 239 + sdk 19 + plugin-feishu 9 + gateway 167 + server 34),合计 **1225 passed / 7 skipped**,退出码 0。
  - `git diff --check` 与本轮相关 ESLint 均退出码 0;严格 investigator 最终复核无阻断。
- 勾选:Phase 4 DoD 项 3(第五宿主注入点 SearchIndex:CF D1 + Node better-sqlite3,FTS5/trigram,双侧集成全绿)。
- 遗留:下一轮 = Phase 4 项 4:对字符长度短于 3 的 query 在 D1/SQLite 两端走 escaped LIKE 子串兜底,用中文两字词“日程”/“日历”与现有三字符 trigram 同 fixture 验收。feedback/权重、自动索引同步、over-fetch/cursor 仍严格留项 5。

## Round 22 — 2026-08-11
- 目标:Phase 4 DoD 项 4 — 为 FTS5 trigram 不产生 token 的短词提供 D1/SQLite 对等的 literal LIKE 召回,同时避免混合查询静默丢词。
- 动作:
  - core 新增统一 `prepareToolSearchQuery`:trim 后按 whitespace 拆 term,长度按 Unicode code points 计算;全部 term 均不少于 3 时继续生成参数化 FTS literal phrase,任一 term 短于 3 时则全部 term 改为 escaped LIKE pattern 并按 AND 组合,避免 `AI calendar` 只按长词命中的假阳性。
  - LIKE 固定使用 `!` escape,依次转义 `!`、`%`、`_`;SQL 结构仅由 term 数量生成,用户文本始终走 bind 参数。短词分支限制 32 terms,连同候选上限最多 65 个 bind,保持在 D1 每 statement 100 参数预算内。
  - D1 与 SQLite adapter 共享分流语义:LIKE 扫描 source table 的 name/description并按 path/name 稳定排序,FTS 分支继续按 bm25/path/name 排序;两者均保留内部候选上限 40,不提前实现 item 5 的权重、自动同步或 cursor。
  - core shared contract 覆盖“日程”/“日历”两字、三字 trigram、混合短词 AND、emoji code-point 边界、ASCII 大小写、`!/%/_/\\` literal escape、32 terms 与 LIKE 分支 40 cap;gateway SELF 与 server HTTP/restart 各增加真实中文两字搜索断言。
  - 严格 investigator 复核曾发现整串长度分流会让 FTS5 静默丢短词;改为逐 term 分流后最终报告 `.llmdoc-tmp/phase4-short-search.md` 结论无阻断。
- 验证:
  - core/gateway/server 定向 typecheck、搜索单测与 D1/SQLite/HTTP 集成测试全绿;相关 ESLint 与 `git diff --check` 均退出码 0。
  - `pnpm verify` → 9 workspace typecheck + 全仓 lint + provision **1 passed** + 包测试 **1225 passed / 7 skipped**(core 735 + plugin-sdk 22 + cli 239 + sdk 19 + plugin-feishu 9 + gateway 167 + server 34),合计 **1226 passed / 7 skipped**,退出码 0。
- 勾选:Phase 4 DoD 项 4(trigram 短词 escaped LIKE 兜底,D1/SQLite 双侧中文两字 + 三字 trigram 集成全绿)。
- 遗留:下一轮 = Phase 4 项 5:索引 tool name/description + `~feedback` title/detail,建立 name>description>feedback 权重、registry/tool mutation 自动同步、权限后处理 over-fetch 与 cursor 契约。P4-1/P4-2 外向动作继续挂起且不阻塞本地代码。

## Round 23 — 2026-08-11
- 目标:Phase 4 DoD 项 5 — 完成原始 ToolSpec + feedback 加权索引、canonical 状态自动同步、权限后处理 over-fetch 与可恢复 cursor 分页。
- 动作:
  - core 把搜索读面拆为轻量 candidate 与按 id hydrate,新增持久 revision/cursor secret、snapshot digest 与批量 StateStore/registry 读取;公开分页口径为 default 50/max 200,单页 4 MiB,raw 扫描每批 100、单请求最多 400。cursor 用 AES-GCM 绑定 query digest/mode/revision/offset,篡改、跨查询及索引变更后的旧 cursor 均 fail closed。
  - D1/SQLite 升级为 v2 source + external-content FTS,统一 `bm25(name=10,description=3,feedback=1)`;只聚合 owning node 上现有非隐藏 top5 feedback 的 title/detail,不索引 tool 子路径反馈,原始 ToolSpec 到返回前才做 read+call、kind/config、virtualize 与最终 hydrate。不可见空页不返回 continuation,避免用 cursor 存在性探测隐藏候选规模。
  - 新增 SearchSynchronizer,覆盖 registry write/update/delete、动态 tool cache fresh list、device hello/reclaim、plugin mutation 与 feedback submit/vote/remove;每次 search 先做 501 节点有界 canonical audit。派生索引预算固定为最多 500 paths、每节点 20 KiB,不反向限制 canonical registry/provider:已 seed 后 overflow 保留 last-known-good,回落后自动全量恢复;未 seed overflow 明确 rate_limited。
  - Workers 侧用固定 node/subtree dirty keys、防重复 marker 放大,并在读取 marker 前先做 root capacity probe;D1 snapshot membership trigger 在并发 replace 下保证正式索引不超过 500 且失败事务无 source/FTS 残留。schema 12 statements 后冷路径最坏预算 48/50 queries,全量 rebuild JSON1 chunks 12/20。Node SQLite 保持同 contract、事务和重启持久。
  - 严格 investigator 多轮负例复核推动闭环:短/长词混合的 D1 LIKE 50-byte 限制、feedback 权限 oracle、跨 KV marker 乱序、legacy seed/no-op digest、cursor 自拒绝/offset 资源放大、D1 row/query/chunk 上限、overflow 热写穿透 LKG、并发索引容量和可选 Search 反向限制 canonical 等问题均已修复。最终顺序 501 与 D1 `499+2` 并发探针通过,无剩余阻断。
  - llmdoc-update 新增 `2026-08-11-search-derived-state-lkg.md`,并同步 current-state、protocol contract、模块边界、代码地图与索引;明确 SearchIndex 是有界可重建派生视图而非授权源或 canonical 容量门。
- 验证:
  - 定向 core 40、gateway 25、server 8 tests 与三包 typecheck、目标 lint、`git diff --check` 全绿;额外 D1 并发 trigger rollback 与 501→500 LKG 恢复探针通过。
  - `pnpm verify` → 9 workspace typecheck + 全仓 lint + provision **1 passed** + 包测试 **1255 passed / 7 skipped**(core 744 + plugin-sdk 22 + cli 239 + sdk 19 + plugin-feishu 9 + gateway 185 + server 37),合计 **1256 passed / 7 skipped**,退出码 0。
- 勾选:Phase 4 DoD 项 5(加权索引、自动同步、权限裁剪 over-fetch 与 opaque cursor 分页)。
- 遗留:下一轮 = Phase 4 项 6:补 `tb search` 与 Dashboard 搜索面,用 CLI command tests + gateway `ui.integration.test.ts` 钉三入口对等。P4-1/P4-2 外向动作继续挂起且不阻塞本地代码。

## Round 24 — 2026-08-11
- 目标:Phase 4 DoD 项 6 —— 补齐 `tb search` 与 Dashboard root 工具搜索面,使 API/CLI/UI 共用同一 `POST /~search` 契约。
- 动作:
  - CLI 新增顶层 `tb search <query>`:`--mode keyword|semantic` + 通用 `--limit 1..200`/`--cursor`,直接发 `{query,opts}` 到 root endpoint,不套 HTBP 数据面信封。`--json` 原样保留 Page/cursor;人类模式分列打印 NODE/TOOL/effect/confirm/description 与 next cursor,避免含 `/` 工具名与节点路径混淆。
  - Dashboard 新增独立 `/ui/search` route/SearchPage、`searchTools` API 与 `useToolSearch` infinite query;query/mode/limit 入 query key,cursor 只作 pageParam。页面区分未搜索/loading/401·403/404 未启用/200 空结果,结果点击进 NodePage 并用 `?tool` 预选命令;ActivityRail/移动导航将「工具搜索」与原 CommandPalette「全局跳转」明确分开。
  - 严格复核发现并闭环两个 HIGH:①合法 TreePath 可含 `?/#/%`,搜索结果只编码 tool 会破坏 URL;最终新增 `encodeTreePath`,全部 `/nodes/` 导航入口与 Dashboard 节点 API 均逐 segment 编码。②gateway UI test 仅在 dist 不存在时 build 可复用旧 chunk 假绿;现每次从当前 Dashboard source 无条件 build 后再启 workerd。
  - 追加边界:`ToolSpec.name` 可含 `/`,但不是单个 URL segment;CmdPanel 对该分支停用错误的 lazy tool-help/direct URL,自动回退 JSON 编辑器 + `POST /<node>` `{tool,arguments}` 信封,与 CLI `tb call <node> --tool <name>` 保持执行对等。
  - llmdoc-update 新增反思 `2026-08-11-search-consumer-parity-ui-evidence.md`,并同步 current-state、protocol contract、模块边界、代码地图与索引。
- 验证:
  - `pnpm --filter @tool-bridge/cli test` → **242 passed / 22 files**;新增 3 例精确断言 root URL/POST/body、JSON Page、人类 cursor 与 mode/limit 请求前拒绝。
  - `pnpm --filter @tool-bridge/gateway exec vitest run test/ui.integration.test.ts` → 启动前真实 Vite build,**15 passed**;gateway 全包为 **189 passed / 6 skipped**。断言 `/ui/search` SPA deep link、SearchPage/API chunk、root POST 路由次序、TreePath helper 与 `/` 工具名 fallback 判别。
  - 真实浏览器(Node server + Playwright)→桌面 1440×900 与移动 390×844 无横向溢出;`calendar` 首页 50 → 下一页累计 57,第二请求携 opaque cursor;ActivityRail/移动面同时暴露工具搜索与全局跳转且语义分开。追加 `providers/a?b/c#d/e%f` + `calendar?open#special%tool` fixture,点击后 URL 为逐段编码形态、NodePage 成功且工具已预选,`not_found=false`。
  - `pnpm verify` → 9 workspace typecheck + 全仓 lint + provision **1 passed** + 包测试 **1262 passed / 7 skipped**(core 744 + plugin-sdk 22 + cli 242 + sdk 19 + plugin-feishu 9 + gateway 189 + server 37),合计 **1263 passed / 7 skipped**,退出码 0。`git diff --check` 退出码 0;严格 investigator 最终复核无阻断。
- 勾选:Phase 4 DoD 项 6(三入口对等:`tb search` + Dashboard 搜索面)。
- 遗留:Phase 4 仅剩外向动作 P4-1(真实 D1 provision/deploy)、P4-2(外部 HTBP Draft)、P4-3(生产中英文 search smoke),不构成组件抽象的代码依赖。按 LOOP「Phase 内只剩 PENDING 则继续」进入 Phase 4.5;下一轮 = Dashboard Registry/Plugins/SK 大页拆分。
