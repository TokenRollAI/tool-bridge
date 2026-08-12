/**
 * Mocean 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/mocean/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Mocean 的三个特点决定了这里的形状:
 * - 参数一律带 `mocean-` 前缀,GET 走 query、POST 走 form-encoded;两种都要显式带上
 *   `mocean-resp-format=json`,否则上游回 XML。
 * - 错误主要走**带内 `status` 码**而非 HTTP 状态:HTTP 200 + `{"status":1}` 就是鉴权失败。
 *   `status:0` 才是成功。
 * - 响应字段是 snake_case 且同一语义有多个别名(`msgid`/`message_id`),整形层逐个兜。
 *
 * 与上游的一处偏离:上游把 404/422 压成 400、validate 模式把 401 压成 400。这里把状态
 * 原样交给 `upstreamError`,收敛各 provider 互不相同的错误口径。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getBalanceInput,
  getMessageStatusInput,
  listPricingInput,
  lookupNumberInput,
  sendSmsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'mocean'
const API_BASE = 'https://rest.moceanapi.com/rest/2'

/** Mocean 带内 status 码里语义为"调用方入参有问题"的那些(照抄上游名单)。 */
const CLIENT_ERROR_CODES = new Set([2, 3, 5, 6, 14, 26, 28, 29, 34, 46, 51, 72])

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function errorMessage(body: Json): string | undefined {
  return text(body.err_msg) ?? text(body.error_message) ?? text(body.message) ?? text(body.error)
}

/** Mocean 的数字字段有时是字符串("0.05"),两种都收。 */
function num(body: Json, key: string): number | undefined {
  const value = body[key]
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** 同一语义的多个别名里取第一个能用的;数字也接受(消息 ID 上游有时回数字)。 */
function pick(body: Json, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = body[key]
    if (typeof value === 'string') return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

function requireObject(value: unknown): Json {
  const body = record(value)
  if (body === undefined) throw upstreamError(502, 'mocean 响应不是对象')
  return body
}

function requireNumber(body: Json, key: string): number {
  const value = num(body, key)
  if (value === undefined) throw upstreamError(502, `mocean 响应缺少 ${key}`)
  return value
}

function requireString(body: Json, key: string): string {
  const value = text(body[key])
  if (value === undefined) throw upstreamError(502, `mocean 响应缺少 ${key}`)
  return value
}

/** 剥掉值为 undefined 的键;上游 `compactObject` 的等价物。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/** 带内 status 码 → HTTP 状态,再交给统一的七码映射。 */
function statusCodeToHttp(status: number): number {
  if (status === 1) return 401
  if (status === 32) return 429
  if (CLIENT_ERROR_CODES.has(status)) return 400
  // 未知的带内码按"上游出问题"处理,不甩锅给调用方。
  return 502
}

async function request(
  ctx: ProviderContext,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string | undefined>,
): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(`${API_BASE}${path}`)
  const form = new URLSearchParams()
  const target = method === 'GET' ? url.searchParams : form
  // 不带这个参数 Mocean 回 XML。
  target.set('mocean-resp-format', 'json')
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    target.set(key, value)
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
  if (method === 'POST') headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method,
      headers,
      ...(method === 'POST' ? { body: form.toString() } : {}),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障。
    throw upstreamError(502, error instanceof Error ? `mocean 请求失败: ${error.message}` : 'mocean 请求失败')
  }

  // Mocean 的错误体有时是纯文本;解析不出 JSON 就把原文当 payload,留给消息提取。
  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      payload = raw
    }
  }

  // 带内 status 优先于 HTTP 状态:HTTP 200 + status:1 是鉴权失败,漏判就会把错误当数据。
  const body = record(payload)
  const inband = body === undefined ? undefined : num(body, 'status')
  if (inband !== undefined && inband !== 0) {
    throw upstreamError(statusCodeToHttp(inband), errorMessage(body!) ?? `mocean 请求失败,status ${inband}`)
  }

  if (!response.ok) {
    const message = (typeof payload === 'string' && payload.trim() !== '' ? payload : undefined)
      ?? (body === undefined ? undefined : errorMessage(body))
      ?? (response.statusText || 'mocean 请求失败')
    throw upstreamError(response.status, message)
  }
  return payload
}

