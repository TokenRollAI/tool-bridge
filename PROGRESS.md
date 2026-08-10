# PROGRESS(进度账本)

> 每轮结束在末尾追加一条 Round 记录(格式见 LOOP.md)。当前 Phase 与 blocker 在此维护。

## ⏸ PENDING(挂起,不阻塞后续 Phase)

- **P1-1 · Phase 1 项 6「部署解冻」** —— 代码已完成并开 PR
  [#32](https://github.com/TokenRollAI/tool-bridge/pull/32)(OPEN / MERGEABLE,+1337 −167,29 files),
  用户表示自行合并。合并后需从与 `origin/main` 零差异的干净工作区执行
  `pnpm deploy:all` + `TB_BASE_URL=… pnpm smoke` 才能勾选。
  **不构成后续 Phase 的代码依赖**:Phase 2 依赖的是 Phase 1 的**代码**(Secret Reference ACL
  与 fail-closed 语义),这些已在本分支历史上;被挂起的只是「合并 + 部署」两个流程动作。
  故按 LOOP 新策略继续推进 Phase 2。
- **P1-2 · Phase 1 遗留的生产验证** —— 跨休眠窗口(≥150s)与真实连接替换竞态须线上验证,
  随 P1-1 部署后一并做(`npx tsx scripts/verify-device.ts`)。

## 当前状态
- 当前 Phase:Phase 1 — A:安全阻断项解冻(代码完成,待部署)
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
