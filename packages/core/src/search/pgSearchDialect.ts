/**
 * Postgres 方言:SqlSearchIndex 的 PG 后端 SQL 真源(宿主中立,只产出 SQL 文本 +
 * 位置参数,不认识 postgres.js)。
 *
 * 与 SQLite/FTS5 方言的结构性差异:
 *
 * - 占位符是 `$1..$n`(SQLite 是 `?`),故不能直接复用 SQLite 的 SQL 常量。
 * - 全文检索用 `ILIKE '%term%'` 子串匹配,统一覆盖 SQLite 侧"长词 trigram FTS +
 *   短词 LIKE" 两条路——整句 AND、加权 score(name=10/description=3/feedback=1)
 *   与 fixture 断言逐条对齐。不用 tsvector:它的词干化与 ts_rank 排序会偏离 fixture
 *   的精确顺序契约。在本表的规模上(受节点上限硬顶)Seq Scan 已是最优,故不建
 *   trigram 索引 —— 依据见 schema 里的实测注释。
 * - 无 external-content FTS 虚拟表与 AI/AD/AU 同步触发器:直接在普通列上匹配,
 *   写路径无需维护派生 FTS 表。
 * - 节点容量在应用层(SqlSearchIndex.replace/rebuild)已先拒;PG 侧再加一个 BEFORE
 *   INSERT 触发器兜底,ABORT 标记与 SQLite 共用 TOOL_SEARCH_CAPACITY_MARKER。
 *
 * 编排(replace/rebuild 顺序、material-change、cursor/revision/分页)全部复用
 * core 的 SqlSearchIndex,本文件只替换方言。
 */

import { type SqlSearchDialect, type SqlSearchStatement, TOOL_SEARCH_CAPACITY_MARKER } from './sqlSearchIndex'
import { TOOL_SEARCH_AUDIT_NODE_LIMIT, toolSearchLikePatterns } from './types'

/** 建表(幂等)。不依赖任何 PG 扩展。 */
export const PG_SEARCH_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS tb_search_tools_v3 (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    path text NOT NULL,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    feedback text NOT NULL DEFAULT '',
    UNIQUE(path, name)
  )`,
  // 这里**故意不建 trigram GIN 索引**。实测(4000 条记录 = 500 节点上限满载):
  // 候选查询是"三列 ILIKE 用 OR 连接 + LIMIT",规划器一律选 Seq Scan(整表仅 1 个
  // buffer),GIN 索引一次都没被使用;而它让插入从 13.7ms 涨到 75.8ms(5.5×)、表总大小
  // 从 1072 kB 涨到 7208 kB(6.7×),检索却仍是 0.50 vs 0.53ms —— 纯负担。
  // 索引记录数受 TOOL_SEARCH_AUDIT_NODE_LIMIT 硬顶约束,不会增长到需要索引的规模;
  // 若将来放宽该上限,应连同候选查询形状(拆成 UNION 或改单列检索列)一起重新评估。
  `CREATE TABLE IF NOT EXISTS tb_search_meta_v3 (
    singleton integer PRIMARY KEY CHECK (singleton = 1),
    revision bigint NOT NULL DEFAULT 0,
    seeded integer NOT NULL DEFAULT 0,
    cursor_secret text NOT NULL
  )`,
  // cursor_secret 需 64 hex(32 字节)。两个内置 gen_random_uuid() 去连字符正好 64
  // hex,避免依赖 pgcrypto 的 gen_random_bytes(自托管 PG 未必预装 pgcrypto)。
  `INSERT INTO tb_search_meta_v3(singleton, revision, seeded, cursor_secret)
    VALUES (
      1, 0, 0,
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
    )
    ON CONFLICT (singleton) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS tb_search_snapshots_v3 (
    path text PRIMARY KEY,
    digest text NOT NULL
  )`,
  `CREATE OR REPLACE FUNCTION tb_search_snapshots_v3_capacity()
    RETURNS trigger AS $$
    BEGIN
      IF (SELECT COUNT(*) FROM tb_search_snapshots_v3) >= ${TOOL_SEARCH_AUDIT_NODE_LIMIT} THEN
        RAISE EXCEPTION '${TOOL_SEARCH_CAPACITY_MARKER}';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS tb_search_snapshots_v3_capacity_trg ON tb_search_snapshots_v3`,
  `CREATE TRIGGER tb_search_snapshots_v3_capacity_trg
    BEFORE INSERT ON tb_search_snapshots_v3
    FOR EACH ROW EXECUTE FUNCTION tb_search_snapshots_v3_capacity()`,
]

/**
 * 索引写路径的事务级 advisory lock 键。
 *
 * 与上面的容量触发器**成对**才成立:触发器用 `COUNT(*)` 判容量,而 COUNT 不加锁——
 * 499 个 path 时两个并发 mutation 各在自己的快照里都读到 499、都放行,提交后 501。
 * 驱动在每个写事务开头取此锁,把索引 mutation 串行化,COUNT 才可信。
 * 任意常量即可(只需全库唯一);读路径不取锁。
 */
export const PG_SEARCH_WRITE_LOCK_KEY = 0x7b5ea2c8

/** 单行写 path→digest 快照(位置参数:path, digest);`replace` 内联使用。 */
export const PG_SEARCH_INSERT_SNAPSHOT_SQL
  = 'INSERT INTO tb_search_snapshots_v3(path, digest) VALUES ($1, $2)'

/**
 * 多行 VALUES 批量插入。
 *
 * 逐条 INSERT 在一个事务里对 4000 行要 ~920ms(每行一次 await 往返),同样数据攒成
 * 单条多行 VALUES 只要 ~12ms —— 相差约 74 倍,是 rebuild 的主要成本。D1 侧用 JSON1
 * (`json_each`)解决同一问题,PG 用多行 VALUES 更直接(不必先序列化成 JSON)。
 *
 * `columns` 决定每行的占位符个数;参数按行优先顺序展开(第 1 行的各列、第 2 行的各列…)。
 * 单条语句的参数总数受 PG 协议上限约束(65535 个),故调用方仍需分块(见 driver)。
 */
export function pgBulkInsertSql(
  table: string,
  columns: readonly string[],
  rows: number,
): string {
  const tuples: string[] = []
  for (let r = 0; r < rows; r++) {
    const placeholders = columns.map((_, c) => `$${r * columns.length + c + 1}`)
    tuples.push(`(${placeholders.join(', ')})`)
  }
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`
}

