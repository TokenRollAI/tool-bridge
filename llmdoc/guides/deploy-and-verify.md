# Guide:从零到线上验证(deploy-and-verify)

> 用途:一条龙走完"本地验证 → 部署 → 线上验证"的完整流程,每步带预期输出与排错。适用:每轮改动落地后、或新环境首次部署。前置:`.env` 已配置(见 [../must/current-state.md](../must/current-state.md) 凭据状态表)、wrangler 已 OAuth 登录。

## 流程

### 1. 本地验证:`pnpm verify`

typecheck + biome lint + 单测(core/cli/sdk)+ 集成测试(gateway 真实 workerd + server 纯 Node + plugin-feishu 真实 workerd)一把过。

2026-07-10 快照:core `681 passed`、cli `162 passed`、sdk `12 passed | 1 skipped`、gateway `119 passed | 6 skipped`、server `23 passed`、plugin-feishu `8 passed`,合计 **1005 passed / 7 skipped**。数字随开发增长,以全 pass 和退出码 0 为准;任一段红即停,先修再继续。

### 2. 先确认部署状态,再决定是否手工部署

当前项目在仓库外配置了 Cloudflare Git 集成,推送 `main` 后可能已经自动生成并部署新 Worker version;仓库 `.github/workflows/` **没有** deploy workflow。先读平台状态:

```sh
pnpm --filter @tool-bridge/gateway exec wrangler deployments list --json
pnpm --filter @tool-bridge/gateway exec wrangler versions list --json
```

核对最新 deployment 是否已经把目标 version 以 100% 流量上线;若本轮含 Dashboard,还要按第 4 步比对生产 `/ui` 产物。目标状态已经存在时停止,不要为了获得一份手工命令输出重复部署。

只有目标 version/产物尚未上线时才运行:

```sh
pnpm deploy:all
```

= `node scripts/provision.mjs`(幂等建 KV/R2,存在即跳过)+ `pnpm --filter @tool-bridge/dashboard build`(gateway 部署前须先产出 dashboard dist)+ `pnpm --filter @tool-bridge/gateway run deploy`(wrangler deploy)。

**部署前置检查**:部署工作区必须与 `origin/main` 零差异(`git fetch && git diff origin/main --stat` 为空、`git status` 干净)——主 checkout 可能残留他人/往轮 WIP,直接部署会把未提交改动带上线。从干净 worktree 部署时把主 checkout 的 `.env` 拷过去即可(gitignored;provision/deploy 脚本读仓库根 `.env`)。

预期(资源已存在时):

```
provisioning with prefix 'tb' (account 0cb9…)
KV namespace 'tb-kv' exists (id=d18c93de…) — skip
R2 bucket 'tb-r2' exists — skip
provision done.
…
Deployed tb-gateway triggers (…)
  https://tool-bridge.pdjjq.org (custom domain)
Current Version ID: …
```

**首次建 KV 时**:provision 会提示把新 id 回填 `packages/gateway/wrangler.jsonc` 的 `TB_KV.id`(当前 id 已回填,日常无需动)。

### 3. 手工探活:curl

```sh
curl -s https://tool-bridge.pdjjq.org/healthz
# → {"healthy":true,"version":"<gateway-version>"}
curl -s -H "Authorization: Bearer $TB_SK" -H 'Accept: text/plain' \
  https://tool-bridge.pdjjq.org/~help | head -1
# → htbp 0.1
```

`/healthz.version` 是 **Gateway 运行时版本**,不能用来判断 Dashboard npm 包或 `/ui` Static Assets 的版本。

### 4. Dashboard 静态产物验收(本轮含前端时)

静态前端以产物身份为准:比较同一提交本地构建与生产入口 HTML 的 SHA-256,再检查入口引用的 hash chunk 和 SPA 深链接回退。macOS 示例:

```sh
pnpm --filter @tool-bridge/dashboard build
shasum -a 256 packages/dashboard/dist/index.html
curl --retry 3 --retry-all-errors -fsS "$TB_BASE_URL/ui/" | shasum -a 256
curl --retry 3 --retry-all-errors -fsS "$TB_BASE_URL/ui/system/status" | shasum -a 256
rg -o 'assets/[A-Za-z0-9._-]+\.(js|css)' packages/dashboard/dist/index.html | sort -u
```

前两个线上 HTML hash 应与本地入口一致;随后逐个请求列出的 `/ui/assets/<hash-name>` 并确认 200。Dashboard npm 发布与生产 `/ui` 上线是两个独立发布面:前者查 Actions + npm dist-tag,后者查 Worker deployment/version + 本步骤的产物证据。详见 [npm-publish.md](npm-publish.md)。

