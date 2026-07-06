# 当前状态(MUST)

> 用途:每轮开场必读的易变状态快照(进度、凭据配置、工具链、兜底路径)。更新时机:每当部署/凭据/工具链/Phase 进度发生变化时,由当轮 Agent 更新本文件。最后核实日期:2026-07-06。

## 进度

- 仓库 **docs-only,无源码**;git 干净,main 分支。
- **Phase 0 未开始**(DOD.md:31-42:monorepo 骨架 / `tb-gateway` Worker / wrangler 绑定占位 / Vitest / `pnpm verify` / `pnpm deploy:all` / CLI 骨架)。
- `PROGRESS.md` 尚不存在,首轮需创建(LOOP.md:37)。
- 首轮建议目标:P0-1(`pnpm verify` 本地绿),不依赖部署与外部资源。
- Phase 0 会立即用到的契约细节(healthz 形状、根 `~help` 占位、TBError 中间件)见 [../reference/proto-map.md](../reference/proto-map.md) 的"Phase 0 契约"一节。

## .env 凭据状态(只记变量名与状态,绝不写值)

| 变量 | 状态 | 备注 |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | 已配置 | DJJ 账户;验证用 `wrangler whoami`,勿用 `/user/tokens/verify` |
| `CLOUDFLARE_API_TOKEN` | 空缺(注释掉) | 预期内:本地开发靠 wrangler OAuth,CI 时才需要 |
| `TB_DOMAIN` | 已配置 | zone pdjjq.org 在 DJJ 账户,Watt 已验证可挂 |
| `TB_BASE_URL` | 已配置 | 生产 BaseURL(custom domain) |
| `TB_NAME_PREFIX` | 已配置(=tb 默认) | worker/KV/R2 命名前缀派生 |
| `TB_SECRET_ENCRYPTION_KEY` | 已配置(32B base64url) | SecretStore env-only 信任根(Proto §2.5);P1-5 依赖 |
| `TB_SK` | 已配置 | CLI 默认 SK;部署后由 `tb init` 输出的 Admin SK 覆盖 |
| `TB_TEST_MCP_URL` / `TB_TEST_MCP_BEARER` | 空缺(注释掉) | Phase 2 / E2E-5 用;见下方兜底 |
| `TB_TEST_S3_ENDPOINT` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` / `_BUCKET` | 空缺(注释掉) | Phase 3 / E2E-2 用;见下方兜底 |
| `TB_R2_ACCESS_KEY_ID` / `TB_R2_SECRET_ACCESS_KEY` | 空缺(注释掉) | `$ref` 预签名用;`tb init`/provision 时创建 |

**结论**:Phase 0-1 所需变量全部已配置;空缺项均有兜底,不阻塞。

## 已知兜底路径(缺外部资源时)

- **真实上游 MCP 空缺** → 用官方 SDK 自建 echo MCP(十行内)兜底(.env.example 注释,DOD §9)。
- **外部 S3 空缺** → 用 DJJ 账户 R2 的 S3 兼容 API 当"外部 S3"。
- **R2 预签名 AK 空缺** → 大对象走网关中转下载路由,功能不缺(docs/Reference.md:86)。
- **Docker 守护进程未运行** → 不阻塞 Phase 0-5;Phase 6 / E2E-4 前需先启动 Docker Desktop。

## 本机工具链(2026-07-06 核实)

| 工具 | 版本/状态 |
|---|---|
| node | v26.4.0 |
| pnpm | 11.10.0 |
| wrangler | 4.107.0,已 OAuth 登录(可访问 DJJ 与 Lightspeed 两账户) |
| gh | 2.96.0,已登录 Disdjj(有 repo scope,可访问 v1 私有仓库) |
| docker | CLI 29.2.1 在,**守护进程未运行** |

**注意**:wrangler OAuth token 已确认 workers/workers_kv/workers_routes write 权限,但 **R2 write 权限未确认**(whoami 输出截断)——P0-5 绑定 R2、Phase 3 R2 provision 前应显式复核。
