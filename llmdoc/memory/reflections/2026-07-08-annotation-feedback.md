# 反思:Path 补充说明 + Agent 反馈能力(builtin 惯性 → ~feedback 保留段返工)

## Task

- 实现两项能力并保持三入口对等(API/CLI/Dashboard):Path 补充说明(system/annotation builtin)+ Agent 反馈能力。反馈能力最终形态为 `~feedback` 协议保留段。已全绿,未部署。

## Expected vs Actual

- 预期:两项能力都按 system/\* builtin 惯性实现,一轮完成。
- 实际:annotation 走 builtin 无异议;feedback 按惯性做成集中式 builtin(system/feedback)并完整实现(含集成测试)后,用户明确"这是非常重要的能力,要用 ~feedback 保留段而不是再加一个 system/\*"——返工 gateway 路由/CLI/测试,形态切换约一小时。

## What Went Wrong

1. **能力的协议形态没有先和用户对齐**:把"加能力"默认等同于"加 system/\* builtin",没有在动工前区分它是协议级(保留段,per-path)还是管理面级(system/\* builtin)。用户在需求里已强调该能力"重要/一级",这个信号被忽略了。
2. 完整实现(含集成测试)后才暴露形态分歧,导致集中式路由壳、CLI 调用面、相关测试整体重写。

## Root Cause

- 惯性路径依赖:此前新能力多以 system/\* builtin 落地,plan 阶段未把"API 形态(保留段 vs builtin)"列为显式确认项,用户评审 plan 时也就没有机会在实现前否决形态。

## Missing Docs or Signals

- 缺一条决策提示:"协议级 vs 管理面级"能力的判别标准与各自的落点(保留段继承 path 级权限;builtin 走集中 scope)。
- plan 模板/评审习惯中没有"API 形态"确认项。

## Promotion Candidates

可复用结论(recorder 酌情提炼):

1. **能力形态先对齐再动工**:用户强调某能力"重要/一级"时,先问它是协议级(`~` 保留段,per-path)还是管理面级(system/\* builtin);plan 评审把"API 形态"列为显式确认项。→ 可并入 `guides/verification-and-commit-practices.md` 或 plan 纪律。
2. **保留段天然继承 path 级权限模型**:权限判定落目标 path 本身,窄 scope SK(仅 feishu/\*\*)无需额外授权即可反馈,比集中 builtin 的 scope 语义更内聚——协议级能力优先考虑保留段形态。→ 契约/架构文档酌情补判别标准。
3. **"纯逻辑收敛在 core store、协议壳在 gateway"边界压低返工成本**:FeedbackStore/排序阈值/HelpModel 渲染全复用,只重写路由壳与调用面,形态切换仅一小时——分层纪律的直接收益,值得作为边界设计的正面案例。→ `architecture/modules-and-boundaries.md` 已有模式,可作佐证。
4. **Help DSL 缩进条目行不能以 scope 开头**:新行走"未知行忽略"通道时,SCOPE_RE 会把 scope 开头的缩进行误归属到最近的 cmd;DSL↔JSON 等价测试(toEqual 精确匹配)会强制新字段两侧同步,是好护栏。→ `reference/protocol-contract.md` 酌情补一句。

留在 memory 即可:返工的具体范围(gateway 路由/CLI/测试)、一小时的切换耗时、用户原话措辞。

## Follow-up

- recorder 评估把"协议级 vs 管理面级形态判别 + plan 显式确认 API 形态"提炼进 guides;契约补 Help DSL 缩进行 scope 开头的坑。
- 待部署后按 verification 纪律做线上验证并同步 current-state。
