import {
  toolSearchPageSchema,
  toolSearchRequestSchema,
  type WireToolSearchRequest,
} from '@tool-bridge/core/protocol'
/** 根级、认证后的 global tool search。local 与 recursive 共用严格 wire。 */
import {
  contentTypeFor,
  normalizeToolSearchLimit,
  TBError,
} from '@tool-bridge/core'
import type { TbHono } from '../deps'
import type { RouteEnv } from './env'
import { isFederatedSearchSessionHandle } from '../search/federatedSession'
import { executeFederatedSearch } from '../search/federatedSearch'
import { executeLocalSearch } from '../search/localSearch'
import { runHandler } from '../responses'

function requestWithNormalizedLimit(request: WireToolSearchRequest): WireToolSearchRequest {
  return {
    ...request,
    opts: {
      ...(request.opts ?? {}),
      limit: normalizeToolSearchLimit(request.opts?.limit),
    },
  }
}

export function registerSearchRoute(app: TbHono, env: RouteEnv): void {
  const { deps, globalSearchCapabilities, searchSync } = env
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
      if (Object.keys(body).some(key => key !== 'query' && key !== 'opts')) {
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
      const optionKeys = new Set([
        'cursor',
        'detail',
        'effects',
        'federation',
        'limit',
        'matching',
        'minCoverage',
        'mode',
        'pathPrefix',
      ])
      if (Object.keys(opts).some(key => !optionKeys.has(key))) {
        throw new TBError('invalid_argument', 'opts contains an unknown search option')
      }
      if (opts.cursor !== undefined && typeof opts.cursor !== 'string') {
        throw new TBError('invalid_argument', 'opts.cursor must be a string')
      }
      const parsed = toolSearchRequestSchema.safeParse({
        query: body.query,
        ...(rawOpts === undefined ? {} : { opts }),
      })
      if (!parsed.success) {
        throw new TBError(
          'invalid_argument',
          parsed.error.issues[0]?.message ?? 'invalid search request',
        )
      }
      const request = requestWithNormalizedLimit(parsed.data)
      const mode = request.opts?.mode ?? 'keyword'
      if (mode === 'semantic' && !capabilities.includes('search:semantic')) {
        throw new TBError(
          'invalid_argument',
          'search mode \'semantic\' requires capability \'search:semantic\'',
        )
      }

      const explicitFederation = request.opts?.federation
      const cursor = request.opts?.cursor
      // 旧 local cursor 在升级后仍按 local 续页；新查询在具备稳定 instanceId + CAS 时
      // 默认进入 recursive。显式选项始终优先。
      const federation = explicitFederation ?? (
        cursor !== undefined && !isFederatedSearchSessionHandle(cursor)
          ? 'local'
          : capabilities.includes('search:federated')
            ? 'recursive'
            : 'local'
      )
      if (federation === 'recursive' && !capabilities.includes('search:federated')) {
        throw new TBError(
          'invalid_argument',
          'recursive search requires capability \'search:federated\'',
        )
      }
      if (federation === 'recursive' && mode === 'semantic') {
        throw new TBError('invalid_argument', 'semantic search cannot use recursive federation')
      }
      const normalizedRequest: WireToolSearchRequest = {
        ...request,
        opts: { ...(request.opts ?? {}), federation },
      }
      const result = federation === 'local'
        ? await executeLocalSearch({
            ctx: c.get('ctx'),
            search,
            ...(searchSync === undefined ? {} : { searchSync }),
            state: c.get('store'),
          }, normalizedRequest)
        : await executeFederatedSearch(deps, {
            ctx: c.get('ctx'),
            headers: c.req.raw.headers,
            request: normalizedRequest,
            requestUrl: c.req.url,
            search,
            ...(searchSync === undefined ? {} : { searchSync }),
            state: c.get('store'),
          })
      return new Response(JSON.stringify(toolSearchPageSchema.parse(result)), {
        headers: { 'content-type': contentTypeFor('json') },
      })
    }),
  )
}
