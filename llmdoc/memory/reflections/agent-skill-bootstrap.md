# Agent Skill 接入反思

## 任务

- 新建 `TokenRollAI/tool-bridge-skill`，参考通用 skill 接入方式，让 Agent 通过运行时 `~help` / `~search` 发现能力，而不是维护易过期的静态工具目录。

## Expected vs Actual

- 预期 skill 同时覆盖工具发现、调用和 feedback 闭环。
- 初版把 feedback 放在任务末尾；用户纠正后，闭环改为调用前消费已有 feedback、异常时立即查询并应用、验证恢复后及时投票，并对新 feedback 去重提交。

## What Went Wrong

- 第一次异常前向测试没有真正进入失败路径：工具 schema 足够清晰，Agent 首次调用即成功，因此不能证明 feedback 能帮助恢复。
- 第二次测试通过强制首调异常，才覆盖“失败 → 查询 feedback → 调整调用 → 验证成功 → 投票/提交”的完整恢复链路。

## Root Cause

- 初版把 feedback 误解为任务后的复盘动作，而不是调用生命周期中的实时控制信号。
- 测试只描述“可能失败”不足以稳定触发异常路径；恢复机制需要可控、可重复的故障注入。

## Missing Docs or Signals

- skill 规范应明确 feedback 的时序、触发条件、验证门槛与去重规则。
- feedback 恢复测试应要求确定性的首次失败，避免用一次自然成功误判闭环已被覆盖。

## Promotion Candidates

- 稳定指南可固化四条原则：运行时发现优先；调用前先消费相关 feedback；异常发生后立即查用；仅在验证结果后及时投票，并对新提交做语义去重。
- 对 feedback 驱动流程设置确定性故障注入测试，验收完整恢复链路，而不只验收最终调用成功。

## Follow-up

- 后续由 stable docs 的维护者判断是否将上述原则提升到 Agent skill 设计与验收指南。
