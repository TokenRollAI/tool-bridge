# llmdoc 索引

> 用途:llmdoc 文档系统的全局地图(每类文档的职责 + 现有文档清单 + 路由提示)。每轮开场的有序阅读清单在 [startup.md](startup.md)。更新时机:任何 llmdoc 文档增删改名时同步本索引。

项目:tool-bridge 重写(docs-only → Phase 0-7 实现)。规范真源是仓库根的 `docs/` 五份文档与 `DOD.md`/`LOOP.md`;llmdoc 是它们的压缩检索层,冲突时以原文为准。

## must/ — 每轮必读的复发性上下文

- [must/project-brief.md](must/project-brief.md) — 项目定义、七个 User Case、五份规范角色、纪律 0-4、术语表精选。
- [must/current-state.md](must/current-state.md) — 进度快照(Phase 0-3 完成 → Phase 4)、已部署资源、代码现状、常用命令、.env 凭据状态表、本机工具链、兜底路径(易变,每轮更新)。

## overview/ — 项目形态与边界

- [overview/project-overview.md](overview/project-overview.md) — 痛点、核心主张、非目标、M1-M10 一览、CF+Docker 部署形态、三入口对等。

## architecture/ — 所有权边界与不变量

- [architecture/modules-and-boundaries.md](architecture/modules-and-boundaries.md) — M1-M10 职责/依赖方向/宿主落地、统一注册面、凭证不出网关、KV/R2/DO/D1 分工、Phase→模块映射、Phase 1/2 实际文件边界。

## reference/ — 稳定查表事实

- [reference/proto-map.md](reference/proto-map.md) — Proto.md 章节检索地图(章节号→行号→接口)、数据模型、TBError、Help DSL、CLI 命令矩阵、内容协商、Phase 0 契约。**引用精确章节号先查这里。**
- [reference/v1-lessons.md](reference/v1-lessons.md) — v1 前代实现:保留资产、六大缺口、参考通道触发条件与检索现状。

## guides/ — 一事一篇的工作流

- [guides/deploy-and-verify.md](guides/deploy-and-verify.md) — 从零到线上验证:`pnpm verify` → `pnpm deploy:all` → curl 探活 → `pnpm smoke` → `tb status --json`,每步预期输出 + 排错(多账户歧义、custom domain 生效延迟)。
- [guides/workers-kv-pitfalls.md](guides/workers-kv-pitfalls.md) — Workers/KV 生产坑:KV list+get 最终一致窗口(须跳 null)、子请求上限约束逐 key get、吊销传播实测 0.3s、vitest-pool-workers 0.18 API 变更。
- [guides/do-websocket-hibernation.md](guides/do-websocket-hibernation.md) — DO hibernation WS 生产坑:边缘 ~100s 空闲掐断须客户端心跳保活、唤醒后内存状态机须从 storage 恢复(restoreReady)、本地 miniflare 测不出须线上跨休眠窗口验证。**改设备通道(deviceSession/deviceRuntime/core device)前必读。**

## memory/ — 过程记忆

- [memory/doc-gaps.md](memory/doc-gaps.md) — 实现注意(G4/G5)、已核实非矛盾(原 C4/C5/C6)、调查盲区、已处理记录(G1/G2/G3/G6)。
- `memory/decisions/`(空)— durable 设计/流程决策,recorder 维护。
- [memory/reflections/2026-07-06-phase0-bootstrap.md](memory/reflections/2026-07-06-phase0-bootstrap.md) — Phase 0 流程教训:scratch 报告易丢需尽快内化、后台 agent 靠产出文件轮询、wrangler 多账户须显式 account、权限用真实操作核实、smoke 不读 .env。reflector 维护。
- [memory/reflections/2026-07-06-phase2-closeout.md](memory/reflections/2026-07-06-phase2-closeout.md) — Phase 2 关门教训:DoD 勾选不等于关门、opt-in 测试看退出码、代理/联邦要测出站边界、CLI 配置面对等。reflector 维护。
- [memory/reflections/2026-07-06-phase4-device-ws-hibernation.md](memory/reflections/2026-07-06-phase4-device-ws-hibernation.md) — Phase 4 生产 blocker 排查教训:本地绿不代表 hibernation 正确、连环根因先取证后改码、验收标识符逐字核对、长驻进程验证管好生命周期。reflector 维护。

## 路由提示

| 你要做的事 | 先读 |
|---|---|
| 每轮开场 | [startup.md](startup.md) 按序走 |
| 引用接口/错误码/CLI 命令 | reference/proto-map.md |
| 判断代码归属模块/依赖方向/存储选型 | architecture/modules-and-boundaries.md |
| 实现 v1 已解决过的机制 | reference/v1-lessons.md |
| 部署/线上验证/部署排错 | guides/deploy-and-verify.md |
| 写 KV 消费代码/排查 KV 一致性或子请求上限/vitest-pool-workers 配置 | guides/workers-kv-pitfalls.md |
| 改设备 WS 通道/排查设备离线/DO hibernation 行为 | guides/do-websocket-hibernation.md |
| 改 docs 或怀疑规范矛盾 | memory/doc-gaps.md |
| 了解产品定位/非目标 | overview/project-overview.md |
