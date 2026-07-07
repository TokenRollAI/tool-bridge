# 反思:gateway/dashboard 转可发布 npm 包(为 Deploy to Cloudflare 模板铺路)

## Task

- 把 `@tool-bridge/gateway` 与 `@tool-bridge/dashboard` 从 private workspace 包改成可发布 npm 包:gateway 用 tsup 单文件 ESM + dts 内联;dashboard 做成纯 dist 静态资源包。
- 新增 `publish-gateway.yml` / `publish-dashboard.yml` 两个 tag 触发的 CI workflow。
- 验收:全量 `pnpm verify` 通过 + 隔离 tsc 验证 dts 类型自包含通过。

## Expected vs Actual

- 预期:沿用 cli/sdk 的既有发布模式(tsup bundle + dts paths 内联 + Trusted Publishing CI)即可平移。
- 实际:整体达成,但踩到三处既有 guide 未覆盖(甚至与之相悖)的点——dev/发布双面孔的 exports 处理、Workers 目标包的隔离 tsc 环境搭建、npm-publish guide 中"core/gateway 不发布"的过时断言。

## What Went Wrong

1. **exports 指向差点破坏 sdk**:gateway 的 exports(`@tool-bridge/gateway/tbApp`、`/bootstrap`)被 sdk 按包名 import。若为发布把 exports 直接改指 dist,sdk 的 typecheck 与 vitest 解析立即断裂。
2. **隔离 tsc 首跑爆几百个错**,两个环境搭建错误叠加:
   - 软链依赖时想当然指向仓库根 `node_modules`——pnpm 不提升,`hono` 实际在 `packages/gateway/node_modules` 下;
   - tsconfig 未设 `lib`,默认含 DOM,`@cloudflare/workers-types` 与 `lib.dom` 的全局声明大面积冲突。
3. **guide 断言过时未即时暴露**:`guides/npm-publish.md` 写死"core/gateway 是 private workspace 包,不发布",本次任务直接推翻了一半;若按 guide 字面执行会误判任务前提。

## Root Cause

1. 没有先区分"dev 解析形态"与"发布形态"是两套需求:workspace 内消费方(sdk)依赖 src 指向做 typecheck/vitest,外部消费方需要 dist 指向。**正解:exports 保持指 src,发布形态用 `publishConfig` 覆盖 main/types/exports 指 dist。** 关键机制差异:`npm publish` **不应用** package.json 的 publishConfig 字段覆盖(仅 registry/access 等少数键),`pnpm pack` **才应用**——所以 CI 发布步骤必须是 `pnpm pack` 后 `npm publish <tarball>`(tarball 发布与 npm Trusted Publishing OIDC 兼容)。决策前先 grep 了 `@tool-bridge/gateway` 的全部消费方才定案,"先取证后改码"再次奏效。
2. 隔离验证环境是"随手拼"而不是"模拟真实消费方"。真实消费方(未来的模板仓库)是 Workers 项目,其 tsconfig 本就该是 `"lib": ["ES2022"]` + `"types": ["@cloudflare/workers-types"]`;软链也该按 pnpm 的实际布局(包级 node_modules)取依赖。验证环境与真实消费方一致时,坑自动消失。
3. guide 里的结论性断言("X 不发布")是写作时刻的快照,没有随决策变更同步。断言写进 guide 时未标注其为现状描述而非不变量。

## Missing Docs or Signals

- `guides/npm-publish.md` 只覆盖"简单形态"(exports 本就指 dist 或无 workspace 内按包名消费方)的发布,缺少"dev 与发布两副面孔"(publishConfig 覆盖 + pnpm pack)的手法。
- 隔离 tsc 验证一节(guide 第 10 行附近)只讲了"要做隔离验证",没讲**环境怎么搭**:pnpm 非提升布局下依赖软链的正确来源、Workers 目标包必须收窄 lib/types。
- guide 中"core/gateway 不发布"已失效,需 recorder 同步改写。

## Promotion Candidates

以下应由 recorder 提炼进 `guides/npm-publish.md`(不留在 memory 就够,均为可复用工作流知识):

1. **publishConfig 双面孔手法**:exports 保持指 src 供 workspace 内消费,`publishConfig` 覆盖指 dist;`npm publish` 不应用该覆盖、`pnpm pack` 才应用,CI 固定 `pnpm pack` + `npm publish <tarball>`(OIDC 兼容)。适用条件:包被 workspace 内其他包按包名 import。
2. **隔离 tsc 环境搭建守则**:软链依赖按 pnpm 实际布局取(`packages/<pkg>/node_modules`,不是仓库根);Workers 目标包 tsconfig 必须 `"lib": ["ES2022"]` + `"types": ["@cloudflare/workers-types"]`;总则——**验证环境应模拟真实消费方,而不是随手拼**。
3. **guide 事实同步**:改"core/gateway 不发布"为四包可发布现状;顺带在包形态一节区分"简单形态(cli/sdk)"与"双面孔形态(gateway)"、dashboard 的纯静态资源包形态。
4. 更泛化的一条("结论性断言写进 guide 即是快照,推翻决策时同步改文")可考虑并入 `guides/verification-and-commit-practices.md` 的收尾纪律,或至少在本次 recorder 更新时体现。

留在 memory 即可的:首跑爆几百错的具体排障过程(两错叠加的现象描述),提炼出守则后原始现象无需进 guide。

## Follow-up

- recorder 更新 `guides/npm-publish.md`:改掉过时断言、补 publishConfig/pnpm pack 手法、补隔离 tsc 环境搭建两坑;`must/current-state.md` 同步四包可发布现状与两个新 workflow。
- gateway/dashboard 首发仍需按 guide 既有"两段式":用户手动首发 + 配 Trusted Publisher,之后才能走 tag CI。
- 模板仓库落地时,tsconfig 直接采用本次隔离验证用的配置(`lib: ES2022` + `types: @cloudflare/workers-types`)。
