/**
 * CallerAPI 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/callerapi/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * CallerAPI 的两个特点决定了这里的形状:
 * - 凭证走 **`x-auth` 头**,不是 Authorization Bearer。
 * - HTTP 200 也可能是失败:响应体里的 `status: "error"/"unauthorized"`(或存在 error/message/
 *   detail 字段)才是真正的结果码,故成功路径也要再判一次 body。
 *
 * 与上游有意偏离:**不迁 validate 阶段**(凭证校验是平台的事),只留 execute 口径。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { getPhoneNumberInformationInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'callerapi'
const API_BASE = 'https://api.callerapi.com'

type Json = Record<string, unknown>

function toRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString` 的语义:非空白字符串才算数,且取 trim 后的值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

/** 错误消息在三个可能的字段里;纯文本体直接当消息。 */
function extractMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  const record = toRecord(payload)
  return text(record?.error) ?? text(record?.message) ?? text(record?.detail)
}

/**
 * HTTP 200 的响应体里挑失败信号。判据照搬上游:
 * 有 error/message/detail 任一,或 `status` 明确是 error/unauthorized。
 * `status` 缺失或为 success 且没有错误字段 → 成功。
 */
function payloadError(payload: unknown): { message: string, status?: string } | undefined {
  const record = toRecord(payload)
  if (record === undefined) return undefined

  const message = extractMessage(payload)
  const status = text(record.status)
  const normalized = status?.toLowerCase()
  if (message === undefined && (status === undefined || normalized === 'success')) return undefined
  if (message !== undefined || normalized === 'error' || normalized === 'unauthorized') {
    return { status, message: message ?? status ?? 'CallerAPI request failed' }
  }
  return undefined
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, string | undefined> = {},
): Promise<Json> {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  const response = await guardedFetch(url.toString(), {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'x-auth': requireApiKey(ctx, SERVICE),
    },
  })
  const payload = await readPayload(response)

  if (!response.ok) {
    const message = extractMessage(payload)
      ?? (response.statusText || `CallerAPI request failed with HTTP ${response.status}`)
    // 402(额度耗尽)在 CallerAPI 的语义上与限流同类:等额度回来就能继续,
    // 而共用映射会把它当参数错。这是 upstreamError 说的"provider 自有错误码覆盖"。
    if (response.status === 402) {
      throw new TBError('rate_limited', message, { retryable: true })
    }
    throw upstreamError(response.status, message)
  }

  const failure = payloadError(payload)
  if (failure !== undefined) {
    // 上游把 body 里的 unauthorized 归 401、其余归 500;这里沿用那个二分,
    // 只是落到七码上:未认证 vs 上游自己没做成。
    if (failure.status?.toLowerCase() === 'unauthorized') {
      throw new TBError('permission_denied', failure.message, { httpStatus: 401 })
    }
    throw upstreamError(500, failure.message)
  }

  const record = toRecord(payload)
  if (record === undefined) throw upstreamError(502, `CallerAPI ${path} response must be an object`)
  return record
}

export function getUserInformation(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return request(ctx, '/api/me')
}

export function getPhoneNumberInformation(
  input: z.infer<typeof getPhoneNumberInformationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // schema 的 min(1) 挡不住纯空白;上游此时会打出 `/api/lookup/`(整个号码段为空),
  // 与其让上游回一个含糊的错,不如就地说清。
  const phone = text(input.phone)
  if (phone === undefined) throw new TBError('invalid_argument', 'phone 不能为空')
  return request(ctx, `/api/lookup/${encodeURIComponent(phone)}`, {
    // 上游无论调用方给没给都发这个参数,缺省 false;照搬。
    hlr: input.hlr === true ? 'true' : 'false',
  })
}
