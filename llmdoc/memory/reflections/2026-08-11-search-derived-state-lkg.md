# 反思:派生 SearchIndex 的 LKG、cursor 与最终一致同步边界

## Task

- Round 23 把 registry、provider tool cache 与 feedback 自动投影到 D1/SQLite SearchIndex，并加入加权检索、权限裁剪后的分页、dirty marker 修复和宿主预算约束。

## What Changed During Review

- 初版为保证 D1 rebuild 容量，把 SearchIndex 的快照限制放进 `NodeRegistryStore.write/update` 与 `getTools()`。严格负例证明这会让未启用 search 的普通 registry/provider 也拒绝合法数据；例如大工具表无法缓存。最终把限制退回 `SearchSynchronizer`/SearchIndex：canonical 写入、调用与缓存不因可选派生索引而收窄，超额节点只是不进入搜索投影。
- 初版 LKG 只保护 full rebuild。顺序写入 501 个节点仍可经 hot reconcile 把正式索引扩到 501；overflow 后还可能先无界扫描 dirty markers。最终补上 hot path 的 501-node 探针、数据库 membership trigger 和每类单一 `pending` marker，才形成完整的 bounded LKG。

## Durable Lesson

1. **派生视图不得反向定义 canonical contract。** SearchIndex 可丢弃、延迟或保留旧投影，但不能让索引的节点数、JSON1 载荷或 D1 query budget 成为 registry/provider 的写入与调用限制。容量降级必须表现为“canonical 仍可用，search 明确陈旧或排除超额项”，而不是主数据面报错。
2. **LKG 必须同时覆盖三条变化路径。** full rebuild 遇 truncated canonical snapshot 时保留正式索引；hot `replace` 前也要做同一 bounded audit，避免逐次写入绕过全量检查；D1/SQLite 再以 snapshot-path capacity trigger/事务约束并发 membership，关闭两个并发 replace 同时越界的竞态。只在应用层 preflight 不能构成容量不变量。
3. **overflow audit 自身也必须有界。** `ensureReady()` 先探测最多 501 个 canonical 节点，再决定是否读取 marker；node/subtree marker 各复用一个固定 key，不能让设备 hello 或失败重试生成无限 UUID 记录。未初始化且已 overflow 时 fail closed；已有索引则服务 LKG，等 canonical 恢复到预算内后由下一次审计自动收敛。
4. **marker 是恢复提示，不是正确性真源。** KV 没有跨 isolate 的传播完成确认；marker 可能提交失败、过早清除或先于 canonical 新视图可见。因此 mutation 前标脏、成功后提交 digest/清理只能加速与诊断，搜索前仍需以 canonical snapshot 做幂等审计。同 digest 不 bump revision，才能让反复审计既可恢复又不使 cursor 无故失效。
5. **cursor 必须在权限裁剪之后定义。** gateway 需要分批 over-fetch raw candidates、批量回读 registry、执行 `read + call` 与 virtualize，再从实际消费边界生成 continuation。若一页 raw 命中全部被拒绝，返回空 `items` 时必须省略 cursor；否则 cursor 本身会泄露隐藏结果仍存在及其大致数量。可见结果不足时继续扫描，但总 raw work、批次数和 hydrate bytes 都要封顶。
6. **预算公式必须落到宿主边界测试。** D1 cold path 把 schema、snapshot/source JSON1 chunks、四批 candidate、hydrate 与 cursor meta 明算为 48 queries，低于 Free 50；KV root audit、bulk `getMany`、marker scan和 registry hydrate也分别有固定上限。常量断言之外，还要用 400+ documents、100+ paths、oversized rows 与并发 insert 在真实 Miniflare/SQLite adapter 上验证公式没有漏项。
7. **严格负例和边界探针应参与设计，而不只是验收。** 125-tool provider、499+并发早排序写入、seed 后顺序 501 hot reconcile、marker commit 失败、延迟 KV 可见、D1 双 replace 竞态、全部 denied 的 500 candidates 等探针，分别揭露了 happy-path 测试看不到的反向限流、可操纵截断、LKG 穿透、最终一致恢复和 cursor 存在性泄露。

## Promotion Candidates

- 架构文档可明确：StateStore/registry 是 canonical，SearchIndex 是可重建派生状态；所有 search-only 容量和失败只能在投影边界降级。
- 验收指南可加入派生索引矩阵：canonical 无索引时不受限、full/hot/concurrent 三路 LKG、marker 有界恢复、权限后 cursor 空页、以及按真实宿主预算计算的边界探针。

## Evidence Boundary

- 当前本地 Memory/Miniflare D1/SQLite 证据已闭环实现与并发边界；registry 超过 500 时 search 保留旧数据是明确降级。未做真实 Cloudflare 部署验证前，不能把它升级为生产 KV/D1 最终一致性的实测保证。
