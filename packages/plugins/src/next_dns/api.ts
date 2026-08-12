/**
 * NextDNS 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/next_dns/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * NextDNS 的两个特点决定了这里的形状:
 * - 凭证走 **`X-Api-Key` 头**。
 * - 失败可能以 **HTTP 200 + `errors[]`** 返回(NextDNS 的参数类错误走这条路),
 *   所以成功分支也要检查 body。
 *
 * 上游把 404 也压成 400,这里没有跟:`upstreamError` 会把它归成 not_found,
 * 「profile 不存在」与「参数不合法」对调用方是两件事。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getAnalyticsDevicesInput,
  getAnalyticsDomainsInput,
  getAnalyticsReasonsInput,
  getAnalyticsStatusInput,
  getLogsInput,
  getProfileInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'next_dns'
const API_BASE = 'https://api.nextdns.io'

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | undefined

function asRecord(value: unknown): Json | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** NextDNS 的错误文案位置不固定:纯文本 body、`message`、`error`、或 `error.message`。 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return nonEmpty(payload)
  const record = asRecord(payload)
  if (record === undefined) return undefined
  return nonEmpty(record.message)
    ?? nonEmpty(record.error)
    ?? nonEmpty(asRecord(record.error)?.message)
}

/** HTTP 200 也可能带 `errors[]`;第一条的 detail/message/code 才是给用户看的原因。 */
function userErrorMessage(payload: unknown): string | undefined {
  const errors = asRecord(payload)?.errors
  if (!Array.isArray(errors)) return undefined
  const first = errors[0]
  if (typeof first === 'string') return nonEmpty(first)
  const record = asRecord(first)
  if (record === undefined) return undefined
  return nonEmpty(record.detail) ?? nonEmpty(record.message) ?? nonEmpty(record.code)
}

/** NextDNS 在边缘错误上会回空体或纯文本;纯文本原样带走,交给 errorMessage 取用。 */
async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, QueryValue> = {},
): Promise<unknown> {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(query)) {
    // 空串按未提供处理:上游 `buildNextDnsUrl` 就是这个口径。
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { 'accept': 'application/json', 'x-api-key': requireApiKey(ctx, SERVICE) },
    })
    payload = await readPayload(response)
  } catch (error) {
    if (error instanceof TBError) throw error
    throw new TBError(
      'unavailable',
      error instanceof Error ? `NextDNS 请求失败: ${error.message}` : 'NextDNS 请求失败',
      { retryable: true },
    )
  }

  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? 'NextDNS request failed')
  }
  const userError = userErrorMessage(payload)
  if (userError !== undefined) throw new TBError('invalid_argument', userError)
  return payload
}

/** 六个 list 端点共用的信封整形:data 保证是数组,meta 拿不到就是 null,raw 不吞信息。 */
function listResult(payload: unknown): Json {
  const record = asRecord(payload)
  if (record === undefined) return { data: [], meta: null, raw: {} }
  return {
    data: Array.isArray(record.data) ? record.data : [],
    meta: asRecord(record.meta) ?? null,
    raw: record,
  }
}

/** 五个 analytics/logs action 共用的时间窗 + 分页 + 设备过滤参数。 */
function commonQuery(input: {
  cursor?: string
  device?: string
  from?: string
  limit?: number
  to?: string
}): Record<string, QueryValue> {
  return {
    from: input.from,
    to: input.to,
    limit: input.limit,
    cursor: input.cursor,
    device: input.device,
  }
}

function analyticsPath(profileId: string, family: string): string {
  return `/profiles/${encodeURIComponent(profileId)}/analytics/${family}`
}

export async function listProfiles(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return listResult(await request(ctx, '/profiles'))
}

export async function getProfile(
  input: z.infer<typeof getProfileInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/profiles/${encodeURIComponent(input.profileId)}`)
  const record = asRecord(payload)
  return {
    // 上游对 profile 的口径:优先 data,没有 data 就把整个响应当 profile。
    profile: asRecord(record?.data) ?? record ?? {},
    raw: record ?? {},
  }
}

export async function getLogs(
  input: z.infer<typeof getLogsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/profiles/${encodeURIComponent(input.profileId)}/logs`, {
    ...commonQuery(input),
    search: input.search,
    status: input.status,
    sort: input.sort,
    raw: input.raw,
  })
  return listResult(payload)
}

export async function getAnalyticsDomains(
  input: z.infer<typeof getAnalyticsDomainsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, analyticsPath(input.profileId, 'domains'), {
    ...commonQuery(input),
    status: input.status,
    root: input.root,
  })
  return listResult(payload)
}

export async function getAnalyticsDevices(
  input: z.infer<typeof getAnalyticsDevicesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listResult(await request(ctx, analyticsPath(input.profileId, 'devices'), commonQuery(input)))
}

export async function getAnalyticsStatus(
  input: z.infer<typeof getAnalyticsStatusInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listResult(await request(ctx, analyticsPath(input.profileId, 'status'), commonQuery(input)))
}

export async function getAnalyticsReasons(
  input: z.infer<typeof getAnalyticsReasonsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listResult(await request(ctx, analyticsPath(input.profileId, 'reasons'), commonQuery(input)))
}
