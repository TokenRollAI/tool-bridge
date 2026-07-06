# PROGRESS(loop 自维护进度账本)

> 每轮结束在末尾追加 Round 记录(格式见 LOOP.md §6)。当前 Phase 与 blocker 在此维护。

## 当前状态

- **当前 Phase**:Phase 1 已关门(质量关口修复完成);下一 Phase:Phase 2 — Tool Layer(DOD.md §4)
- **已勾选 DoD 项**:无
- **Blockers**:
  - Docker 守护进程未运行(Phase 6 / E2E-4 前需启动 Docker Desktop;不阻塞 Phase 0-5)
  - `TB_TEST_MCP_URL` / `TB_TEST_S3_*` / `TB_R2_ACCESS_KEY_*` 空缺(均有兜底:自建 echo MCP、R2 当外部 S3、网关中转下载;不阻塞 Phase 0-1)

## 外部前置核对(DOD §9,2026-07-06 核实)

- Cloudflare:wrangler OAuth 已登录(DJJ 账户,与 `CLOUDFLARE_ACCOUNT_ID` 一致);`CLOUDFLARE_API_TOKEN` 空缺属预期(本地 OAuth)。⚠️ whoami 未确认 R2 write 权限,Phase 0 P0-5 绑定 R2 前复核。
- 工具链:node v26.4.0 / pnpm 11.10.0 / wrangler 4.107.0 / gh 2.96.0(可访问 v1 私有仓)/ docker CLI 29.2.1(daemon 未起)。
- 核心变量已配置:`CLOUDFLARE_ACCOUNT_ID`、`TB_DOMAIN`、`TB_BASE_URL`、`TB_NAME_PREFIX`、`TB_SECRET_ENCRYPTION_KEY`。`TB_SK` 空缺(预期:Phase 1 Admin SK 引导后回填)。

## Round 日志

## Round 1 — 2026-07-06
- 目标:Phase 0 / "`pnpm verify` 本地绿"(DOD.md:38)+ 工程骨架全量交付(P0-2~P0-5 的脚本就绪)
- 动作:先跑 `/llmdoc:init`(4+1 个 investigator 并行 → recorder 产 9 份稳定文档);修 docs C1/C3(commit 0d48b06);派 `llmdoc:worker` 实现骨架(5 个 commit:monorepo 根 / core / gateway / cli / scripts)。选型:Hono + citty? 见 worker commit;lint 用 biome;测试 vitest 4 + @cloudflare/vitest-pool-workers。
- 验证(主协调者亲自复跑):
  - `pnpm verify` → 全绿(typecheck 3 包 ✓;biome 25 files ✓;core unit 29 passed;gateway integration 7 passed,真实 workerd + .dev.vars)
  - `wrangler dev` + `curl /healthz` → `{"healthy":true,"version":"0.1.0"}`;`/~help` → 首行 `htbp 0.1`(text/plain);`/~tree` → 501
  - `TB_BASE_URL=http://localhost:8787 node packages/cli/dist/index.js status --json` → 可解析 JSON(ok/status/version 字段)
- 勾选:P0-1(`pnpm verify` 本地绿)
- 沉淀:llmdoc bootstrap 完成(index/startup/must×2/overview/proto-map/modules-and-boundaries/v1-lessons/doc-gaps);v1 检索地图内化进 v1-lessons;doc-gaps G1/G2/G6 已处理。流程坑:.llmdoc-tmp 的 v1 报告一度丢失(原因不明,已由 inv-v1 重写)——scratch 报告用后应尽快内化进稳定文档。
- 遗留:Round 2 做 P0-2~P0-5(provision + deploy:all + 线上 smoke + tb status);deploy 前复核 wrangler OAuth 的 R2 write 权限;G3(healthz 形状)实现已定型为 `{"healthy":true,"version"}`,待回写 docs。

