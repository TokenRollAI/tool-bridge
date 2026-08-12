# 反思:抽宿主中立层——编译器强制、产物基线与不可测的 bundle 图

## Task

- 架构评估指出 gateway 同时承载"CF 宿主适配"与"宿主中立应用层"两个身份,sdk/server 靠深链 `@tool-bridge/gateway/tbApp` 消费中立层。用户批准建议 #1 的彻底版:新建 `@tool-bridge/app` 承载中立层,gateway 降为薄 CF adapter。搬 17 文件 / ~6050 行,接线 sdk 2 处、server 4 处、gateway 测试 13 处、4 个 tsconfig/tsup + 4 个 CI workflow。

## Durable Lesson

1. **"中立性"若只靠人工纪律,等于没有。** 原方案(只给 gateway 的 `publishConfig.exports` 补 `./tbApp` 等)是治症状:gateway 的 `tsconfig.json` 全局挂 `types: ["@cloudflare/workers-types"]`,`tbApp.ts` 里写 `KVNamespace` 编译器一声不吭。独立包 + `types: []` + `lib: ["ES2023","DOM"]` 把同一条约束交给类型系统。判断一条架构约束值不值得付搬迁成本,看它**当前是否可被静默违反**,而不是看当前是否已被违反。
2. **收紧类型面是找存量 bug 的廉价手段。** ~6000 行搬到 `types: []` 下只报一个错,但那是真 bug:`objectBodyToBytes` 返回 `Uint8Array<ArrayBufferLike>`,而标准 `BodyInit` 拒收 SharedArrayBuffer 支撑的视图(内容可能在传输途中被并发改写)。`@cloudflare/workers-types` 恰好宽松放过,所以它在原位置**永远不会暴露**。修在 core 而非局部,因为 `r2Object.ts` 有同一潜在隐患。宽松的宿主类型定义会掩盖标准语义违规——换一层严格类型重编译,比读代码找 bug 便宜。
3. **bundle 图的正确性在 workspace 内不可测。** 我一度把 app 设成 gateway/sdk/server 的常规外部依赖。因为 core 是 private 包、被每个发布产物各自 bundle,external 的 app 会让运行时并存两份 core:`err instanceof TBError` 跨副本恒为 false,TBError 静默降级成 internal(错误码/状态码/retryable 全丢)。**workspace 测试跑源码单副本,一个用例都不会红。** 这类"只在发布形态成立"的缺陷必须靠配置层不变量 + 收尾产物检查兜住,不能指望测试。
4. **对比基线必须实测,中间态不是基线。** 我曾报告 sdk dist 从 560 KB "膨胀"到 2.27 MB。`git stash push -u` 回 HEAD 重装重建后发现 HEAD 本来就是 2.27 MB,chunk 切分、ajv 引用数、external import 集合逐项相同——560 KB 是我自己那个 external-app 中间态的产物。**任何"变大了/变慢了/多了"的结论,先把基线真跑出来。** 顺带发现的存量问题(sdk bundle 了 ~1.7 MB ajv,因为 MCP SDK 包不在其 `dependencies`)记录但不顺手改。
5. **两份清单必须一一对应时,不一致往往静默通过。** tsup 的 `dts.resolve` 数组与 `tsconfig.build.json` 的 `paths` 是两份清单:漏配 paths 不报错,只在 `dist/index.d.ts` 留一行悬空 `from '@tool-bridge/app'`,而该包在 devDependencies 里不随发布走——消费方类型入口直接断。三个包同时踩到。收尾一行可查:`grep '^import' packages/*/dist/index.d.ts` 不应出现任何 `@tool-bridge/*`。
6. **搬迁与验证面迁移要分两刀。** 本轮刻意不动测试(仍在 gateway 跑 workerd),只做文件搬迁 + 接线。把"测试也迁到中立宿主"留给下一步,单步失败面小、可独立回滚,也让"产物零回归"这个判断不被测试改动污染。代价是文档里必须显式写清:app 没有自有测试目录,其行为由 gateway 套件覆盖——否则下一个人会以为中立层没被验证。

## Promotion Candidates

- npm-publish 指南已加"单份 core 硬不变量"与 `dts.resolve` ↔ `tsconfig.build.json` paths 对应检查;可再补一条通用的**发布产物收尾清单**(d.ts 无 workspace 悬空 import、体积对照实测基线、入口指 dist)。
- 验证实践指南可加一条:**任何体积/性能对比结论必须附基线的获取方式**(stash 回 HEAD 重建,还是引用历史记录),不接受"印象中之前是 X"。
