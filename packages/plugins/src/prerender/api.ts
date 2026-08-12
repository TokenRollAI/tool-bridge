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
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'prerender'
const API_BASE = 'https://api.prerender.io'

type Json = Record<string, unknown>

/** 上游 `optionalString`:非字符串、或去空白后为空,都算缺失。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  const body = record(payload)
  return text(body?.error) ?? text(body?.message) ?? text(body?.status)
}

/** 空体回 null;JSON 解析不了就把原文当 payload,留给消息提取。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
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
  // base 末尾补 `/`、path 去掉首 `/`:与上游 buildPrerenderUrl 同构。
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, `${API_BASE}/`)

  const headers: Record<string, string> = { accept: 'application/json' }
  if (input.method === 'POST') headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method,
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 500。
    throw upstreamError(
      502,
      error instanceof Error ? `Prerender 请求失败: ${error.message}` : 'Prerender 请求失败',
    )
  }

  const payload = await readPayload(response)
  if (!response.ok && !(input.expectedStatuses ?? []).includes(response.status)) {
    throw upstreamError(
      response.status,
      errorMessage(payload) ?? `Prerender 请求失败,HTTP ${response.status}`,
    )
  }
  return { payload, status: response.status }
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