## Round 2 — 2026-07-06
- 目标:Phase 0 / P0-2~P0-5(部署管道,DOD.md:39-42)
- 动作:回填 tb-kv namespace id(d18c93de…)、wrangler.jsonc 加 account_id 与 custom domain 路由(tool-bridge.pdjjq.org);跑 provision + deploy。R2 write 权限实测可用(`r2 bucket create` 成功,此前的 whoami 截断疑虑解除)。
- 验证(逐条):
  - `pnpm provision` → KV `tb-kv` 已存在跳过、R2 `tb-r2` 创建成功(幂等复跑验证过)
  - `pnpm deploy:all` → Uploaded tb-gateway,custom domain `tool-bridge.pdjjq.org` 绑定,Version 76ddfc3e
  - `curl https://tool-bridge.pdjjq.org/healthz` → 200 `{"healthy":true,"version":"0.1.0"}`
  - `curl …/~help` → 200 首行 `htbp 0.1`;`…/~tree` → 501
  - `TB_BASE_URL=… tb status --json` → 可解析 JSON(ok:true)
  - `TB_BASE_URL=… pnpm smoke` → smoke passed
  - 回归 `pnpm verify` → 全绿(29 unit + 7 integration)
- 勾选:P0-2、P0-3、P0-4、P0-5 —— **Phase 0 五项全勾**
- 沉淀:G3 healthz 形状已回写 docs/Proto.md §1.1(Round 1 末commit 1700544)
- 遗留:Phase 0 关门流程(质量关口 Workflow + /llmdoc:update);smoke 脚本不读 .env,需显式传 TB_BASE_URL(可改进);Phase 1 是下一目标。

## Round 3 — 2026-07-06(Phase 0 关门)
- 目标:LOOP §5.4 Phase 0 关门(质量关口 + 沉淀)+ Phase 1 预研
- 动作:质量关口 Workflow(3 维 review → 逐条对抗核查,13 agent):原始发现 10 条,确认 6 条(全部 MINOR,无 BLOCKER/MAJOR)→ 派 worker 修复 5 条代码项(commit 65ae2fc),PROGRESS 的 TB_SK 记录不实由主协调者改正;/llmdoc:update 完成(current-state 刷新、新 guide deploy-and-verify、reflection 2026-07-06-phase0-bootstrap);并行派 investigator 产出 Phase 1 实现级规格摘要(.llmdoc-tmp/investigations/phase1-spec-digest.md,28KB);其 6 个开放问题已由主协调者决策并回写 docs(commit 8903b5e:401 语义、Help/Tree JSON 形状、builtin cmd 命名、system/status cmd 集、自动 directory 规则、KV key 布局)。
- 验证:修复后 `pnpm verify` 全绿(36 unit + 8 integration);`pnpm provision` 幂等复跑两条 skip;gen-dev-vars 引号转义生效。
- 勾选:无新增(Phase 0 已全勾;质量关口通过 = 关门完成)
- 沉淀:见上(llmdoc 更新 + docs 回写 + reflection)
- 遗留:Phase 1 开工,首个目标 = core 纯逻辑(scope 判定 + registerPath 规则)单测先行;规格依据 phase1-spec-digest.md + docs 新增章节。

