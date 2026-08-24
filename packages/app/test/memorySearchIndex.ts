import {
  assertKeywordToolSearchMode,
  decodeToolSearchCursor,
  encodeToolSearchCursor,
  type MutableSearchIndex,
  normalizeToolSearchLimit,
  normalizeToolSearchPath,
  normalizeToolSearchQuery,
  type Page,
  prepareToolSearchUnits,
  type SearchCapability,
  type SerializedToolSearchRecord,
  serializeToolSearchDocuments,
  serializeToolSearchSnapshot,
  TBError,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
  TOOL_SEARCH_BATCH_LIMIT,
  type ToolSearchCandidate,
  type ToolSearchDocument,
  type ToolSearchOptions,
  toolSearchSnapshotDigest,
  type ToolSpec,
  type TreePath,
} from '@tool-bridge/core'

/**
 * `MutableSearchIndex` 的内存实现,给中立层测试用。
 *
 * **它不是 D1/SQLite adapter 的替身**:SQL 执行、JSON1 分块与 D1 query
 * 预算由 `packages/gateway` 的 `d1SearchIndex.integration` 用真实 D1 覆盖,
 * 这里只复用 core 搜索单元做大小写不敏感的子串匹配。它覆盖的是**另一件事**:
 * SearchSynchronizer → 索引 → 权限裁剪 → canonical 水合这条联动链,以及
 * `/~search`、`/~mcp` 的 `tb_search` 投影在"宿主注入了索引"时的行为。
 *
 * 序列化、快照 digest、query 预处理、cursor 加解密、limit 归一全部复用 core 的
 * 共享实现——adapter 之间真正该一致的部分因此不是靠各自抄一遍来保证的。
 *
 * 顺带它也是第三个 SearchIndex 参考实现:这个注入点不绑 SQL,更不绑 Cloudflare。
 * 若要让 SDK 内存宿主缺省具备搜索能力,把它提升进 core 与 MemoryStateStore /
 * MemoryObjectStore 并列即可(当前刻意不做,避免测试迁移这一刀顺手扩产品面)。
 */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function groupByPath(
  records: readonly SerializedToolSearchRecord[],
): Map<TreePath, SerializedToolSearchRecord[]> {
  const grouped = new Map<TreePath, SerializedToolSearchRecord[]>()
  for (const record of records) {
    const group = grouped.get(record.path)
    if (group === undefined) grouped.set(record.path, [record])
    else group.push(record)
  }
  return grouped
}

/**
 * 还原 core 生成的 escaped LIKE pattern,仅用于内存子串匹配。
 */
function likePatternLiteral(pattern: string): string {
  let literal = ''
  for (let index = 1; index < pattern.length - 1; index += 1) {
    const codePoint = pattern[index]
    if (codePoint === '!') index += 1
    literal += pattern[index]
  }
  return literal.toLowerCase()
}

/** 部分命中即召回;每个单元只计入权重最高的命中字段。 */
function scoreRecord(
  record: SerializedToolSearchRecord,
  units: ReturnType<typeof prepareToolSearchUnits>,
): number {
  const name = record.name.toLowerCase()
  const path = record.path.toLowerCase()
  const description = record.description.toLowerCase()
  const feedback = record.feedback.toLowerCase()
  let total = 0
  for (const unit of units) {
    const literal = likePatternLiteral(unit.pattern)
    if (name.includes(literal)) total += unit.tier * 10
    else if (path.includes(literal)) total += unit.tier * 5
    else if (description.includes(literal)) total += unit.tier * 3
    else if (feedback.includes(literal)) total += unit.tier
  }
  return total
}

export class MemorySearchIndex implements MutableSearchIndex {
  readonly capabilities: readonly SearchCapability[] = ['search']

  /** cursor HMAC/AES 密钥;真 adapter 存在 meta 表,内存版固定即可。 */
  private readonly cursorSecret = 'a'.repeat(64)
  private nextRef = 1
  /** path+name → 稳定 ref(对应 D1 的 rowid)。 */
  private readonly refs = new Map<string, string>()
  private revision = 0
  private seeded = false
  /** path → 该节点的完整快照(replace 的写入单位是节点,不是单条工具)。 */
  private readonly snapshots = new Map<TreePath, {
    digest: string
    records: SerializedToolSearchRecord[]
  }>()

