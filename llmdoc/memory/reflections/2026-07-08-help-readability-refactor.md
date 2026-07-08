# 反思:~help 可读性重构(用户抱怨"h 语义含糊"驱动)

## Task

- 用户抱怨 ~help 输出可读性差(单字符 `h` 行语义含糊)。重构 ~help 表现层:Markdown 渲染器 + `hint` 行 + 索引一句话摘要 + DSL 多行值安全化。代码落点:`packages/core/src/htbp/helpMarkdown.ts`、`summary.ts`、`mcpSchema.ts`;gateway/CLI 各加对等入口(`Accept: text/markdown`、`tb help --md`)。

## Expected vs Actual

- 预期:按用户描述改字段命名/排版,是个小 UX 修补。
- 实际:动手前先拉线上真实 ~help 输出取证,一次暴露三个更深的根因,重构范围随之扩大为表现层分层 + 数据安全化,全部本轮完成并提交(a14ffa3 / 6ed1a1f / 8ca0bbd)。

## What Went Wrong

1. **问题比用户描述深,若按描述直接改会整轮返工**:真实输出显示上游 mcp 的整篇多行 markdown description 被原样塞进 `h` 行——单节点 ~help 数千 token 撑爆索引,且裸露多行文本破坏行式 DSL 结构(变成"未知行");同时 `Accept: text/markdown` 静默回落 DSL,用户要 markdown 拿到的正是最难读的表现。三个根因都不在用户的抱怨里。
2. **此前把给 LLM 的指引文案拼接进 description 语义字段**,污染了数据,消费方无法区分"节点描述"与"下一步提示"。

## Root Cause

1. 行式格式的值位(node description、`h`)从未假定上游会给多行脏数据——mcp 上游 description 无任何长度/换行约束,脏数据必然出现。
2. 表现层无分层定位:DSL/JSON/markdown 三者关系不明,导致 markdown 回落行为与"是否承诺结构化解析"都是含糊的。

## Missing Docs or Signals

- 契约文档此前未规定多行值的安全化规则与 markdown 表现定位(本轮已随 ffb671e 补入 `reference/protocol-contract.md`)。
- 无"用户抱怨表现问题 → 先拉一次线上真实输出再设计"的显式步骤提示(取证纪律已有,但偏向 bug 排查场景)。

## Promotion Candidates

可复用结论(recorder 酌情提炼;契约面本轮已同步):

1. **先取证后设计也适用于 UX/可读性类抱怨**:一次真实线上输出取证同时暴露三个根因,远优于按描述猜测——可并入 `guides/verification-and-commit-practices.md` 的"先取证后改码"条目(现措辞偏 bug 场景)。
2. **协议扩展优先走"未知行必须忽略"通道**:HTBP 规定消费方忽略未知行,这个向前兼容扩展点就是为加 `hint` 这类行设计的,不 bump 版本;给 LLM 的提示文案单独开渲染位(hint 字段),绝不拼进语义字段(description)。→ `reference/protocol-contract.md`(已入)。
3. **表现分层避免等价矩阵**:markdown 定位为"可读性表现"(排版自定、不承诺结构化解析),DSL↔JSON 仍是唯一规范等价对——否则三种表现两两等价的维护矩阵不可持续。→ 契约(已入)。
4. **行式格式多行值双层防御**:任何值位假定上游多行脏数据——构建时一句话化(索引摘要)+ 渲染时续行缩进(全量)。→ 契约(已入)。

留在 memory 即可:用户原始抱怨措辞、单节点数千 token 的实测数据、静默回落的具体表现。

## Follow-up

- recorder 评估把"先取证后设计(含 UX 类抱怨)"并入 verification-and-commit-practices 的既有条目;契约面已同步,无遗留。
- 后续新增任何行式协议字段,默认走 hint 式独立行 + 未知行忽略通道,不动版本号、不拼语义字段。
