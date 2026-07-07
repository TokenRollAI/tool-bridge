# 当前状态(MUST)

> 用途:每轮开场必读的易变状态快照(进度、部署、代码现状、凭据配置、工具链、兜底路径)。更新时机:每当部署/凭据/工具链/Phase 进度发生变化时,由当轮 Agent 更新本文件。最后核实日期:2026-07-07。

## 进度

- **Phase 0 已完成**(2026-07-06,五项 DoD 全勾,DOD.md §2):verify 绿 / deploy 成功 / healthz 200+版本号 / `tb status --json` 可解析 / KV+R2 幂等创建并绑定。
- **Phase 1 已完成并关门**(2026-07-06,七项 DoD 全勾,DOD.md §3;质量关口 9 条发现全部修复并生产验证):SK 判定 + HTBP 核心树 + SecretStore + builtin 四模块 + 内容协商 + 可见性裁剪 + CLI 子命令。Phase 1 落地事实见 [../architecture/modules-and-boundaries.md](../architecture/modules-and-boundaries.md) "Phase 1 落地"节。
- **Phase 2 已完成并关门**(2026-07-06,六项 DoD 全勾并经质量关口修复,commit 186a739):mcp/http Provider、remote 联邦(§3.4)、工具虚拟化、调用点 Check、`tb call`/`tb tool mount`/`tb server add|ls|rm`。关门补强:remote `~tree` 聚合、`skRef` 换发测试、CLI 管理面对等、opt-in MCP/live HTTP 可重跑证据。
- **Phase 3 已完成**(2026-07-06,DOD.md §5 各项已勾):Context 四动词、r2/s3 provider、Search、大对象 `$ref`(presign 凭证空缺走 `/~ref` 网关中转)、`tb ctx *`。
- **当前目标:Phase 4 — Device Gateway(M4,反向注册)**(DOD.md §6,DOD.md:85-95):`tb connect` 设备长驻、DeviceSession DO、`device/<id>/shell|fs` 数据面。**主链路已生产验证通过**(2026-07-06):连接后立即调用与空闲 ≥150s 跨休眠窗口调用均成功;两个生产 blocker 已修复(客户端心跳保活 + hibernation 唤醒恢复 ready 态),细节见 [../guides/do-websocket-hibernation.md](../guides/do-websocket-hibernation.md)。
- 从零到线上验证的完整流程见 [../guides/deploy-and-verify.md](../guides/deploy-and-verify.md);Workers/KV 生产坑见 [../guides/workers-kv-pitfalls.md](../guides/workers-kv-pitfalls.md)。

## 已部署资源(DJJ 账户)

| 资源 | 名称/地址 | 备注 |
|---|---|---|
| Worker | `tb-gateway` @ https://tool-bridge.pdjjq.org | custom domain(zone pdjjq.org);`wrangler.jsonc` 已写死 `account_id`;当前生产 Version `1c64ff83-9f98-45c1-9958-4fe9bbbc27f5`(app.ts 拆宿主中立 createTbApp + SDK 装配面,2026-07-07);DO `DeviceSession` 绑定 `TB_DEVICE`(migration v1,sqlite) |
| Worker secrets | `TB_BOOTSTRAP_ADMIN_SK` / `TB_SECRET_ENCRYPTION_KEY` | 已 `wrangler secret put`;前者是 Admin SK 明文(引导时 sha256 入库) |
| KV | `tb-kv`(id `d18c93de33cf4ba2b1fbf7d26fd742f1`) | 绑定名 `TB_KV`;id 已回填 wrangler.jsonc |
| R2 | `tb-r2` | 绑定名 `TB_R2`;write 权限已实测可用(Phase 1 尚未实际使用) |

## 代码现状(pnpm monorepo)

- `packages/core` — 纯逻辑内核,**322 个单测**,六组能力:
  - `auth/`(scope 判定 / authorizer / registerPath §2.4 / sk 签发与哈希)
  - `tree/`(path 规则 / NodeRegistryStore / visibility 裁剪)
  - `htbp/`(helpDsl 渲染 / HelpModel / negotiate 内容协商 / tree 构建)
  - `secret/`(SecretStoreImpl,AES-256-GCM 只写不读)
  - `builtin/`(sk / secret / registry / status 四模块的 cmd 表 + dispatch)
  - `tool/`(HttpToolDef 拼装、虚拟化、mcp schema→HelpModel、remote 路径/白名单/Via、上游错误归一)
  - 另有 `errors.ts`(TBError)/ `store.ts`(StateStore 接口 + 内存实现)/ `types.ts`。
