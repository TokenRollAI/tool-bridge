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

## 当前状态
- 当前 Phase:**Phase 2 — B:Plugin SDK / OperationRegistry 地基**(分支 `phase2-plugin-sdk`)
- Phase 2 已勾选:项 1(OperationRegistry)、项 2(Plugin v2 多 export)、项 3(Context 按 handler 推导能力)、项 4(`@tool-bridge/plugin-sdk` 可发布)
- Phase 2 待办:项 5 样例双 export / 项 6 删净 legacy 面 / Dashboard export 字段 / `@tool-bridge/plugin-sdk` 可发布 / 项 5 样例 plugin 双 export / 项 6 删净 legacy 面 / 项 7 飞书重写复验(依赖生产,预计 PENDING)/ 项 8 部署(PENDING)
- Phase 1(代码完成,部署挂起见 PENDING)
- 已勾选:项 1(Secret Reference 使用授权,Round 1 → Round 4 补第三写入口后成立)、项 2(DO/Node 连接替换 TOCTOU,Round 2 → Round 4 补 registerPaths 后成立)、项 3(Node/Docker bootstrap fail closed)、项 4(canonical origin 对等)、项 5(`pnpm verify` 全绿)
- 未勾选:项 6(部署解冻 smoke)—— 被 P1-1 / P1-2 卡住,见上
- 已提交:`4e59750` core 原语 / `3867a30` 宿主接线(四个阻断项)/ `a9fcba4` lockfile / `3b42eda` 规划文档
- Blockers(从 DOR.md 继承,不阻塞全局开工,只缩小对应 Phase 可推进范围):
  - **C-1**(Phase 4):D1 绑定与 provision 幂等分支尚未建立(`packages/gateway/wrangler.jsonc` 无 `d1_databases`、`scripts/provision.mjs` 无 D1 分支)。属 Phase 4 第一个 DoD 项,不阻塞 Phase 1/2/3。
  - **E-1**(Phase 3):缺一个 MCP client 做 tools/list + tools/call 验收。属 Phase 3 第一步(用官方 @modelcontextprotocol/sdk 写测试 client 自足),不阻塞 Phase 1/2。

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
