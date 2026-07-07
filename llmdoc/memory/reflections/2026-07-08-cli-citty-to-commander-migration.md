# 反思:CLI 框架 citty→commander 迁移(权限拼错 flag 静默放行事故驱动)

## Task

- 排查用户报告的安全事故:`tb connect <url> --allow git --alows ls` 拼错 flag(`--alows`)后 CLI 未报错,用户以为放行了 ls,实际 shell 白名单只有 git。
- 根因定位到 citty 0.2.2 后,经用户拍板整体迁移到 commander:15 个命令文件 + 8 个测试文件。

## Expected vs Actual

- 预期:修一个"未知 flag 未报错"的解析 bug,可能又是给 citty 打一个补丁。
- 实际:深挖发现同根缺陷一串,补丁不可持续;整体迁移 commander,实测成本远低于预期(两轮并行 workflow,总耗时 <15 分钟),并以精确回归 + 全命令矩阵测试收尾。

## What Went Wrong

1. **解析器宽松模式成了安全缺陷**:citty 0.2.2 底层用 node `parseArgs` 的 `strict:false`——未知 flag 静默变 boolean、其值滑成 positional。在权限相关 CLI(allow 白名单)上,这不是 UX 问题而是安全缺陷:拼错的授权 flag 被静默吞掉,用户以为授权生效。
2. **同根缺陷成串**:string flag 缺值时得到空串/吞掉下一个 flag;`--no-shell` 是靠前缀否定的巧合才行为正确;重复 flag last-wins,须从 rawArgs 手工重收集(此前已为此在 `args.ts` 打过 `repeatableArg` 补丁)。
3. **换框架信号识别滞后**:repeatableFlags 问题时已经给框架打过一次补丁,当时没触发"框架根子有问题"的评估;这次是第二次同根补丁信号,才升级为换框架决策。

## Root Cause

1. 选型时未验证解析器的 strict 行为;citty 的宽松解析是设计取向,不是可配置项,补丁只能逐症状堵。
2. "给框架缺陷打补丁"的第一次没有留下"再犯即换"的决策阈值;单看每个症状都像小修,串起来才是框架级缺陷。
3. 迁移成本被高估(15 个命令文件听起来大),实测机械平移极快——高估成本导致倾向继续打补丁。

## Missing Docs or Signals

- 无任何文档记录"CLI flag 解析必须 strict"这一安全不变量,以及"权限/授权类 flag 的拼错必须硬失败"。
- 无"框架缺陷补丁计数"信号:第一次补 citty 时(repeatableArg)未在 memory 留痕,第二次撞上时无从对照。
- 迁移打法本轮现拼但可复用:
  - 先手写 3 个范例文件(`args.ts`/`connect.ts`/`mount.ts`)钉死模式,再 workflow 每文件一个 agent 机械平移;规则里把 kebab→camelCase 映射逐个列全。
  - 测试侧先建解析级 harness(`runCli`/`parseError` 走真实 `buildProgram`),再迁存量测试。
- commander 两个坑无处可查:`exitOverride` 不向 `addCommand` 的子命令继承(须递归应用);内置 help 子命令与业务 `tb help` 冲突(须 `.helpCommand(false)`)。

## Promotion Candidates

应由 recorder 提炼(不必留 memory,均为可复用结论):

1. **进 `must/project-brief.md` 工程纪律或 `guides/verification-and-commit-practices.md`**:权限/授权相关 CLI 的解析必须 strict——未知 flag、缺值、拼错一律硬失败;"宽松解析在权限面是安全缺陷"作为不变量。
2. **进 `guides/`(可并入验证纪律篇)**:第二次为同一框架缺陷打补丁时,触发换框架评估而非继续补;评估时用小样本实测迁移成本(本轮 3 个范例文件即钉死模式),不要凭文件数估。
3. **进 `architecture/code-map.md` 或 CLI 相关 guide**:commander 两坑(exitOverride 须递归应用到子命令、`.helpCommand(false)` 避让业务 help 命令)+ 解析级测试 harness 的位置与用法。
4. `reference/protocol-contract.md` 的 CLI 命令矩阵如引用了 citty 术语需同步;`must/current-state.md` 工具链选型表更新 citty→commander。

留在 memory 即可:事故命令原文、citty 各症状的逐条现象描述、两轮 workflow 的耗时数据。

## Follow-up

- recorder 按上述四条更新稳定文档;确认 `strictParsing.test.ts` 已覆盖事故命令精确回归 + 35 叶子命令未知 flag 矩阵(已落地,dist 构建后用用户原始命令端到端复现修复通过)。
- 后续引入任何 CLI/解析类依赖时,选型验证清单加一条:未知 flag/缺值行为实测。
