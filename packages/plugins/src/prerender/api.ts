/**
 * Prerender 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/prerender/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Prerender 的两个特点决定了这里的形状:
 * - 凭证**不走请求头**:POST 时作为 `prerenderToken` 字段进 JSON body,GET 时作为
 *   **路径段**进 URL(`/cache-clear-status/<token>`)。这是上游 API 的设计,换成
 *   Authorization 头会直接 401,迁移没有选择余地。
 * - **403 不是错误**:cache-clear 相关的两个端点用 403 表示"清理任务正在跑",
 *   要归一成 `status: 'in_progress'`。当成错误抛就会把正常状态报成鉴权失败。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { addSitemapInput, clearCacheInput, recacheUrlsInput } from './schema'
import { asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'prerender'
const API_BASE = 'https://api.prerender.io'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  const body = record(payload)
  return text(body?.error) ?? text(body?.message) ?? text(body?.status)
}

interface RequestInput {
  body?: Json
  /** 不算失败的非 2xx 状态;Prerender 用 403 表达"任务进行中"。 */
  expectedStatuses?: readonly number[]
  method: 'GET' | 'POST'
}

async function request(
  ctx: ProviderContext,
  path: string,
  input: RequestInput,
): Promise<{ payload: unknown, status: number }> {
  const result = await http.request({
    path,
    method: input.method,
    headers: { accept: 'application/json' },
    ...(input.body === undefined ? {} : { json: input.body }),
    acceptStatuses: input.expectedStatuses,
    invalidJson: 'text',
    sensitiveValues: [requireApiKey(ctx, SERVICE)],
    mapError: ({ data: payload, status }) => upstreamError(
      status,
      errorMessage(payload) ?? `Prerender 请求失败,HTTP ${status}`,
    ),
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined ? 'Prerender 请求失败' : `Prerender 请求失败: ${message}`,
    ),
  })
  return { payload: result.bodyKind === 'empty' ? null : result.data, status: result.status }
}

function cacheClearStatusPath(apiKey: string): string {
  return `/cache-clear-status/${encodeURIComponent(apiKey)}`
}

export async function recacheUrls(
  input: z.infer<typeof recacheUrlsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const response = await request(ctx, '/recache', {
    method: 'POST',
    body: {
      prerenderToken: requireApiKey(ctx, SERVICE),
      urls: input.urls,
      ...(input.adaptiveType === undefined ? {} : { adaptiveType: input.adaptiveType }),
    },
  })
  return { accepted: true, raw: response.payload }
}

export async function addSitemap(
  input: z.infer<typeof addSitemapInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 生成的 schema 把 url 标成了 optional(上游 action 定义如此),但上游 executor 必填它。
  // schema 表达不了这条,就在这里挡住。
  if (input.url === undefined) throw new TBError('invalid_argument', 'url is required')
  const response = await request(ctx, '/sitemap', {
    method: 'POST',
    body: { prerenderToken: requireApiKey(ctx, SERVICE), url: input.url },
  })
  return { accepted: true, raw: response.payload }
}

export async function clearCache(
  input: z.infer<typeof clearCacheInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 同 add_sitemap:schema 里 query 是 optional,上游必填。
  const query = input.query?.trim()
  if (query === undefined || query === '') throw new TBError('invalid_argument', 'query is required')
  const response = await request(ctx, '/cache-clear', {
    method: 'POST',
    body: { prerenderToken: requireApiKey(ctx, SERVICE), query },
    expectedStatuses: [403],
  })
  return { status: response.status === 403 ? 'in_progress' : 'queued', raw: response.payload }
}

export async function getCacheClearStatus(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const response = await request(ctx, cacheClearStatusPath(requireApiKey(ctx, SERVICE)), {
    method: 'GET',
    expectedStatuses: [403],
  })
  return { status: response.status === 403 ? 'in_progress' : 'idle', raw: response.payload }
}
