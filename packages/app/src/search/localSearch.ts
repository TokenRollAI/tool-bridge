import type {
  WireToolSearchDetail,
  WireToolSearchPage,
  WireToolSearchRequest,
} from '@tool-bridge/core/protocol'
/**
 * 单实例搜索执行器。HTTP 路由与 federated coordinator 共用这一条 canonical
 * hydration / scope / byte-budget 路径，避免“本地搜索”和“本地 source”漂移。
 */
import {
  type CallContext,
  check,
  NodeRegistryStore,
  normalizeToolSearchLimit,
  normalizeToolSearchOptions,
  type SearchIndex,
  type StateStore,
  TBError,
  TOOL_SEARCH_BATCH_LIMIT,
  TOOL_SEARCH_DESCRIPTION_BYTES_MAX,
  TOOL_SEARCH_PAGE_BYTES,
  TOOL_SEARCH_WORK_LIMIT,
  type ToolSearchCandidate,
  type ToolSearchEffect,
  type ToolSearchOptions,
  type ToolSpec,
  type TreeNode,
  type TreePath,
  virtualizeTools,
} from '@tool-bridge/core'
import { canonicalSearchTools, type SearchSynchronizer } from './synchronizer'

function normalizedEffect(effect: unknown): ToolSearchEffect {
  return effect === 'read' || effect === 'write' || effect === 'destructive'
    ? effect
    : 'unknown'
}

function projectSearchTool(tool: ToolSpec, detail: WireToolSearchDetail): ToolSpec {
  if (detail === 'full') return tool
  const compact = { ...tool }
  delete compact.inputSchema
  delete compact.outputSchema
  if (compact.description !== undefined) {
    const encoder = new TextEncoder()
    if (encoder.encode(compact.description).length > TOOL_SEARCH_DESCRIPTION_BYTES_MAX) {
      let description = ''
      let bytes = 0
      for (const char of compact.description) {
        const size = encoder.encode(char).length
        if (bytes + size > TOOL_SEARCH_DESCRIPTION_BYTES_MAX) break
        description += char
        bytes += size
      }
      compact.description = description
    }
  }
  return compact
}

export interface LocalSearchDeps {
  ctx: CallContext
  search: SearchIndex
  searchSync?: SearchSynchronizer
  state: StateStore
}

