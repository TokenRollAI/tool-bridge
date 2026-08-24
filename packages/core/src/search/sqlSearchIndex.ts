/**
 * SQL SearchIndex 的共享实现——D1、better-sqlite3 与 PostgreSQL 三个 adapter
 * 的编排与候选检索唯一真源。
 *
 * 此前两边各持一份逐行相同的 schema DDL、查询 SQL、material-change 判定与
 * cursor/分页逻辑(共 ~780 行,重合度 >85%),任何一侧改动都得靠人工纪律同步到另
 * 一侧。这里把**所有**与具体驱动无关的部分收进 `SqlSearchIndex`,宿主差异压缩成
 * `SqlSearchDriver` 的五个
 * 方法:
 *
 * - D1 全异步、写入走 `db.batch()`,且单请求有 50 查询预算 —— 故记录插入必须
 *   攒成 JSON1 块(`insertRecords` 返回少量语句)并声明 `assertInsertBudget`;
 * - better-sqlite3 全同步、写入走 `db.transaction()`,无查询预算 —— 逐条插入即可。
 *
 * core 是宿主中立层:这里只产出 SQL 文本与参数数组,不认识 D1Database 也不认识
 * better-sqlite3。
 */

import type { Page, TreePath } from '../types'
import type { ToolSpec } from '../tool/types'
import {
  assertKeywordToolSearchMode,
  decodeToolSearchCursor,
  encodeToolSearchCursor,
  type MutableSearchIndex,
  normalizeToolSearchLimit,
  normalizeToolSearchPath,
  normalizeToolSearchQuery,
  prepareToolSearchUnits,
  type SearchCapability,
  type SearchUnit,
  type SerializedToolSearchRecord,
  serializeToolSearchDocuments,
  serializeToolSearchSnapshot,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
  TOOL_SEARCH_BATCH_LIMIT,
  type ToolSearchCandidate,
  type ToolSearchDocument,
  type ToolSearchOptions,
  toolSearchSnapshotDigest,
  toolSearchSnapshotDigests,
  toolSearchSnapshotDigestsEqual,
} from './types'
import { TBError } from '../errors'

/**
 * 建表语句(幂等)。**元素不带尾分号**:D1 要一条一条 prepare,SQLite 侧自己
 * `join(';')` 后 exec。容量 trigger 把节点上限压在数据库里,不依赖调用方自觉。
 */
