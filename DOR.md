# DOR(Definition of Ready)

> 开工前的就绪风险清单。已满足的勾上;未满足的不阻止开工,而是作为 blocker 继承进
> PROGRESS——它缩小 agent 本次能推进的范围(依赖它的 DoD 项会被跳过),而不是让整件事停摆。
> 目标是让 agent 带着"什么还没就绪"的清醒认知开跑,而不是在门口空等。

## 需求就绪
- [x] VISION 的每条成功标准都可验收(6 条成功标准各附命令或 User Case;5 个 User Case A/B/E/C/D 一一对应 DOD 的 E2E)
- [x] 没有静默假设(grill 的 9 个决策全部由用户显式拍板,DECISIONS.md「记录在案的假设」为空)
- [x] 执行顺序与依赖已定(A→B→E→C→D;E 紧跟 B 不依赖 Search,C 在 B 后因索引 ToolSpec,D 依赖 B/C 接口定稿)

## 技术就绪
- [x] 核心选型表已定型(Hono / @modelcontextprotocol/sdk / aws4fetch / zod / DO WS Hibernation / commander / better-sqlite3 / React 19 栈 / Vitest + vitest-pool-workers / wrangler,见 project-brief)
- [x] 架构基座已定(core 纯逻辑 → gateway/sdk/cli/server 装配;四宿主注入点;Authorizer.Check 唯一判定入口;凭证不出网关)
- [x] 构建 / 测试 / 运行命令已知且可跑(`pnpm verify` / `pnpm deploy:all` / `pnpm smoke` / `pnpm --filter @tool-bridge/server start` / `docker build && docker run`)
- [x] 阶段 B 新 SDK 技术路线已定(Zod 驱动 OperationRegistry;Plugin v2 多 export;`@tool-bridge/plugin-sdk` Web 标准兼容,不污染 Worker 运行时;无新框架依赖)
- [x] 阶段 E 技术路线已定(复用已有 @modelcontextprotocol/sdk 的 server 侧,gateway 加 MCP server 端点转发到现有树分发 + Authorizer.Check 裁剪;无新依赖)
- [x] 阶段 C 第五个宿主注入点 SearchIndex 已选型且双侧实测(CF=D1 FTS5+trigram;Node=better-sqlite3 SQLite 3.53.2 已编入 fts5+trigram;同库不同表;trigram 3 字符下限 + 短查询 LIKE 兜底两条硬约束已知)
- [ ] **阶段 C 的 D1 绑定尚未创建** —— `packages/gateway/wrangler.jsonc` 当前无 `d1_databases`;`scripts/provision.mjs` 无 D1 幂等分支。**标 blocker(C-1)**:C 开工前需在 wrangler.jsonc 加绑定 + provision.mjs 补按 TB_KV 那套 list→skip/create→回填 的幂等分支,否则干净账户 deploy:all 断链。属 C 阶段自身第一步,不阻塞 A/B/E。

## 外部前置就绪
- [x] Cloudflare 账户可用(DJJ 账户,wrangler 4.107.0 已 OAuth 登录;`CLOUDFLARE_ACCOUNT_ID` 已配置;wrangler.jsonc 已写 account_id)
- [x] 生产网关在线(`tb-gateway` @ https://tool-bridge.pdjjq.org;KV tb-kv / R2 tb-r2 已绑定;`TB_BOOTSTRAP_ADMIN_SK` / `TB_SECRET_ENCRYPTION_KEY` 已 secret put)
- [x] Admin SK 可用(`.env` 的 `TB_SK` = Admin SK,CLI/smoke/verify-* 默认凭证)
- [x] Docker 可用(CLI 29.2.1,守护进程可用,build/run/restart 验收已过)
- [x] 飞书 plugin 生产链路在线(Worker tb-plugin-feishu;平台 SecretStore `feishu-app` 已配 app_id/app_secret;挂载节点 feishu authRef=feishu-app)—— 阶段 B 重写后可原地复验
- [ ] **阶段 E 缺一个 MCP client 做验收** —— 需要一个能连自定义 MCP endpoint 的 client 才能验 tools/list + tools/call。**标 blocker(E-1)**:可用官方 @modelcontextprotocol/sdk 写一个测试 client 自足(推荐,零外部依赖),或用 Cursor/Claude Desktop 手动验。E 开工时先落测试 client,不阻塞 A/B。
- [ ] **飞书 list-docs 仍缺 drive:drive 应用权限** —— 已知遗留,不影响 create-doc/fetch-doc/update-doc 主链路复验。**非 blocker**,B 阶段飞书复验用主链路三动词即可,list-docs 按需由用户开权限。

## 验收手段就绪
- [x] A 可验收(`pnpm verify` + 新增 TOCTOU/fail-closed 用例 + 生产 smoke + fail-closed 启动退出码断言)
- [x] B 可验收(`npm pack --dry-run` + 新 SDK 样例 plugin 双 export + 飞书生产三动词复验 + `pnpm verify` + 代码中无 legacy 面的检索断言)
- [x] E 可验收(测试 MCP client 的 tools/list 按 scope 裁剪 + tools/call 真实成功 + 窄 scope 收窄钉死用例 + 生产 smoke)—— 依赖 E-1 blocker 解除
- [x] C 可验收(中文两字词命中/不空 + 权限裁剪 + CF·Node 双侧对等集成测试 + Dashboard 搜索面 + deploy:all 不断链)—— 依赖 C-1 blocker 解除
- [x] D 可验收(`docker compose up` 端到端 smoke + Dashboard 拆分后 verify 全绿 + 真实浏览器四面证据)
- [x] 三入口对等原则可检验(每个动了接口面的阶段,CLI 子命令与 Dashboard 同轮交付,能力矩阵审计)

## Blockers
> 会被 /loop 继承进 PROGRESS 初始状态。这些不阻塞全局开工,只缩小对应阶段可推进范围。

- **C-1**:阶段 C 的 D1 绑定与 provision 幂等分支尚未建立(wrangler.jsonc 无 d1_databases、provision.mjs 无 D1 分支)。属 C 阶段第一个 DoD 项,不阻塞 A/B/E。
- **E-1**:阶段 E 缺一个 MCP client 做 tools/list + tools/call 验收。属 E 阶段第一步(用官方 SDK 写测试 client 自足),不阻塞 A/B。
