import {
  effectFor,
  type FeedbackEntry,
  isTBError,
  KEY_FEEDBACK,
  type MutableSearchIndex,
  NodeRegistryStore,
  normalizeToolSearchPath,
  parseFeedbackEntries,
  selectFeedbackSearchText,
  serializeToolSearchSnapshot,
  type StateStore,
  TBError,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
  type ToolSearchDocument,
  toolSearchSnapshotDigest,
  type ToolSpec,
  type TreeNode,
  type TreePath,
} from '@tool-bridge/core'
import { cachedTools, peekToolCache, toolCacheKey } from '../providers/toolCache'

const DIRTY_NODE_PREFIX = 'searchdirty:node:'
const DIRTY_SUBTREE_PREFIX = 'searchdirty:subtree:'

export interface SearchDirtyMarker {
  committedAt?: number
  createdAt: number
  expectedDigest?: string | null
  key: string
  kind: 'node' | 'subtree'
  path: TreePath
}

export function isMutableSearchIndex(value: unknown): value is MutableSearchIndex {
  if (typeof value !== 'object' || value === null) return false
  const index = value as Partial<MutableSearchIndex>
  return typeof index.replace === 'function'
    && typeof index.remove === 'function'
    && typeof index.removePrefix === 'function'
    && typeof index.rebuild === 'function'
    && typeof index.initialized === 'function'
}

function toolNode(node: TreeNode): boolean {
  return (
    (node.kind === 'mcp' || node.kind === 'http' || node.kind === 'tool')
    && node.config?.kind === node.kind
  )
}

function httpTools(node: TreeNode): ToolSpec[] | null {
  if (node.config?.kind !== 'http') return null
  return node.config.tools.map((tool) => {
    const spec: ToolSpec = {
      description: tool.description,
      effect: effectFor(tool),
      name: tool.name,
    }
    if (tool.inputSchema !== undefined) spec.inputSchema = tool.inputSchema
    return spec
  })
}

function deviceTools(node: TreeNode): ToolSpec[] | null {
  if (node.config?.kind !== 'tool') return null
  const cmds = node.config.providerConfig?.cmds
  if (!Array.isArray(cmds)) return null
  return cmds as ToolSpec[]
}

/** Resolve complete raw ToolSpecs from canonical registry/config/cache state in one bulk read. */
export async function canonicalSearchTools(
  state: StateStore,
  nodes: readonly TreeNode[],
): Promise<Map<TreePath, ToolSpec[]>> {
  const unique = new Map(nodes.map(node => [node.path, node]))
  const dynamicPaths = [...unique.values()]
    .filter(node => node.kind !== 'http' && deviceTools(node) === null)
    .map(node => node.path)
  const cached = dynamicPaths.length === 0
    ? new Map<string, unknown>()
    : await state.getMany(dynamicPaths.map(toolCacheKey))
  const result = new Map<TreePath, ToolSpec[]>()
  for (const node of unique.values()) {
    const tools = node.kind === 'http'
      ? httpTools(node)
      : deviceTools(node) ?? cachedTools(cached.get(toolCacheKey(node.path)))
    if (tools !== null) result.set(node.path, tools)
  }
  return result
}

function documentsFor(path: TreePath, tools: readonly ToolSpec[], feedback: string): ToolSearchDocument[] {
  return tools.map(tool => ({ path, tool, ...(feedback === '' ? {} : { feedback }) }))
}

/**
 * StateStore 是 canonical state，SearchIndex 是可重建派生状态。mutation 前写 dirty marker，
 * 热同步成功后清除；每次搜索仍重做幂等 canonical 快照审计。KV 没有传播完成的硬确认，
 * marker 只能帮助失败诊断，不能成为派生状态最终收敛的唯一触发器。
 */
export class SearchSynchronizer {
  private readonly registry: NodeRegistryStore
  private seedPromise: Promise<void> | undefined

  constructor(
    private readonly state: StateStore,
    private readonly search: MutableSearchIndex,
  ) {
    this.registry = new NodeRegistryStore(state)
  }

  private async mark(path: TreePath, kind: SearchDirtyMarker['kind']): Promise<SearchDirtyMarker> {
    const canonical = normalizeToolSearchPath(path)
    const marker: SearchDirtyMarker = {
      createdAt: Date.now(),
      // Marker 只是审计提示，正确性由每次 canonical audit 保证。每类固定一个 key，
      // 避免 overflow/device hello 用 UUID marker 把 KV 与扫描成本无界放大。
      key: `${kind === 'node' ? DIRTY_NODE_PREFIX : DIRTY_SUBTREE_PREFIX}pending`,
      kind,
      path: canonical,
    }
    await this.state.put(marker.key, marker)
    return marker
  }

