# 当前状态(MUST)

> 用途:每次会话开场必读的易变状态快照(部署、代码现状、凭据配置、工具链、未竟事项)。更新时机:部署/凭据/工具链/能力面变化时,由当轮 Agent 更新本文件。最后核实日期:2026-07-08。

## 项目状态

- **初步实现阶段已完成**(2026-07-07 "破壳"):SK 鉴权与作用域、HTBP 核心树与内容协商、Tool 层(mcp/http/remote 联邦 + 虚拟化)、Context 层(r2/s3 四动词 + Search + `$ref` 大对象)、设备反向注册(DO WebSocket hibernation)、SDK、Plugin 系统、Dashboard 均已落地并经生产验证。
- 2026-07-07:修复"挂载 MCP 过一段时间失效"生产故障(不合规上游对过期会话回 200+空列表,见 [../guides/mcp-upstream-pitfalls.md](../guides/mcp-upstream-pitfalls.md)),已部署上线并经塞伪 session 复现验证自愈。2026-07-08 同故障复发:初版防御的重试回读 KV 被边缘读缓存击穿(拿回刚删的旧会话),已改为重试强制完整重握手(`forceFresh`)并补钉死用例,**待部署上线**(线上已用手动清 `mcpsession:` 应急恢复)。
- bootstrap 期过程文档已归档 `archive/`;知识真源 = 代码 + llmdoc(见 [project-brief.md](project-brief.md))。
- **npm 已发布**:`@tool-bridge/cli` 0.2.0(commander 严格解析,breaking:拼错 flag/多余参数从静默变报错)、`@tool-bridge/sdk` 0.1.0(均 public,经 CI Trusted Publishing;core 为 private 不发布)。gateway/dashboard 0.1.0 已改为可发布(为一键部署模板铺路),**待手动首发 + 配 Trusted Publisher**。发布流程见 [../guides/npm-publish.md](../guides/npm-publish.md)。

## 已部署资源(DJJ 账户)

| 资源 | 名称/地址 | 备注 |
|---|---|---|
| Worker | `tb-gateway` @ https://tool-bridge.pdjjq.org | custom domain(zone pdjjq.org);`wrangler.jsonc` 已写死 `account_id`;DO `DeviceSession` 绑定 `TB_DEVICE`(migration v1,sqlite);Dashboard 经 Static Assets 挂 `/ui`(`run_worker_first: true`) |
| Worker secrets | `TB_BOOTSTRAP_ADMIN_SK` / `TB_SECRET_ENCRYPTION_KEY` | 已 `wrangler secret put`;前者是 Admin SK 明文(引导时 sha256 入库) |
| KV | `tb-kv`(id `d18c93de33cf4ba2b1fbf7d26fd742f1`) | 绑定名 `TB_KV`;id 已回填 wrangler.jsonc |
| R2 | `tb-r2` | 绑定名 `TB_R2` |

## 代码现状(pnpm monorepo,测试数为 2026-07-08 实跑)

- `packages/core` — 纯逻辑内核(唯一运行时依赖 zod),**603 个单测**,模块族:
  - `auth/`(scope 判定 / authorizer / 注册路径规则 / sk 签发与哈希)、`tree/`(path 规则 / NodeRegistryStore / visibility 裁剪)、`htbp/`(helpDsl / HelpModel / negotiate / tree 构建)、`secret/`(AES-256-GCM 只写不读)
  - `builtin/`(**五模块**:sk / secret / registry / status / plugin 的 cmd 表 + dispatch)
  - `tool/`(HttpToolDef 拼装、虚拟化、mcp schema→HelpModel、remote 路径/白名单/Via、上游错误归一)
  - `context/`(四动词 objectProvider / objectStore 接口 / path 穿越防护 / ttl)
  - `device/`(帧编解码 / 会话状态机 / 设备侧 client / shell 白名单 / helpModel)
  - `plugin/`(manifest 校验 / envelope 编解码 / RequestDedupe / 契约校验)
  - `node/`(`./node` 子导出:FsObjectStore realpath 防逃逸 + shellExecutor 有界缓冲)
  - 顶层 `errors.ts`(TBError)/ `store.ts`(StateStore 接口 + 内存实现)/ `types.ts`。
