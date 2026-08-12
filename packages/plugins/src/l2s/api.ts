/**
 * L2S 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/l2s/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 与上游有两处有意偏离:
 * - 上游给每次请求挂了 30 秒的 `AbortSignal` 超时。当前 ProviderContext 不透传 signal,
 *   超时归平台的出站策略管,插件不再自持一份。
 * - 上游每个字段都过 `optionalString`(顺带 trim、纯空白当缺失)。schema 的 `min(1)` 已挡住
 *   空串,剩下"纯空白串"这条缝隙极窄,不值得为它在每个字段上重做一遍转换。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { getUrlDetailsInput, shortenUrlInput, updateUrlDetailsInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'l2s'
const API_BASE = 'https://api.l2s.is'

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * L2S 的错误体是 `{response:{message}}` 这个信封。`response` 在时**不回落**到顶层以外的键
 * (与上游一致):两组键分属不同的错误体形状,混用会拿到与本次失败不相干的字符串。
 */
function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload.trim()
  const body = record(payload)
  if (body === undefined) return `L2S request failed with ${status}`
  const envelope = record(body.response)
  const message = envelope === undefined
    ? text(body.message)
    : text(envelope.message) ?? text(envelope.error) ?? text(body.message)
  return message ?? `L2S request failed with ${status}`
}

interface RequestInput {
  body?: Json
  method: 'GET' | 'POST' | 'PUT'
  path: string
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const url = new URL(input.path, API_BASE)
  const headers = {
    'accept': 'application/json',
    'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
    'content-type': 'application/json',
  }

  let response: Response
  let raw: string
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method,
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
    raw = await response.text()
  } catch (error) {
    const message = error instanceof Error ? `L2S request failed: ${error.message}` : 'L2S request failed'
    throw upstreamError(502, message)
  }

  let payload: unknown = {}
  if (raw !== '') {
    try {
      payload = JSON.parse(raw)
    } catch {
      // 成功响应必须是 JSON;失败响应回 HTML 错误页时把原文留给消息提取,
      // 免得"非法 JSON"的 502 顶掉真实的 401/429。
      if (response.ok) throw upstreamError(502, 'L2S returned invalid JSON')
      payload = raw
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return payload
}

/** schema 把 `id` 标成可选(上游靠 executor 里的 `requiredString` 兜底),这道检查不能省。 */
function urlPath(id: string | undefined): string {
  if (id === undefined || id.trim() === '') {
    throw new TBError('invalid_argument', 'id 不能为空')
  }
  return `/url/${encodeURIComponent(id)}`
}

function urlBody(input: z.infer<typeof shortenUrlInput>): Json {
  const body: Json = { url: input.url }
  for (const key of ['customKey', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent', 'title'] as const) {
    const value = input[key]
    if (value !== undefined) body[key] = value
  }
  // 空数组按上游口径当作"没给 tags":它会被 `normalizeTagArray` 折成 undefined 后剔除。
  if (input.tags !== undefined && input.tags.length > 0) body.tags = input.tags
  return body
}

export async function shortenUrl(
  input: z.infer<typeof shortenUrlInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, { method: 'POST', path: '/url', body: urlBody(input) })
}

export async function getUrlDetails(
  input: z.infer<typeof getUrlDetailsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, { method: 'GET', path: urlPath(input.id) })
}

export async function updateUrlDetails(
  input: z.infer<typeof updateUrlDetailsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, { method: 'PUT', path: urlPath(input.id), body: urlBody(input) })
}
