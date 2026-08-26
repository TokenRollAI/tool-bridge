# Search 重构与嵌套联邦查询实现说明

状态：实现与仓库级验证完成
日期：2026-08-26
范围：keyword search、compact discovery、remote path projection、递归联邦搜索与续页

## 1. 结论

本轮没有只调字段权重，而是把 Search 拆成了三条边界清晰的执行路径：

```text
HTTP / MCP / SDK / CLI / Dashboard
                  │
                  ▼
          strict search wire
                  │
          ┌───────┴────────┐
          ▼                ▼
  LocalSearchSource   FederatedSearchCoordinator
          │          ├─ local source
          │          └─ direct remote sources
          │                    │
          └──── canonical projection / hydration
                               │
                               └─ child 递归查询自己的 direct remotes
```

当前实现已经支持 A 挂载 B、B 再挂载 C 的 root search。A 返回的 C 工具路径是 A
视角下的本地路径，并可继续用于 A 上的 `~help` 和 call。联邦不是把 remote catalog
镜像进父节点索引，而是逐跳、按请求递归协调。

核心行为变化：

- keyword 排名升级为 `keyword-v2`：distinct logical-term coverage 绝对优先；
- 默认页从 50 降到 10，默认结果为 compact，不再批量携带 schema；
- 新增 `matching`、`minCoverage`、`pathPrefix`、`effects`、`detail`、`federation`；
- 具备稳定 `TB_INSTANCE_ID`、原子 CAS 和 revisioned index 时，新查询默认 recursive；
- 联邦 cursor 是固定 37 字符的服务端 session handle，不随层数和 source 数增长；
- 每次续页递归验证所有已参与 child 的 revision/topology snapshot；
- remote 自动跳转已 fail closed，联邦 I/O 具备 deadline、响应 byte cap 和受控错误。

## 2. 为什么原实现不好用

旧 keyword search 是“任一派生 query unit 命中即可召回，再把字段分数相加”：

```text
name=10, path=5, description=3, feedback=1
```

它没有要求一个候选覆盖多少个不同 query term。因此，名称里强命中 `temperature`
的写工具可能压过同时表达 `read/current/home` 的读取入口；`--limit` 只能截断这个顺序，
无法把被噪声挤到后面的正确工具找回来。默认 50 条且每条带完整 schema，又把排序噪声
直接放大为 agent 上下文成本。

原搜索也完全是本地的：同步器不索引 `remote`，root `~search` 不做远端 I/O，嵌套
`~help/~tree` 返回路径没有完整外层 rebase。因此，A→B→C 在“已知 path 的 call”之外
并未形成 discovery → describe → invoke 的闭环。

## 3. 竞品取舍

OpenConnector 的 MiniSearch 方案证明了两点值得采用：

- discovery 应返回 compact action reference，schema/guide 按需获取；
- source/service 过滤应在搜索阶段完成，而不是拿到长结果后再裁剪。

本实现没有照搬 always-on OR、prefix、fuzzy 或把 BM25/raw score 直接用于联邦排序。
这些方法能改善单语料库相关性，却不能保证“覆盖更多意图词的候选一定更靠前”，不同
gateway 的 raw score 也没有可比性。Meilisearch 式的分层排序思路更适合当前问题：
先冻结 coverage 桶，再在桶内比较本 source 的字段质量。

## 4. 本地 keyword-v2

### 4.1 确定性的 logical terms

`prepareToolSearchQuery` 只由 raw query 与代码版本确定计划：

- Unicode/空白归一化后按 whitespace 得到 logical terms；
- ASCII 大小写重复 term 去重；
- 每个 term 保留 whole-term unit；
- 1–2 字符 ASCII 字母数字 term 不能仅凭 path substring 获得 coverage，避免 `on` 命中
  `contract`、`to` 命中 `tools`；name/description/feedback 仍可正常命中；
- CJK term 可派生 script run、bigram 和单码点 fallback；
- 所有派生 unit 始终带原 logical term ID，不能重复增加 coverage；
- query 最多 32 个 logical terms、98 个检索 units，并受 LIKE pattern byte cap 约束。

当前没有把实例级 alias/synonym 加进 query plan，因此 A、B、C 从同一 raw query
独立重算时天然得到相同 `totalTermCount`。父节点还会拒绝 child 返回的 ranking version、
分母或 coverage 比例不一致的 evidence。

