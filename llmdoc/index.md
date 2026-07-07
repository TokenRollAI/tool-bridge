# llmdoc 索引

> 用途:llmdoc 文档系统的全局地图(每类文档的职责 + 现有文档清单 + 路由提示)。每轮开场的有序阅读清单在 [startup.md](startup.md)。更新时机:任何 llmdoc 文档增删改名时同步本索引。

项目:tool-bridge——自描述、可反向注册、协议开放的工具与上下文网关(HTBP 参考实现)。**知识真源 = 代码 + llmdoc**;bootstrap 期规范与过程文档已归档 `archive/`(历史,不作规范)。

## must/ — 每轮必读的复发性上下文

- [must/project-brief.md](must/project-brief.md) — 项目定义、知识真源、七个 User Case、工程纪律(含选型表)、术语表精选。
- [must/current-state.md](must/current-state.md) — 部署资源、代码现状(五包 + 测试数)、常用命令、.env 凭据状态表、工具链、未竟事项路线图(易变,每轮更新)。

## overview/ — 项目形态与边界

- [overview/project-overview.md](overview/project-overview.md) — 痛点、核心主张、非目标、模块总览与落地状态、CF+Docker 部署形态、三入口对等。

## architecture/ — 所有权边界与不变量

- [architecture/modules-and-boundaries.md](architecture/modules-and-boundaries.md) — 全局模式(统一注册面/唯一判定入口/凭证不出网关/宿主注入点)、模块表(职责→代码落点)、依赖方向、存储分工、网关判定次序、注册通道、引导、Provider 边界细则、Dashboard 集成。

## reference/ — 稳定查表事实

- [reference/protocol-contract.md](reference/protocol-contract.md) — HTBP 契约查表:端点面、内容协商、TBError、Help DSL、数据模型、SK/注册路径规则、设备帧协议、Plugin 传输契约、CLI 命令矩阵。**引用接口契约先查这里。**
- [reference/v1-lessons.md](reference/v1-lessons.md) — v1 前代实现:保留资产、重写动机(现状)、文件级检索地图、踩坑结论。

## guides/ — 一事一篇的工作流

- [guides/deploy-and-verify.md](guides/deploy-and-verify.md) — 从零到线上验证:`pnpm verify` → `pnpm deploy:all` → curl 探活 → `pnpm smoke` → `tb status --json`,每步预期输出 + 排错(多账户歧义、custom domain 生效延迟)。
- [guides/workers-kv-pitfalls.md](guides/workers-kv-pitfalls.md) — Workers/KV 生产坑:KV list+get 最终一致窗口(须跳 null)、子请求上限约束逐 key get、吊销传播实测 0.3s、vitest-pool-workers 0.18 API 变更。
- [guides/do-websocket-hibernation.md](guides/do-websocket-hibernation.md) — DO hibernation WS 生产坑:边缘 ~100s 空闲掐断须客户端心跳保活、唤醒后内存状态机须从 storage 恢复(restoreReady)、本地 miniflare 测不出须线上跨休眠窗口验证。**改设备通道前必读。**
- [guides/npm-publish.md](guides/npm-publish.md) — @tool-bridge/cli 与 @tool-bridge/sdk 的 npm 发布:tsup bundle + dts 内联的包形态、tag 触发 CI(Trusted Publishing OIDC)、新包"手动首发+配 Trusted Publisher"两段式、EOTP/provenance E422 等坑。

## memory/ — 过程记忆

- [memory/doc-gaps.md](memory/doc-gaps.md) — llmdoc 文档缺口追踪(当前:Docker 宿主 guide、dashboard 开发 guide)。recorder 维护。
- `memory/decisions/`(空)— durable 设计/流程决策,recorder 维护。
- [memory/reflections/](memory/reflections/) — 历史反思(按日期,reflector 维护;记录当时事实,含已归档的阶段称谓属正常):
  - 2026-07-06-phase0-bootstrap — scratch 报告易丢需尽快内化、wrangler 多账户须显式 account、权限用真实操作核实、smoke 不读 .env。
  - 2026-07-06-phase2-closeout — 勾选不等于关门、opt-in 测试看退出码、代理/联邦要测出站边界、CLI 配置面对等。
  - 2026-07-06-phase4-device-ws-hibernation — 本地绿不代表 hibernation 正确、连环根因先取证后改码、验收标识符逐字核对、长驻进程验证管好生命周期。
  - 2026-07-07-sdk-dts-bundle-pitfall — tsup dts 对指向 .ts 源的 workspace 包不生效,须专用 tsconfig paths;类型自包含用隔离 tsc 验证。
  - 2026-07-07-npm-publish-sdk-cli — 2FA/EOTP 认证 URL 对 agent 脱敏须用户亲自 publish、新包两段式发布、git push SSL 抖动直接重试。
  - 2026-07-07-hatching-doc-restructure — 破壳重构教训:文档漂移靠实跑审计暴露、hook 自动暂存须核对暂存区再分块提交、批量删注释后先 lint:fix、运行时字符串引用与测试断言耦合。

## 路由提示

| 你要做的事 | 先读 |
|---|---|
| 每轮开场 | [startup.md](startup.md) 按序走 |
| 引用接口/错误码/CLI 命令 | reference/protocol-contract.md |
| 判断代码归属模块/依赖方向/存储选型 | architecture/modules-and-boundaries.md |
| 实现 v1 已解决过的机制 | reference/v1-lessons.md |
| 部署/线上验证/部署排错 | guides/deploy-and-verify.md |
| 写 KV 消费代码/排查 KV 一致性/vitest-pool-workers 配置 | guides/workers-kv-pitfalls.md |
| 改设备 WS 通道/排查设备离线/DO hibernation 行为 | guides/do-websocket-hibernation.md |
| 发 npm 新版本/新增可发布包/排查 CI 发布失败 | guides/npm-publish.md |
| 了解产品定位/非目标/模块落地状态 | overview/project-overview.md |
| 追溯 bootstrap 期规范原文/验收证据 | 仓库根 `archive/`(历史) |
