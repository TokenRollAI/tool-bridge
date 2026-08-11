/**
 * 短词(escaped LIKE)检索的共享 SQL 片段——D1 与 SQLite 两个 adapter 的唯一真源。
 *
 * 此前 gateway/d1SearchIndex 与 server/sqliteSearchIndex 各持一份逐字符相同的
 * 常量,改一处忘另一处会让两宿主的检索行为静默分叉。SQL 只拼占位符个数,
 * 值全部走参数绑定;LIKE pattern 的转义(`!`)在 likePattern(types.ts)完成。
 */

/** short_terms CTE:每个短词一个 `(?)` 占位符,值由调用方按序绑定。 */
export function shortTermsSql(patterns: readonly string[]): string {
  return `short_terms(pattern) AS (VALUES ${patterns.map(() => '(?)').join(', ')})`
}

/** 所有短词都命中 name/description/feedback 之一(整句 AND 语义)。 */
export const SHORT_MATCH_SQL = `
NOT EXISTS (
  SELECT 1 FROM short_terms
  WHERE tools.name NOT LIKE pattern ESCAPE '!'
    AND tools.description NOT LIKE pattern ESCAPE '!'
    AND tools.feedback NOT LIKE pattern ESCAPE '!'
)
`

/** 短词加权得分:name=10 / description=3 / feedback=1,逐词求和。 */
export const SHORT_SCORE_SQL = `
(
  SELECT COALESCE(SUM(
    CASE
      WHEN tools.name LIKE pattern ESCAPE '!' THEN 10
      WHEN tools.description LIKE pattern ESCAPE '!' THEN 3
      WHEN tools.feedback LIKE pattern ESCAPE '!' THEN 1
      ELSE 0
    END
  ), 0)
  FROM short_terms
)
`