/** 执行已经过 wire schema 校验的 local-only 请求。 */
export async function executeLocalSearch(
  deps: LocalSearchDeps,
  request: WireToolSearchRequest,
): Promise<WireToolSearchPage> {
  const { ctx, search, searchSync, state } = deps
  const query = request.query
  const wireOpts = request.opts ?? {}
  const detail = wireOpts.detail ?? 'compact'
  const matching = wireOpts.matching ?? 'best'
  const mode = wireOpts.mode ?? 'keyword'
  const limit = normalizeToolSearchLimit(wireOpts.limit)
  const constraints = normalizeToolSearchOptions({
    ...(wireOpts.effects === undefined ? {} : { effects: wireOpts.effects }),
    matching,
    ...(wireOpts.minCoverage === undefined ? {} : { minCoverage: wireOpts.minCoverage }),
    ...(wireOpts.pathPrefix === undefined ? {} : { pathPrefix: wireOpts.pathPrefix }),
  })
  const indexOptions: ToolSearchOptions = { mode, ...constraints }
  await searchSync?.ensureReady()
  const registry = new NodeRegistryStore(state)
  const selected: Array<{ candidate: ToolSearchCandidate, node: TreeNode }> = []
  const workLimit = Math.min(
    TOOL_SEARCH_WORK_LIMIT,
    Math.max(TOOL_SEARCH_BATCH_LIMIT, limit * 2),
  )
  let scanCursor = wireOpts.cursor
  let responseCursor: string | undefined
  let responseCandidate: ToolSearchCandidate | undefined
  let visibleCoverage: number | undefined
  let scanned = 0
  let stopped = false
  while (!stopped && selected.length < limit && scanned < workLimit) {
    const batchLimit = Math.min(TOOL_SEARCH_BATCH_LIMIT, workLimit - scanned)
    const page = await search.search(query, {
      ...indexOptions,
      limit: batchLimit,
      ...(scanCursor === undefined ? {} : { cursor: scanCursor }),
    })
    if (page.items.length === 0) {
      responseCursor = page.cursor
      break
    }
    const nodes = await registry.getMany(page.items.map(candidate => candidate.path))
    let lastCandidateInVisibleBand: ToolSearchCandidate | undefined
    for (const [index, candidate] of page.items.entries()) {
      if (
        matching === 'best'
        && visibleCoverage !== undefined
        && candidate.coverage !== visibleCoverage
      ) {
        responseCandidate = lastCandidateInVisibleBand
        responseCursor = responseCandidate === undefined ? scanCursor : undefined
        stopped = true
        break
      }
      scanned++
      lastCandidateInVisibleBand = candidate
      if (!check(ctx, candidate.path, 'read').allow || !check(ctx, candidate.path, 'call').allow) {
        continue
      }
      const node = nodes.get(candidate.path)
      if (
        node === undefined
        || (node.kind !== 'mcp' && node.kind !== 'http' && node.kind !== 'tool')
        || node.config?.kind !== node.kind
        || virtualizeTools(node.virtualize, [{ name: candidate.name }]).exposed.length === 0
      ) {
        continue
      }
      visibleCoverage ??= candidate.coverage
      selected.push({ candidate, node })
      if (selected.length === limit) {
        const hasUnscanned = index < page.items.length - 1 || page.cursor !== undefined
        responseCandidate = hasUnscanned ? candidate : undefined
        responseCursor = undefined
        stopped = true
        break
      }
    }
    if (stopped) break
    responseCursor = page.cursor
    if (page.cursor === undefined) break
    scanCursor = page.cursor
  }

  const canonicalTools = await canonicalSearchTools(state, selected.map(item => item.node))
  const requestedEffects = constraints.effects === undefined
    ? undefined
    : new Set<ToolSearchEffect>(constraints.effects)
  const items: WireToolSearchPage['items'] = []
  let pageBytes = 0
  for (const [index, selectedItem] of selected.entries()) {
    const raw = canonicalTools.get(selectedItem.candidate.path)
      ?.find(tool => tool.name === selectedItem.candidate.name)
    if (raw === undefined) continue
    const tool = virtualizeTools(selectedItem.node.virtualize, [raw]).exposed[0]
    if (tool === undefined) continue
    if (requestedEffects !== undefined && !requestedEffects.has(normalizedEffect(tool.effect))) {
      continue
    }
    const item = {
      path: selectedItem.candidate.path as TreePath,
      relevance: {
        coverage: selectedItem.candidate.coverage,
        matchedTermCount: selectedItem.candidate.matchedTermCount,
        rankingVersion: 'keyword-v2' as const,
        totalTermCount: selectedItem.candidate.totalTermCount,
      },
      tool: projectSearchTool(tool, detail),
    }
    const itemBytes = new TextEncoder().encode(JSON.stringify(item)).length
    if (pageBytes + itemBytes > TOOL_SEARCH_PAGE_BYTES) {
      if (items.length === 0) {
        throw new TBError('internal', '工具搜索页面字节预算无法容纳首个结果')
      }
      responseCandidate = selected[index - 1]?.candidate
      responseCursor = undefined
      break
    }
    items.push(item)
    pageBytes += itemBytes
  }
  if (responseCandidate !== undefined) {
    responseCursor = await search.cursorFor(query, responseCandidate, mode)
  }
  // deny==not_found：空可见页不返回 continuation，避免 cursor 存在性泄露隐藏命中量。
  if (items.length === 0) responseCursor = undefined
  return responseCursor === undefined ? { items } : { items, cursor: responseCursor }
}
