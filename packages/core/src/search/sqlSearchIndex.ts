/**
 * SQLite 系 SearchIndex 的共享实现——D1(Workers)与 better-sqlite3(Node)两个
 * adapter 的唯一真源。
 *
 * 此前两边各持一份逐行相同的 schema DDL、查询 SQL、material-change 判定与
 * cursor/分页逻辑(共 ~780 行,重合度 >85%),任何一侧改动都得靠人工纪律同步到另
 * 一侧;`shortTermSql.ts` 只收敛了其中最容易出事的一小段。这里把**所有**与具体
 * 驱动无关的部分收进 `SqlSearchIndex`,宿主差异压缩成 `SqlSearchDriver` 的五个
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
  type PreparedToolSearchQuery,
  prepareToolSearchQuery,
  type SearchCapability,
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
import { SHORT_MATCH_SQL, SHORT_SCORE_SQL, shortTermsSql } from './shortTermSql'
import { TBError } from '../errors'

/**
 * 建表语句(幂等)。**元素不带尾分号**:D1 要一条一条 prepare,SQLite 侧自己
 * `join(';')` 后 exec。容量 trigger 把节点上限压在数据库里,不依赖调用方自觉。
 */
export const TOOL_SEARCH_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS tb_search_tools_v3 (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    feedback TEXT NOT NULL DEFAULT '',
    UNIQUE(path, name)
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS tb_search_tools_fts_v3 USING fts5(
    name,
    description,
    feedback,
    content='tb_search_tools_v3',
    content_rowid='id',
    tokenize='trigram'
  )`,
  `CREATE TRIGGER IF NOT EXISTS tb_search_tools_v3_ai AFTER INSERT ON tb_search_tools_v3 BEGIN
    INSERT INTO tb_search_tools_fts_v3(rowid, name, description, feedback)
    VALUES (new.id, new.name, new.description, new.feedback);
  END`,
  `CREATE TRIGGER IF NOT EXISTS tb_search_tools_v3_ad AFTER DELETE ON tb_search_tools_v3 BEGIN
    INSERT INTO tb_search_tools_fts_v3(tb_search_tools_fts_v3, rowid, name, description, feedback)
    VALUES ('delete', old.id, old.name, old.description, old.feedback);
  END`,
  `CREATE TRIGGER IF NOT EXISTS tb_search_tools_v3_au
  AFTER UPDATE OF name, description, feedback ON tb_search_tools_v3 BEGIN
    INSERT INTO tb_search_tools_fts_v3(tb_search_tools_fts_v3, rowid, name, description, feedback)
    VALUES ('delete', old.id, old.name, old.description, old.feedback);
    INSERT INTO tb_search_tools_fts_v3(rowid, name, description, feedback)
    VALUES (new.id, new.name, new.description, new.feedback);
  END`,
  `CREATE TABLE IF NOT EXISTS tb_search_meta_v3 (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    revision INTEGER NOT NULL DEFAULT 0,
    seeded INTEGER NOT NULL DEFAULT 0,
    cursor_secret TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO tb_search_meta_v3(
    singleton, revision, seeded, cursor_secret
  ) VALUES (1, 0, 0, lower(hex(randomblob(32))))`,
  `CREATE TABLE IF NOT EXISTS tb_search_snapshots_v3 (
    path TEXT PRIMARY KEY,
    digest TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS tb_search_snapshots_v3_capacity
  BEFORE INSERT ON tb_search_snapshots_v3
  WHEN NOT EXISTS (
    SELECT 1 FROM tb_search_snapshots_v3 WHERE path = new.path
  ) AND (SELECT COUNT(*) FROM tb_search_snapshots_v3) >= ${TOOL_SEARCH_AUDIT_NODE_LIMIT}
  BEGIN
    SELECT RAISE(ABORT, 'tb_search_path_capacity');
  END`,
] as const

/** 容量 trigger 的 ABORT 标记;驱动抛出的原始错误里含此串即归一为 rate_limited。 */
export const TOOL_SEARCH_CAPACITY_MARKER = 'tb_search_path_capacity'

/** 逐条插入(位置参数:path, name, description, feedback)。 */
export const TOOL_SEARCH_INSERT_SQL = `
INSERT INTO tb_search_tools_v3 (path, name, description, feedback)
VALUES (?, ?, ?, ?)
`

/** JSON1 批量插入(单参数:记录数组的 JSON);给有查询预算的宿主省语句数。 */
export const TOOL_SEARCH_INSERT_JSON_SQL = `
INSERT INTO tb_search_tools_v3 (path, name, description, feedback)
SELECT
  json_extract(value, '$.path'),
  json_extract(value, '$.name'),
  json_extract(value, '$.description'),
  json_extract(value, '$.feedback')
FROM json_each(?)
`

/** 逐条写 path→digest 快照(位置参数:path, digest)。 */
export const TOOL_SEARCH_INSERT_SNAPSHOT_SQL
  = 'INSERT INTO tb_search_snapshots_v3(path, digest) VALUES (?, ?)'

/** JSON1 批量写快照(单参数:`[path, digest]` 二元组数组的 JSON)。 */
export const TOOL_SEARCH_INSERT_SNAPSHOT_JSON_SQL = `
INSERT INTO tb_search_snapshots_v3(path, digest)
SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)
`

const META_SQL
  = 'SELECT revision, seeded, cursor_secret FROM tb_search_meta_v3 WHERE singleton = 1'
const SNAPSHOT_DIGESTS_SQL
  = 'SELECT path, digest FROM tb_search_snapshots_v3 ORDER BY path'
/** replace 的前置探测:一次拿到本 path 的 digest、是否残留 source 行、已用节点数。 */
const PATH_STATE_SQL = `
SELECT snapshots.digest,
  EXISTS(SELECT 1 FROM tb_search_tools_v3 WHERE path = ?) AS has_tools,
  (SELECT COUNT(*) FROM tb_search_snapshots_v3) AS path_count
FROM (SELECT 1) AS singleton
LEFT JOIN tb_search_snapshots_v3 AS snapshots ON snapshots.path = ?
`
const PRESENT_SQL = 'SELECT 1 AS present FROM tb_search_tools_v3 WHERE path = ? LIMIT 1'
const PRESENT_PREFIX_SQL = `
SELECT 1 AS present FROM tb_search_tools_v3
WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'
LIMIT 1
`
const DELETE_TOOLS_SQL = 'DELETE FROM tb_search_tools_v3 WHERE path = ?'
const DELETE_SNAPSHOT_SQL = 'DELETE FROM tb_search_snapshots_v3 WHERE path = ?'
const DELETE_TOOLS_PREFIX_SQL = `
DELETE FROM tb_search_tools_v3
WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'
`
const DELETE_SNAPSHOT_PREFIX_SQL = `
DELETE FROM tb_search_snapshots_v3
WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'
`
const DELETE_ALL_TOOLS_SQL = 'DELETE FROM tb_search_tools_v3'
const DELETE_ALL_SNAPSHOTS_SQL = 'DELETE FROM tb_search_snapshots_v3'
const BUMP_REVISION_SQL
  = 'UPDATE tb_search_meta_v3 SET revision = revision + 1 WHERE singleton = 1'
const COMPLETE_REBUILD_SQL
  = 'UPDATE tb_search_meta_v3 SET seeded = 1, revision = revision + 1 WHERE singleton = 1'

/** 一条待执行语句:SQL 文本 + 按序绑定的参数,不含任何驱动对象。 */
export interface SqlSearchStatement {
  readonly params: readonly unknown[]
  readonly sql: string
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

/** 候选查询:短词 LIKE / 长词 trigram FTS / 两者 AND,三形态共用同一套排序与分页。 */
export function toolSearchCandidateStatement(
  prepared: PreparedToolSearchQuery,
  limit: number,
  offset: number,
): SqlSearchStatement {
  if (prepared.kind === 'like') {
    return {
      params: [...prepared.patterns, limit + 1, offset],
      sql: `
        WITH ${shortTermsSql(prepared.patterns)}
        SELECT tools.id, tools.path, tools.name, ${SHORT_SCORE_SQL} AS short_score
        FROM tb_search_tools_v3 AS tools
        WHERE ${SHORT_MATCH_SQL}
        ORDER BY short_score DESC, tools.path, tools.name
        LIMIT ? OFFSET ?
      `,
    }
  }
  if (prepared.kind === 'hybrid') {
    return {
      params: [...prepared.patterns, prepared.expression, limit + 1, offset],
      sql: `
        WITH ${shortTermsSql(prepared.patterns)},
        long_hits AS (
          SELECT tools.id, bm25(tb_search_tools_fts_v3, 10.0, 3.0, 1.0) AS fts_rank
          FROM tb_search_tools_fts_v3
          JOIN tb_search_tools_v3 AS tools ON tools.id = tb_search_tools_fts_v3.rowid
          WHERE tb_search_tools_fts_v3 MATCH ?
        )
        SELECT tools.id, tools.path, tools.name, long_hits.fts_rank,
          ${SHORT_SCORE_SQL} AS short_score
        FROM long_hits
        JOIN tb_search_tools_v3 AS tools ON tools.id = long_hits.id
        WHERE ${SHORT_MATCH_SQL}
        ORDER BY long_hits.fts_rank, short_score DESC, tools.path, tools.name
        LIMIT ? OFFSET ?
      `,
    }
  }
  return {
    params: [prepared.expression, limit + 1, offset],
    sql: `
      SELECT tools.id, tools.path, tools.name
      FROM tb_search_tools_fts_v3
      JOIN tb_search_tools_v3 AS tools ON tools.id = tb_search_tools_fts_v3.rowid
      WHERE tb_search_tools_fts_v3 MATCH ?
      ORDER BY bm25(tb_search_tools_fts_v3, 10.0, 3.0, 1.0), tools.path, tools.name
      LIMIT ? OFFSET ?
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

export class SqlSearchIndex implements MutableSearchIndex {
  readonly capabilities: readonly SearchCapability[] = ['search']

  constructor(protected readonly driver: SqlSearchDriver) {}

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
    const row = await this.driver.first<MetaRow>({ params: [], sql: META_SQL })
    if (row === null) throw new TBError('internal', '工具搜索 meta 缺失')
    return row
  }

  private async snapshotDigests(): Promise<Map<TreePath, string>> {
    const rows = await this.driver.all<{ digest: string, path: string }>({
      params: [],
      sql: SNAPSHOT_DIGESTS_SQL,
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
      sql: PATH_STATE_SQL,
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
    await this.writeOrCapacity([
      { params: [canonical], sql: DELETE_TOOLS_SQL },
      ...inserts,
      { params: [canonical], sql: DELETE_SNAPSHOT_SQL },
      ...(digest === null
        ? []
        : [{ params: [canonical, digest], sql: TOOL_SEARCH_INSERT_SNAPSHOT_SQL }]),
      { params: [], sql: BUMP_REVISION_SQL },
    ])
  }

  async remove(path: TreePath): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    await this.driver.ensureSchema()
    const current = await this.driver.first<{ present: number }>({
      params: [canonical],
      sql: PRESENT_SQL,
    })
    if (current === null) return
    await this.driver.write([
      { params: [canonical], sql: DELETE_TOOLS_SQL },
      { params: [canonical], sql: DELETE_SNAPSHOT_SQL },
      { params: [], sql: BUMP_REVISION_SQL },
    ])
  }

  async removePrefix(path: TreePath): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    await this.driver.ensureSchema()
    const prefixParams = [canonical, canonical, canonical]
    const current = await this.driver.first<{ present: number }>({
      params: prefixParams,
      sql: PRESENT_PREFIX_SQL,
    })
    if (current === null) return
    await this.driver.write([
      { params: prefixParams, sql: DELETE_TOOLS_PREFIX_SQL },
      { params: prefixParams, sql: DELETE_SNAPSHOT_PREFIX_SQL },
      { params: [], sql: BUMP_REVISION_SQL },
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
    await this.writeOrCapacity([
      { params: [], sql: DELETE_ALL_TOOLS_SQL },
      { params: [], sql: DELETE_ALL_SNAPSHOTS_SQL },
      ...inserts,
      ...snapshots,
      { params: [], sql: COMPLETE_REBUILD_SQL },
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
      toolSearchCandidateStatement(prepareToolSearchQuery(normalized), limit, offset),
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
