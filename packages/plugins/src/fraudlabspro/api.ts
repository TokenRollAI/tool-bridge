/**
 * FraudLabs Pro 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/fraudlabspro/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * FraudLabs Pro 的两个特点决定了这里的形状:
 * - **API key 是普通参数**,不走 header:GET 拼进 query(`?key=...&format=json`),
 *   POST 拼进 JSON body。两处都得带,漏一个就是 401。
 * - **失败常以 HTTP 200 + 错误体返回**(`{error}` / `{error_message}` /
 *   `{status:'ERROR'}` / `{success:false}`),状态码不足以判定成败,故 `isErrorPayload`
 *   必须在 `response.ok` 之后再查一遍。
 *
 * 上游 `buildFraudlabsproError` 按"校验期/执行期"分叉的部分不保留(状态码归一由共用的
 * `upstreamError` 统一口径);保留的是**按消息判类**,那是 HTTP 200 场景下唯一的信号源。
 */

import type { z } from 'zod/v4'
import type { feedbackOrderInput, getOrderResultInput, screenOrderInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'fraudlabspro'
const API_BASE = 'https://api.fraudlabspro.com/v2'

type Json = Record<string, unknown>
type ParamValue = number | string | undefined

function asRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

/** 上游 `optionalString` 的语义:先 trim,空则视为缺失。 */
function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** `undefined` 与空串都不发 —— 空串对 FraudLabs Pro 是有含义的取值,不能替调用方发。 */
function compact(input: Record<string, ParamValue>): Record<string, number | string> {
  const output: Record<string, number | string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') output[key] = value
  }
  return output
}

/** HTTP 200 也可能是失败:这四种标记任意一个出现就按错误处理。 */
function isErrorPayload(payload: unknown): boolean {
  const record = asRecord(payload)
  if (record === undefined) return false
  return record.error !== undefined
    || record.error_message !== undefined
    || record.status === 'ERROR'
    || record.success === false
}

function errorMessage(payload: unknown): string | undefined {
  const direct = optionalText(payload)
  if (direct !== undefined) return direct
  const record = asRecord(payload)
  if (record === undefined) return undefined
  const nested = asRecord(record.error)
  return optionalText(record.error_message)
    ?? optionalText(record.error)
    ?? optionalText(nested?.message)
    ?? optionalText(nested?.info)
    ?? optionalText(record.message)
    ?? optionalText(record.status)
}

/**
 * 错误归类。HTTP 200 + 错误体是常态,故消息优先于状态码:
 * - 含 "limit" → 限流(FraudLabs Pro 的额度耗尽就回这种消息,状态仍是 200)。
 * - 提到 license key / api key → 凭证问题。上游在执行期把它压成 400,那是错的 ——
 *   会把"挂载的 key 配错了"说成"调用方参数不对",这里改判 permission_denied。
 */
function fraudlabsproError(status: number, payload: unknown): Error {
  const message = errorMessage(payload) ?? `FraudLabs Pro 请求失败(HTTP ${status || 500})`
  const normalized = message.toLowerCase()

  if (status === 429 || normalized.includes('limit')) return upstreamError(429, message)
  if (status === 401 || status === 403
    || normalized.includes('license key') || normalized.includes('api key')) {
    return upstreamError(401, message)
  }
  // HTTP 200 带错误体时状态码没有归类价值,退回 400(调用方参数问题)。
  return upstreamError(status >= 400 ? status : 400, message)
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw upstreamError(502, 'FraudLabs Pro 返回了无法解析的 JSON 响应')
  }
}

interface RequestInput {
  body?: Record<string, ParamValue>
  method: 'GET' | 'POST'
  path: string
  query?: Record<string, ParamValue>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<Json> {
  const apiKey = requireApiKey(ctx, SERVICE)
  // 上游按 `new URL(path, base + '/')` 拼,故去掉前导斜杠,否则会丢掉 /v2 前缀。
  const url = new URL(input.path.replace(/^\//, ''), `${API_BASE}/`)
  const common = { key: apiKey, format: 'json' }

  const headers: Record<string, string> = {}
  let body: string | undefined
  if (input.method === 'GET') {
    for (const [key, value] of Object.entries(compact({ ...common, ...input.query }))) {
      url.searchParams.set(key, String(value))
    }
  } else {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(compact({ ...common, ...input.body }))
  }

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method,
      headers,
      ...(body === undefined ? {} : { body }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    throw upstreamError(
      502,
      error instanceof Error ? `FraudLabs Pro 请求失败: ${error.message}` : 'FraudLabs Pro 请求失败',
    )
  }

  const payload = await readPayload(response)
  if (!response.ok || isErrorPayload(payload)) throw fraudlabsproError(response.status, payload)

  const record = asRecord(payload)
  if (record === undefined) {
    throw upstreamError(502, 'FraudLabs Pro 返回了无法解析的 JSON 响应')
  }
  return record
}

export async function screenOrder(
  input: z.infer<typeof screenOrderInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 键名从驼峰入参换成 FraudLabs Pro 的下划线线上名,顺序照抄上游让请求体可预期。
  return request(ctx, {
    method: 'POST',
    path: '/order/screen',
    body: {
      ip: input.ip,
      user_order_id: input.userOrderId,
      email: input.email,
      amount: input.amount,
      currency: input.currency,
      payment_mode: input.paymentMode,
      first_name: input.firstName,
      last_name: input.lastName,
      user_phone: input.userPhone,
      email_hash: input.emailHash,
      email_domain: input.emailDomain,
      bin_no: input.binNo,
      quantity: input.quantity,
      coupon_code: input.couponCode,
      flp_checksum: input.flpChecksum,
    },
  })
}

export async function getOrderResult(
  input: z.infer<typeof getOrderResultInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, { method: 'GET', path: '/order/result', query: { id: input.id } })
}

export async function feedbackOrder(
  input: z.infer<typeof feedbackOrderInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    method: 'POST',
    path: '/order/feedback',
    body: { id: input.id, action: input.action, note: input.note },
  })
}
