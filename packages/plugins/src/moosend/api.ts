/**
 * Moosend 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/moosend/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Moosend 的两个特点决定了这里的形状:
 * - **API key 走 `apikey` query 参数**,不走 header。
 * - **失败常以 HTTP 200 + body 里 `Code != 0` / `Error` 非空返回**,状态码不足以归类错误,
 *   必须再读 body —— `payloadError()` + `mapPayloadError()` 是这套判定的唯一实现。
 *
 * `Format` 入参上游收下但从不发出(路径后缀 `.json` 已经定死了响应格式),这里照旧忽略。
 */

import type { z } from 'zod/v4'
import type {
  addSubscriberInput,
  getSubscriberByEmailInput,
  listMailingListsInput,
  listSubscribersInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'moosend'
const API_BASE = 'https://api.moosend.com/v3'

type Json = Record<string, unknown>

/** body 里自报的失败:`Code` 非 0 或 `Error` 非空。两者都缺才算成功。 */
function payloadError(payload: Json): string | undefined {
  const code = typeof payload.Code === 'number' ? payload.Code : undefined
  const error = typeof payload.Error === 'string' && payload.Error.trim() !== '' ? payload.Error : undefined
  if ((code === undefined || code === 0) && error === undefined) return undefined
  return error ?? `Moosend request failed with code ${code ?? 'unknown'}`
}

/**
 * body 自报的失败 → TBError。**消息优先于状态码**:凭证失效在 Moosend 上也是 HTTP 200,
 * 只有文案("api key")能把它与普通业务错误区分开。
 *
 * 与上游有意不同:上游在这条路径上把凭证类错误压成 400(因为 HTTP 状态是 200,不落在
 * 4xx 区间)。这里直接归 401 —— 收敛各 provider 互不相同的错误口径正是 `upstreamError` 的理由,
 * 且"配的 key 不对"归成 invalid_argument 会让调用方去改业务参数,方向就错了。
 */
function mapPayloadError(message: string, status: number): Error {
  if (status === 429) return upstreamError(429, message)
  const lower = message.toLowerCase()
  if (status === 401 || status === 403 || lower.includes('api key') || lower.includes('apikey')) {
    return upstreamError(401, message)
  }
  return upstreamError(status >= 400 ? status : 400, message)
}

/** HTTP 层失败的消息:Moosend 在这条路径上常回 HTML,截断到 200 字符免得把整页当消息。 */
function httpErrorMessage(status: number, raw: string): string {
  const snippet = raw.trim().slice(0, 200)
  const base = `Moosend request failed with HTTP ${status}`
  return snippet === '' ? base : `${base}; body: ${snippet}`
}

interface RequestInput {
  body?: Json
  method?: 'GET' | 'POST'
  path: string
  query?: Record<string, boolean | number | string | undefined>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<Json> {
  const url = new URL(`${API_BASE}${input.path}`)
  url.searchParams.set('apikey', requireApiKey(ctx, SERVICE))
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = { accept: 'application/json' }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  let raw: string
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method ?? 'GET',
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
    raw = await response.text()
  } catch (error) {
    const message = error instanceof Error ? `Moosend request failed: ${error.message}` : 'Moosend request failed'
    throw upstreamError(502, message)
  }

  let payload: Json = {}
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw) as Json
    } catch {
      // 非法 JSON 时不吞掉真实状态码:429 仍是 429,其余当上游故障。
      throw upstreamError(response.status === 429 ? 429 : 502, httpErrorMessage(response.status, raw))
    }
  }

  const selfReported = payloadError(payload)
  if (selfReported !== undefined) throw mapPayloadError(selfReported, response.status)
  if (!response.ok) throw upstreamError(response.status, httpErrorMessage(response.status, raw))
  return payload
}

export async function listMailingLists(
  input: z.infer<typeof listMailingListsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    path: '/lists.json',
    query: {
      WithStatistics: input.WithStatistics,
      SortBy: input.SortBy,
      SortMethod: input.SortMethod,
    },
  })
}

export async function listSubscribers(
  input: z.infer<typeof listSubscribersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/lists/${encodeURIComponent(input.MailingListID)}`
    + `/subscribers/${encodeURIComponent(input.Status)}.json`
  return request(ctx, { path, query: { Page: input.Page, PageSize: input.PageSize } })
}

export async function getSubscriberByEmail(
  input: z.infer<typeof getSubscriberByEmailInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    path: `/subscribers/${encodeURIComponent(input.MailingListID)}/view.json`,
    query: { Email: input.Email },
  })
}

export async function addSubscriber(
  input: z.infer<typeof addSubscriberInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body: Json = { Email: input.Email }
  if (input.Name !== undefined) body.Name = input.Name
  if (input.HasExternalDoubleOptIn !== undefined) body.HasExternalDoubleOptIn = input.HasExternalDoubleOptIn
  if (input.CustomFields !== undefined) body.CustomFields = input.CustomFields
  if (input.Tags !== undefined) body.Tags = input.Tags
  if (input.Preferences !== undefined) body.Preferences = input.Preferences

  return request(ctx, {
    path: `/subscribers/${encodeURIComponent(input.MailingListID)}/subscribe.json`,
    method: 'POST',
    body,
  })
}
