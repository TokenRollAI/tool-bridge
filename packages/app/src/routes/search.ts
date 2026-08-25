/**
 * `POST /~search`:根级、需认证的全局工具搜索端点。
 *
 * 宿主未注入可用索引(或未声明 search capability)时路由不存在(404),而不是空结果。
 * 索引命中后按调用者 scope 复判可见性并回读规范工具表,因此索引陈旧不会泄露隐藏工具;
 * 分页在"可见页"上做,空可见页不返回 cursor(避免 cursor 存在性泄露隐藏命中量)。
 */
import {
  check,
  contentTypeFor,
  NodeRegistryStore,
  normalizeToolSearchLimit,
  TBError,
  TOOL_SEARCH_BATCH_LIMIT,
  TOOL_SEARCH_PAGE_BYTES,
  TOOL_SEARCH_WORK_LIMIT,
  type ToolSearchCandidate,
  type ToolSpec,
  type TreeNode,
  type TreePath,
  virtualizeTools,
} from '@tool-bridge/core'
import {
  toolSearchPageSchema,
  toolSearchRequestSchema,
} from '@tool-bridge/core/protocol'
import type { TbHono } from '../deps'
import type { RouteEnv } from './env'
import { canonicalSearchTools } from '../search/synchronizer'
import { runHandler } from '../responses'

export function registerSearchRoute(app: TbHono, env: RouteEnv): void {
  const { deps, globalSearchCapabilities, searchSync } = env

  // POST /~search is a root-only, authenticated protocol endpoint. The route remains absent
  // until a host injects a real keyword index and declares the matching capability.
  app.post('/~search', c =>
    runHandler(async () => {
      const search = deps.search
      const capabilities = globalSearchCapabilities()
      if (search === undefined || !capabilities.includes('search')) {
        throw TBError.notFound('no such path')
      }

      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new TBError('invalid_argument', 'body must be a JSON object')
      }
      const bodyKeys = Object.keys(body)
      if (bodyKeys.some(key => key !== 'query' && key !== 'opts')) {
        throw new TBError('invalid_argument', 'body only accepts query and opts')
      }
      if (typeof body.query !== 'string' || body.query.trim().length === 0) {
        throw new TBError('invalid_argument', 'query must be a non-empty string')
      }

      const rawOpts = body.opts
      if (
        rawOpts !== undefined
        && (rawOpts === null || typeof rawOpts !== 'object' || Array.isArray(rawOpts))
      ) {
        throw new TBError('invalid_argument', 'opts must be a JSON object')
      }
      const opts = (rawOpts ?? {}) as Record<string, unknown>
      if (Object.keys(opts).some(key => key !== 'mode' && key !== 'limit' && key !== 'cursor')) {
        throw new TBError('invalid_argument', 'opts only accepts mode, limit and cursor')
      }
      const mode = opts.mode ?? 'keyword'
      if (mode !== 'keyword' && mode !== 'semantic') {
        throw new TBError('invalid_argument', 'opts.mode must be \'keyword\' or \'semantic\'')
      }
      if (mode === 'semantic' && !capabilities.includes('search:semantic')) {
        throw new TBError(
          'invalid_argument',
          'search mode \'semantic\' requires capability \'search:semantic\'',
        )
      }
      const limit = normalizeToolSearchLimit(opts.limit)
      if (opts.cursor !== undefined && typeof opts.cursor !== 'string') {
        throw new TBError('invalid_argument', 'opts.cursor must be a string')
      }
      // 手工分支保留既有稳定错误消息；最终仍过共享严格 schema，避免三端形状漂移。
      const wireRequest = toolSearchRequestSchema.parse({
        query: body.query,
        ...(rawOpts === undefined ? {} : { opts }),
      })
      const query = wireRequest.query
      await searchSync?.ensureReady()
      const ctx = c.get('ctx')
      const registry = new NodeRegistryStore(c.get('store'))
      const selected: Array<{ candidate: ToolSearchCandidate, node: TreeNode }> = []
      const workLimit = Math.min(
        TOOL_SEARCH_WORK_LIMIT,
        Math.max(TOOL_SEARCH_BATCH_LIMIT, limit * 2),
      )
      let scanCursor = opts.cursor as string | undefined
      let responseCursor: string | undefined
      let responseCandidate: ToolSearchCandidate | undefined
      let scanned = 0
      let stopped = false
      while (!stopped && selected.length < limit && scanned < workLimit) {
        const batchLimit = Math.min(TOOL_SEARCH_BATCH_LIMIT, workLimit - scanned)
        const page = await search.search(query, {
          mode,
          limit: batchLimit,
          ...(scanCursor === undefined ? {} : { cursor: scanCursor }),
        })
        if (page.items.length === 0) {
          responseCursor = page.cursor
          break
        }
        const nodes = await registry.getMany(page.items.map(candidate => candidate.path))
        for (const [index, candidate] of page.items.entries()) {
          scanned++
          if (
            !check(ctx, candidate.path, 'read').allow
            || !check(ctx, candidate.path, 'call').allow
          ) {
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

      const canonicalTools = await canonicalSearchTools(
        c.get('store'),
        selected.map(item => item.node),
      )
      const items: Array<{ path: TreePath, tool: ToolSpec }> = []
      let pageBytes = 0
      for (const [index, selectedItem] of selected.entries()) {
        const raw = canonicalTools.get(selectedItem.candidate.path)
          ?.find(tool => tool.name === selectedItem.candidate.name)
        if (raw === undefined) continue
        const tool = virtualizeTools(selectedItem.node.virtualize, [raw]).exposed[0]
        if (tool === undefined) continue
        const item = { path: selectedItem.candidate.path, tool }
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
      const result = responseCursor === undefined ? { items } : { items, cursor: responseCursor }
      return new Response(JSON.stringify(toolSearchPageSchema.parse(result)), {
        headers: { 'content-type': contentTypeFor('json') },
      })
    }),
  )
}
