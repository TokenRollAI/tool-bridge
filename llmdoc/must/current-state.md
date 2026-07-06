# 当前状态(MUST)

> 用途:每轮开场必读的易变状态快照(进度、部署、代码现状、凭据配置、工具链、兜底路径)。更新时机:每当部署/凭据/工具链/Phase 进度发生变化时,由当轮 Agent 更新本文件。最后核实日期:2026-07-06。

## 进度

- **Phase 0 已完成**(2026-07-06,五项 DoD 全勾,见 DOD.md §2):`pnpm verify` 绿 / `pnpm deploy:all` 成功 / `curl ${TB_BASE_URL}/healthz` 返回 200+版本号 / `tb status --json` 可解析 / KV+R2 已由幂等脚本创建并绑定。
- **当前目标:Phase 1 — Auth(SK)+ HTBP 核心树**(DOD.md §3,DOD.md:44-56):TBError 中间件、SK 判定、SecretStore、NodeRegistry、`~help`/`~skill`/`~tree`、内容协商、builtin 节点、CLI 子命令。
- 从零到线上验证的完整流程见 [../guides/deploy-and-verify.md](../guides/deploy-and-verify.md)。

## 已部署资源(DJJ 账户)

| 资源 | 名称/地址 | 备注 |
|---|---|---|
| Worker | `tb-gateway` @ https://tool-bridge.pdjjq.org | custom domain(zone pdjjq.org);`wrangler.jsonc` 已写死 `account_id` |
| KV | `tb-kv`(id `d18c93de33cf4ba2b1fbf7d26fd742f1`) | 绑定名 `TB_KV`;id 已回填 wrangler.jsonc |
| R2 | `tb-r2` | 绑定名 `TB_R2`;**write 权限已实测可用** |

## 代码现状(pnpm monorepo)

- `packages/core` — 纯逻辑内核:TBError + HTTP 映射 + 版本常量;29 个单测。
- `packages/gateway` — Hono app 工厂 + Workers 入口(`src/index.ts`);7 个集成测试跑真实 workerd(`@cloudflare/vitest-pool-workers`);`wrangler.jsonc` 在此包内。
- `packages/cli` — citty 命令框架,`tb status`,全局 `--json`;`tb` bin 由 tsup 打包。
- `scripts/` — `gen-dev-vars.mjs`(.env → .dev.vars)/ `provision.mjs`(幂等建 KV/R2)/ `smoke.ts`(线上冒烟)。
- 工具链:lint 用 biome;测试 vitest 4 + @cloudflare/vitest-pool-workers。

## 常用命令

- `pnpm verify` — typecheck + lint + 单测 + 集成测试,一把过。
- `pnpm deploy:all` — 幂等 provision + 部署 gateway。
- `TB_BASE_URL=https://tool-bridge.pdjjq.org pnpm smoke` — 线上冒烟(**smoke 不读 .env,须显式传 TB_BASE_URL**)。

## .env 凭据状态(只记变量名与状态,绝不写值)

| 变量 | 状态 | 备注 |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | 已配置 | DJJ 账户;验证用 `wrangler whoami`,勿用 `/user/tokens/verify` |
| `CLOUDFLARE_API_TOKEN` | 空缺(注释掉) | 预期内:本地开发靠 wrangler OAuth,CI 时才需要 |
| `TB_DOMAIN` | 已配置 | zone pdjjq.org 在 DJJ 账户 |
| `TB_BASE_URL` | 已配置 | 生产 BaseURL(custom domain,已上线) |
| `TB_NAME_PREFIX` | 已配置(=tb 默认) | worker/KV/R2 命名前缀派生 |
| `TB_SECRET_ENCRYPTION_KEY` | 已配置(32B base64url) | SecretStore env-only 信任根(Proto §2.5);P1-5 依赖 |
| `TB_SK` | 已配置 | CLI 默认 SK;部署后由 `tb init` 输出的 Admin SK 覆盖 |
| `TB_TEST_MCP_URL` / `TB_TEST_MCP_BEARER` | 空缺(注释掉) | Phase 2 / E2E-5 用;见下方兜底 |
| `TB_TEST_S3_ENDPOINT` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` / `_BUCKET` | 空缺(注释掉) | Phase 3 / E2E-2 用;见下方兜底 |
| `TB_R2_ACCESS_KEY_ID` / `TB_R2_SECRET_ACCESS_KEY` | 空缺(注释掉) | `$ref` 预签名用;`tb init`/provision 时创建 |

**结论**:Phase 1 所需变量全部已配置;空缺项均有兜底,不阻塞。

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
| docker | CLI 29.2.1 在,**守护进程未运行**(Phase 6 前须启动) |

**注意**:wrangler OAuth 下有多账户,所有 wrangler 命令须显式指定账户(`wrangler.jsonc` 已写 `account_id`;脚本内用 `CLOUDFLARE_ACCOUNT_ID`),否则报多账户歧义错误。
