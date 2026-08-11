# 反思:验收命令退出 0 不等于产物语义正确

## Task

- Round 28 复核 E2E-B 的 Plugin SDK 发布产物、样例/飞书实现测试与 `verify-plugin`，确保打包工具和验收脚本验证的是当前 plugin/v2 契约，而不是只获得绿色退出码。

## What Changed During Verification

- `npm pack --dry-run --json` 退出 0，但该命令没有按 pnpm 发布路径应用 `publishConfig`：候选包仍包含 `src/index.ts`，manifest 的 `main`/`exports` 仍指源码。由于 npm 会为入口额外收包，顶层 `files:["dist"]` 也不能阻止错误源码入口进入候选产物。
- 真正执行 `pnpm pack` 后，tar 只有 `LICENSE`、`dist/index.js`、`dist/index.d.ts` 与 manifest；打包后的 `main`/`types`/`exports` 全指向 dist，JS/声明文件中的 Node 内建引用与 `@tool-bridge/core` workspace 类型引用均为 0。
- 隔离 Node 首跑 `verify-plugin` 时，产品的 v2 注册/调用链可工作，失败来自脚本仍断言 v1 `kind/interfaceVersion`。脚本改为显式注册 `protocolVersion:'plugin/v2'`、挂载 `export:'entries'` 并检查 `exports[id/profile/methods/capabilities]` 后，全流程通过。

## Durable Lesson

1. **命令成功只证明该命令自己的成功条件。** `pack --dry-run` 的 exit 0 表示工具能生成候选清单，不证明最终发布器会采用相同 manifest 变换，也不证明消费者能从声明入口加载。验收必须逐项定义文件集合、入口、类型入口、运行时依赖和禁止引用，不能把“能打包”简写成“可发布”。
2. **发布产物要检查真实 tar，而不是工作区 package.json。** monorepo 可让 workspace 开发入口指向 `src`，再由 `publishConfig` 改写发布入口；只有实际发布命令生成的 tarball 才是消费者拿到的对象。应解包检查精确文件清单和包内 manifest，并从 tar 内的 JS/d.ts 扫描 Node built-in、workspace alias 与悬空类型引用。
3. **打包器是发布契约的一部分。** npm 与 pnpm 对 `publishConfig`、workspace 依赖重写、LICENSE 收集和入口保留的行为可能不同。仓库既然依赖 pnpm 的 publish 变换，DoD/CI 就必须执行 `pnpm pack`；不能用看似等价的 `npm pack --dry-run` 替代，更不能仅凭两者命令名相似外推产物一致。
4. **协议升级后，E2E 脚本也是必须迁移的客户端。** plugin/v1 的 `kind/interfaceVersion`、省略 export 的 mount 与 v2 的 `protocolVersion + exports` 语义不同。产品单测全绿而旧脚本失败时，应先定位失败发生在注册、挂载、消费还是脚本自身断言；不能立即归因于产品回归，也不能删掉断言让脚本变绿。
5. **脚本要断言协议的判别字段，而非只跑通业务动作。** v2 验收应检查 `~describe.protocolVersion`，按 id 找到目标 export，再核对 profile、methods 与 capabilities；挂载时显式选择 export。否则单 export stub 可能凭默认行为通过，而真实多 export plugin 仍会挂错能力面。
6. **实现证据与外部生产证据必须分账。** workerd 样例 5/5 证明 SDK 双 export 在真实 Worker harness 接线；plugin SDK 22/22 证明协议派生与 envelope；飞书 mock 9/9 证明 TAT/MCP 适配和失败分支；隔离 Node `verify-plugin` 证明 gateway/CLI/stub 全链路。它们都不能替代重新部署后对真实飞书 create-doc/fetch-doc/update-doc 的生产实调。
7. **验收脚本漂移应在协议变更时主动搜索。** 修改 manifest/profile/export grammar 后，要搜索 scripts、README、fixtures、Dashboard builder 与生产 runbook 中的旧判别字段，并至少运行一次隔离宿主流程。长期未跑的 E2E 脚本最容易成为“产品正确、验收器错误”的假红来源。

## Promotion Candidates

- npm 发布指南可加入真实 tar 验收模板：指定唯一打包器，列 tar、读取包内 manifest、从包内产物扫描禁止 runtime/type 引用，并以临时目录清理产物。
- 协议升级清单可把 `scripts/verify-*` 视为正式消费者，与 CLI、Dashboard、fixtures 同步迁移；多 export 场景必须显式选择并断言 export。

## Evidence Boundary

- 本轮已复现 npm dry-run 的错误候选语义，并核对 pnpm 真 tar 的四个文件、dist 入口及零 Node/workspace 类型引用；workerd 样例 5/5、飞书 mock 9/9、plugin SDK 22/22 通过，更新后的 `verify-plugin` 在隔离 Node gateway 上全 PASS。尚未获授权执行重新部署与真实飞书 create-doc/fetch-doc/update-doc，P2-1 与 E2E-B 的生产半边必须保持 PENDING。
