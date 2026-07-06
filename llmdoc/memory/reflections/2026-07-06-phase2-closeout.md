# Phase 2 Closeout 反思(2026-07-06)

> 范围:Tool Layer(M2)关门质量关口。以下是本轮已验证的流程教训,用于后续 Phase 3+ 防止重复。

## 1. DoD 勾选不能替代关门审计

Round 6 已把 Phase 2 六项 DoD 全勾,但 Round 7 质量关口仍发现 remote `~tree` 未聚合远端子树、CLI 管理面缺 `virtualize.describe`/HTTP auth 形态、remote 出站 SK 行为缺直接测试、opt-in MCP 命令退出码曾失败。这说明"单项看起来完成"不等于 Phase 可关门。

**下轮怎么做**:Phase 3 每勾一个 DoD 项时同步写强证据;Phase 关门前必须按 DOD 每条做 evidence matrix,把"实现存在"、"测试覆盖"、"生产/opt-in 命令可重跑"分开判断。

## 2. opt-in 外部测试必须以退出码为准

MCP E2E 曾出现测试断言全过但 Vitest 因 SDK 后台 AbortError 退出码 1。只记录"测试 passed"会伪造进度。修复后命令退出码为 0,但 workerd 仍打印 SDK sourcemap/Network connection lost 诊断噪声。

**下轮怎么做**:外部资源/兜底服务测试只以完整命令退出码作为证据;有诊断噪声但退出码 0 时在 PROGRESS 写明,不要把 stderr 文本当失败或成功证据。

## 3. 联邦/代理类功能要测出站边界

只测白名单和环检测不足以证明 remote 契约。真正关键的是:本地调用者 SK 不外传、`skRef` 换发、远端响应原样透传、`~tree` 子树本地化。这些必须用 fake fetch/双实例或脚本直接断言。

**下轮怎么做**:凡是 M3 context/s3/r2 这类代理/存储边界,至少有一条测试断言"凭证/路径/版本/内容"在出站或存储层的真实形状,不能只断言入口返回 200。

## 4. CLI 对等要按配置面穷尽

Phase 2 代码层支持 `Virtualize.describe` 与 HTTP `authHeader/authScheme`,但 CLI 最初未暴露,形成"直接 API 可做、CLI 做不到"的管理旁路。

**下轮怎么做**:每新增 NodeConfig/ProviderConfig 字段时,同轮检查 CLI 的 mount/update 命令是否可设置;若刻意不暴露,必须在 Proto/DOD 或 PROGRESS 写明理由。

## Promotion Candidates

- 把 "Phase 关门 evidence matrix" 提升为 guide 或 LOOP 补充模板。
- Phase 3 Context Layer 开工前,先列出四动词/版本/大对象/CLI 字段的配置面对等矩阵。
