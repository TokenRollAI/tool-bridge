/** PostgreSQL search SQL: schema, bounded bulk writes and coverage-ranked candidate queries. */
import {
  type NormalizedToolSearchOptions,
  normalizeToolSearchOptions,
  prepareToolSearchQuery,
  type SearchUnit,
  searchUnitAllowsPath,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
  TOOL_SEARCH_UNIT_LIMIT,
  type ToolSearchEffect,
} from './types'
import { TBError } from '../errors'

/** SQL text and ordered PostgreSQL parameters; no runtime driver dependencies. */
export interface SqlSearchStatement {
  readonly params: readonly unknown[]
  readonly sql: string
}

/** Capacity-trigger failure is mapped to the public rate_limited error. */
export const TOOL_SEARCH_CAPACITY_MARKER = 'tb_search_path_capacity'

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
  // 查询单元数或容量边界变化时，应重新测量查询计划并评估查询形状与索引。
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

/** Numeric results must remain numbers: postgres.js otherwise returns bigint as strings and EXISTS as booleans. */
export const PG_SEARCH_STATEMENTS = {
  bumpRevision: 'UPDATE tb_search_meta_v5 SET revision = revision + 1 WHERE singleton = 1',
  completeRebuild: 'UPDATE tb_search_meta_v5 SET seeded = 1, revision = revision + 1 WHERE singleton = 1',
  deleteAllSnapshots: 'DELETE FROM tb_search_snapshots_v5',
  deleteAllTools: 'DELETE FROM tb_search_tools_v5',
  deleteSnapshot: 'DELETE FROM tb_search_snapshots_v5 WHERE path = $1',
  deleteSnapshotPrefix: `DELETE FROM tb_search_snapshots_v5
    WHERE path = $1 OR substr(path, 1, length($2) + 1) = $3 || '/'`,
  deleteTools: 'DELETE FROM tb_search_tools_v5 WHERE path = $1',
  deleteToolsPrefix: `DELETE FROM tb_search_tools_v5
    WHERE path = $1 OR substr(path, 1, length($2) + 1) = $3 || '/'`,
  insertSnapshot: 'INSERT INTO tb_search_snapshots_v5(path, digest) VALUES ($1, $2)',
  meta: 'SELECT revision::int AS revision, seeded::int AS seeded, cursor_secret FROM tb_search_meta_v5 WHERE singleton = 1',
  pathState: `SELECT snapshots.digest,
    EXISTS(SELECT 1 FROM tb_search_tools_v5 WHERE path = $1)::int AS has_tools,
    (SELECT COUNT(*) FROM tb_search_snapshots_v5)::int AS path_count
    FROM (SELECT 1) AS singleton
    LEFT JOIN tb_search_snapshots_v5 AS snapshots ON snapshots.path = $2`,
  present: 'SELECT 1 AS present FROM tb_search_tools_v5 WHERE path = $1 LIMIT 1',
  presentPrefix: `SELECT 1 AS present FROM tb_search_tools_v5
    WHERE path = $1 OR substr(path, 1, length($2) + 1) = $3 || '/' LIMIT 1`,
  snapshotDigests: 'SELECT path, digest FROM tb_search_snapshots_v5 ORDER BY path',
} as const

/**
 * 多行 VALUES 批量插入。
 *
 * 逐条 INSERT 在一个事务里对 4000 行要 ~920ms(每行一次 await 往返),同样数据攒成
 * 单条多行 VALUES 只要 ~12ms —— 相差约 74 倍,是 rebuild 的主要成本。PG 多行 VALUES 无需先序列化成 JSON。
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

/** effect filter 直接写受控 SQL literal，不把用户输入拼进 SQL，以参数携带的过滤值不会进入 SQL 文本。 */
function toolSearchEffectSql(effect: ToolSearchEffect): string {
  switch (effect) {
    case 'read': return '\'read\''
    case 'write': return '\'write\''
    case 'destructive': return '\'destructive\''
    case 'unknown': return '\'unknown\''
    default: throw new TBError('invalid_argument', `工具搜索 effect '${String(effect)}' 非法`)
  }
}

/**
 * PostgreSQL coverage 排序的候选查询生成器。
 *
 * 每个查询单元只要命中任意索引字段即可召回。派生单元先按
 * `(tool, logicalTermId)` 取最佳 tier×字段权重，因此一个原始 term 无论命中多少
 * 派生 unit/字段，coverage 都只计一次。最终先按 matched logical terms，再按既有
 * 字段质量总分排序。pathPrefix 在召回 CTE 内按 segment 过滤，只占一个 binding；
 * floor 用受控整数直接写入 SQL。无 prefix 时保留 98+2 bindings，有 prefix 时使用
 * 97 units + prefix + limit/offset，保持现有单次查询的 100 个参数工作量上限。
 */