export const TOOL_SEARCH_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS tb_search_tools_v4 (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    feedback TEXT NOT NULL DEFAULT '',
    UNIQUE(path, name)
  )`,
  `CREATE TABLE IF NOT EXISTS tb_search_meta_v4 (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    revision INTEGER NOT NULL DEFAULT 0,
    seeded INTEGER NOT NULL DEFAULT 0,
    cursor_secret TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO tb_search_meta_v4(
    singleton, revision, seeded, cursor_secret
  ) VALUES (1, 0, 0, lower(hex(randomblob(32))))`,
  `CREATE TABLE IF NOT EXISTS tb_search_snapshots_v4 (
    path TEXT PRIMARY KEY,
    digest TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS tb_search_snapshots_v4_capacity
  BEFORE INSERT ON tb_search_snapshots_v4
  WHEN NOT EXISTS (
    SELECT 1 FROM tb_search_snapshots_v4 WHERE path = new.path
  ) AND (SELECT COUNT(*) FROM tb_search_snapshots_v4) >= ${TOOL_SEARCH_AUDIT_NODE_LIMIT}
  BEGIN
    SELECT RAISE(ABORT, 'tb_search_path_capacity');
  END`,
] as const

/** 容量 trigger 的 ABORT 标记;驱动抛出的原始错误里含此串即归一为 rate_limited。 */
export const TOOL_SEARCH_CAPACITY_MARKER = 'tb_search_path_capacity'

/** 逐条插入(位置参数:path, name, description, feedback)。 */
export const TOOL_SEARCH_INSERT_SQL = `
INSERT INTO tb_search_tools_v4 (path, name, description, feedback)
VALUES (?, ?, ?, ?)
`

/** JSON1 批量插入(单参数:记录数组的 JSON);给有查询预算的宿主省语句数。 */
export const TOOL_SEARCH_INSERT_JSON_SQL = `
INSERT INTO tb_search_tools_v4 (path, name, description, feedback)
SELECT
  json_extract(value, '$.path'),
  json_extract(value, '$.name'),
  json_extract(value, '$.description'),
  json_extract(value, '$.feedback')
FROM json_each(?)
`

/** 逐条写 path→digest 快照(位置参数:path, digest)。 */
export const TOOL_SEARCH_INSERT_SNAPSHOT_SQL
  = 'INSERT INTO tb_search_snapshots_v4(path, digest) VALUES (?, ?)'

/** JSON1 批量写快照(单参数:`[path, digest]` 二元组数组的 JSON)。 */
export const TOOL_SEARCH_INSERT_SNAPSHOT_JSON_SQL = `
INSERT INTO tb_search_snapshots_v4(path, digest)
SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)
`

const META_SQL
  = 'SELECT revision, seeded, cursor_secret FROM tb_search_meta_v4 WHERE singleton = 1'
const SNAPSHOT_DIGESTS_SQL
  = 'SELECT path, digest FROM tb_search_snapshots_v4 ORDER BY path'
/** replace 的前置探测:一次拿到本 path 的 digest、是否残留 source 行、已用节点数。 */
const PATH_STATE_SQL = `
SELECT snapshots.digest,
  EXISTS(SELECT 1 FROM tb_search_tools_v4 WHERE path = ?) AS has_tools,
  (SELECT COUNT(*) FROM tb_search_snapshots_v4) AS path_count
FROM (SELECT 1) AS singleton
LEFT JOIN tb_search_snapshots_v4 AS snapshots ON snapshots.path = ?
`
const PRESENT_SQL = 'SELECT 1 AS present FROM tb_search_tools_v4 WHERE path = ? LIMIT 1'
const PRESENT_PREFIX_SQL = `
SELECT 1 AS present FROM tb_search_tools_v4
WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'
LIMIT 1
`
const DELETE_TOOLS_SQL = 'DELETE FROM tb_search_tools_v4 WHERE path = ?'
const DELETE_SNAPSHOT_SQL = 'DELETE FROM tb_search_snapshots_v4 WHERE path = ?'
const DELETE_TOOLS_PREFIX_SQL = `
DELETE FROM tb_search_tools_v4
WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'
`
const DELETE_SNAPSHOT_PREFIX_SQL = `
DELETE FROM tb_search_snapshots_v4
WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'
`
const DELETE_ALL_TOOLS_SQL = 'DELETE FROM tb_search_tools_v4'
const DELETE_ALL_SNAPSHOTS_SQL = 'DELETE FROM tb_search_snapshots_v4'
const BUMP_REVISION_SQL
  = 'UPDATE tb_search_meta_v4 SET revision = revision + 1 WHERE singleton = 1'
const COMPLETE_REBUILD_SQL
  = 'UPDATE tb_search_meta_v4 SET seeded = 1, revision = revision + 1 WHERE singleton = 1'

/** 一条待执行语句:SQL 文本 + 按序绑定的参数,不含任何驱动对象。 */
export interface SqlSearchStatement {
  readonly params: readonly unknown[]
  readonly sql: string
}

/**
 * 固定形态语句:参数个数与语义在 core 编排里写死,方言只提供 SQL 文本。
 * 占位符语法(`?` / `$n`)与字符串函数由各方言自行决定。
 */
export interface SqlSearchStatements {
  readonly bumpRevision: string
  readonly completeRebuild: string
  readonly deleteAllSnapshots: string
  readonly deleteAllTools: string
  readonly deleteSnapshot: string
  readonly deleteSnapshotPrefix: string
  readonly deleteTools: string
  readonly deleteToolsPrefix: string
  /** 单 path 的 path→digest 快照插入(replace 内联使用)。 */
  readonly insertSnapshot: string
  /** 读 meta 单例(revision/seeded/cursor_secret)。 */
  readonly meta: string
  /** replace 前置探测:本 path 的 digest、是否残留 source 行、已用节点数。 */
  readonly pathState: string
  /** 单 path 是否存在 source 行。 */
  readonly present: string
  /** path 或其子树是否存在 source 行。 */
  readonly presentPrefix: string
  /** 全量快照 digest,按 path 升序。 */
  readonly snapshotDigests: string
}

/**
 * SQL 方言:把与具体引擎绑定的 SQL 文本从数据库无关的编排里分出来。
 *
 * `SqlSearchIndex` 只认识本接口——候选查询 + 一组固定语句 + 建表 DDL。
 * D1 与 better-sqlite3 同为 SQLite,共用 {@link sqliteSearchDialect};其它引擎
 * (如 Postgres)实现自己的方言,替换占位符与大小写折叠语法。方言只管 SQL 文本,
 * 具体驱动的同步/异步、批量预算、结果整形仍由 {@link SqlSearchDriver} 吸收。
 */
export interface SqlSearchDialect {
  /**
   * 把已 normalize 的 query 变成候选查询语句(含排序与分页)。三后端共用查询单元
   * 展开和评分形态，方言只选择占位符语法与 LIKE/ILIKE。
   */
  candidateStatement(
    query: string,
    limit: number,
    offset: number,
  ): SqlSearchStatement
  /** 建表(幂等),元素不带尾分号。 */
  readonly schemaStatements: readonly string[]
  /** 编排直接下发的固定语句。 */
  readonly statements: SqlSearchStatements
}

interface CandidateRow {
  id: number
  name: string
  path: string
}

interface MetaRow {
  cursor_secret: string
  revision: number
  seeded: number
}

interface PathStateRow {
  digest: string | null
  has_tools: number
  path_count: number
}

/**
 * 宿主驱动:把 `SqlSearchStatement` 落到具体数据库上。
 *
 * `write` 必须原子(D1 `batch` / SQLite `transaction`)——revision bump 与数据变更
 * 分裂会让 cursor 指向不存在的 offset。
 */
export interface SqlSearchDriver {
  /** 多行只读查询。 */
  all: <T>(statement: SqlSearchStatement) => Promise<T[]>
  /**
   * 记录插入语句数上限(可选);只有查询预算受限的宿主(D1 50/请求)需要实现。
   * `count` 是本次 mutation 的记录 + 快照插入语句总数,不含固定的删除/bump。
   */
  assertInsertBudget?: (count: number) => void
  /** 建表(幂等);构造时已建好的宿主实现成 no-op。 */
  ensureSchema: () => Promise<void>
  /** 单行只读查询;无行返回 null。 */
  first: <T>(statement: SqlSearchStatement) => Promise<T | null>
  /** 把记录变成插入语句(JSON1 攒块 or 逐条绑定)。 */
  insertRecords: (records: readonly SerializedToolSearchRecord[]) => SqlSearchStatement[]
  /** 把 path→digest 快照变成插入语句。 */
  insertSnapshots: (digests: ReadonlyMap<TreePath, string>) => SqlSearchStatement[]
  /** 原子执行一组写语句。 */
  write: (statements: readonly SqlSearchStatement[]) => Promise<void>
}

export interface ToolSearchSqlSyntax {
  readonly likeOperator: 'ILIKE' | 'LIKE'
  placeholder(index: number): string
}

/**
 * 三后端候选查询的唯一 SQL 生成器。
 *
 * 每个查询单元只要命中任意索引字段即可召回；tier 与字段权重相乘后逐单元求和。
 * 高 tier 与高权字段通常靠前，但总分不额外承诺“覆盖全部 term”绝对优先。参数只
 * 包含 escaped LIKE pattern、limit 与 offset，tier 和 SQL syntax 都来自受控常量。
 */
export function toolSearchCandidateStatement(
  units: readonly SearchUnit[],
  limit: number,
  offset: number,
  syntax: ToolSearchSqlSyntax,
): SqlSearchStatement {
  const values = units.map((unit, index) =>
    `(${syntax.placeholder(index + 1)}, ${unit.tier})`).join(', ')
  const limitParam = syntax.placeholder(units.length + 1)
  const offsetParam = syntax.placeholder(units.length + 2)
  const like = syntax.likeOperator
  return {
    params: [...units.map(unit => unit.pattern), limit + 1, offset],
    sql: `
      WITH units(pattern, tier) AS (VALUES ${values})
      SELECT * FROM (
        SELECT tools.id, tools.path, tools.name,
          (
            SELECT COALESCE(SUM(units.tier * CASE
              WHEN tools.name ${like} units.pattern ESCAPE '!' THEN 10
              WHEN tools.path ${like} units.pattern ESCAPE '!' THEN 5
              WHEN tools.description ${like} units.pattern ESCAPE '!' THEN 3
              WHEN tools.feedback ${like} units.pattern ESCAPE '!' THEN 1
              ELSE 0
            END), 0)
            FROM units
          ) AS score
        FROM tb_search_tools_v4 AS tools
      ) AS scored_tools
      WHERE score > 0
      ORDER BY score DESC, path, name
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
  }
}

