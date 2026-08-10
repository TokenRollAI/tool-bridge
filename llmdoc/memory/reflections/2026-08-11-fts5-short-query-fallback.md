# 反思:FTS5 trigram 短词静默丢失与整句 fallback

## Task

- Round 22 为 D1/SQLite 的 trigram 工具搜索补齐短查询：支持中文两字词、混合长短词和 LIKE 元字符，并保持两宿主语义一致。

## What Was Surprising

- 给每个 term 加引号并参数绑定后，FTS5 查询可以成功执行，但 trigram tokenizer 会静默丢弃少于 3 个 Unicode code points 的 term。单独短词可能漏搜；更危险的是混合查询会只执行长词部分，例如用户要求 `日程 calendar`，结果却可能仅因 `calendar` 命中而产生假阳性。状态码与 SQL 成功都发现不了这种语义退化。

## Durable Lesson

1. **搜索正确性必须用“混合负例”验证。** 单测短词能命中还不够；必须加入“短词不匹配、长词匹配时整体仍为空”的用例，证明每个用户 term 都真正参与过滤。任何 tokenizer、stop-word、stemming 或分词器升级都应复跑这类负例。
2. **任一短 term 时整句切换到同一策略。** 不把长词留在 FTS、短词另做松散补丁；整句所有 terms 统一走 escaped `LIKE`，term 之间 `AND`，每个 term 在 name/description 之间 `OR`。这样所有条件都由同一执行语义约束，避免 FTS 静默忽略项后产生混合假阳性。
3. **长度按引擎语义计数。** 分流阈值按 Unicode code points 计算，而不是 JavaScript UTF-16 code units 或字节数；需用含 emoji 的 2/3 code-point 边界测试钉住。这里不是用户可见 grapheme 数，不能用 UI 字符长度直觉代替。
4. **fallback 也必须同时收紧 grammar 与预算。** LIKE 模式固定 escape 字符并依次转义 escape 本身、`%`、`_`；动态 WHERE 每 term 占两个 bind 参数，因此限制最多 32 terms，使 `2n + LIMIT` 明确低于 D1 的 100 参数上限，同时继续保留 40 条候选上限。
5. **helper、adapter、wire 三层都要有证据。** core 测分流/转义/code-point/term cap；D1 与 SQLite 共用真实 adapter fixture 锁定引擎结果；两宿主 HTTP wire 再证明短词能力没有在装配或协议层丢失。

## Promotion Candidates

- 搜索架构文档可记录“trigram 仅用于所有 term 都不少于 3 code points；否则全句 LIKE AND”的稳定查询策略。
- 验收指南可加入：数据库查询无错误不等于查询语义完整，分词/规范化能力必须包含混合假阳性负例和实际引擎测试。
