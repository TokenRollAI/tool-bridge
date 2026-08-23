# llmdoc 索引

`llmdoc/` 只记录当前仍有效、可复用的项目知识。实现与文档冲突时以代码为准，并在同轮修正文档。提交、发布与一次性环境证据留在 Git、PR 和 CI，不在这里维护第二份历史。

## 会话入口

1. 读 [startup.md](startup.md)。
2. 必读 [project-brief.md](must/project-brief.md) 与 [current-state.md](must/current-state.md)。
3. 按任务选择下表中的最小文档集。

## 路由

| 任务 | 文档 |
|---|---|
| 产品定位、技术选型、长期约束 | [must/project-brief.md](must/project-brief.md) |
| 当前阶段、近期重点、验收入口 | [must/current-state.md](must/current-state.md) |
| 用户能力、部署形态与公共文档边界 | [overview/project-overview.md](overview/project-overview.md) |
| 包职责、依赖方向、宿主注入 | [architecture/modules-and-boundaries.md](architecture/modules-and-boundaries.md) |
| 文件与符号导航 | [architecture/code-map.md](architecture/code-map.md) |
| 插件目录、binding 与外部注册 | [architecture/plugin-runtime.md](architecture/plugin-runtime.md) |
| 全局工具搜索 | [architecture/search.md](architecture/search.md) |
| Dashboard 数据流与表单边界 | [architecture/dashboard.md](architecture/dashboard.md) |
| 认证、密钥、出站与日志边界 | [architecture/security-boundaries.md](architecture/security-boundaries.md) |
| HTBP、节点、builtin、CLI 契约 | [reference/protocol-contract.md](reference/protocol-contract.md) |
| CLI 参数与三入口对等 | [guides/cli-argument-contract-review.md](guides/cli-argument-contract-review.md) |
| Linux 设备 daemon 安装与生命周期 | [guides/device-daemon.md](guides/device-daemon.md) |
| Agent Skill 接入、feedback 工作流与验收 | [guides/agent-skill-integration.md](guides/agent-skill-integration.md) |
| 插件设计、迁移和三道闸门 | [guides/plugin-design-and-migration.md](guides/plugin-design-and-migration.md) |
| 本地/CI/真实环境验证 | [guides/verification-and-commit-practices.md](guides/verification-and-commit-practices.md) |
| Cloudflare 初始化、部署和验收 | [guides/deploy-and-verify.md](guides/deploy-and-verify.md) |
| Node、Docker、Compose 与 Kubernetes | [guides/docker-host.md](guides/docker-host.md) |
| npm 版本与发布 | [guides/npm-publish.md](guides/npm-publish.md) |
| MCP 外部协议兼容 | [guides/mcp-upstream-pitfalls.md](guides/mcp-upstream-pitfalls.md) |
| Durable Object WebSocket | [guides/do-websocket-hibernation.md](guides/do-websocket-hibernation.md) |

## 本轮 reflection

| 主题 | 文档 |
|---|---|
| 公共站点独立仓库与 CI 启动 | [memory/reflections/public-site-bootstrap.md](memory/reflections/public-site-bootstrap.md) |
| 公共站点任务化重构与契约校对 | [memory/reflections/public-site-redesign.md](memory/reflections/public-site-redesign.md) |
| 公共站点自动发布与切页性能 | [memory/reflections/public-site-delivery-performance.md](memory/reflections/public-site-delivery-performance.md) |
| Agent Skill 接入与 feedback 异常闭环 | [memory/reflections/agent-skill-bootstrap.md](memory/reflections/agent-skill-bootstrap.md) |
| CLI registry tarball 的工作区依赖协议泄漏 | [memory/reflections/cli-registry-catalog-dependency.md](memory/reflections/cli-registry-catalog-dependency.md) |
| Linux 设备 daemon 产品化 | [memory/reflections/device-daemon.md](memory/reflections/device-daemon.md) |
| SDK device 多运行时边界 | [memory/reflections/sdk-device-runtime-boundary.md](memory/reflections/sdk-device-runtime-boundary.md) |
| 多副本部署产品化与 CF 发布路径合流 | [memory/reflections/multi-deploy-productionization.md](memory/reflections/multi-deploy-productionization.md) |
| Cloudflare D1 Sessions、Placement 与延迟诊断 | [memory/reflections/cloudflare-d1-performance.md](memory/reflections/cloudflare-d1-performance.md) |
| Dashboard 能力树与 Context 详情交互 | [memory/reflections/dashboard-tree-context-ui.md](memory/reflections/dashboard-tree-context-ui.md) |
| 直连命令路径不变量与 wire 闭环 | [memory/reflections/direct-command-path-invariant.md](memory/reflections/direct-command-path-invariant.md) |

## decision

| 主题 | 文档 |
|---|---|
| Cloudflare 权威状态 KV→D1(accepted,已实施) | [memory/decisions/adr-001-kv-to-d1-authoritative-state.md](memory/decisions/adr-001-kv-to-d1-authoritative-state.md) |

## 维护边界

- `must/` 不记录精确版本、测试数、URL、资源 ID、登录状态或某台机器的工作树。
- `architecture/` 只描述当前 ownership 和不变量，不写实施轮次。
- `guides/` 只保留可重跑流程与会复发的坑。
- `reference/` 只保留当前契约，不兼任 changelog。
- reflection 是更新过程中的临时输入；稳定知识吸收完成后删除，不长期积累 `memory/`。
