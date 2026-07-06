# llmdoc 索引

> 用途:llmdoc 文档系统的全局地图(每类文档的职责 + 现有文档清单 + 路由提示)。每轮开场的有序阅读清单在 [startup.md](startup.md)。更新时机:任何 llmdoc 文档增删改名时同步本索引。

项目:tool-bridge 重写(docs-only → Phase 0-7 实现)。规范真源是仓库根的 `docs/` 五份文档与 `DOD.md`/`LOOP.md`;llmdoc 是它们的压缩检索层,冲突时以原文为准。

## must/ — 每轮必读的复发性上下文

- [must/project-brief.md](must/project-brief.md) — 项目定义、七个 User Case、五份规范角色、纪律 0-4、术语表精选。
- [must/current-state.md](must/current-state.md) — 进度快照、.env 凭据状态表、本机工具链、兜底路径(易变,每轮更新)。

## overview/ — 项目形态与边界

- [overview/project-overview.md](overview/project-overview.md) — 痛点、核心主张、非目标、M1-M10 一览、CF+Docker 部署形态、三入口对等。

## architecture/ — 所有权边界与不变量

- [architecture/modules-and-boundaries.md](architecture/modules-and-boundaries.md) — M1-M10 职责/依赖方向/宿主落地、统一注册面、凭证不出网关、KV/R2/DO/D1 分工、Phase→模块映射。

## reference/ — 稳定查表事实

- [reference/proto-map.md](reference/proto-map.md) — Proto.md 章节检索地图(章节号→行号→接口)、数据模型、TBError、Help DSL、CLI 命令矩阵、内容协商、Phase 0 契约。**引用精确章节号先查这里。**
- [reference/v1-lessons.md](reference/v1-lessons.md) — v1 前代实现:保留资产、六大缺口、参考通道触发条件与检索现状。

## guides/ — 一事一篇的工作流(当前为空)

实现中沉淀出可复用工作流(如部署排错、E2E 跑法)时由 recorder 补。

## memory/ — 过程记忆

- [memory/doc-gaps.md](memory/doc-gaps.md) — 需回写项(G3 healthz)、实现注意(G4/G5)、已核实非矛盾(原 C4/C5/C6)、调查盲区(G6 v1 未检索)、已处理记录(G1/G2 已修,commit 0d48b06)。
- `memory/decisions/`(空)— durable 设计/流程决策,recorder 维护。
- `memory/reflections/`(空)— 流程反思,reflector 维护。

## 路由提示

| 你要做的事 | 先读 |
|---|---|
| 每轮开场 | [startup.md](startup.md) 按序走 |
| 引用接口/错误码/CLI 命令 | reference/proto-map.md |
| 判断代码归属模块/依赖方向/存储选型 | architecture/modules-and-boundaries.md |
| 实现 v1 已解决过的机制 | reference/v1-lessons.md |
| 改 docs 或怀疑规范矛盾 | memory/doc-gaps.md |
| 了解产品定位/非目标 | overview/project-overview.md |
