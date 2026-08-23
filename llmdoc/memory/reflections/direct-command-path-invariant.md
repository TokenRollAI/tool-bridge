# 直连命令路径不变量 Reflection

## Task

- 修复 device shell `exec` 的发现结果仍指向 owner 节点、未包含命令叶子的问题，并全面清理公开 HTBP 数据面残留的旧调用形态。
- 同轮核对命令级 help、Dashboard 实际调用与 CLI/curl 提示、真实 smoke 脚本，以及合法的 plugin/v2 内部信封边界。

## Expected vs Actual

- 预期：`~help` 的每个 `cmds[].path` 都是可直接调用的完整命令路径；Dashboard、CLI 和 curl 只需原样消费它，并以裸 arguments 发起 POST。
- 实际：device shell 的 `exec` 仍宣告 owner 路径，漏掉 `/exec`。同一个错误字段同时进入发现结果、Dashboard 真实调用、CLI 提示和 curl 示例，因此表面像旧 `--tool` 又出现，实质是命令身份从路径叶子丢失。
- 执行路由本身已只接受完整叶子路径，所以错误发现结果会稳定导向 404；手写正确 URL 的调用测试无法证明发现契约正确。

## What Went Wrong

- `cmds[].path` 被当成展示元数据，而不是贯穿“发现 → 帮助 → 调用 → 示例”的公共行为契约。device shell 漏掉统一补叶子的步骤后，多个消费者同时失真。
- core 测试把 owner 路径写成期望值，反向固定了错误；gateway 测试只匹配 `cmd exec POST` 的模糊子串，没有精确断言完整路径。
- 执行测试直接手写正确的 `/shell/exec`，绕过 `~help`，于是发现和执行各自为绿，却没有闭环。
- 旧信封否定用例一度只有正确直连请求和误导性标题，没有真实发送 owner 路径加 `{tool,arguments}`，因此没有钉住“旧入口必须 404”。
- compose/revocation 等真实 smoke helper 不在常规发现到执行测试链内，迁移后仍可编译，却继续生成旧 URL 和旧 body；只有消耗外部资源时才可能暴露语义漂移。

## Root Cause

- 缺少跨 kind 的不变量：owner 级 HelpModel 中，命令的 `path` 必须包含命令叶子，并能同时用于命令级 `~help` 与实际 POST。
- 验证按组件分割，检查了“help 有 exec”和“正确 URL 能执行”，却没有从 help 返回值驱动真实调用；测试断言也偏向标题、子串和手写 fixture，而非精确 wire。
- 协议审计没有先区分两个合法边界：公开 HTBP 数据面是 `POST /<node>/<command>` 加裸 arguments；平台到 plugin 的 plugin/v2 内部传输则是固定 endpoint 加 `{tool,arguments}`，其中 `tool` 是 plugin 方法。机械删除所有 `tool` 或信封既会漏掉公开路径漂移，也会误删合法内部协议。

## Validation Lesson

- 本轮定向覆盖了 device help/frame、Help DSL、Dashboard CLI/curl 提示，以及 gateway 的发现、调用和旧信封否定路径；全仓 verify、build、受影响公开产物重建、打包入口检查与仓库外干净安装均通过。
- 这些证据证明修复在源码、消费者和发布产物中一致，但不应被表述为真实生产上游验证；本轮不需要且未获授权访问真实外部资源。

## Missing Docs or Signals

- 协议 reference 虽说明“命令是虚拟叶子”，但还可以更明确：`cmds[].path` 是可执行的完整路径，不是 owner 定位或展示提示。
- 验证 guide 缺少统一的发现到执行闭环模板，也未要求 wire 迁移审计 smoke 脚本、示例和运维 helper。
- plugin/v2 的合法信封需要在协议导航中显式标成内部 wire，避免全仓搜索 `{tool,arguments}` 时产生错误修复范围。

## Promotion Candidates

- 提升到 `reference/protocol-contract.md`：明确 owner help 的每个 `cmds[].path` 必须是完整、可调用、可查询命令级 help 的叶子路径；公开 HTBP 与 plugin/v2 内部传输使用一张边界表区分 URL、body 和 `tool` 的含义。
- 提升到 `guides/verification-and-commit-practices.md`：wire 变更至少覆盖“读取 owner JSON help → 精确断言叶子 path → 用返回 path 和裸 arguments 调用 → 查询命令级 help”，并真实断言 owner 加旧信封被拒绝。
- 同一 guide 增加断言质量规则：路径和 body 用精确结构断言，不以标题、模糊子串或手写正确 URL 替代契约闭环。
- 同一 guide 增加可执行脚本审计：协议迁移必须检查 smoke、验证脚本和示例；优先抽出纯 URL/body 构造器做离线测试，或让本地 stub smoke 进入常规闸门，避免只能靠真实外部资源发现漂移。

## Follow-up

- 由 recorder 评估并把上述候选分别吸收到协议契约和验证指南；reflection 本身不承担稳定文档更新。