## Round 4 — 2026-07-06(Phase 1 全量)
- 目标:Phase 1 全部 DoD(DOD.md:51-57)
- 动作:三波并行 subagent——①4 个 worker 并行写 core 纯逻辑(auth 74 测/tree/htbp 40 测/secret),232→248 单测;②w-gw 实现 builtin 四模块 + gateway 装配(认证中间件/KV StateStore/bootstrap/HTBP 路由,13 集成测试),期间修复 workerd unhandled rejection(裸 return promise → await);③w-cli 实现 8 个 Phase 1 命令(28 单测)。开放问题 6 条由主协调者决策并回写 docs(8903b5e/327ee1e)。部署:生成 Admin SK 入 .env TB_SK + wrangler secret put(TB_BOOTSTRAP_ADMIN_SK/TB_SECRET_ENCRYPTION_KEY)→ deploy。生产实测中发现并修复 1 个真实 bug:KV list 最终一致窗口内返回已删除 key 的 null 值 → TreeNode 消费抛 internal(fix: kvStateStore 跳过 null,commit 见 log)。
- 验证(生产 https://tool-bridge.pdjjq.org 逐条):
  - `pnpm verify` 全绿(248 core + 28 cli 单测,13 gateway 集成,0 Errors)
  - 无 SK `GET /~help` → 401 裸 TBError;Admin SK → 200 DSL 首行 htbp 0.1
  - `tb login` → `tb whoami --json`(authenticated:true + 健康摘要)→ `tb sk create --scope 'docs/**:read'` → 受限 SK `~tree` 只见 docs 子树(可见性裁剪实证)→ 受限 SK POST system/sk → 404(deny==not_found)
  - `tb secret set/ls` → list 只见 name+updatedAt,不回显明文
  - 吊销传播:`tb sk rm` 后轮询,受限 SK 在 ~10s 开始被拒(≤60s 窗口,Proto §2.3)
  - `TB_SK=… pnpm smoke` → 3 项全过(healthz/401/200);smoke 已升级为 Phase 1 语义
  - 注册链路:POST docs/notes/~register → 中间 directory 自动物化(registeredBy system:auto),delete 后级联回收(生产验证)
- 勾选:Phase 1 全部 7 项(DOD.md:51-57)。注:P1-7 吊销"本地宿主立即被拒"部分以 workerd 集成测试覆盖(单实例 KV 即时一致);SQLite 宿主属 Phase 6,届时补验。
- 沉淀:待 Phase 1 关门轮做 /llmdoc:update + 质量关口
- 遗留:①w-gw 决策清单待核(两条注册通道定位、~tree 根免判定、~register 判定资源)需回写 docs;②CLI 偏差(whoami 语义、readline 代替 @clack、config 路径)需回写 Proto 附A;③生产 KV 一致性坑(list+get null)值得沉淀 guide。

## Round 5 — 2026-07-06(Phase 1 关门)
- 目标:Phase 1 质量关口 + 修复 + 沉淀 + Phase 2 预研
- 动作:①rec-p1docs 回写 Phase 1 决策 9 项 A-I(commit 5a78566);②质量关口 Workflow(4 维 review + 对抗核查,18 agent,2 个 review 维度因 API 中断部分缺失——auth/contract-cli 维度未完整跑完,已跑维度确认 9 条:6 MAJOR + 3 MINOR);③w-p1fix 修复全部 9 条(commits d5d4d4a/50a6df7/afd6a25):registry list/get 可见性裁剪与 deny==not_found、~tree 根真实性(ghost→404、根 kind 真实)、HelpJson body→inputSchema(真 JSON Schema)、URL decodeURIComponent、children/subtree 前缀扫描(消 O(N²))、~register body 校验(kind 必填+body.path==URL path)、吊销/disabled/expired 集成测试补齐、SK patch 白名单负向测试、非 builtin 节点 ~help→501;④新增 scripts/verify-revocation.ts(可重跑的吊销传播验收);⑤inv-phase2 产出 Phase 2 规格摘要(9 开放问题),主协调者拍板全部 9 项并由 rec-p2docs 回写(commit 03a538c)。
- 验证:修复后 pnpm verify 全绿(258 core + 28 cli + 23 gateway);重部署(Version 4dc3c622)后生产逐条:smoke 3 项过;/ghost/~tree → 404;/system/sk/~tree 根 kind builtin;~help JSON 含规范 inputSchema;verify-revocation.ts → 吊销传播 0.3s(≤60s 窗口)。
- 勾选:无新增(Phase 1 已勾;本轮是关门修复)。DOD:55/57 的勾选依据现在有可重跑测试/脚本支撑(质量关口指出的"勾选依据不实"已消除)。
- 沉淀:Phase 2 决策回写 docs(03a538c);llmdoc update 见下轮开头。
- 遗留:质量关口的 auth/contract-cli 两个 review 维度因 API 中断未完整跑完——Phase 2 关门时对 auth 面加倍覆盖;Phase 2 开工(规格已齐:phase2-spec-digest.md + docs 定型)。
