/**
 * LiveSession 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/livesession/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 入参的 camelCase(visitorId / timezone / dateFrom)与上游 query 参数的 snake_case
 * (visitor_id / tz / date_from)不同名,这层重命名是 open-connector 加的,不是 LiveSession
 * 的。归一时对上游响应的 total / page.num / page.size / session.id 做**强类型校验**:
 * 上游给非整数就说明它违约,与其把 NaN 往下传,不如就地报 unavailable。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { listSessionsInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'livesession'
const API_BASE = 'https://api.livesession.io/v1'

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

/** 错误体有两种形状:`{error:'...'}` 与 `{error:{message}}`,再退回顶层 message。 */
function errorMessage(payload: unknown): string | undefined {
  const body = record(payload)
  const error = body?.error
  if (typeof error === 'string' && error !== '') return error
  return text(record(error)?.message) ?? text(body?.message)
}

/** 空体按 `{}` 处理;JSON 解析不了就把原文塞进 message,留给消息提取。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    return { message: body }
  }
}

async function request(ctx: ProviderContext, path: string, query: Record<string, unknown>): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 500。
    throw upstreamError(502, error instanceof Error ? error.message : 'LiveSession API 请求失败')
  }

  const payload = await readPayload(response)
  if (!response.ok) {
    throw upstreamError(
      response.status,
      errorMessage(payload) ?? `LiveSession API 请求失败,HTTP ${response.status}`,
    )
  }
  return payload
}

function requireObject(value: unknown, message: string): Json {
  const object = record(value)
  if (object === undefined) throw new TBError('unavailable', message, { retryable: true })
  return object
}

function objectArray(value: unknown, message: string): Json[] {
  if (!Array.isArray(value)) throw new TBError('unavailable', message, { retryable: true })
  return value.map(item => requireObject(item, message))
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TBError('unavailable', `LiveSession 返回的 ${field} 非法`, { retryable: true })
  }
  return value
}

function nullableInteger(value: unknown, field: string): number | null {
  return value === undefined || value === null ? null : requireInteger(value, field)
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function normalizeSession(value: Json): Json {
  const id = value.id
  if (typeof id !== 'string' || id === '') {
    throw new TBError('unavailable', 'LiveSession 返回的 session.id 非法', { retryable: true })
  }
  return {
    id,
    websiteId: nullableString(value.website_id),
    sessionUrl: nullableString(value.session_url),
    creationTimestamp: nullableInteger(value.creation_timestamp, 'session.creation_timestamp'),
    duration: nullableInteger(value.duration, 'session.duration'),
    device: nullableString(value.device),
    visitor: value.visitor === undefined || value.visitor === null
      ? null
      : requireObject(value.visitor, 'LiveSession 返回的嵌套对象非法'),
    raw: value,
  }
}

export async function listSessions(
  input: z.infer<typeof listSessionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/sessions', {
    page: input.page,
    size: input.size,
    email: input.email,
    visitor_id: input.visitorId,
    tz: input.timezone,
    date_from: input.dateFrom,
    date_to: input.dateTo,
  })

  const body = requireObject(payload, 'LiveSession 返回的会话列表载荷非法')
  const page = requireObject(body.page, 'LiveSession 返回的分页元数据非法')
  const total = requireInteger(body.total, 'total')
  if (total < 0) throw new TBError('unavailable', 'LiveSession 返回的 total 非法', { retryable: true })

  return {
    total,
    page: {
      num: requireInteger(page.num, 'page.num'),
      size: requireInteger(page.size, 'page.size'),
    },
    sessions: objectArray(body.sessions, 'LiveSession 返回的 sessions 非法').map(normalizeSession),
    raw: body,
  }
}
