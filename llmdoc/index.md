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
- [architecture/code-map.md](architecture/code-map.md) — 代码检索地图:"要改 X 去哪个文件",按包→目录/文件族→关键符号。**动代码前先查这里。**

## reference/ — 稳定查表事实

- [reference/protocol-contract.md](reference/protocol-contract.md) — HTBP 契约查表:端点面、内容协商、TBError、Help DSL、数据模型、SK/注册路径规则、设备帧协议、Plugin 传输契约、CLI 命令矩阵。**引用接口契约先查这里。**
- [reference/v1-lessons.md](reference/v1-lessons.md) — v1 前代实现:保留资产、重写动机(现状)、文件级检索地图、踩坑结论。

## guides/ — 一事一篇的工作流

- [guides/deploy-and-verify.md](guides/deploy-and-verify.md) — 从零到线上验证:`pnpm verify` → `pnpm deploy:all` → curl 探活 → `pnpm smoke` → `tb status --json`,每步预期输出 + 排错(多账户歧义、custom domain 生效延迟)。
- [guides/workers-kv-pitfalls.md](guides/workers-kv-pitfalls.md) — Workers/KV 生产坑:KV list+get 最终一致窗口(须跳 null)、子请求上限约束逐 key get、吊销传播实测 0.3s、vitest-pool-workers 0.18 API 变更。
- [guides/do-websocket-hibernation.md](guides/do-websocket-hibernation.md) — DO hibernation WS 生产坑:边缘 ~100s 空闲掐断须客户端心跳保活、唤醒后内存状态机须从 storage 恢复(restoreReady)、本地 miniflare 测不出须线上跨休眠窗口验证。**改设备通道前必读。**
- [guides/mcp-upstream-pitfalls.md](guides/mcp-upstream-pitfalls.md) — MCP 上游生产坑:会话复用机制(mcpsession KV 无 TTL + 400/404 失效信号)、不合规上游对过期会话回 200+空列表(实测 MetaMCP)与空列表防御、生产可重跑排查手法(refresh=1 区分缓存层、幂等 update 强制重握手、塞伪 session 复现)。**挂载/排查 mcp 上游前必读。**
- [guides/npm-publish.md](guides/npm-publish.md) — cli / sdk / gateway / dashboard 四包的 npm 发布:tsup bundle + dts 内联(paths 映射 + 隔离 tsc 验证)、publishConfig 覆盖模式(pnpm pack + publish tarball)、tag 触发 CI(Trusted Publishing OIDC)、新包"手动首发+配 Trusted Publisher"两段式、EOTP/provenance E422 等坑。
- [guides/verification-and-commit-practices.md](guides/verification-and-commit-practices.md) — 验证与提交纪律:证据矩阵、收尾同轮更新 current-state、配置面对等、出站边界测试、opt-in 退出码、长驻进程与跨休眠验证、先取证后改码、批量清理后 lint:fix、pathspec 提交与 hook 自动暂存防污染。

## memory/ — 过程记忆

- [memory/doc-gaps.md](memory/doc-gaps.md) — llmdoc 文档缺口追踪(当前无缺口)。recorder 维护。
- `memory/decisions/` — durable 设计/流程决策,recorder 维护。现存:
  - [memory/decisions/plugin-hosted-install.md](memory/decisions/plugin-hosted-install.md) — 2026-07-07:Plugin 托管化安装(插件市场),CF 宿主经 scoped API token 自动部署;多挂载扩展 CallContext(`mountPath`/`mountConfig`);手动 register 通道保留。
- `memory/reflections/` — 新反思写此目录(reflector 维护),定期把 durable 教训提炼进 guides 后归档。现存:2026-07-07 gateway/dashboard 可发布化(publishConfig 覆盖、隔离 tsc 环境坑)。bootstrap 期存量反思已提炼完毕并归档至 `archive/llmdoc-reflections/`。

## 路由提示

| 你要做的事 | 先读 |
|---|---|
| 每轮开场 | [startup.md](startup.md) 按序走 |
| 改代码找文件/符号 | architecture/code-map.md |
| 引用接口/错误码/CLI 命令 | reference/protocol-contract.md |
| 判断代码归属模块/依赖方向/存储选型 | architecture/modules-and-boundaries.md |
| 功能收尾验收/真实环境验证/批量改动/提交 | guides/verification-and-commit-practices.md |
| 实现 v1 已解决过的机制 | reference/v1-lessons.md |
| 部署/线上验证/部署排错 | guides/deploy-and-verify.md |
| 写 KV 消费代码/排查 KV 一致性/vitest-pool-workers 配置 | guides/workers-kv-pitfalls.md |
| 改设备 WS 通道/排查设备离线/DO hibernation 行为 | guides/do-websocket-hibernation.md |
| 挂载 mcp 上游/排查 mcp 节点工具消失或会话异常 | guides/mcp-upstream-pitfalls.md |
| 发 npm 新版本/新增可发布包/排查 CI 发布失败 | guides/npm-publish.md |
| 了解产品定位/非目标/模块落地状态 | overview/project-overview.md |
| 追溯 bootstrap 期规范原文/验收证据 | 仓库根 `archive/`(历史) |
