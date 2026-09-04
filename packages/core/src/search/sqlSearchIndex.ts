/** PostgreSQL SearchIndex orchestration: atomic mutations, snapshot revisions and sealed cursors. */
import type { Page, TreePath } from '../types'
import type { ToolSpec } from '../tool/types'
import {
  assertKeywordToolSearchMode,
  decodeToolSearchCursor,
  encodeToolSearchCursor,
  encodeToolSearchCursorForCandidate,
  type MutableSearchIndex,
  normalizeToolSearchLimit,
  normalizeToolSearchOptions,
  normalizeToolSearchPath,
  normalizeToolSearchQuery,
  type SearchCapability,
  type SerializedToolSearchRecord,
  serializeToolSearchDocuments,
  serializeToolSearchSnapshot,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
  TOOL_SEARCH_BATCH_LIMIT,
  type ToolSearchCandidate,
  type ToolSearchDocument,
  type ToolSearchOptions,
  toolSearchOptionsFingerprint,
  toolSearchSnapshotDigest,
  toolSearchSnapshotDigests,
  toolSearchSnapshotDigestsEqual,
} from './types'
import { PG_SEARCH_STATEMENTS, pgSearchCandidateStatement, type SqlSearchStatement, TOOL_SEARCH_CAPACITY_MARKER } from './pgSearchSql'
import { TBError } from '../errors'

interface CandidateRow {
  id: number
  matched_term_count: number
  name: string
  path: string
  total_term_count: number
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

/** PostgreSQL I/O boundary. All mutations execute in one transaction under the search write lock. */
export interface SqlSearchDriver {
  /** 多行只读查询。 */
  all: <T>(statement: SqlSearchStatement) => Promise<T[]>
  /** 建表(幂等)，初始化状态由 PG 驱动维护。 */
  ensureSchema: () => Promise<void>
  /** 单行只读查询;无行返回 null。 */
  first: <T>(statement: SqlSearchStatement) => Promise<T | null>
  /** 把记录分成有界的 PostgreSQL 多行 VALUES 插入语句。 */
  insertRecords: (records: readonly SerializedToolSearchRecord[]) => SqlSearchStatement[]
  /** 把 path→digest 快照变成插入语句。 */
  insertSnapshots: (digests: ReadonlyMap<TreePath, string>) => SqlSearchStatement[]
  /** 原子执行一组写语句。 */
  write: (statements: readonly SqlSearchStatement[]) => Promise<void>
}

export class SqlSearchIndex implements MutableSearchIndex {
  readonly capabilities: readonly SearchCapability[] = ['search']

  protected readonly driver: SqlSearchDriver
  constructor(driver: SqlSearchDriver) {
    this.driver = driver
  }

  /** PG 容量触发器的失败按固定标记归一。 */
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
    const row = await this.driver.first<MetaRow>({ params: [], sql: PG_SEARCH_STATEMENTS.meta })
    if (row === null) throw new TBError('internal', '工具搜索 meta 缺失')
    return row
  }

  private async snapshotDigests(): Promise<Map<TreePath, string>> {
    const rows = await this.driver.all<{ digest: string, path: string }>({
      params: [],
      sql: PG_SEARCH_STATEMENTS.snapshotDigests,
    })
    return new Map(rows.map(row => [row.path, row.digest]))
  }

  async initialized(): Promise<boolean> {
    await this.driver.ensureSchema()
    return (await this.meta()).seeded === 1
  }

  async revision(): Promise<number> {
    await this.driver.ensureSchema()
    return (await this.meta()).revision
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
      sql: PG_SEARCH_STATEMENTS.pathState,
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
    const statements = PG_SEARCH_STATEMENTS
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
      sql: PG_SEARCH_STATEMENTS.present,
    })
    if (current === null) return
    const statements = PG_SEARCH_STATEMENTS
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
      sql: PG_SEARCH_STATEMENTS.presentPrefix,
    })
    if (current === null) return
    const statements = PG_SEARCH_STATEMENTS
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
    const statements = PG_SEARCH_STATEMENTS
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
    const constraints = normalizeToolSearchOptions(opts)
    const optionsFingerprint = toolSearchOptionsFingerprint(constraints)
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
      constraints,
    )
    const limit = Math.min(normalizeToolSearchLimit(opts?.limit), TOOL_SEARCH_BATCH_LIMIT)
    const rows = await this.driver.all<CandidateRow>(
      pgSearchCandidateStatement(normalized, limit, offset, constraints),
    )
    // best 每页只暴露当前最高 coverage band；若下一行已降档，cursor 正好落在
    // band 边界，续页再以剩余结果的最高档开页。all 已由 SQL 收紧为 full coverage。
    const firstBand = rows[0]?.matched_term_count
    const bandEnd = constraints.matching === 'best' && firstBand !== undefined
      ? rows.findIndex(row => row.matched_term_count !== firstBand)
      : -1
    const pageLength = bandEnd >= 0 ? Math.min(limit, bandEnd) : Math.min(limit, rows.length)
    const page = rows.slice(0, pageLength)
    const hasMore = rows.length > page.length
    const items = page.map((row, index): ToolSearchCandidate => ({
      coverage: row.matched_term_count / row.total_term_count,
      matchedTermCount: row.matched_term_count,
      name: row.name,
      path: row.path,
      ref: String(row.id),
      resumeOffset: offset + index + 1,
      revision,
      searchOptionsFingerprint: optionsFingerprint,
      totalTermCount: row.total_term_count,
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
            constraints,
          ),
        }
      : { items }
  }

  async cursorFor(
    query: string,
    candidate: ToolSearchCandidate,
    mode: 'keyword' = 'keyword',
  ): Promise<string> {
    await this.driver.ensureSchema()
    const meta = await this.meta()
    if (candidate.revision !== meta.revision) {
      throw new TBError('invalid_argument', '搜索 cursor 已失效')
    }
    return await encodeToolSearchCursorForCandidate(
      query,
      mode,
      candidate,
      meta.cursor_secret,
    )
  }
}
