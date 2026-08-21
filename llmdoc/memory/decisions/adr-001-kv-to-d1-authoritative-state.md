# ADR-001:Cloudflare 宿主权威状态从 KV 迁往 D1

状态:**accepted(已实施)** · 提出/拍板:2026-08-21 · 影响:gateway(Workers 宿主)

**拍板记录**:选项 A(全量迁 D1),pre-launch 无线上用户、零迁移负担,跳过前置量化直接实施(延迟观测留待真实部署验收)。共库问题在实施中按用户意见改判:**一个 D1 库(`tb-db`)、两个 binding(TB_STATE/TB_SEARCH)指向它** —— 分库唯一的实质理由(search rebuild 与认证热路径的写竞争)在控制面网关的真实量级下可忽略,而共库省一个云资源、省 provision 步骤、用户心智"一个库"收益是实打实的;binding 表达用途、库表达存储位置,将来要拆只动配置不动代码。state 表名 `tb_state_kv`(与 `tb_search_*` 共库自解释)。

## 背景与问题

Workers 宿主的 `StateStore` 由 KV 承担(`KvStateStore`,绑定 `TB_KV`),存放 SK 哈希表、节点树、加密 secret、plugin manifest、feedback 等全部权威状态。KV 是最终一致存储,带来四类已知代价:

1. **撤销窗口**:SK 吊销、节点删除跨 PoP 传播期间旧值仍可读(通常约 60s,平台不保证上界)。安全下界只能靠 fail-closed 与短缓存兜底,无法提供"立即全局生效"。
2. **无原子原语**:KV 无 CAS/事务。`StateStore.putIfAbsent`(ADR 时点已进契约)在 KV 上无法实现,并发引导只能走 get-miss→put 回退;feedback 投票、plugin 注册等读改写同样裸奔。
3. **list/get 幽灵**:`list` 返回的 key 紧接 `get` 可为 null,读路径永远要防御(kvStateStore.ts 已处理,但这是所有消费方的长期心智负担)。
4. **每请求逐 key 读放大**:树遍历多次 get;bulk get 每次 100 key 上限。

D1 已在同宿主用于 SearchIndex(`TB_SEARCH`,FTS5),即 D1 的绑定、provision、miniflare 测试链路都已存在。

## 关键窗口:pre-launch 无迁移负担

项目处于 pre-launch,`project-brief` 明确"项目自己的旧预览状态不作为兼容目标"。**现在切换 = 新部署重新引导,不需要写任何 KV→D1 数据迁移工具**。正式上线后这个窗口关闭,同样的决策会多出一整套迁移/回滚工程。这是本 ADR 现在提出的主要原因。

## 选项

**A. 全量迁 D1(推荐)**:新建 `D1StateStore`(单表 kv,与 server 的 `SqliteStateStore`/`PgStateStore` 同布局同语义——D1 就是 SQLite,`prefixUpperBound` 范围扫描、`INSERT OR IGNORE` putIfAbsent 可近乎照搬);`TB_KV` 从状态存储撤出。
- 得:强一致撤销、原子 putIfAbsent、幽灵消失、三宿主 StateStore 全部收敛到 SQL 语义(契约测试可共享)。
- 失:**认证热路径延迟**。`sk:h:<hash>` 每请求一读:KV 边缘命中是毫秒级,D1 查询回源主库(读复制走 Sessions API,仍非边缘缓存),跨区域可到几十 ms。这是唯一实质代价,必须先量化再全量切。
- 缓解:per-isolate 内存缓存 + 短 TTL(5–15s)+ 负缓存禁用;撤销语义从"KV 传播不可控"变为"缓存 TTL 上界可控"——反而是收益。

**B. 只迁热敏数据(SK/撤销/引导标志),树与 manifest 留 KV**:按 key 前缀路由两个后端。
- 得:改动面小。失:长期两套一致性语义并存,`StateStore` 之上要加路由层,list 跨后端语义混乱;省下的延迟恰恰在最热的 SK 路径上并不省(SK 正是要迁的部分)。**不推荐**。

**C. 维持现状,文档化限制**:零成本,但 putIfAbsent 在 Workers 永久缺席、撤销窗口永久存在,与"server 独占授权权威"的安全叙事长期矛盾。仅当 A 的延迟量化结果不可接受时退守。

## 推荐路径(A,分三步,每步独立可验收)

1. **量化**:miniflare 本地 + 真实部署各测一次 `D1 SELECT by key` vs `KV get` 的 p50/p95;同时测 per-isolate 缓存命中路径。产出数字进本 ADR 的验收记录。
2. **实现**:`D1StateStore`(复用 server SQL store 的 key 布局与测试对拍套件)+ `TB_STATE` D1 binding(可与 `TB_SEARCH` 同库不同表,省一个资源);`depsFromEnv` 按 binding 存在性选择后端,过渡期保留 KV 路径一个 minor。provision/template/Deploy Button 同轮加 binding(吸取 template 漂移教训:三条发布路径同轮核对)。
3. **收口**:默认切 D1,KV 从 wrangler 模板移除或降为显式 opt-in;`workers-kv-pitfalls.md` 相应收缩;bump gateway minor 并在 PR 显式写"新部署行为变化:状态强一致,旧 KV 状态不迁移"。

## 验收标准

- 撤销即时性:吊销 SK 后下一请求(缓存 TTL 外)即 401,有集成测试。
- `putIfAbsent` 在 Workers 宿主原子生效,并发引导测试跨三宿主对齐。
- 认证热路径 p95 增量在量化预算内(建议阈值:相对 KV 方案 +20ms 以内,超出则先做缓存层再切)。
- `verifySearchIndexContract` 式的共享黑盒契约套件覆盖 D1StateStore 与 Memory/SQLite/PG 对拍。