/** 索引记录表与列(供批量插入构造)。 */
export const PG_SEARCH_TOOLS_TABLE = 'tb_search_tools_v3'
export const PG_SEARCH_TOOLS_COLUMNS = ['path', 'name', 'description', 'feedback'] as const
/** 快照表与列。 */
export const PG_SEARCH_SNAPSHOTS_TABLE = 'tb_search_snapshots_v3'
export const PG_SEARCH_SNAPSHOTS_COLUMNS = ['path', 'digest'] as const
/**
 * 单条语句最大行数。PG 绑定参数上限是 65535;4 列时理论上限 16383 行,
 * 取 1000 留足余量(1000 行 × 4 列 = 4000 个参数),同时已把往返摊薄到可忽略。
 */
export const PG_SEARCH_INSERT_ROWS_MAX = 1000

/**
 * 类型归一(务必保留 ::int 转换):postgres.js 把 `bigint` 与 `COUNT(*)` 返回为
 * **字符串**、`EXISTS` 返回 **boolean**,而 core 的 MetaRow/PathStateRow 契约要求
 * number。不转的后果不是类型报错而是静默错行为:
 *   - `ToolSearchCandidate.revision` 运行时变字符串,违反公开类型;
 *   - `current.has_tools === 0` 对 boolean `false` 永不成立,空快照 no-op 判定失效,
 *     重复 `replace(path, [])` 会白 bump revision 并失效所有既有 cursor。
 * revision 用 ::int:核心只做相等比较,且 4 字节整型对索引代数足够(溢出前需 21 亿次
 * mutation);超出即回绕仍只影响 cursor 失效判定,不损坏权威数据。
 */
const META_SQL = `
SELECT revision::int AS revision, seeded::int AS seeded, cursor_secret
FROM tb_search_meta_v3 WHERE singleton = 1
`
const SNAPSHOT_DIGESTS_SQL
  = 'SELECT path, digest FROM tb_search_snapshots_v3 ORDER BY path'