  async cursorFor(
    query: string,
    candidate: ToolSearchCandidate,
    mode: 'keyword' | 'semantic' = 'keyword',
  ): Promise<string> {
    if (candidate.revision !== this.revision) {
      throw new TBError('invalid_argument', '搜索 cursor 已失效')
    }
    return await encodeToolSearchCursor(
      query,
      mode,
      candidate.revision,
      candidate.resumeOffset,
      this.cursorSecret,
    )
  }

  async initialized(): Promise<boolean> {
    return this.seeded
  }

  async rebuild(documents: readonly ToolSearchDocument[]): Promise<void> {
    const records = serializeToolSearchDocuments(documents)
    this.snapshots.clear()
    for (const [path, group] of groupByPath(records)) {
      this.snapshots.set(path, { digest: toolSearchSnapshotDigest(group), records: group })
    }
    this.seeded = true
    this.revision += 1
  }

  async remove(path: TreePath): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    if (!this.snapshots.delete(canonical)) return
    this.revision += 1
  }

  async removePrefix(path: TreePath): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    const prefix = `${canonical}/`
    let removed = false
    for (const key of [...this.snapshots.keys()]) {
      if (key !== canonical && !key.startsWith(prefix)) continue
      this.snapshots.delete(key)
      removed = true
    }
    if (removed) this.revision += 1
  }

  async replace(
    path: TreePath,
    tools: readonly ToolSpec[],
    opts: { feedback?: string } = {},
  ): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    const records = serializeToolSearchSnapshot(canonical, tools, opts.feedback ?? '')
    const current = this.snapshots.get(canonical)
    if (records.length === 0) {
      if (current === undefined) return
      this.snapshots.delete(canonical)
      this.revision += 1
      return
    }
    const digest = toolSearchSnapshotDigest(records)
    // material change 才 bump revision:相同快照重写不该失效在途 cursor。
    if (current?.digest === digest) return
    if (current === undefined && this.snapshots.size >= TOOL_SEARCH_AUDIT_NODE_LIMIT) {
      throw new TBError('rate_limited', '工具搜索索引节点容量已满')
    }
    this.snapshots.set(canonical, { digest, records })
    this.revision += 1
  }

  async search(query: string, opts?: ToolSearchOptions): Promise<Page<ToolSearchCandidate>> {
    assertKeywordToolSearchMode(opts)
    const normalized = normalizeToolSearchQuery(query)
    const mode = opts?.mode ?? 'keyword'
    const revision = this.revision
    const offset = await decodeToolSearchCursor(
      opts?.cursor,
      normalized,
      mode,
      revision,
      this.cursorSecret,
    )
    const limit = Math.min(normalizeToolSearchLimit(opts?.limit), TOOL_SEARCH_BATCH_LIMIT)

    const units = prepareToolSearchUnits(normalized)
    const matched = [...this.snapshots.values()]
      .flatMap(snapshot => snapshot.records)
      .map(record => ({ record, score: scoreRecord(record, units) }))
      .filter(entry => entry.score > 0)
      // name(10) / path(5) / description(3) / feedback(1) 加权;
      // 同分按 path、name 稳定排序,保证分页确定。
      .sort((a, b) =>
        b.score - a.score
        || compare(a.record.path, b.record.path)
        || compare(a.record.name, b.record.name))
      .map(entry => entry.record)

    const window = matched.slice(offset, offset + limit + 1)
    const hasMore = window.length > limit
    const page = hasMore ? window.slice(0, limit) : window
    const items = page.map((record, index): ToolSearchCandidate => ({
      name: record.name,
      path: record.path,
      ref: this.refFor(record),
      resumeOffset: offset + index + 1,
      revision,
    }))
    const last = items[items.length - 1]
    if (!hasMore || last === undefined) return { items }
    return {
      items,
      cursor: await encodeToolSearchCursor(
        normalized,
        mode,
        revision,
        last.resumeOffset,
        this.cursorSecret,
      ),
    }
  }

  /** 稳定 ref(path+name → 递增 id),与 D1 的 rowid 同语义。 */
  private refFor(record: SerializedToolSearchRecord): string {
    const key = `${record.path} ${record.name}`
    const existing = this.refs.get(key)
    if (existing !== undefined) return existing
    const ref = String(this.nextRef++)
    this.refs.set(key, ref)
    return ref
  }
}
