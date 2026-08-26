/**
 * Postgres 方言:SqlSearchIndex 的 PG 后端 SQL 真源(宿主中立,只产出 SQL 文本 +
 * 位置参数,不认识 postgres.js)。
 *
 * 与 SQLite 方言的结构性差异:
 *
 * - 占位符是 `$1..$n`(SQLite 是 `?`),故不能直接复用 SQLite 的 SQL 常量。
 * - 检索用 `ILIKE` 做 Unicode 大小写折叠；查询单元、部分命中召回和加权评分 SQL
 *   与 SQLite 共用同一个生成器。不用 tsvector/trigram 索引：在节点上限约束下
 *   Seq Scan 已是最优，依据见 schema 里的实测注释。
 * - 节点容量在应用层(SqlSearchIndex.replace/rebuild)已先拒;PG 侧再加一个 BEFORE
 *   INSERT 触发器兜底,ABORT 标记与 SQLite 共用 TOOL_SEARCH_CAPACITY_MARKER。
 *
 * 编排(replace/rebuild 顺序、material-change、cursor/revision/分页)全部复用
 * core 的 SqlSearchIndex,本文件只替换方言。
 */

import {
  normalizeToolSearchOptions,
  prepareToolSearchQuery,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
  TOOL_SEARCH_UNIT_LIMIT,
} from './types'
import {
  type SqlSearchDialect,
  TOOL_SEARCH_CAPACITY_MARKER,
  toolSearchCandidateStatement,
} from './sqlSearchIndex'

/** 建表(幂等)。不依赖任何 PG 扩展。 */
export const PG_SEARCH_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS tb_search_tools_v5 (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    path text NOT NULL,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    effect text NOT NULL CHECK (effect IN ('read', 'write', 'destructive', 'unknown')),
    feedback text NOT NULL DEFAULT '',
    UNIQUE(path, name)
  )`,
  // 这里**故意不建 trigram GIN 索引**。历史基准在 500 节点 × 8 工具(4000 行)
  // 样本上对单 unit 多列 ILIKE 一律选 Seq Scan；GIN 让写入和体积显著增加却未改善
  // 检索。4000 行只是代表样本，不是严格工具行上限（节点内还受 20KB JSON 约束）；
  // 查询单元数或容量边界变化时，应重跑 searchBench 并重新评估查询形状与索引。
  `CREATE TABLE IF NOT EXISTS tb_search_meta_v5 (
    singleton integer PRIMARY KEY CHECK (singleton = 1),
    revision bigint NOT NULL DEFAULT 0,
    seeded integer NOT NULL DEFAULT 0,
    cursor_secret text NOT NULL
  )`,
  // cursor_secret 需 64 hex(32 字节)。两个内置 gen_random_uuid() 去连字符正好 64
  // hex,避免依赖 pgcrypto 的 gen_random_bytes(自托管 PG 未必预装 pgcrypto)。
  `INSERT INTO tb_search_meta_v5(singleton, revision, seeded, cursor_secret)
    VALUES (
      1, 0, 0,
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
    )
    ON CONFLICT (singleton) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS tb_search_snapshots_v5 (
    path text PRIMARY KEY,
    digest text NOT NULL
  )`,
  `CREATE OR REPLACE FUNCTION tb_search_snapshots_v5_capacity()
    RETURNS trigger AS $$
    BEGIN
      IF (SELECT COUNT(*) FROM tb_search_snapshots_v5) >= ${TOOL_SEARCH_AUDIT_NODE_LIMIT} THEN
        RAISE EXCEPTION '${TOOL_SEARCH_CAPACITY_MARKER}';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS tb_search_snapshots_v5_capacity_trg ON tb_search_snapshots_v5`,
  `CREATE TRIGGER tb_search_snapshots_v5_capacity_trg
    BEFORE INSERT ON tb_search_snapshots_v5
    FOR EACH ROW EXECUTE FUNCTION tb_search_snapshots_v5_capacity()`,
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
  = 'INSERT INTO tb_search_snapshots_v5(path, digest) VALUES ($1, $2)'

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
export const PG_SEARCH_TOOLS_TABLE = 'tb_search_tools_v5'
export const PG_SEARCH_TOOLS_COLUMNS = [
  'path',
  'name',
  'description',
  'effect',
  'feedback',
] as const
/** 快照表与列。 */
export const PG_SEARCH_SNAPSHOTS_TABLE = 'tb_search_snapshots_v5'
export const PG_SEARCH_SNAPSHOTS_COLUMNS = ['path', 'digest'] as const
/**
 * 单条语句最大行数。PG 绑定参数上限是 65535;当前 tools 5 列时理论上限
 * 13107 行，取 1000 留足余量(1000 行 × 5 列 = 5000 个参数)，同时已把往返
 * 摊薄到可忽略。
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
FROM tb_search_meta_v5 WHERE singleton = 1
`
const SNAPSHOT_DIGESTS_SQL
  = 'SELECT path, digest FROM tb_search_snapshots_v5 ORDER BY path'