- `packages/gateway` — Workers 胶水(可发布 Worker library:tsup 单文件 ESM bundle core,`src/index.ts` 另 export `createApp` 与 `type Env`;dev exports 指 src、发布形态 publishConfig 覆盖指 dist),**86 个默认集成测试 + 6 个 opt-in skipped**(真实 workerd;含 mcp 过期会话空列表防御的 mock 上游用例):`app.ts`(Env→deps 适配)/ `tbApp.ts`(**宿主中立 createTbApp**,路由/认证/HTBP/remote 聚合,SDK 复用)/ `bootstrap.ts` / `kvStateStore.ts` / `refToken.ts`(`$ref` 中转 token)/ `deviceSession.ts`(DeviceSession DO)/ `providers/`(mcp / http / remote / pluginTool / pluginContext / pluginClient / r2Object / s3Object / s3Sign / toolCache);`wrangler.jsonc` 在此包内。
- `packages/cli` — commander 框架(严格解析:未知 flag/子命令报错,防权限误配),**124 个单测**(含拼错 flag 事故回归 strictParsing),**17 个命令**:status / login / whoami / use / sk / secret / ls / tree / help / call / tool / server / ctx / connect / device / mount / plugin;全局 `--json`;配置 `~/.config/tool-bridge/config.json`(XDG,多 profile)。
- `packages/sdk` — 薄装配层(4 个源文件),**12 个单测 + 1 个 opt-in**;公开面 `createToolBridge(config)` → `{ fetch, registerTool, registerContext, connect }`,复用 core + gateway 的 createTbApp;再导出内存宿主实现(MemoryStateStore 等)。
- `packages/dashboard` — React 19 + Vite + Tailwind 4 + shadcn/ui + @rjsf + TanStack Query SPA(可发布纯静态产物包:只发 dist,依赖全在 devDependencies):树导航 / cmd 表单调用 / context 条目浏览(metadata 编辑、`$ref` 大对象经 Update 只改 metadata、Search mode keyword|semantic 切换)/ SK·Registry·Devices·Secrets·Plugins 管理页(Plugins 对等 `tb plugin` 六 cmd,pluginToken 一次性展示;Registry 挂载面对等 CLI:kind:tool / plugin provider、virtualize 全量、http authHeader/authScheme、context ttl)/ ⌘K 面板;无专用后端(同源消费 HTBP),行为由 gateway 的 `ui.integration.test.ts` 覆盖;`pnpm deploy:all` 先 build dashboard 再部署 gateway。
- `scripts/` — `gen-dev-vars.mjs` / `provision.mjs` / `smoke.ts`(healthz + 无 SK 401 + 带 SK 200)+ 三个可重跑生产验收脚本:`verify-revocation.ts`(吊销传播,实测 0.3s)/ `verify-device.ts`(设备 shell/fs/registerPaths 全链路,可选跨休眠用例)/ `verify-plugin.ts`(Plugin 注册→挂载→四动词全流程)。
- CI(.github/workflows/):`publish-cli.yml`(tag `cli-v*`)/ `publish-sdk.yml`(tag `sdk-v*`)/ `publish-gateway.yml`(tag `gateway-v*`)/ `publish-dashboard.yml`(tag `dashboard-v*`),npm Trusted Publishing(OIDC);**无主干测试 CI**。
- 工具链:lint 用 biome;测试 vitest 4 + @cloudflare/vitest-pool-workers 0.18(API 变更注意见 [../guides/workers-kv-pitfalls.md](../guides/workers-kv-pitfalls.md))。

## 常用命令

- `pnpm verify` — typecheck + lint + 单测 + 集成测试一把过(当前 603 core + 124 cli + 12 sdk 单测,86 gateway 默认集成 + 6 opt-in skipped)。
- `pnpm deploy:all` — 幂等 provision + dashboard build + 部署 gateway。
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
- **Docker 守护进程未运行** → 仅阻塞 Docker 自部署路径的开发验收,启动 Docker Desktop 即可。

## 本机工具链(2026-07-06 核实)

| 工具 | 版本/状态 |
|---|---|
| node | v26.4.0 |
| pnpm | 11.10.0 |
| wrangler | 4.107.0,已 OAuth 登录(可访问 DJJ 与 Lightspeed 两账户) |
| gh | 2.96.0,已登录 Disdjj(有 repo scope,可访问 v1 私有仓库) |
| docker | CLI 29.2.1 在,**守护进程未运行** |

**注意**:wrangler OAuth 下有多账户,所有 wrangler 命令须显式指定账户(`wrangler.jsonc` 已写 `account_id`;脚本内用 `CLOUDFLARE_ACCOUNT_ID`),否则报多账户歧义错误。

## 未竟事项(路线图,非进度账本)

- **gateway/dashboard 首发**:两包 0.1.0 待用户手动 `npm publish` 首发 + npmjs.com 配 Trusted Publisher(workflow 分别为 `publish-gateway.yml` / `publish-dashboard.yml`),见 [../guides/npm-publish.md](../guides/npm-publish.md)。
- **tool-bridge-template 模板仓库**(未动工):公开仓库挂 Deploy to Cloudflare 按钮——3 行 `src/index.ts`(import app + `DeviceSession` from `@tool-bridge/gateway`)+ 无 account_id/routes 的干净 wrangler.jsonc(KV/R2/DO 由 Deploy 按钮自动创建回填)+ copy-ui 脚本(dashboard 包 dist → public);presign/ASSETS/TB_BOOTSTRAP_ADMIN_SK 在运行时均可选且已优雅降级,无需改运行时代码。
- **`tb init` 向导**:干净账户一条命令拉起(wrangler auth 检查 → provision → 部署 → Admin SK 输出,可重入);当前部署路径是 `pnpm deploy:all`。
- **Docker 自部署路径**:node adapter(@hono/node-server)+ SQLite StateStore + FS ObjectStore + ws 设备通道 + Dashboard 静态托管,`/data` 卷持久化;SDK 已具备宿主中立装配面,缺镜像、SQLite StateStore 与验收(SQLite 宿主的吊销即时性验证也在此时补)。落地时补一篇 Docker 宿主 guide。
- **端到端验收系统化**:七个 User Case 的脚本化 E2E(CLI `--json` 驱动 + Dashboard 浏览器侧)未拉通;现有 smoke + 三个 verify-* 脚本覆盖主链路。
- **遗留小项**:CLI deviceRuntime 迁移为 SDK 消费者;R2 Access Key 创建后 presign 主路径 opt-in 复验;dashboard bundle 1.14MB 未 code-split(vite 警告,不阻塞);生产 `device/demo-mac` 疑似测试残骸待确认清理;dashboard 本地开发流程(vite dev + wrangler dev 联调)下次涉及时补 guide。

## 遗留注意

- opt-in MCP E2E 退出码为 0,但 workerd 会打印 SDK sourcemap 诊断与一次 `Network connection lost` 文本,属 harness 噪声,不作为失败依据。
- 本机主 checkout(`~/.superset/projects/tool-bridge`)工作区有一份未提交 WIP(deviceSession→deviceHello 抽取重构);**部署必须从与 origin/main 零差异的干净工作区执行**(2026-07-07 部署即为避开该 WIP 从干净 worktree 出发)。
