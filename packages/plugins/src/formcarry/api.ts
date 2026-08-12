/**
 * Formcarry 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/formcarry/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 一处有意偏离上游:上游 `assertFormcarryResponse` 把 403 压成 401、404/422 压成 400、
 * 5xx 压成 502。这里把原始状态交给 `upstreamError`,404 仍是 not_found —— 收敛各 provider
 * 互不相同的错误口径正是 `_runtime/upstreamError.ts` 存在的理由。
 *
 * 响应**原样透出**:三个 action 的返回体上游都是直接给出去的,套一层就改了调用方看到的形状。
 */

import type { z } from 'zod/v4'
import type { createFormInput, deleteFormInput, listSubmissionsInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'formcarry'
const API_BASE = 'https://formcarry.com'

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Formcarry 的错误体键名不定:message/error/title/status 都出现过。 */
function errorMessage(payload: unknown): string | undefined {
  const body = record(payload)
  if (body === undefined) return undefined
  return text(body.message) ?? text(body.error) ?? text(body.title) ?? text(body.status)
}

interface RequestInput {
  body?: string
  contentType?: string
  method: 'DELETE' | 'GET' | 'PUT'
  path: string
  query?: Record<string, number | string | undefined>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<Json> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(input.path, API_BASE)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  // 凭证走自定义 `api_key` 头,不是 Authorization。
  const headers: Record<string, string> = { accept: 'application/json', api_key: apiKey }
  if (input.contentType !== undefined) headers['content-type'] = input.contentType

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method,
      headers,
      ...(input.body === undefined ? {} : { body: input.body }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error" 500。
    throw upstreamError(
      502,
      error instanceof Error ? `formcarry request failed: ${error.message}` : 'formcarry request failed',
    )
  }

  const raw = await response.text().catch(() => '')
  let payload: unknown
  try {
    payload = raw === '' ? undefined : JSON.parse(raw)
  } catch {
    // 解析不出 JSON 时:失败响应把原文当消息,成功响应算上游破契约。
    if (!response.ok) throw upstreamError(response.status, raw)
    throw upstreamError(502, `invalid Formcarry ${input.path} response`)
  }

  if (!response.ok) {
    throw upstreamError(
      response.status,
      errorMessage(payload) ?? `formcarry request failed with ${response.status}`,
    )
  }

  const body = record(payload)
  if (body === undefined) throw upstreamError(502, `invalid Formcarry ${input.path} response`)
  return body
}

export async function createForm(
  input: z.infer<typeof createFormInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = new URLSearchParams()
  // 字段顺序照抄上游,让请求体可预期;空串按"没给"处理(Formcarry 不接受空值)。
  for (const [key, value] of [
    ['name', input.name],
    ['email', input.email],
    ['returnUrl', input.returnUrl],
    ['failUrl', input.failUrl],
    ['googleRecaptcha', input.googleRecaptcha],
    ['webhook', input.webhook],
  ] as const) {
    if (value !== undefined && value !== '') body.set(key, value)
  }
  if (input.returnParams !== undefined) body.set('returnParams', String(input.returnParams))
  if (input.retention !== undefined) body.set('retention', String(input.retention))

  return request(ctx, {
    method: 'PUT',
    path: '/api/form',
    contentType: 'application/x-www-form-urlencoded',
    body: body.toString(),
  })
}

export async function deleteForm(
  input: z.infer<typeof deleteFormInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, { method: 'DELETE', path: `/api/form/${encodeURIComponent(input.form_id)}` })
}

export async function listSubmissions(
  input: z.infer<typeof listSubmissionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    method: 'GET',
    path: `/api/form/${encodeURIComponent(input.form_id)}/submissions`,
    query: { limit: input.limit, page: input.page, sort: input.sort, filter: input.filter },
  })
}
