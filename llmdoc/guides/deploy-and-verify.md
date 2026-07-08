# Guide:从零到线上验证(deploy-and-verify)

> 用途:一条龙走完"本地验证 → 部署 → 线上验证"的完整流程,每步带预期输出与排错。适用:每轮改动落地后、或新环境首次部署。前置:`.env` 已配置(见 [../must/current-state.md](../must/current-state.md) 凭据状态表)、wrangler 已 OAuth 登录。

## 流程

### 1. 本地验证:`pnpm verify`

typecheck + biome lint + 单测(core/cli/sdk)+ 集成测试(gateway 真实 workerd + server 纯 Node)一把过。

预期:全绿,末尾 core `603 passed`、cli `101 passed`、sdk `12 passed`、gateway `85 passed | 6 skipped`、server `23 passed`(数字随开发增长,以全 pass 为准)。任一段红即停,先修再继续。

### 2. 部署:`pnpm deploy:all`

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
# → {"healthy":true,"version":"0.1.0"}
curl -s https://tool-bridge.pdjjq.org/~help | head -1
# → htbp 0.1
```

### 4. 冒烟脚本:`TB_BASE_URL=… pnpm smoke`

```sh
TB_BASE_URL=https://tool-bridge.pdjjq.org pnpm smoke
```

**注意:smoke 不读 `.env`**,必须显式传 `TB_BASE_URL`(或 `tsx scripts/smoke.ts <baseUrl>`)。脚本只做只读探测(healthz + `~help`)。

预期:

```
ok  GET /healthz → 200 healthy version=0.1.0
ok  GET /~help → 200 text/plain first line "htbp 0.1"

smoke passed against https://tool-bridge.pdjjq.org
```

### 5. CLI 验证:`tb status --json`

```sh
pnpm --filter @tool-bridge/cli build   # 首次或改动 CLI 后
node packages/cli/dist/index.js status --json
```

预期:输出可解析 JSON,含 healthy/version(`TB_BASE_URL` 从环境读取)。

## 排错

- **wrangler 报多账户歧义**(`More than one account available`):wrangler OAuth 下有 DJJ 与 Lightspeed 两账户,必须显式指定——`wrangler.jsonc` 已写死 `account_id`,脚本走 `CLOUDFLARE_ACCOUNT_ID`;若单独手敲 wrangler 命令,补 `CLOUDFLARE_ACCOUNT_ID=… npx wrangler …`。
- **custom domain 刚部署后 curl 404/522**:custom domain 首次绑定或 DNS 变更有分钟级生效延迟,等 1-2 分钟重试;也可先用 wrangler deploy 输出里的 workers.dev 地址确认 Worker 本身健康,再等域名。
- **smoke 报 `missing base URL`**:忘了传 `TB_BASE_URL`(它不读 .env),见第 4 步。
- **verify 里集成测试起不来 workerd**:确认 `pnpm install` 后再跑;`@cloudflare/vitest-pool-workers` 用 miniflare 本地实例,不需要真实 KV id。
