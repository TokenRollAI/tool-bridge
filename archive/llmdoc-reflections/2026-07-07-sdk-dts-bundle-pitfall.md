# SDK 发布包 d.ts 内联陷阱反思(2026-07-07)

> 范围:packages/sdk 用 tsup 打发布包时,dist/index.d.ts 残留 `import ... from '@tool-bridge/core'`,而 core 是 devDependency 且 files 只含 dist,导致发布包类型入口悬空。本文记结论与流程教训。

## 1. tsup 的 `noExternal` / `dts.resolve` 对"指向 .ts 源的 workspace 包"不生效

- `noExternal: ['@tool-bridge/core', ...]` 只影响 JS bundle,**不影响 dts 输出**。
- `dts: { resolve: true }` 和 `dts: { resolve: [...] }` 对 exports 指向 .ts 源文件的 workspace 包(如 @tool-bridge/core 的 exports "." → "./src/index.ts")**均不生效**,dist/index.d.ts 仍会 `import ... from '@tool-bridge/core'`。

**生效的修法**:给 tsup 指定专用 tsconfig(packages/sdk/tsconfig.build.json),用 `compilerOptions.paths` 把 `'@tool-bridge/core'` 等映射到对方 `src/*.ts`;tsup.config.ts 设 `tsconfig: 'tsconfig.build.json'` + `dts: { resolve: true }`。此后 d.ts 被完整内联(4KB → 18KB,零外部 import)。

## 2. 验证"类型自包含"要用隔离 tsc,grep 不够

仅 grep d.ts 里没有 workspace import 不充分。有效验证:在仓库外的隔离目录写一个只 import dist 类型的 check.ts,用仓库 `node_modules/.bin/tsc`(**不开 skipLibCheck**)编译通过,才算发布包类型自包含。

## 3. 流程教训:发布包"可独立消费性"不在常规 verify 覆盖里

types 入口、files 白名单、dependency 分类三者交叉决定发布包能否被独立消费,常规 `pnpm verify` 测不到。发布前值得用隔离 tsc 检查兜底。

## Promotion Candidates

- 待办:若后续多个包发布,tsconfig.build.json + paths 映射的做法与隔离 tsc 验证步骤可提升为 `guides/` 发布工作流一节;单包阶段先留本反思。
