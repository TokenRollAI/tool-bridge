/**
 * IPQualityScore 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/ipqualityscore/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * IPQS 的两个特点决定了这里的形状:
 * - **API key 拼在 URL 路径里**(`/api/json/{family}/{apiKey}/{value}`),不走 header。
 *   四个 action 的差别只有 family、主值与 query,故共用一个 `request()`。
 * - **失败常以 HTTP 200 + `success:false` 返回**:凭证失效、额度耗尽都走这条路。
 *   状态码因此不足以归类错误,必须再读 body 里的 message —— `ipqsError()` 是这套
 *   "先看消息、再看状态"判定的唯一实现。
 */

import { TBError } from '@tool-bridge/plugin-sdk'
import { z } from 'zod/v4'
import type {
  checkIpReputationInput,
  scanUrlInput,
  validateEmailInput,
  validatePhoneInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'ipqualityscore'
const API_BASE = 'https://www.ipqualityscore.com'

/** 上游用 `node:net` 的 isIP 卡这一层;这里换成同语义的 Zod 校验器,不引运行时依赖。 */
const IP_LITERAL = z.union([z.ipv4(), z.ipv6()])

type Json = Record<string, unknown>
type Family = 'email' | 'ip' | 'phone' | 'url'
/** query 项;值为 `undefined` 表示该参数不传(而非传空串)。 */
type Query = Array<[string, string | undefined]>

/** 上游对可选文本参数的口径:trim 后非空才发,纯空白按未提供处理。 */
function optionalText(value: string | undefined): string | undefined {
  return value?.trim() || undefined
}

/**
 * 主值先 trim 再拼进路径。schema 的 `min(1)` 挡不住纯空白串,而空路径段会打出
 * `/api/json/phone/{key}/` 这种上游读不懂的 URL。
 */
function pathValue(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new TBError('invalid_argument', `${field} 不能为空`)
  return trimmed
}

/** IPQS 的错误文案在 `message`,少数端点用 `error`;整个 body 也可能就是一段纯文本。 */
function messageOf(payload: unknown): string | undefined {
  if (typeof payload === 'string') return optionalText(payload)
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const record = payload as Json
  const pick = (value: unknown): string | undefined =>
    typeof value === 'string' ? optionalText(value) : undefined
  return pick(record.message) ?? pick(record.error)
}

/**
 * IPQS 错误 → TBError。判定顺序照搬上游,且**消息优先于状态码** —— 因为大多数失败
 * 是 HTTP 200 带 `success:false`,只有文案能说明是额度耗尽还是凭证无效。
 * 三段顺序不能调:额度耗尽的文案里常一并提到 API key(「your API key has insufficient
 * credits」),先判凭证会把限流误报成 permission_denied,调用方于是不再重试。
 */
function ipqsError(response: Response, payload: unknown): TBError {
  const message = messageOf(payload)
    ?? optionalText(response.statusText)
    ?? `IPQualityScore request failed with ${response.status}`
  const lower = message.toLowerCase()

  if (response.status === 429 || response.status === 402 || lower.includes('insufficient credits')) {
    return upstreamError(429, message)
  }
  // 上游把 403 和一切凭证类文案都收敛成 401(对调用方而言都是"这把 key 不能用")。
  if (lower.includes('invalid api key') || lower.includes('api key')
    || response.status === 401 || response.status === 403) {
    return upstreamError(401, message)
  }
  if (
    response.status === 400
    || lower.includes('invalid ip')
    || lower.includes('invalid email')
    || lower.includes('invalid phone')
    || lower.includes('invalid url')
  ) {
    return upstreamError(400, message)
  }
  // 状态码 2xx/3xx 却走到这里 = 上游自称失败但没给可归类的理由,当作上游故障。
  return upstreamError(response.status >= 400 ? response.status : 502, message)
}

/** 尽力解析响应体:IPQS 在边缘错误上会回空体或纯文本。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

async function request(
  ctx: ProviderContext,
  family: Family,
  value: string,
  query: Query = [],
): Promise<Json> {
  const path = `/api/json/${family}/${encodeURIComponent(requireApiKey(ctx, SERVICE))}/${encodeURIComponent(value)}`
  const url = new URL(path, API_BASE)
  for (const [key, queryValue] of query) {
    if (queryValue !== undefined) url.searchParams.append(key, queryValue)
  }

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    payload = await readPayload(response)
  } catch (error) {
    // 上游主机是写死的常量,这里只可能是网络/传输问题 —— 重试有意义,不该归成 internal。
    throw new TBError(
      'unavailable',
      error instanceof Error ? `IPQualityScore 请求失败: ${error.message}` : 'IPQualityScore 请求失败',
      { retryable: true },
    )
  }

  if (!response.ok) throw ipqsError(response, payload)
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TBError('unavailable', `IPQualityScore 对 ${family} 的响应不是 JSON 对象`, { retryable: true })
  }
  if ((payload as Json).success === false) throw ipqsError(response, payload)
  return payload as Json
}

export async function checkIpReputation(
  input: z.infer<typeof checkIpReputationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ipAddress = pathValue(input.ipAddress, 'ipAddress')
  // schema 只要求非空串。非 IP 的入参上游会回 200 + success:false,本地挡住省一次往返,
  // 也让错误落在 invalid_argument 而不是含糊的上游故障上。
  if (!IP_LITERAL.safeParse(ipAddress).success) {
    throw new TBError('invalid_argument', 'ipAddress 必须是合法的 IPv4 或 IPv6 地址')
  }
  return await request(ctx, 'ip', ipAddress, [
    ['strictness', input.strictness?.toString()],
    ['allow_public_access_points', input.allowPublicAccessPoints?.toString()],
    ['user_agent', optionalText(input.userAgent)],
    ['user_language', optionalText(input.userLanguage)],
  ])
}

export async function validateEmail(
  input: z.infer<typeof validateEmailInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await request(ctx, 'email', pathValue(input.email, 'email'), [
    ['timeout', input.timeout?.toString()],
    ['abuse_strictness', input.abuseStrictness?.toString()],
  ])
}

export async function validatePhone(
  input: z.infer<typeof validatePhoneInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await request(ctx, 'phone', pathValue(input.phone, 'phone'), [
    ['strictness', input.strictness?.toString()],
    // 多个候选国家是重复的 `country[]`,且上游只认大写的 ISO alpha-2。
    ...(input.country ?? []).map((code): [string, string] => ['country[]', code.toUpperCase()]),
  ])
}

export async function scanUrl(
  input: z.infer<typeof scanUrlInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await request(ctx, 'url', pathValue(input.url, 'url'), [
    ['strictness', input.strictness?.toString()],
  ])
}
