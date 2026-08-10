# 反思:Search 宿主 adapter 的 capability、预算与查询语法边界

## Task

- Round 21 为 Cloudflare D1 与 Node SQLite 实现同一 `MutableSearchIndex`，并分别接入 Worker binding 与 Node server 的第五宿主注入点。

## Risk Found

- 只测 adapter 会漏掉 Env/binding/deps 接线错误；只测 HTTP wire 又难以证明 replace/remove/rebuild、持久化和宿主预算等细粒度契约。
- 复用 Context 的宽 `SearchOptions` 看似省类型，却会提前承诺尚未实现的 limit/cursor/filter。SQL 使用 bind 参数也不代表 FTS5 安全：`MATCH ?` 的绑定值仍会被 FTS grammar 再解析，NUL 等输入不能靠 SQL 参数化兜底。

## Durable Lesson

1. **Cloudflare capability 必须沿真实资源链暴露。** `wrangler` 声明 binding 只是部署配置；只有运行时 `env.TB_SEARCH` 实际存在并构造 `D1SearchIndex` 后，才能向 `TbAppDeps` 注入并声明 `search`。library host 省略可选 binding 时，`~describe`/`~search` 应继续 404，不能用配置意图冒充可用能力。
2. **平台预算需要 adapter contract 与 wire test 双证据。** 共享 contract 锁定 D1/SQLite 的 mutation/search 一致性，宿主专用测试锁定 D1 参数/批次上限及超限前拒绝；真实 `SELF`/HTTP wire 再证明 binding → adapter → gateway → capability/结果的接线成立，并验证候选上限没有在传输层失效。两层缺一都不能证明宿主能力完整可用。
3. **接口只暴露当前兑现的最小 opts。** 全局工具搜索当前只收 `mode`，应使用窄 `ToolSearchOptions`；分页、cursor、filter 等到对应 DoD 实现和测试就绪后再扩展。提前复用更宽类型会把“编译可传”误写成协议承诺，也容易让 adapter 静默忽略参数。
4. **参数绑定只隔离 SQL grammar，不隔离 FTS grammar。** FTS 查询必须先转换为 literal phrase、转义双引号并拒绝 NUL/空查询，再作为 bind 参数交给 `MATCH`。所有嵌套 DSL、正则、JSONPath 或搜索表达式都应按同一原则审计：参数化解决外层语言注入，内层语言仍需独立校验。

## Promotion Candidates

- recorder 可在架构文档补充“可选 binding → adapter 构造成功 → deps 注入 → capability 暴露”的完整链路。
- 验收指南可加入“跨宿主 adapter contract + 各宿主 wire test”矩阵，以及“参数绑定不等于嵌套查询语言安全”的输入审查项。

## Evidence Boundary

- 本地 workerd/SQLite 证据可证明实现与接线；未执行真实 Cloudflare provision/deploy 时，仍不能把这些测试记作生产 D1 可用证据。
