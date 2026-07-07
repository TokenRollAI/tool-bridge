# Workers/KV 生产坑清单

> 用途:Cloudflare Workers + KV 宿主下已实际踩过或实测核实的限制,写码/排错前先对照。更新时机:新增实测踩坑或 CF 限制变化时。来源:实现与生产验证(2026-07-06)。

## 1. KV list + get 的最终一致窗口(生产实际踩坑)

KV 最终一致:**刚删除的 key 可能仍出现在 `list()` 结果里,而对它的 `get()` 已返回 null**。生产实测触发:delete 节点后立刻 `~tree`,list 出的 key get 到 null,null 流入 TreeNode 消费方(读 `.path`)抛 internal 500。

**修法**:StateStore 的 list 实现必须跳过 get 为 null 的 key(`packages/gateway/src/kvStateStore.ts` 已内置,commit 916de0d)。任何"list 键名再逐 key 取值"的 KV 消费模式都要带这层防御。

## 2. Workers 子请求上限约束 KV 逐 key get

KV 的 `list()` 不带值(官方限制),取值须逐 key `get()`,而**每次 get 计一个 Workers 子请求**——上限免费套餐 ~50 / 付费 ~1000 每请求。因此单次请求内 list 触碰的键数受此硬约束。

**修法**:`NodeRegistryStore.children/subtree` 按**子树前缀扫描**,不扫全树(消 O(N²));一次 `~tree` 读入的子树节点数应 ≤ 数百(与 `~tree` 节点上限 500 同量级),给 1000 上限留余量。规模再增须改 KV metadata 承载值(list 不再逐 get)或换 SQLite 宿主。详见 `kvStateStore.ts` 头注释。

## 3. 吊销传播窗口:上限 60s,实测 0.3s

SK 记录经 KV 分发(最终一致),吊销/禁用在全球边缘的传播窗口**上限 60s**(KV 官方上限,亦是协议承诺的吊销窗口)。生产实测(`scripts/verify-revocation.ts`,可重跑):`tb sk rm` 后 **0.3s** 即开始被拒——上限是承诺,实际通常远快。需要即时失效用短 `expiresAt` 或主动轮换;SQLite 宿主吊销即时生效。

## 4. @cloudflare/vitest-pool-workers 0.18 的 API 变更

0.18(配 vitest 4)有两处破坏性变更,网上旧资料多为旧 API:

- **配置改为 Vite 插件形态**:`cloudflareTest({ wrangler: { configPath }, miniflare: { bindings } })` 放进 `plugins`,取代旧的 `test.poolOptions.workers`(见 `packages/gateway/vitest.config.ts`)。
- **`cloudflare:test` 模块声明(SELF、env 等)移到 `/types` 子路径**:需 `/// <reference types="@cloudflare/vitest-pool-workers/types" />`(见 `packages/gateway/test/env.d.ts`)。

另:测试用 vars 经 `miniflare.bindings` 注入而非 .dev.vars,保证测试确定性。

## 相关坑(其他文档)

- workerd 会把裸 `return asyncFn()` 的 reject 误报为 unhandled rejection——handler 里必须 `await`(`app.ts:295` 注释)。
- 多账户 wrangler 须显式 account、smoke 不读 .env → [deploy-and-verify.md](deploy-and-verify.md)。
