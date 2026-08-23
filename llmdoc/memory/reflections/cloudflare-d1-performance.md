# 反思：Cloudflare D1 延迟与 Sessions 接入

任务：修复 Workers 上的秒级延迟风险，接入 D1 Sessions/read replication，并补齐 Placement 与可观测性。

## 教训与发现

1. **`withSession()` 的正确粒度是请求，不是 Store 方法。** 每个 `get` 各建 session 会让每次权威读都重新命中 primary，几乎没有复制收益；把 session 缓存在 isolate/DO 上又会跨请求复用 bookmark 与 I/O 对象。主 Worker 因此按 HTTP 请求创建 State/Search session，schema gate 与编译期 plugin binding 才按 isolate 复用。

2. **派生状态也不能忽略 schema 复制窗口。** State 含 SK、权限和节点权威状态，首查询必须 `first-primary`。Search 虽是可重建派生索引，但 schema 首次惰性创建后立即用 `first-unconstrained` 可能命中尚无新表的副本；最终 Search 同样从 primary 起步，后续查询再由满足 bookmark 的副本服务。

3. **启用 D1 read replication 与使用 Sessions 是两道独立开关。** 只开数据库复制、代码仍直接用 `D1Database.prepare()`，查询继续落 primary；只改代码但未在 D1 Settings 启用复制，语义正确但没有副本收益。Wrangler 当前没有启用复制的命令，源码 provision 只能明确提醒 Dashboard 操作，不能假装已完成。

4. **Smart Placement 对 API 与静态资源有相反取舍。** 所有鉴权请求至少有一次权威 D1 访问，Worker 靠近主要后端可减少请求内重复跨区往返；但当前 `/ui` 因 `run_worker_first=true` 也经过 Worker，Smart Placement 可能增加纯静态资源 TTFB。未拆出 edge-first UI Worker 前，配置明确选择核心 API 延迟优先。

5. **SQL 执行时间不能解释网络延迟。** D1 `meta.timings.sql_duration_ms` 不含网络；请求级观测同时记录 D1 wall time、SQL time、`served_by_region`、`served_by_primary` 和调用数。响应 `Server-Timing` 便于客户端量化，超过阈值的结构化日志不记录 SQL、key、参数或返回值，避免性能诊断泄密。

6. **兼容日期不能机械推进到当天。** 首次设置 `2026-08-23` 后，仓库锁定的 workerd 只支持到 `2026-07-08`，所有 Miniflare 测试在启动前失败。兼容日期最终与可验证运行时上限对齐；工具链升级后再同步推进，而不是牺牲本地验收。

## 已提升为稳定知识

- Cloudflare 请求级 Sessions、一致性分层、Read Replication 开关、Placement 取舍与诊断方法进入 `guides/deploy-and-verify.md`。
- D1 权威状态决策的延迟缓解从“待实现”更新为当前 Sessions/Placement/观测形态，进入 ADR-001。
- Cloudflare 当前实现摘要进入 `must/current-state.md`。