  async markNode(path: TreePath): Promise<SearchDirtyMarker> {
    return await this.mark(path, 'node')
  }

  async markSubtree(path: TreePath): Promise<SearchDirtyMarker> {
    return await this.mark(path, 'subtree')
  }

  async abort(marker: SearchDirtyMarker | undefined): Promise<void> {
    if (marker !== undefined && marker.expectedDigest === undefined) {
      await this.state.delete(marker.key)
    }
  }

  private async dirtyMarkers(): Promise<SearchDirtyMarker[]> {
    const markers: SearchDirtyMarker[] = []
    for (const prefix of [DIRTY_NODE_PREFIX, DIRTY_SUBTREE_PREFIX]) {
      let cursor: string | undefined
      do {
        const page = await this.state.list(prefix, {
          limit: 200,
          ...(cursor === undefined ? {} : { cursor }),
        })
        for (const item of page.items) {
          const marker = item.value as Partial<SearchDirtyMarker>
          if (
            typeof marker.createdAt === 'number'
            && marker.key === item.key
            && (marker.kind === 'node' || marker.kind === 'subtree')
            && typeof marker.path === 'string'
          ) {
            markers.push(marker as SearchDirtyMarker)
          }
        }
        cursor = page.cursor
      } while (cursor !== undefined)
    }
    return markers
  }

  private async commitMarker(
    marker: SearchDirtyMarker | undefined,
    expectedDigest: string | null,
  ): Promise<void> {
    if (marker === undefined) return
    const committed: SearchDirtyMarker = {
      ...marker,
      committedAt: Date.now(),
      expectedDigest,
    }
    await this.state.put(marker.key, committed)
    Object.assign(marker, committed)
  }

  private async finishMarker(marker: SearchDirtyMarker | undefined): Promise<void> {
    if (marker !== undefined) await this.state.delete(marker.key)
  }

  private async feedbackText(
    path: TreePath,
    snapshot?: readonly FeedbackEntry[],
  ): Promise<string> {
    if (snapshot !== undefined) return selectFeedbackSearchText(snapshot)
    return selectFeedbackSearchText(parseFeedbackEntries(await this.state.get(KEY_FEEDBACK + path)))
  }

  private async rawTools(node: TreeNode, override?: readonly ToolSpec[]): Promise<ToolSpec[] | null> {
    if (override !== undefined) return [...override]
    if (node.kind === 'http') return httpTools(node)
    const device = deviceTools(node)
    if (device !== null) return device
    if (node.kind === 'mcp' || node.kind === 'tool') {
      return await peekToolCache(this.state, node.path)
    }
    return null
  }

  private indexableRecords(
    path: TreePath,
    tools: readonly ToolSpec[],
    feedback: string,
  ): ReturnType<typeof serializeToolSearchSnapshot> | null {
    try {
      return serializeToolSearchSnapshot(path, tools, feedback)
    } catch (error) {
      if (isTBError(error)) return null
      throw error
    }
  }

