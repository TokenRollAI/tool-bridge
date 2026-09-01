import type { z } from 'zod/v4'
import type {
  crawlInput,
  createResearchInput,
  extractInput,
  getResearchInput,
  mapInput,
  searchInput,
} from './schema'
import type { ProviderContext } from '../_runtime/plugin'
import {
  asJsonObject,
  type JsonObject,
} from '../_runtime/providerHttp'
import { createAuthedClient } from '../_runtime/authedClient'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'tavily'
const REQUEST_TIMEOUT_MS = 30_000
const http = createAuthedClient({
  baseUrl: 'https://api.tavily.com/',
  service: SERVICE,
  auth: { kind: 'bearer' },
  headers: { accept: 'application/json' },
  errorMessage: {
    keys: ['detail', 'error', 'message'],
    fallback: status => `Tavily 返回 HTTP ${status}`,
  },
  mapTransportError: ({ kind, message }) => kind === 'timeout'
    ? upstreamError(504, `Tavily ${REQUEST_TIMEOUT_MS / 1000}s 内没有返回`)
    : upstreamError(502, message === undefined ? 'Tavily 请求失败' : `Tavily 请求失败:${message}`),
})

interface RequestOptions {
  body?: JsonObject
  method: 'GET' | 'POST'
  path: string
}

async function request(ctx: ProviderContext, options: RequestOptions): Promise<JsonObject> {
  const { data } = await http.request(ctx, {
    path: options.path,
    method: options.method,
    ...(options.body === undefined ? {} : { json: options.body }),
    timeoutMs: REQUEST_TIMEOUT_MS,
    invalidJsonMessage: 'Tavily 返回了非 JSON 响应',
  })

  if (data === undefined) return {}
  const result = asJsonObject(data)
  if (result === undefined) throw upstreamError(502, 'Tavily 响应不是对象')
  return result
}

export function search(input: z.infer<typeof searchInput>, ctx: ProviderContext): Promise<JsonObject> {
  return request(ctx, { method: 'POST', path: 'search', body: input })
}

export function extract(input: z.infer<typeof extractInput>, ctx: ProviderContext): Promise<JsonObject> {
  return request(ctx, { method: 'POST', path: 'extract', body: input })
}

export function map(input: z.infer<typeof mapInput>, ctx: ProviderContext): Promise<JsonObject> {
  return request(ctx, { method: 'POST', path: 'map', body: input })
}

export function crawl(input: z.infer<typeof crawlInput>, ctx: ProviderContext): Promise<JsonObject> {
  return request(ctx, { method: 'POST', path: 'crawl', body: input })
}

export function createResearch(
  input: z.infer<typeof createResearchInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return request(ctx, { method: 'POST', path: 'research', body: input })
}

export function getResearch(
  input: z.infer<typeof getResearchInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return request(ctx, { method: 'GET', path: `research/${encodeURIComponent(input.request_id)}` })
}

export function getUsage(_input: JsonObject, ctx: ProviderContext): Promise<JsonObject> {
  return request(ctx, { method: 'GET', path: 'usage' })
}
