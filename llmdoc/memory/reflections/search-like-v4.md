# Search LIKE v4 Reflection

## Task

- 将 SQLite/D1 的 FTS5/trigram 与 PostgreSQL 的独立 `ILIKE` 实现合并为共享的 LIKE/ILIKE 搜索单元和评分 SQL。
- 把全 AND 改成部分命中，加入 CJK 整词/bigram/单字三档、path 权重，并以 schema v4 自愈重建派生索引。

## Expected vs Actual

- 预期单元上限 128，并保留每个 term 的 tier-4 整词；实际 D1 单查询最多 100 个 bindings、单个 LIKE pattern 最多 50 bytes。limit/offset 还占两个 binding，因此共享上限只能是 98；超长非 CJK term 不能只丢整词，否则会得到零单元，最终改为按 code point 确定性分块。
- 预期真实终验中的 `send message` 能召回只有 `inbox/deliver` 路径和中文“本地信箱/消息”描述的工具；实际所有搜索仍是字面子串匹配，英文 query 与中文材料没有任何重叠。OR、path 权重和 CJK 拆分都不能提供跨语言同义词能力。
- 预期以“500 节点硬顶、4000 工具、PG 约 0.5ms”说明最坏规模可控；实际 500 只限制节点数，工具行数由每节点 20KB JSON 间接约束。4000 行只是 benchmark 样本，新查询的比较量还随最多 98 个 units 增长，不能当作最坏情况证明。
- 预期定向 Vitest 通过后再跑全仓闸门；实际首次 `pnpm verify` 在 core typecheck 阶段发现测试文件直接使用了未声明的 `TextEncoder` 类型，运行时 Vitest 没有暴露这个问题。补本地最小声明后才通过类型闸门。
- 预期按已拍板范围为 app/gateway/server 升 minor；实际 gateway/server 明确承载宿主搜索行为，而 app 不含候选 SQL、也不把自己的 manifest version 注入产物，app bump 与 public artifact ownership 判据存在张力。本轮尊重已确认的发布范围，但 PR 应显式记录这一取舍，不能把它包装成无争议的依赖传递。
- 预期只处理三个 public package；实际 gateway 升到新 0.x minor 后，Deploy Button template 的 caret 不会跨 minor，必须同步 template 的 gateway 依赖和已过时的 FTS 文案，发布闭环才完整。

## Root Causes And Lessons

- 共享最低能力平台决定共享算法上限。SQL 已统一并不等于约束已统一；D1 的绑定数和 pattern 字节数必须在 query preparation 层成为显式常量与测试不变量，而不是等真实部署报错。
- “部分命中”只放宽已有字面单元之间的布尔关系，不会创造翻译、词干或同义词。验收矩阵必须先证明 query units 与索引字段存在重叠，否则期望本身不可实现。
- 性能结论要同时写清数据上界、查询上界与样本规模。节点容量、工具行数、单元数是三种不同约束，不能用一个方便的 benchmark 样本互相代替。
- 定向运行时测试适合快速验证行为，但不会替代 TypeScript 编译环境。新增测试内全局类型或跨包导出时，应在全仓 verify 前先跑受影响包 typecheck，缩短反馈链。
- public artifact ownership 应以消费者能否从该包获得变化后的行为为准；用户已确认的发布范围可以执行，但有张力时必须把依据和取舍留在 PR，而非反向改写 ownership 规则。
- 发布闭环包含间接消费者。0.x caret 不跨 minor，使 Deploy Button template 的依赖 pin 成为 gateway minor 发布的硬关联检查项。

## Validation Lesson

- CJK 三档、去重、确定性截断、D1 98 bindings/50-byte pattern、path 权重和部分命中都需要由三后端共享 fixture 与 query-preparation 单测共同覆盖；只测 SQLite 或只测生成 SQL 都不能证明宿主等价。
- schema v4 的一次性行为需要分别证明：新表从 canonical state 重建、旧 v3 表不被 DROP、旧 cursor 因新 secret 失效。它们是三个不同事实。
- `score > 0` 与加权总分只保证“有命中即可召回并按分排序”，不保证“覆盖所有 query terms 的结果必然排第一”；文档和 PR 不应作更强承诺。

## Promotion Candidates

- 提升到 `llmdoc/architecture/search.md`：统一 LIKE/ILIKE 的单元/评分模型、path 权重、schema v4 自愈边界；同时写明 D1 导出的 98-unit 与 50-byte pattern 不变量、超长非 CJK 分块、字面检索不提供跨语言同义词，以及加权分不保证 coverage 优先。
- 提升到 `llmdoc/architecture/search.md`：容量表述区分节点上限、每节点 JSON 上限、工具行数和 unit 上限；4000 行/0.5ms 只能作为一次 benchmark 样本，不能称最坏规模。
- 提升到 `llmdoc/guides/verification-and-commit-practices.md`：搜索改动须让 SQLite/D1/PG 共跑同一 fixture，PG 组不得 skip；定向 Vitest 后、全仓 verify 前，新增测试全局或导出变化应先跑受影响包 typecheck。
- 提升到 `llmdoc/guides/deploy-and-verify.md`：gateway minor 发布必须核对源码入口、npm `/full` 与 Deploy Button template；0.x template 依赖 pin 及搜索后端描述必须同轮更新。
- app bump 的 ownership 张力更适合留在 PR，并由 recorder 判断是否需要补强 `guides/npm-publish.md` 的实例，不应塞进 search architecture。

## Follow-up

- 由 recorder 仅吸收仍稳定且代码已验证的候选；reflection 不改稳定文档、索引或发布状态。
