/**
 * Geokeo 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/geokeo/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Geokeo 的特点决定了这里的形状:
 * - **API key 是 `api` query 参数**,不走 header。
 * - **失败常以 HTTP 200 + `status` 字段返回**(`OVER_QUERY_LIMIT` / `ACCESS_DENIED` …),
 *   所以状态码不足以归类错误,必须先看 body 的 `status`。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { geocodeForwardInput, geocodeReverseInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'geokeo'
const API_BASE = 'https://geokeo.com'

type Json = Record<string, unknown>

/** Geokeo 把「查得到」和「查不到」都算成功,只有其余 status 才是错。 */
function isSuccessfulStatus(status: string): boolean {
  return status === 'ok' || status === 'ZERO_RESULTS'
}

/**
 * body 里的 status → TBError。映射照搬上游。
 *
 * 注意 `ACCESS_DENIED`(key 无效/被封)上游归成 400 而非 401 —— 保持等价,没有改口径;
 * 若日后要让凭证问题落到 permission_denied,这是唯一要改的地方。
 */
function statusError(status: string): TBError {
  if (status === 'OVER_QUERY_LIMIT') return upstreamError(429, status)
  if (status === 'INVALID_REQUEST' || status === 'ACCESS_DENIED') return upstreamError(400, status)
  return upstreamError(502, status)
}

function statusOf(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const status = (payload as Json).status
  return typeof status === 'string' && status !== '' ? status : undefined
}

/** Geokeo 在边缘错误上会回空体或 HTML。 */
async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new TBError('unavailable', 'Geokeo 返回了非 JSON 响应', { retryable: true })
  }
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, number | string | undefined>,
): Promise<unknown> {
  const url = new URL(path, API_BASE)
  url.searchParams.set('api', requireApiKey(ctx, SERVICE))
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), { method: 'GET' })
    payload = await readPayload(response)
  } catch (error) {
    if (error instanceof TBError) throw error
    // 上游主机是写死的常量,这里只可能是网络/传输问题 —— 重试有意义。
    throw new TBError(
      'unavailable',
      error instanceof Error ? `Geokeo 请求失败: ${error.message}` : 'Geokeo 请求失败',
      { retryable: true },
    )
  }

  // 顺序不能调:status 比状态码更能说明失败原因,先判它。
  const status = statusOf(payload)
  if (status !== undefined && !isSuccessfulStatus(status)) throw statusError(status)
  if (!response.ok) {
    throw upstreamError(
      response.status,
      status === undefined ? 'Geokeo request failed' : `Geokeo request failed with status ${status}`,
    )
  }
  return payload
}

export async function geocodeForward(
  input: z.infer<typeof geocodeForwardInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return await request(ctx, '/geocode/v1/search.php', { q: input.q, country: input.country })
}

export async function geocodeReverse(
  input: z.infer<typeof geocodeReverseInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return await request(ctx, '/geocode/v1/reverse.php', { lat: input.lat, lng: input.lng })
}
