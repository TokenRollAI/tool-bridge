# 反思:Search capability 必须绑定真实宿主实现与网关后处理

## Task

- Round 20 为根级 `~search` 定义协议契约、可选 `SearchIndex` 注入和 `~describe` capability；D1/SQLite 的真实索引实现留待后续轮次。

## Risk Found

- 容易把“协议阶段”理解成只验证请求/响应形状，并让 fake `SearchIndex` 的结果直接穿透网关。这样本地契约测试会绿，但后续接入真实 D1/SQLite 时，索引中的 raw path、工具名、描述或 schema 可能暂态泄露给无 `read`/`call` 权限的调用者，或绕过 `hide`/`rename`/`prefix`/description override。
- capability 也不能是路线图承诺。若宿主尚未注入可用实现却提前声明 `search`，`~describe` 会公布一个实际不可调用的能力，协议发现面与运行面发生漂移。

## Durable Lesson

1. **capability 必须由真实注入驱动。** `SearchIndex` 缺省或未声明 `search` 时，`POST /~search` 与根 `GET /~describe` 都应 fail closed；`search:semantic` 只能在宿主确实实现并声明后出现，未声明的 mode 在调用索引前返回 `invalid_argument`。
2. **fake contract 仍要经过完整安全边界。** 即使测试注入只是 fake，gateway 也必须立即对 raw hit 执行目标 path 的 `read + call` 检查、registry 回读、tool-like kind/config 一致性校验和 `virtualizeTools` 后处理；节点消失、类型漂移、无权或工具被隐藏时一律过滤。这个契约先于 D1/SQLite 接线，可防止宿主替换带来短暂元数据泄露。
3. **外部规范与本地实现分账验收。** 本地保留段、gateway 契约测试和 protocol-contract 更新只能证明本仓实现；HTBP Draft 的外部仓库同步需要独立提交/PR 证据。外部动作仍 PENDING 时，不能因为本地测试全绿而勾选包含 Draft 同步的 DoD。

## Promotion Candidates

- recorder 可把“索引只产出 raw candidate，gateway 统一做授权、registry 回读与虚拟化”的边界提升到架构文档。
- 验收指南可增加“跨仓规范同步单列证据，不与本地代码完成合并计分”的检查项。

## Follow-up

- D1 与 SQLite 实现接线时继续复用同一 `SearchIndex` 契约，并用真实宿主测试证明 capability 只在实现存在时暴露。
- HTBP Draft 未取得外部变更证据前，Phase 4 对应 DoD 保持未勾选。
