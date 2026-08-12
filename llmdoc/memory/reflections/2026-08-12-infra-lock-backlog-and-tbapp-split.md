# 反思:infra-lock 待办清仓与 tbApp 拆分——纯移动的证据、显式化闭包、平台语义的处理方式

## Task

- 2026-08-11 架构评估列出 6 项(#1 抽 `@tool-bridge/app`、#2 验证面迁 Node、#3 收敛两份 SQL SearchIndex、#4 plugin 托管安装去 provider 绑定、#5 拆 2948 行的 `tbApp.ts`、外加卫生项 `no-explicit-any`/zod 版本统一 与 部署叙事去 CF 化)。#1/#2 已在前两轮落地;用户"请你全都帮我处理吧"授权余下全部,本轮清完并逐项独立提交(`5df617a`/`cd3a4ff`/`f078be7`/`366fd86`)。

## Durable Lesson

1. **"纯移动重构"要拿行集合 diff 当证据,不是拿 diff 当证据。** 拆 `tbApp.ts` 时 git diff 是 2948 行删 + 十几个文件增,人眼无法判断有没有丢逻辑。可判定的做法:把 `git show HEAD:<file>` 的目标区间与所有新文件拼接,各自做 `去空白 → 去空行 → 排序 → uniq`,再 `comm` 比对。合格标准是**"只在旧侧出现"的行必须全部可归因**——本轮只剩三类:加了 `export` 的声明行、加了 `env` 参数的声明行与调用点、一处重写的 doc comment。零函数体落在旧侧,这才是"纯移动"的证据。测试全绿只能证明没坏,证明不了没漏。
2. **拆文件前先把闭包依赖显式化,别用 sed 改写函数体。** 原 handler 全靠闭包捕获 `deps`/`searchSync`/`builtinsOf`/`globalSearchCapabilities`。直觉方案是搬走后把标识符改写成 `env.deps`——但正则会打到注释和字符串里,且让每个函数体都产生真实差异,上一条的验证手段随之作废。实际做法:定义 `RouteEnv` 且**字段名与原闭包变量逐字同名**,在每个 handler 顶部插一行解构。函数体保持字节相同,签名变化是唯一 diff,证据链才立得住。
3. **可移植性的产出不是"删掉平台语义",而是把它降级成显式下界。** KV 最终一致的吊销窗口、D1 Free 50 查询/请求塑造出的 `TOOL_SEARCH_*` 预算、DO hibernation 的心跳设计,都是 CF 事实泄进中立层的产物。中立化的诱惑是把这些注释删掉当作"解耦完成",但换到 Node/SQLite 宿主它们仍是**安全的下界**(更强的一致性/更宽的预算不会违反按弱平台设计的逻辑)。正确处理是保留并标注为下界与来源平台,而不是抹掉出处——否则下一个人会按 SQLite 的强一致重写判定次序。
4. **两个实现"看起来重复"要先分清哪部分是逻辑、哪部分是驱动。** D1 与 SQLite 两份 SearchIndex 差异集中在 batch/prepare 形态、同步 vs Promise、有没有查询预算;v3 的 schema、trigram/LIKE 混合查询、digest 判定是同一套。收敛成 core `search/sqlSearchIndex.ts` + 各宿主一个 `SqlSearchDriver` 后,gateway 侧 115 行、server 侧 82 行,都只剩驱动。判据是**"改协议行为要不要动两处"**:要,就该收敛;只是形状像,不必。
5. **lint 规则会反向约束 API 形状,签名统一不能一刀切。** 把所有 handler 统一成 `(c, env)` 后,`handleFeedbackGet` 用不到 `env`,unused-parameter 规则直接拦。为了"整齐"给它塞个 `_env` 是把规则当障碍;正确处理是承认它确实不依赖 RouteEnv,签名保持 `(c)`。一致性是给读者的线索,不是给自己的仪式。
6. **一次性授权"全都处理"时,提交仍要按项切分。** 四项互不相干的改动(卫生、部署叙事、SQL 收敛、拆文件)如果攒成一个提交,任何一项回滚都要手工挑拣,而拆文件那项恰恰是最需要保留独立回滚能力的。用户批准的是范围,不是提交粒度。

## Promotion Candidates

- verification-and-commit-practices 可加一节**"纯移动重构的验收清单"**:行集合 diff 的具体命令、合格标准(旧侧残留必须逐类可归因)、以及"先显式化闭包再搬运"的前置步骤。
- modules-and-boundaries 已把"次序在 `tbApp.ts`、行为在 `routes/*`"写进判定次序段;若后续再拆大文件,可提炼一条通用规则:**装配面只留声明与顺序,读完即知全貌**。