### 4.2 排序契约

三种 SQL 宿主共用同一查询生成器：

```text
matchedDistinctLogicalTerms DESC,
sum(bestFieldScorePerLogicalTerm) DESC,
path ASC,
name ASC
```

字段分仍为 name/path/description/feedback = 10/5/3/1，并乘派生 unit tier；但每个
`(tool, logicalTermId)` 只保留最佳一次命中。字段质量只能打破同 coverage 桶内的平局，
不能让少覆盖一个 term 的候选反超。

索引升级为 v5，新增结构化 `effect` 列。`unknown` 不被猜成 read；effect 只响应显式
filter，不从自然语言或 prose 推断执行安全性。

当前刻意未实现 phrase/order、IDF、typo/fuzzy、alias、preferred priority 和
`matchedTerms/matchedFields`。这些属于后续质量迭代，不能在现有 wire 或验收中宣称存在。

### 4.3 matching、filter 与 cursor

- `matching: "best"`（默认）：一页只返回当前最高的非空 coverage band，不用低档结果填满；
- `matching: "all"`：要求 coverage=1；若同时给 `minCoverage`，只能为 1；
- `minCoverage`：在候选分页前转换为所需最少 distinct term 数；
- `pathPrefix`：按完整 path segment 在 SQL candidate 阶段过滤；
- `effects`：在 SQL candidate 阶段按结构化枚举过滤；
- local cursor v2 绑定 normalized query、mode、ranking version、index revision、offset 和
  所有会影响结果集/顺序的 options；任一绑定变化都 fail closed。

默认 limit 是 10，public max 为 200；单次 adapter batch 上限 100，route 级 raw candidate
work limit 为 400。最大 200 是兼容上限，不代表调用方应把 broad query 当批量 catalog API。

## 5. Compact discovery 与入口对等

默认 `detail: "compact"` 返回：

```json
{
  "path": "home/home-assistant",
  "tool": {
    "name": "get_live_context",
    "description": "...",
    "effect": "read"
  },
  "relevance": {
    "rankingVersion": "keyword-v2",
    "matchedTermCount": 4,
    "totalTermCount": 4,
    "coverage": 1
  },
  "source": { "path": "" }
}
```

compact 会移除 input/output schema，并把 description 限制在 1 KiB UTF-8。显式
`detail: "full"` 才在返回前从 canonical registry/provider 状态重新水合完整 ToolSpec；
单页最终仍受 4 MiB 限制。更推荐 agent 先 search，再对一两个命中使用 `~help`。

同一 wire 已接入：

- HTTP `POST /~search` 与 OpenAPI；
- MCP `tb_search`；
- SDK client；
- CLI `tb search`（含 `--federation`、`--matching`、`--min-coverage`、
  `--path-prefix`、可重复 `--effect`、`--schemas`）；
- Dashboard filter、coverage/effect/source/partial 展示。

## 6. 嵌套联邦模型

### 6.1 逐跳递归，不扁平抓全树

每个 gateway 只枚举自己 registry 中的 direct remote mounts：

```text
A POST /~search
├─ A local
└─ B POST /~search             X-TB-Via: A
   ├─ B local
   └─ C POST /~search          X-TB-Via: A,B
      └─ C local
```

source budget 在父层确定性分片后下发，child 不能重新获得一份完整预算。direct children
在每跳的并发上限内并行；所有后代共享逐跳递减的剩余时间和绝对 session expiry。

具备以下三项时才广告 `search:federated`：

1. 已显式配置稳定的 `TB_INSTANCE_ID`；
2. StateStore 实现原子 `compareAndSwap`；
3. SearchIndex 实现 `revision()`。

缺少任一项时仍提供 local search，但显式 recursive 请求会被拒绝。升级前产生、可识别为
local 的旧 cursor 仍按 local 续页，避免默认行为切换破坏在途分页。

### 6.2 skRef 与 source 选择

联邦 remote 必须声明 `skRef`，并且 secret 在本次查询开始时能成功解析：

- 未声明 `skRef`：source 状态为 `unsupported`，不出站；
- 已声明但 secret 缺失/不可解析：状态为 `unavailable`，不出站；
- 不可用 source 不占有限的可参与 remote slot；
- 每一跳只发送该 remote 自己的 service credential，终端调用者 SK 不跨 gateway；
- parent 先检查 caller 对 mount 的 `read+call`，child 返回后再检查每个 localized hit；
- 每次续页重新解析当前 registry、allowlist、secret 和 caller scopes。