export async function getBalance(
  _input: z.infer<typeof getBalanceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = requireObject(await request(ctx, 'GET', '/account/balance', {}))
  return { status: requireNumber(body, 'status'), value: requireNumber(body, 'value') }
}

export async function listPricing(
  input: z.infer<typeof listPricingInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 跨字段约束,schema 表达不了:Mocean 只按 mcc+mnc 组合定位运营商,单给一个会被静默忽略。
  if ((input.mcc === undefined) !== (input.mnc === undefined)) {
    throw new TBError('invalid_argument', 'mcc 与 mnc 必须同时提供')
  }

  const body = requireObject(await request(ctx, 'GET', '/account/pricing', {
    'mocean-type': input.type,
    'mocean-mcc': input.mcc,
    'mocean-mnc': input.mnc,
  }))
  const destinations = body.destinations
  return {
    status: requireNumber(body, 'status'),
    destinations: Array.isArray(destinations)
      ? destinations.map((item) => {
          const row = requireObject(item)
          return compact({
            country: text(row.country),
            operator: text(row.operator),
            mcc: text(row.mcc),
            mnc: text(row.mnc),
            // price 上游有时回数字,出参声明的是字符串。
            price: row.price === undefined || row.price === null ? undefined : String(row.price),
            currency: text(row.currency),
          })
        })
      : [],
  }
}

export async function getMessageStatus(
  input: z.infer<typeof getMessageStatusInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = requireObject(await request(ctx, 'GET', '/report/message', {
    'mocean-msgid': input.messageId,
  }))
  return {
    status: requireNumber(body, 'status'),
    messageStatus: requireNumber(body, 'message_status'),
    messageId: requireString(body, 'msgid'),
    creditDeducted: requireString(body, 'credit_deducted'),
  }
}

function normalizeCarrier(value: unknown): Json | undefined {
  const body = record(value)
  if (body === undefined) return undefined
  return compact({
    country: text(body.country),
    name: pick(body, 'name', 'carrier', 'network'),
    networkCode: pick(body, 'network_code', 'networkCode'),
    mcc: pick(body, 'mcc'),
    mnc: pick(body, 'mnc'),
  })
}

export async function lookupNumber(
  input: z.infer<typeof lookupNumberInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = requireObject(await request(ctx, 'POST', '/nl', { 'mocean-to': input.to }))
  const ported = typeof body.ported === 'string' ? body.ported.trim().toLowerCase() : undefined
  return compact({
    status: requireNumber(body, 'status'),
    messageId: pick(body, 'msgid', 'message_id'),
    to: pick(body, 'to', 'mocean-to'),
    currentCarrier: normalizeCarrier(body.current_carrier ?? body.currentCarrier),
    originalCarrier: normalizeCarrier(body.original_carrier ?? body.originalCarrier),
    // 出参把 ported 声明成枚举;上游偶尔回枚举外的值,那时干脆省略这个键而不是回一个
    // 违反自己 schema 的值。
    ported: ported !== undefined && ['ported', 'not_ported', 'unknown'].includes(ported) ? ported : undefined,
  })
}

export async function sendSms(
  input: z.infer<typeof sendSmsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = requireObject(await request(ctx, 'POST', '/sms', {
    'mocean-from': input.from,
    'mocean-to': input.to,
    'mocean-text': input.text,
    // dlr-mask 是"要不要回执"的开关,只在给了回调地址时才打开。
    'mocean-dlr-mask': input.deliveryReportUrl === undefined ? undefined : '1',
    'mocean-dlr-url': input.deliveryReportUrl,
  }))
  const messages = body.messages
  return {
    messages: Array.isArray(messages)
      ? messages.map((item) => {
          const row = requireObject(item)
          return compact({
            // 逐条消息各有自己的 status:整批 HTTP 成功,单个收件人仍可能被拒。
            status: requireNumber(row, 'status'),
            receiver: text(row.receiver),
            messageId: pick(row, 'msgid', 'message_id'),
            errorMessage: pick(row, 'err_msg', 'error_message'),
          })
        })
      : [],
  }
}