const PATH_STATE_SQL = `
SELECT snapshots.digest,
  EXISTS(SELECT 1 FROM tb_search_tools_v3 WHERE path = $1)::int AS has_tools,
  (SELECT COUNT(*) FROM tb_search_snapshots_v3)::int AS path_count
FROM (SELECT 1) AS singleton
LEFT JOIN tb_search_snapshots_v3 AS snapshots ON snapshots.path = $2
`
const PRESENT_SQL = 'SELECT 1 AS present FROM tb_search_tools_v3 WHERE path = $1 LIMIT 1'
const PRESENT_PREFIX_SQL = `
SELECT 1 AS present FROM tb_search_tools_v3
WHERE path = $1 OR substr(path, 1, length($2) + 1) = $3 || '/'
LIMIT 1
`
const DELETE_TOOLS_SQL = 'DELETE FROM tb_search_tools_v3 WHERE path = $1'
const DELETE_SNAPSHOT_SQL = 'DELETE FROM tb_search_snapshots_v3 WHERE path = $1'
const DELETE_TOOLS_PREFIX_SQL = `
DELETE FROM tb_search_tools_v3
WHERE path = $1 OR substr(path, 1, length($2) + 1) = $3 || '/'
`
const DELETE_SNAPSHOT_PREFIX_SQL = `
DELETE FROM tb_search_snapshots_v3
WHERE path = $1 OR substr(path, 1, length($2) + 1) = $3 || '/'
`
const DELETE_ALL_TOOLS_SQL = 'DELETE FROM tb_search_tools_v3'
const DELETE_ALL_SNAPSHOTS_SQL = 'DELETE FROM tb_search_snapshots_v3'
const BUMP_REVISION_SQL
  = 'UPDATE tb_search_meta_v3 SET revision = revision + 1 WHERE singleton = 1'
const COMPLETE_REBUILD_SQL
  = 'UPDATE tb_search_meta_v3 SET seeded = 1, revision = revision + 1 WHERE singleton = 1'

/**
 * 候选查询:每个 term 都必须命中 name/description/feedback 之一(整句 AND),
 * 逐词加权求和(name=10/description=3/feedback=1)排序,与 SQLite 方言逐条对齐。
 *
 * ESCAPE '!' 与 core 的 likePattern 转义规则一致。长词短词走同一条路径(都是 ILIKE
 * 子串),不像 SQLite 侧要分 FTS/LIKE 两轨;实测规划器在本表规模上一律选 Seq Scan,
 * 4000 条满载时中位数个毫秒级。
 */
export function pgCandidateStatement(
  query: string,
  limit: number,
  offset: number,
): SqlSearchStatement {
  const patterns = toolSearchLikePatterns(query)
  // $1..$k = patterns;$k+1 = limit;$k+2 = offset。
  const matchClauses = patterns.map((_, i) => {
    const p = `$${i + 1}`
    return `(name ILIKE ${p} ESCAPE '!' OR description ILIKE ${p} ESCAPE '!' `
      + `OR feedback ILIKE ${p} ESCAPE '!')`
  })
  const scoreTerms = patterns.map((_, i) => {
    const p = `$${i + 1}`
    return `CASE WHEN name ILIKE ${p} ESCAPE '!' THEN 10 `
      + `WHEN description ILIKE ${p} ESCAPE '!' THEN 3 `
      + `WHEN feedback ILIKE ${p} ESCAPE '!' THEN 1 ELSE 0 END`
  })
  const limitParam = `$${patterns.length + 1}`
  const offsetParam = `$${patterns.length + 2}`
  return {
    params: [...patterns, limit + 1, offset],
    sql: `
      SELECT id, path, name, (${scoreTerms.join(' + ')}) AS score
      FROM tb_search_tools_v3
      WHERE ${matchClauses.join(' AND ')}
      ORDER BY score DESC, path, name
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
  }
}

/** Postgres 方言:ILIKE 子串检索,$n 占位符,无扩展依赖。 */
export const pgSearchDialect: SqlSearchDialect = {
  candidateStatement: pgCandidateStatement,
  schemaStatements: PG_SEARCH_SCHEMA_STATEMENTS,
  statements: {
    bumpRevision: BUMP_REVISION_SQL,
    completeRebuild: COMPLETE_REBUILD_SQL,
    deleteAllSnapshots: DELETE_ALL_SNAPSHOTS_SQL,
    deleteAllTools: DELETE_ALL_TOOLS_SQL,
    deleteSnapshot: DELETE_SNAPSHOT_SQL,
    deleteSnapshotPrefix: DELETE_SNAPSHOT_PREFIX_SQL,
    deleteTools: DELETE_TOOLS_SQL,
    deleteToolsPrefix: DELETE_TOOLS_PREFIX_SQL,
    insertSnapshot: PG_SEARCH_INSERT_SNAPSHOT_SQL,
    meta: META_SQL,
    pathState: PATH_STATE_SQL,
    present: PRESENT_SQL,
    presentPrefix: PRESENT_PREFIX_SQL,
    snapshotDigests: SNAPSHOT_DIGESTS_SQL,
  },
}