/** JSON1 载荷只取索引列;toolDigest 只参与 material-change 判定,不落库。 */
export function toolSearchInsertPayload(
  records: readonly SerializedToolSearchRecord[],
): Array<Record<string, unknown>> {
  return records.map(record => ({
    description: record.description,
    feedback: record.feedback,
    name: record.name,
    path: record.path,
  }))
}

/** SQLite 方言:D1 与 better-sqlite3 共用纯 LIKE；占位符是 `?`。 */
export const sqliteSearchDialect: SqlSearchDialect = {
  candidateStatement: (query, limit, offset) =>
    toolSearchCandidateStatement(
      prepareToolSearchUnits(query),
      limit,
      offset,
      { likeOperator: 'LIKE', placeholder: () => '?' },
    ),
  schemaStatements: TOOL_SEARCH_SCHEMA_STATEMENTS,
  statements: {
    bumpRevision: BUMP_REVISION_SQL,
    completeRebuild: COMPLETE_REBUILD_SQL,
    deleteAllSnapshots: DELETE_ALL_SNAPSHOTS_SQL,
    deleteAllTools: DELETE_ALL_TOOLS_SQL,
    deleteSnapshot: DELETE_SNAPSHOT_SQL,
    deleteSnapshotPrefix: DELETE_SNAPSHOT_PREFIX_SQL,
    deleteTools: DELETE_TOOLS_SQL,
    deleteToolsPrefix: DELETE_TOOLS_PREFIX_SQL,
    insertSnapshot: TOOL_SEARCH_INSERT_SNAPSHOT_SQL,
    meta: META_SQL,
    pathState: PATH_STATE_SQL,
    present: PRESENT_SQL,
    presentPrefix: PRESENT_PREFIX_SQL,
    snapshotDigests: SNAPSHOT_DIGESTS_SQL,
  },
}