const PATH_STATE_SQL = `
SELECT snapshots.digest,
  EXISTS(SELECT 1 FROM tb_search_tools_v5 WHERE path = $1)::int AS has_tools,
  (SELECT COUNT(*) FROM tb_search_snapshots_v5)::int AS path_count
FROM (SELECT 1) AS singleton
LEFT JOIN tb_search_snapshots_v5 AS snapshots ON snapshots.path = $2
`
const PRESENT_SQL = 'SELECT 1 AS present FROM tb_search_tools_v5 WHERE path = $1 LIMIT 1'
const PRESENT_PREFIX_SQL = `
SELECT 1 AS present FROM tb_search_tools_v5
WHERE path = $1 OR substr(path, 1, length($2) + 1) = $3 || '/'
LIMIT 1
`
const DELETE_TOOLS_SQL = 'DELETE FROM tb_search_tools_v5 WHERE path = $1'
const DELETE_SNAPSHOT_SQL = 'DELETE FROM tb_search_snapshots_v5 WHERE path = $1'
const DELETE_TOOLS_PREFIX_SQL = `
DELETE FROM tb_search_tools_v5
WHERE path = $1 OR substr(path, 1, length($2) + 1) = $3 || '/'
`
const DELETE_SNAPSHOT_PREFIX_SQL = `
DELETE FROM tb_search_snapshots_v5
WHERE path = $1 OR substr(path, 1, length($2) + 1) = $3 || '/'
`
const DELETE_ALL_TOOLS_SQL = 'DELETE FROM tb_search_tools_v5'
const DELETE_ALL_SNAPSHOTS_SQL = 'DELETE FROM tb_search_snapshots_v5'
const BUMP_REVISION_SQL
  = 'UPDATE tb_search_meta_v5 SET revision = revision + 1 WHERE singleton = 1'
const COMPLETE_REBUILD_SQL
  = 'UPDATE tb_search_meta_v5 SET seeded = 1, revision = revision + 1 WHERE singleton = 1'

/** Postgres 方言:ILIKE 子串检索,$n 占位符,无扩展依赖。 */
export const pgSearchDialect: SqlSearchDialect = {
  candidateStatement: (query, limit, offset, rawConstraints) => {
    const constraints = normalizeToolSearchOptions(rawConstraints)
    const prepared = prepareToolSearchQuery(
      query,
      constraints.pathPrefix === undefined
        ? TOOL_SEARCH_UNIT_LIMIT
        : TOOL_SEARCH_UNIT_LIMIT - 1,
    )
    return toolSearchCandidateStatement(
      prepared.units,
      prepared.totalTermCount,
      limit,
      offset,
      constraints,
      { likeOperator: 'ILIKE', placeholder: index => `$${index}` },
    )
  },
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