const placeholder = (index: number): string => `$${index}`

function candidateStatement(
  units: readonly SearchUnit[],
  totalTermCount: number,
  limit: number,
  offset: number,
  constraints: NormalizedToolSearchOptions,
): SqlSearchStatement {
  if (
    !Number.isInteger(totalTermCount)
    || totalTermCount < 1
    || units.some(unit =>
      !Number.isInteger(unit.logicalTermId)
      || unit.logicalTermId < 0
      || unit.logicalTermId >= totalTermCount)
  ) {
    throw new TBError('invalid_argument', '工具搜索 logical term 计划非法')
  }
  const values = units.map((unit, index) =>
    `(${unit.logicalTermId}, ${placeholder(index + 1)}, ${unit.tier}, ${
      searchUnitAllowsPath(unit) ? 1 : 0
    })`).join(', ')
  const hasPrefix = constraints.pathPrefix !== undefined
  const prefixParam = hasPrefix ? placeholder(units.length + 1) : undefined
  const trailingStart = units.length + (hasPrefix ? 2 : 1)
  const limitParam = placeholder(trailingStart)
  const offsetParam = placeholder(trailingStart + 1)
  const requiredMatchedTerms = constraints.minCoverage === undefined
    ? 1
    : Math.ceil(constraints.minCoverage * totalTermCount)
  const effectLiterals = constraints.effects?.map(toolSearchEffectSql)
  const prefixCte = hasPrefix
    ? `, prefix_filter(value) AS (VALUES (${prefixParam}))`
    : ''
  const filterPredicates = [
    ...(hasPrefix
      ? [
          `(
            tools.path = prefix_filter.value
            OR substr(tools.path, 1, length(prefix_filter.value) + 1)
              = prefix_filter.value || '/'
          )`,
        ]
      : []),
    ...(effectLiterals === undefined ? [] : [`tools.effect IN (${effectLiterals.join(', ')})`]),
  ]
  const filteredToolsCte = filterPredicates.length > 0
    ? `,
      filtered_tools AS (
        SELECT tools.*
        FROM tb_search_tools_v5 AS tools
        ${hasPrefix ? 'CROSS JOIN prefix_filter' : ''}
        WHERE ${filterPredicates.join('\n          AND ')}
      )`
    : ''
  const candidateTable = filterPredicates.length > 0 ? 'filtered_tools' : 'tb_search_tools_v5'
  return {
    params: [
      ...units.map(unit => unit.pattern),
      ...(hasPrefix ? [constraints.pathPrefix] : []),
      limit + 1,
      offset,
    ],
    sql: `
      WITH units(logical_term_id, pattern, tier, path_allowed) AS (VALUES ${values})${prefixCte}${filteredToolsCte},
      unit_matches AS (
        SELECT tools.id, tools.path, tools.name, units.logical_term_id,
          units.tier * CASE
            WHEN tools.name ILIKE units.pattern ESCAPE '!' THEN 10
            WHEN units.path_allowed = 1
              AND tools.path ILIKE units.pattern ESCAPE '!' THEN 5
            WHEN tools.description ILIKE units.pattern ESCAPE '!' THEN 3
            WHEN tools.feedback ILIKE units.pattern ESCAPE '!' THEN 1
            ELSE 0
          END AS unit_score
        FROM ${candidateTable} AS tools
        CROSS JOIN units
      ),
      term_matches AS (
        SELECT id, path, name, logical_term_id, MAX(unit_score) AS term_score
        FROM unit_matches
        WHERE unit_score > 0
        GROUP BY id, path, name, logical_term_id
      ),
      scored_tools AS (
        SELECT id, path, name,
          CAST(COUNT(*) AS INTEGER) AS matched_term_count,
          CAST(SUM(term_score) AS INTEGER) AS score
        FROM term_matches
        GROUP BY id, path, name
      )
      SELECT id, path, name, matched_term_count, ${totalTermCount} AS total_term_count
      FROM scored_tools
      WHERE matched_term_count >= ${requiredMatchedTerms}
      ORDER BY matched_term_count DESC, score DESC, path, name
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
  }
}

/** The sole SQL query entry point; ranking and preparation limits remain unchanged. */
export function pgSearchCandidateStatement(
  query: string,
  limit: number,
  offset: number,
  rawConstraints?: NormalizedToolSearchOptions,
): SqlSearchStatement {
  const constraints = normalizeToolSearchOptions(rawConstraints)
  const prepared = prepareToolSearchQuery(
    query,
    constraints.pathPrefix === undefined ? TOOL_SEARCH_UNIT_LIMIT : TOOL_SEARCH_UNIT_LIMIT - 1,
  )
  return candidateStatement(prepared.units, prepared.totalTermCount, limit, offset, constraints)
}