export class SqlSearchIndex implements MutableSearchIndex {
  readonly capabilities: readonly SearchCapability[] = ['search']

  protected readonly dialect: SqlSearchDialect

  constructor(
    protected readonly driver: SqlSearchDriver,
    dialect: SqlSearchDialect = sqliteSearchDialect,
  ) {
    this.dialect = dialect
  }

  /** 容量 trigger 的 ABORT 在各驱动里错误形状不同,统一按标记串归一。 */
  private async writeOrCapacity(statements: readonly SqlSearchStatement[]): Promise<void> {
    try {
      await this.driver.write(statements)
    } catch (error) {
      if (String(error).includes(TOOL_SEARCH_CAPACITY_MARKER)) {
        throw new TBError('rate_limited', '工具搜索索引节点容量已满')
      }
      throw error
    }
  }

  private async meta(): Promise<MetaRow> {
    const row = await this.driver.first<MetaRow>({ params: [], sql: this.dialect.statements.meta })
    if (row === null) throw new TBError('internal', '工具搜索 meta 缺失')
    return row
  }

  private async snapshotDigests(): Promise<Map<TreePath, string>> {
    const rows = await this.driver.all<{ digest: string, path: string }>({
      params: [],
      sql: this.dialect.statements.snapshotDigests,
    })
    return new Map(rows.map(row => [row.path, row.digest]))
  }

  async initialized(): Promise<boolean> {
    await this.driver.ensureSchema()
    return (await this.meta()).seeded === 1
  }