### 5. 冒烟脚本:`TB_BASE_URL=… TB_SK=… pnpm smoke`

```sh
TB_BASE_URL=https://tool-bridge.pdjjq.org TB_SK='…' pnpm smoke
```

**注意:smoke 不读 `.env`**,调用时必须同时显式传 `TB_BASE_URL` 与 `TB_SK`。缺任一项都会在发出网络请求前退出 1,不会跳过认证检查;输出只给配置指引,不回显凭据。脚本做只读探测(healthz + 匿名 `~help` 401 + 认证 markdown/DSL `~help` 200)。

预期:

```
ok  GET /healthz → 200 healthy version=<gateway-version>
ok  GET /~help (no SK) → 401 TBError permission_denied
ok  GET /~help (with SK) → 200 text/markdown (default representation)
ok  GET /~help (Accept: text/plain) → 200 first line "htbp 0.1"

smoke passed against https://tool-bridge.pdjjq.org
```

### 6. CLI 验证:`tb status --json`

```sh
pnpm --filter @tool-bridge/cli build   # 首次或改动 CLI 后
node packages/cli/dist/index.js status --json
```

预期:输出可解析 JSON,含 healthy/version(`TB_BASE_URL` 从环境读取)。

### 7. MCP consumer 出口:`pnpm verify:mcp`

先准备 admin SK 和一把窄 SK。窄 SK 默认至少须能读 `system/status:get`;如生产策略不允许该路径,用 `TB_MCP_NARROW_PATH` / `TB_MCP_NARROW_COMMAND` / `TB_MCP_NARROW_ARGS` 选择另一项无副作用工具:

```sh
TB_BASE_URL=https://tool-bridge.pdjjq.org \
TB_SK='...' TB_MCP_NARROW_SK='...' pnpm verify:mcp
```

脚本使用官方 MCP SDK 建立两条独立连接:admin 必须 list 非空并真实 call 默认只读 `system/registry:list`;窄工具集必须非空、为 admin 严格子集,且预期允许工具必须真实 call 成功;最后用 admin-only 旧 flat name 验证窄连接返回 `tool not found`。不要用 `scopes=[]` 的空工具集 SK 做“收窄”证据;脚本会对此 fail closed。

### 8. Search只读验收:`pnpm verify:search`

目标环境须先有同时命中 `日程` 与 `create document` 的 control fixtures:允许前缀内至少一项、前缀外至少一项;窄 SK须对允许前缀同时持 `read + call`。脚本不创建/修改fixture,四个环境变量都必填:

```sh
TB_BASE_URL=https://tool-bridge.pdjjq.org \
TB_SK='...' \
TB_SEARCH_NARROW_SK='...' \
TB_SEARCH_ALLOWED_PREFIX='search/visible' \
pnpm verify:search
```

脚本对两个 exact query分别用真实 CLI拉完所有 cursor页,再要求窄结果非空、属于admin集合、严格缩小且全部落在完整TreePath段前缀内。重复item/cursor或20页预算后仍有cursor均fail closed。当前只有本地Miniflare D1、Node SQLite/CLI/Dashboard证据;须在真实D1 provision与干净部署后运行此命令并以同一窄身份复核生产Dashboard,才能关闭P4-1/P4-3。

## 排错

- **wrangler 报多账户歧义**(`More than one account available`):wrangler OAuth 下有 DJJ 与 Lightspeed 两账户,必须显式指定——`wrangler.jsonc` 已写死 `account_id`,脚本走 `CLOUDFLARE_ACCOUNT_ID`;若单独手敲 wrangler 命令,补 `CLOUDFLARE_ACCOUNT_ID=… npx wrangler …`。
- **custom domain 刚部署后 curl 404/522**:custom domain 首次绑定或 DNS 变更有分钟级生效延迟,等 1-2 分钟重试;也可先用 wrangler deploy 输出里的 workers.dev 地址确认 Worker 本身健康,再等域名。
- **smoke 报缺少配置**:确认命令行同时显式传入 `TB_BASE_URL` 与 `TB_SK`(脚本不读 `.env`),见第 5 步;不要把缺 SK 当作可跳过项。
- **verify 里集成测试起不来 workerd**:确认 `pnpm install` 后再跑;`@cloudflare/vitest-pool-workers` 用 miniflare 本地实例,不需要真实 KV id。
- **`SSL_ERROR_SYSCALL` / `Network connection lost` 等瞬时网络错误**:只对原来的只读查询或幂等 push 重试,随后重新读取远端 refs、Actions、npm dist-tag、Cloudflare deployment/version 与产物 hash;不要未经证据改认证、重打 tag 或重复 deploy。