### 6.3 路径投影和不可信 child 响应

`RemotePathProjector` 被 search、help、tree 共用。child path 进入父层前必须：

- 为 lowercase canonical tree path；
- 不含首尾 `/`、`.`/`..`、保留段、反斜线、控制字符、query/fragment；
- 不含任何可被 URL decode 成别名的 percent encoding；
- node/command/source path 不能逃出当前 mount；
- tool name 不能包含 `/` 或非 canonical 别名；
- search page 必须符合严格 schema、最多返回请求的一个 source item、evidence 自洽。

投影后，父层对 A 视角的 path 再执行权限与 hard filters。由此 C 的
`home/home-assistant` 会依次变成 B 的 `inner/home/home-assistant` 和 A 的
`outer/inner/home/home-assistant`；A 上的 `~help` 返回同样 localized 的 command path。

### 6.4 跨 source merge

跨 source 只比较协议级 `coverage`。每个 source 自己保证桶内有序，coverage 相同时由
coordinator 做 source-balanced interleave，再以稳定 source path 打破平局。child 的 raw
SQL score、catalog size 或未来的 curated priority 不跨 source 直接比较。

`matching: "best"` 为确定全局最高 coverage band，必须等所有纳入 source 返回首 hit、
确认 exhausted 或达到 deadline。第一版选择“分页稳定优先”：首页失败的 source 在整个
session chain 中固定排除，不会在后续页突然插入并破坏顺序。

## 7. 联邦 continuation 与递归 revision 绑定

客户端 cursor 形如：

```text
fsc1_<32 chars base64url random>
```

总长固定为 37 字符。StateStore key 只保存 handle 的 SHA-256，不保存客户端明文 handle。
每个 handle 指向一个不可变 generation；旧 generation 在 TTL 内保留，所以同一 cursor
重试或并发提交会收敛到同一 page/next handle，不会重复推进 child。

session state 只保存 compact page、direct source continuation、child opaque handles、
状态和 digest，不保存 Authorization、SK 明文、baseUrl 或完整 schema。结构解析会拒绝
credential/schema 字段，单条记录、每条链、每 actor 和全局均有原子 quota；默认包括：

- 1 MiB/record、8 MiB/session chain；
- 最多 1024 generations/session；
- 32 MiB/actor、128 MiB/global；
- 最多 64 chains/actor、256 chains/global；
- session TTL 默认 5 分钟。

根节点不能仅绑定自己的 registry revision。为覆盖 A→B→C 后代变更，父子之间使用内部
snapshot validation handle：

1. parent 请求 child page 时要求 child 返回当前 generation 的 snapshot handle；
2. parent 只保存 direct child 的固定尺寸 handle；
3. 续页前 parent 用该 handle 请求 child 做 validation-only；
4. child 先校验自己的 topology/revision/auth binding，再递归验证它保存的后代 handles；
5. 任一后代变更返回 non-retryable invalid cursor；暂时 transport 失败返回 retryable 503；
6. 即使父级下一页已缓存，重试旧 cursor 也必须完成这条递归验证后才能返回缓存页。

这解决了“每层把 32 KiB cursor 再嵌套”的不可组合问题，也避免仅绑定 A/B 而漏掉 C
revision 的静默旧页问题。

## 8. 预算、partial 与传输安全

部署默认值：

| 预算 | 默认值 |
| --- | ---: |
| `maxHops` | 4 |
| 全递归 source budget | 16 |
| 每跳 direct concurrency | 4 |
| root deadline | 2500 ms |
| 每跳返回预留 | 100 ms |
| 最小 child work slice | 200 ms |
| remote response body | 512 KiB |
| session TTL | 300 s |

对应环境变量为 `TB_SEARCH_FEDERATION_*`，客户端和下游 header 只能收紧，不能扩大部署
上限。每跳从剩余时间扣除 return reserve；nested full `~help` hydration 也传播该预算并受
AbortSignal/byte cap 约束。

remote transport 对所有调用路径显式使用 `redirect: "error"`，301/302/303/307/308 均不
自动跟随；初始 baseUrl 仍执行 HTTPS 与 allowlist 校验。响应按流读取，声明或累计超过
byte cap 会取消 body；deadline 到达也会取消 reader 并归一为受控错误。