  async replace(
    path: TreePath,
    tools: readonly ToolSpec[],
    opts: { feedback?: string } = {},
  ): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    const records = serializeToolSearchSnapshot(canonical, tools, opts.feedback ?? '')
    await this.driver.ensureSchema()
    const current = await this.driver.first<PathStateRow>({
      params: [canonical, canonical],
      sql: this.dialect.statements.pathState,
    })
    const digest = records.length === 0 ? null : toolSearchSnapshotDigest(records)
    // 快照未实质变化(含"本来就空、现在还空")→ 不 bump revision,避免无谓失效全部 cursor。
    if (
      current !== null
      && (
        (digest !== null && current.digest === digest)
        || (digest === null && current.digest === null && current.has_tools === 0)
      )
    ) return
    // 新增 path 且已达节点上限:先在应用层拒,trigger 只是兜底。
    if (
      digest !== null
      && current?.digest === null
      && (current?.path_count ?? 0) >= TOOL_SEARCH_AUDIT_NODE_LIMIT
    ) {
      throw new TBError('rate_limited', '工具搜索索引节点容量已满')
    }
    const inserts = this.driver.insertRecords(records)
    this.driver.assertInsertBudget?.(inserts.length)
    const statements = this.dialect.statements
    await this.writeOrCapacity([
      { params: [canonical], sql: statements.deleteTools },
      ...inserts,
      { params: [canonical], sql: statements.deleteSnapshot },
      ...(digest === null
        ? []
        : [{ params: [canonical, digest], sql: statements.insertSnapshot }]),
      { params: [], sql: statements.bumpRevision },
    ])
  }

  async remove(path: TreePath): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    await this.driver.ensureSchema()
    const current = await this.driver.first<{ present: number }>({
      params: [canonical],
      sql: this.dialect.statements.present,
    })
    if (current === null) return
    const statements = this.dialect.statements
    await this.driver.write([
      { params: [canonical], sql: statements.deleteTools },
      { params: [canonical], sql: statements.deleteSnapshot },
      { params: [], sql: statements.bumpRevision },
    ])
  }

  async removePrefix(path: TreePath): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    await this.driver.ensureSchema()
    const prefixParams = [canonical, canonical, canonical]
    const current = await this.driver.first<{ present: number }>({
      params: prefixParams,
      sql: this.dialect.statements.presentPrefix,
    })
    if (current === null) return
    const statements = this.dialect.statements
    await this.driver.write([
      { params: prefixParams, sql: statements.deleteToolsPrefix },
      { params: prefixParams, sql: statements.deleteSnapshotPrefix },
      { params: [], sql: statements.bumpRevision },
    ])
  }

  async rebuild(documents: readonly ToolSearchDocument[]): Promise<void> {
    const records = serializeToolSearchDocuments(documents)
    await this.driver.ensureSchema()
    const desired = toolSearchSnapshotDigests(records)
    const current = await this.snapshotDigests()
    // 已 seed 且全树摘要一致 → 整次 rebuild 是 no-op(运维重跑不惊动 cursor)。
    if ((await this.meta()).seeded === 1 && toolSearchSnapshotDigestsEqual(current, desired)) {
      return
    }
    const inserts = this.driver.insertRecords(records)
    const snapshots = this.driver.insertSnapshots(desired)
    this.driver.assertInsertBudget?.(inserts.length + snapshots.length)
    const statements = this.dialect.statements
    await this.writeOrCapacity([
      { params: [], sql: statements.deleteAllTools },
      { params: [], sql: statements.deleteAllSnapshots },
      ...inserts,
      ...snapshots,
      { params: [], sql: statements.completeRebuild },
    ])
  }

  async search(query: string, opts?: ToolSearchOptions): Promise<Page<ToolSearchCandidate>> {
    assertKeywordToolSearchMode(opts)
    const normalized = normalizeToolSearchQuery(query)
    const mode = opts?.mode ?? 'keyword'
    await this.driver.ensureSchema()
    const meta = await this.meta()
    const revision = meta.revision
    const offset = await decodeToolSearchCursor(
      opts?.cursor,
      normalized,
      mode,
      revision,
      meta.cursor_secret,
    )
    const limit = Math.min(normalizeToolSearchLimit(opts?.limit), TOOL_SEARCH_BATCH_LIMIT)
    const rows = await this.driver.all<CandidateRow>(
      this.dialect.candidateStatement(normalized, limit, offset),
    )
    // 多取一条只为判断 hasMore,不进入返回页。
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const items = page.map((row, index): ToolSearchCandidate => ({
      name: row.name,
      path: row.path,
      ref: String(row.id),
      resumeOffset: offset + index + 1,
      revision,
    }))
    const last = items[items.length - 1]
    return hasMore && last !== undefined
      ? {
          items,
          cursor: await encodeToolSearchCursor(
            normalized,
            mode,
            revision,
            last.resumeOffset,
            meta.cursor_secret,
          ),
        }
      : { items }
  }

  async cursorFor(
    query: string,
    candidate: ToolSearchCandidate,
    mode: 'keyword' | 'semantic' = 'keyword',
  ): Promise<string> {
    await this.driver.ensureSchema()
    const meta = await this.meta()
    if (candidate.revision !== meta.revision) {
      throw new TBError('invalid_argument', '搜索 cursor 已失效')
    }
    return await encodeToolSearchCursor(
      query,
      mode,
      meta.revision,
      candidate.resumeOffset,
      meta.cursor_secret,
    )
  }
}
