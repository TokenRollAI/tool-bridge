# Startup:每轮开场阅读清单

> 用途:开发 Agent 的有序启动流程。只放阅读顺序与升级提示;全局文档地图见 [index.md](index.md)。

## MUST(按序读)

1. [must/project-brief.md](must/project-brief.md) — 项目是什么、知识真源、工程纪律、术语。
2. [must/current-state.md](must/current-state.md) — 部署、代码现状、凭据状态、工具链、未竟事项。

## 升级提示(按任务再读)

- 要动代码、找"X 在哪个文件" → [architecture/code-map.md](architecture/code-map.md)。
- 要引用接口契约/错误码/CLI 命令 → [reference/protocol-contract.md](reference/protocol-contract.md)。
- 要新增/修改 CLI 参数、分页命令或 Provider 分支 → [guides/cli-argument-contract-review.md](guides/cli-argument-contract-review.md)。
- 要确认模块归属/依赖方向/存储分工/网关判定次序 → [architecture/modules-and-boundaries.md](architecture/modules-and-boundaries.md)。
- 功能收尾验收/真实环境验证/批量改动/提交 → [guides/verification-and-commit-practices.md](guides/verification-and-commit-practices.md)。
- 涉及 mcp 会话/虚拟化/多租户哈希/tree 环检测的前代经验 → [reference/v1-lessons.md](reference/v1-lessons.md)。
- 部署/线上验证/部署排错 → [guides/deploy-and-verify.md](guides/deploy-and-verify.md)。
- 写 KV 消费代码/配 vitest-pool-workers/排查 KV 一致性 → [guides/workers-kv-pitfalls.md](guides/workers-kv-pitfalls.md)。
- 改设备 WS 通道(deviceSession/deviceRuntime/core device)/排查设备离线 → [guides/do-websocket-hibernation.md](guides/do-websocket-hibernation.md)。
- 挂载 mcp 上游/排查 mcp 节点工具消失或会话异常 → [guides/mcp-upstream-pitfalls.md](guides/mcp-upstream-pitfalls.md)。
- 发 npm 新版本/新增可发布包 → [guides/npm-publish.md](guides/npm-publish.md)。
- 有相关 `guides/` 或 `memory/reflections/` 时在计划前读(清单见 [index.md](index.md))。
- 需要追溯 bootstrap 期的规范原文、验收证据或历史反思 → 仓库根 `archive/`(历史,不作规范)。