- `packages/gateway` — Workers 胶水,**34 个默认集成测试 + 2 个 opt-in**跑真实 workerd:`app.ts`(Hono 路由 + 认证/HTBP/remote 聚合)/ `providers/`(mcp/http/remote/toolCache)/ `bootstrap.ts` / `kvStateStore.ts` / `index.ts`;`wrangler.jsonc` 在此包内。
- `packages/cli` — citty 框架,**45 个单测**,12 个命令:`status` / `login` / `whoami` / `use` / `sk` / `secret` / `ls` / `tree` / `help` / `call` / `tool` / `server`;全局 `--json`;配置 `~/.config/tool-bridge/config.json`(Proto 附A 注记)。
- **npm 发布**:@tool-bridge/cli(0.1.1)与 @tool-bridge/sdk(0.1.0)均已发布 npm(public;core/gateway 为 private 不发布),流程见 [../guides/npm-publish.md](../guides/npm-publish.md)。cli 0.1.1 经 CI Trusted Publishing 发布成功(此前因 package.json 缺 `repository.url` 被 provenance 校验拒过,commit c20afae 已补齐两包)。
- `scripts/` — `gen-dev-vars.mjs` / `provision.mjs` / `smoke.ts`(已升级 Phase 1 语义:healthz + 无 SK 401 + 带 SK 200)/ **`verify-revocation.ts`(新增:吊销传播可重跑验收,生产实测 0.3s,上限 60s)**。
- 工具链:lint 用 biome;测试 vitest 4 + @cloudflare/vitest-pool-workers 0.18(API 变更注意见 [../guides/workers-kv-pitfalls.md](../guides/workers-kv-pitfalls.md))。

## 常用命令

- `pnpm verify` — typecheck + lint + 单测 + 集成测试,一把过(当前 322 core + 45 cli 单测,34 gateway 默认集成 + 2 opt-in skipped)。
- `pnpm deploy:all` — 幂等 provision + 部署 gateway。
- `TB_BASE_URL=https://tool-bridge.pdjjq.org pnpm smoke` — 线上冒烟(**smoke 不读 .env,须显式传 TB_BASE_URL;Phase 1 起还需 TB_SK**)。
- `npx tsx scripts/verify-revocation.ts` — 吊销传播验收(需 TB_BASE_URL + TB_SK)。
- `TB_TEST_MCP_URL=http://127.0.0.1:39002/mcp TB_ALLOW_INSECURE_HTTP=true pnpm --filter @tool-bridge/gateway test -- tool.integration.test.ts` — Phase 2 opt-in MCP E2E(先用 `ECHO_MCP_PORT=39002 pnpm --filter @tool-bridge/gateway echo-mcp` 启动兜底上游)。
- `TB_TEST_LIVE_HTTP=1 pnpm --filter @tool-bridge/gateway test -- tool.integration.test.ts` — Phase 2 opt-in 真实 HTTP 上游(postman-echo)。

## .env 凭据状态(只记变量名与状态,绝不写值)

| 变量 | 状态 | 备注 |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | 已配置 | DJJ 账户;验证用 `wrangler whoami`,勿用 `/user/tokens/verify` |
| `CLOUDFLARE_API_TOKEN` | 空缺(注释掉) | 预期内:本地开发靠 wrangler OAuth,CI 时才需要 |
| `TB_DOMAIN` | 已配置 | zone pdjjq.org 在 DJJ 账户 |
| `TB_BASE_URL` | 已配置 | 生产 BaseURL(custom domain,已上线) |
| `TB_NAME_PREFIX` | 已配置(=tb 默认) | worker/KV/R2 命名前缀派生 |
| `TB_SECRET_ENCRYPTION_KEY` | 已配置(32B base64url) | SecretStore env-only 信任根(Proto §2.5);已同步 `wrangler secret put` |
| `TB_SK` | **已配置(= Admin SK)** | Phase 1 引导产出;CLI/smoke/verify-revocation 的默认凭证 |
| `TB_TEST_MCP_URL` / `TB_TEST_MCP_BEARER` | 空缺(注释掉) | Phase 2 / E2E-5 用;见下方兜底 |
| `TB_TEST_S3_ENDPOINT` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` / `_BUCKET` | 空缺(注释掉) | Phase 3 / E2E-2 用;见下方兜底 |
| `TB_R2_ACCESS_KEY_ID` / `TB_R2_SECRET_ACCESS_KEY` | 空缺(注释掉) | `$ref` 预签名用;`tb init`/provision 时创建 |

**结论**:Phase 3 主路径不被凭据阻塞;真实外部 S3 空缺走 R2 S3 兼容 API 兜底,预签名 AK 空缺时大对象走网关中转下载。

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

## 遗留注意

- P1-7 吊销"本地宿主立即被拒"以 workerd 集成测试覆盖;SQLite 宿主属 Phase 6,届时补验。
- Phase 2 opt-in MCP E2E 退出码已为 0;workerd 仍会打印 SDK sourcemap 诊断与一次 `Network connection lost` 文本,属 harness 噪声,不作为失败依据。