  async reconcileNode(
    path: TreePath,
    opts: {
      feedback?: readonly FeedbackEntry[]
      marker?: SearchDirtyMarker
      tools?: readonly ToolSpec[]
    } = {},
  ): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    const node = await this.registry.get(canonical).catch(() => null)
    if (node === null || !toolNode(node)) {
      await this.commitMarker(opts.marker, null)
      await this.search.remove(canonical)
      await this.finishMarker(opts.marker)
      return
    }
    const tools = await this.rawTools(node, opts.tools)
    if (tools === null) {
      await this.search.remove(canonical)
      await this.finishMarker(opts.marker)
      return
    }
    if (tools.length === 0) {
      await this.commitMarker(opts.marker, null)
      await this.search.remove(canonical)
      await this.finishMarker(opts.marker)
      return
    }
    const root = await this.registry.rootSnapshot(TOOL_SEARCH_AUDIT_NODE_LIMIT)
    if (root.truncated) {
      // 正式索引在 overflow 期间保持 last-known-good；新 canonical 节点仍可正常调用。
      await this.finishMarker(opts.marker)
      return
    }
    const feedback = await this.feedbackText(canonical, opts.feedback)
    const records = this.indexableRecords(canonical, tools, feedback)
    if (records === null) {
      await this.commitMarker(opts.marker, null)
      await this.search.remove(canonical)
      await this.finishMarker(opts.marker)
      return
    }
    const digest = records.length === 0 ? null : toolSearchSnapshotDigest(records)
    await this.commitMarker(opts.marker, digest)
    await this.search.replace(canonical, tools, {
      feedback,
    })
    await this.finishMarker(opts.marker)
  }

  /** mutation 热路径使用：canonical 已成功时，派生同步失败只保留 marker。 */
  async reconcileNodeQuietly(
    path: TreePath,
    opts: {
      feedback?: readonly FeedbackEntry[]
      marker?: SearchDirtyMarker
      tools?: readonly ToolSpec[]
    } = {},
  ): Promise<void> {
    try {
      await this.reconcileNode(path, opts)
    } catch {
      // dirty marker 留给下一次 search/tool-list 修复。
    }
  }

  async rebuildAll(
    markers: readonly SearchDirtyMarker[] = [],
    opts: {
      authoritativeEmpty?: readonly TreePath[]
      canonicalNodes?: readonly TreeNode[]
    } = {},
  ): Promise<boolean> {
    const snapshot = opts.canonicalNodes === undefined
      ? await this.registry.rootSnapshot(TOOL_SEARCH_AUDIT_NODE_LIMIT)
      : { items: [...opts.canonicalNodes], truncated: false }
    // KV 无跨 isolate CAS。容量竞态溢出时保留 last-known-good，不能让可操纵的
    // 字典序前 N 个节点替换全局索引；marker 同样保留，待 canonical 恢复后再审计。
    if (snapshot.truncated) return false
    const nodes = snapshot.items.filter(toolNode)
    const authoritativeEmpty = new Set(opts.authoritativeEmpty ?? [])
    const keys = nodes.flatMap(node => [KEY_FEEDBACK + node.path, toolCacheKey(node.path)])
    const values = await this.state.getMany(keys)
    const documents: ToolSearchDocument[] = []
    for (const node of nodes) {
      if (authoritativeEmpty.has(node.path)) continue
      let tools: ToolSpec[] | null
      if (node.kind === 'http') {
        tools = httpTools(node)
      } else {
        tools = deviceTools(node)
          ?? cachedTools(values.get(toolCacheKey(node.path)))
      }
      if (tools === null) continue
      const feedback = selectFeedbackSearchText(
        parseFeedbackEntries(values.get(KEY_FEEDBACK + node.path)),
      )
      if (this.indexableRecords(node.path, tools, feedback) === null) continue
      documents.push(...documentsFor(node.path, tools, feedback))
    }
    await this.search.rebuild(documents)
    // Marker 只是有界审计提示；canonical 若仍是 KV 旧视图，下一次 search 的
    // 无条件快照审计会再次纠正索引。
    await Promise.all(markers.map(async (marker) => {
      await this.state.delete(marker.key).catch(() => {})
    }))
    return true
  }

  /** 每次搜索前审计 canonical 快照；同快照 rebuild 不 bump revision。 */
  async ensureReady(): Promise<void> {
    // 先做 501 个节点的有界探针，不能先让不可信 marker 数量放大扫描成本。
    const snapshot = await this.registry.rootSnapshot(TOOL_SEARCH_AUDIT_NODE_LIMIT)
    if (snapshot.truncated) {
      if (await this.search.initialized()) return
      throw new TBError('rate_limited', 'registry 超出工具搜索 canonical audit 容量')
    }
    const dirty = await this.dirtyMarkers()
    await this.rebuildAll(dirty, { canonicalNodes: snapshot.items })
  }

  /** 首次 registry/device mutation 前建立 last-known-good，避免并发溢出抢在首次 seed 前。 */
  async ensureSeeded(): Promise<void> {
    if (await this.search.initialized()) return
    if (this.seedPromise === undefined) {
      this.seedPromise = (async () => {
        if (!await this.rebuildAll()) {
          throw new TBError('rate_limited', 'registry 超出工具搜索 canonical audit 容量')
        }
      })()
    }
    try {
      await this.seedPromise
    } finally {
      this.seedPromise = undefined
    }
  }

  async removeSubtreeQuietly(path: TreePath, marker?: SearchDirtyMarker): Promise<void> {
    try {
      const canonical = normalizeToolSearchPath(path)
      if ((await this.registry.subtree(canonical)).length === 0) {
        await this.commitMarker(marker, null)
        await this.search.removePrefix(canonical)
        await this.finishMarker(marker)
      } else {
        await this.rebuildAll(marker === undefined ? [] : [marker])
      }
    } catch {
      // marker 保留，后续 ensureReady 用 canonical registry 全量重建。
    }
  }
}