第一页只要至少一个 source 正常完成（正常空结果也算完成），可以返回 200 与：

```json
{
  "partial": true,
  "sources": [
    { "path": "outer", "status": "timed_out" }
  ]
}
```

状态集合为 `unsupported | timed_out | unavailable | cycle | hop_limit |
budget_exhausted | invalid_response`（协议也保留 `ok`）。所有候选 source 都无法正常完成时
返回 503。continuation 中已参与 source 暂时失败时返回 retryable 503，调用方可用同一
cursor 重试；安全、拓扑、revision 或协议不一致则返回 non-retryable invalid cursor。

错误正文、baseUrl、skRef、Authorization 和远端原始错误不进入公开 page/source status。

## 9. 验收覆盖

本轮测试固定了以下关键行为：

- Issue #107 三条复现 query：读取温度、开灯、取消全部 timer；
- 覆盖更多 distinct terms 的候选不能被字段分反超；
- CJK unit 不重复增加 coverage；
- D1、better-sqlite3、PostgreSQL 共用 keyword-v2 fixture；
- local compact/full、filter、cursor binding、virtualize rename 分页与重试；
- HTTP、MCP、SDK、CLI、Dashboard 契约和展示；
- remote 所有 30x fail closed、stream body cap 和 abort；
- A→B→C search/help/tree path rebase 与外层 descendant scope；
- A→B→A cycle、hop/source/deadline budget、partial；
- 固定尺寸 cursor、幂等 generation、原子 session/byte quotas；
- A→B→C 后代 revision 变化使父级已缓存 cursor 递归失效；
- missing secret 不出站且不占 source slot；
- 初始 full hydration 失败不提交 root session；
- 嵌套 full hydration 的 stalled body 在 deadline 内被取消；
- 非 canonical/编码别名/越 mount/恶意 evidence/超大响应被拒。

真实 PostgreSQL 套件需要 `TB_TEST_DATABASE_URL`；未提供时测试会明确 skip，不把 skip 写成
通过。Gateway/Server 复用同一 host-neutral app/coordinator，宿主 adapter 分别覆盖配置、
CAS/revision 和 SQL 行为；真实三实例 A→B→C HTTP 链在 app integration 中运行，而不是
声称每个 host package 都复制一套相同 E2E。

## 10. 版本和兼容性

这是消费者可感知的新能力与默认行为变化，按仓库 0.x 规则 bump minor：

| 包 | 版本 |
| --- | ---: |
| `@tool-bridge/app` | 0.17.0 |
| `@tool-bridge/cli` | 0.26.0 |
| `@tool-bridge/dashboard` | 0.24.0 |
| `@tool-bridge/gateway` | 0.22.0 |
| `@tool-bridge/sdk` | 0.18.0 |
| `@tool-bridge/server` | 0.18.0 |

`core` 和 `plugins` 为 private，不单独发布。当前工作树不提交、不打 tag、不推送；tag 必须
等待合入 main 后再按发布流程逐个执行。

需要在 release note 明示：

- 有 federation capability 的新查询默认从 local 变为 recursive；
- 默认 limit 从 50 变为 10；
- 默认结果从 full ToolSpec 变为 compact；
- 排名从可补偿总分变为 coverage-first；
- generic remote 不再自动跟随 redirect；
- recursive federation 要求显式 `TB_INSTANCE_ID`、CAS、revision 和每个 remote 的 skRef。

## 11. 后续工作（不属于本轮已实现能力）

- 基于评测集决定是否增加 phrase/order/exact-token/IDF 桶内信号；
- 设计结构化 alias 与 preferred priority，且不改变跨 source coverage 分母；
- 若需要 agent 自定义阈值，再扩展 `matchedTerms/matchedFields` 或 explain wire；
- 做 production-like fan-out latency、session quota 和首屏 token benchmark；
- 在统一 calibration/eval contract 前，不实现跨 provider semantic score merge。

## 参考

- Tool Bridge Issue #107：coverage-blind keyword ranking 与上下文体积
- OpenConnector：MiniSearch + compact action discovery
- Meilisearch ranking pipeline：不可补偿的分层排序思路
- WHATWG Fetch：redirect 与敏感 header 处理边界
