# Startup:每轮开场阅读清单

> 用途:每轮被唤起的开发 Agent 的有序启动流程。只放阅读顺序与升级提示;全局文档地图见 [index.md](index.md)。

## MUST(按序读)

1. [must/project-brief.md](must/project-brief.md) — 项目是什么、五份规范角色、纪律、术语。
2. [must/current-state.md](must/current-state.md) — 进度、.env 凭据状态、工具链、兜底路径。

## 启动流程(接 LOOP 五步循环)

1. 读完上面两份 MUST 后,读根目录 [../LOOP.md](../LOOP.md)(每轮执行契约)——尤其纪律 0-4 与本轮所处步骤。
2. 读 [../DOD.md](../DOD.md) 中**当前 Phase 的章节**(当前:Phase 2,DOD.md:59-71)+ 通用验收规则(DOD.md:21-29)。
3. 读/创建根目录 `PROGRESS.md`(不存在则按 LOOP.md:85-93 的单轮输出格式创建),从中挑本轮唯一目标(一个未勾选 DoD 项)。

## 升级提示(按任务再读)

- 要引用接口契约/错误码/CLI 命令 → [reference/proto-map.md](reference/proto-map.md)。
- 要确认模块归属/依赖方向/存储分工 → [architecture/modules-and-boundaries.md](architecture/modules-and-boundaries.md)。
- 涉及 mcp 会话/虚拟化/多租户哈希/tree 环检测 → [reference/v1-lessons.md](reference/v1-lessons.md)(v1 参考通道)。
- 动手改 docs/ 或遇到疑似规范矛盾 → 先查 [memory/doc-gaps.md](memory/doc-gaps.md)(已核实的待修项与"已确认非矛盾"清单)。
- 写 KV 消费代码/配 vitest-pool-workers/排查 KV 一致性 → [guides/workers-kv-pitfalls.md](guides/workers-kv-pitfalls.md)。
- 有相关 `guides/` 或 `memory/reflections/` 时在计划前读(清单见 [index.md](index.md))。
