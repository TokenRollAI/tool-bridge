/**
 * EODHD APIs 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/eodhd_apis/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * EODHD 的三个特点决定了这里的形状:
 * - **API key 是 `api_token` query 参数**,不走 header;每个请求还要显式 `fmt=json`
 *   (缺省返回 CSV)。
 * - 失败可能以 **HTTP 200 + 一段错误文本 / `{message}`** 返回,所以成功分支也要查 body。
 * - 同一个端点的响应形状随参数变:`get_eod` 带 filter 时回标量,不带时回数组;
 *   `get_real_time_quote` 单 ticker 回对象、多 ticker 回数组。
 *
 * 上游把 401/403/404 都压成 400 的自有映射没有搬:状态码归一现在统一走 `upstreamError`,
 * 凭证问题因此落在 permission_denied,调用方能据此换 key 而不是改参数。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getEodInput,
  getIdMappingInput,
  getMacroIndicatorsInput,
  getRealTimeQuoteInput,
  getUstYieldRatesInput,
  searchInstrumentsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'eodhd_apis'
const API_BASE = 'https://eodhd.com/api'
const USER_PATH = '/user'

type Json = Record<string, unknown>
type QueryValue = number | string | undefined

function asRecord(value: unknown): Json | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** EODHD 的错误文案:整个 body 就是一段文本,或者 `message` / `error` / `error.message`。 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return nonEmpty(payload)
  const record = asRecord(payload)
  if (record === undefined) return undefined
  return nonEmpty(record.message) ?? nonEmpty(record.error) ?? nonEmpty(asRecord(record.error)?.message)
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') {
    throw new TBError('unavailable', 'EODHD 返回了空响应', { retryable: true })
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new TBError('unavailable', 'EODHD 返回了非 JSON 响应', { retryable: true })
  }
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, QueryValue> = {},
): Promise<unknown> {
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, `${API_BASE}/`)
  url.searchParams.set('api_token', requireApiKey(ctx, SERVICE))
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
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
    if (error instanceof TBError) throw error
    throw new TBError(
      'unavailable',
      error instanceof Error ? `EODHD 请求失败: ${error.message}` : 'EODHD 请求失败',
      { retryable: true },
    )
  }

  const message = errorMessage(payload)
  if (!response.ok) {
    throw upstreamError(
      response.status,
      message ?? `EODHD APIs request failed with status ${response.status}`,
    )
  }
  // HTTP 200 但 body 是错误文案:这是 EODHD 报参数问题的主要路径。
  if (message !== undefined) throw new TBError('invalid_argument', message)
  return payload
}

function requireObject(value: unknown, field: string): Json {
  const record = asRecord(value)
  if (record === undefined) {
    throw new TBError('unavailable', `EODHD 响应的 ${field} 不是对象`, { retryable: true })
  }
  return record
}

function objectArray(value: unknown, field: string): Json[] {
  if (!Array.isArray(value)) {
    throw new TBError('unavailable', `EODHD 响应的 ${field} 不是数组`, { retryable: true })
  }
  return value.map((item, index) => requireObject(item, `${field}[${index}]`))
}

/** /user 的字段挑出来做定型,缺的补 null(schema 要求这几个键都在)。 */
function normalizeUser(payload: unknown): Json {
  const record = requireObject(payload, 'payload')
  const text = (value: unknown): null | string => nonEmpty(value) ?? null
  const int = (value: unknown): null | number =>
    typeof value === 'number' && Number.isInteger(value) ? value : null
  return {
    name: text(record.name),
    email: text(record.email),
    subscriptionType: text(record.subscriptionType),
    paymentMethod: text(record.paymentMethod),
    apiRequests: int(record.apiRequests),
    apiRequestsDate: text(record.apiRequestsDate),
    dailyRateLimit: int(record.dailyRateLimit),
  }
}

export async function searchInstruments(
  input: z.infer<typeof searchInstrumentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/search/${encodeURIComponent(input.query)}`, {
    fmt: 'json',
    type: input.type,
    exchange: input.exchange,
    // EODHD 的布尔 query 认 1/0。
    bonds_only: input.bondsOnly === undefined ? undefined : (input.bondsOnly ? 1 : 0),
    limit: input.limit,
  })
  return { results: objectArray(payload, 'payload') }
}

export async function listExchanges(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/exchanges-list', { fmt: 'json' })
  return { exchanges: objectArray(payload, 'payload') }
}

export async function getRealTimeQuote(
  input: z.infer<typeof getRealTimeQuoteInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/real-time/${encodeURIComponent(input.ticker)}`, {
    fmt: 'json',
    // 附加 ticker 走 `s`,逗号连接;主 ticker 仍在路径上。
    s: input.additionalTickers?.join(','),
    ex: input.exchange,
  })
  // 单 ticker 回对象、多 ticker 回数组;统一成数组给调用方。
  return {
    quotes: Array.isArray(payload)
      ? payload.map((item, index) => requireObject(item, `payload[${index}]`))
      : [requireObject(payload, 'payload')],
  }
}

export async function getEod(
  input: z.infer<typeof getEodInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/eod/${encodeURIComponent(input.ticker)}`, {
    fmt: 'json',
    from: input.dateFrom,
    to: input.dateTo,
    period: input.period,
    filter: input.filter,
  })

  // 三种响应形状分别落到 rows / value / raw,调用方看哪个非空就知道拿到的是什么。
  if (Array.isArray(payload)) {
    return {
      rows: payload.map((item, index) => requireObject(item, `payload[${index}]`)),
      value: null,
      raw: null,
    }
  }
  if (typeof payload === 'string' || typeof payload === 'number') {
    return { rows: [], value: payload, raw: null }
  }
  return { rows: [], value: null, raw: requireObject(payload, 'payload') }
}

export async function getIdMapping(
  input: z.infer<typeof getIdMappingInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const filters: Record<string, QueryValue> = {
    'filter[symbol]': input.filterSymbol,
    'filter[ex]': input.filterExchange,
    'filter[isin]': input.filterIsin,
    'filter[figi]': input.filterFigi,
    'filter[lei]': input.filterLei,
    'filter[cusip]': input.filterCusip,
    'filter[cik]': input.filterCik,
  }
  // 「至少给一个标识符过滤条件」是跨字段约束,schema 表达不了;不挡的话
  // 上游会把整张映射表拉回来。
  if (Object.values(filters).every(value => value === undefined)) {
    throw new TBError('invalid_argument', 'get_id_mapping 至少需要一个标识符过滤条件')
  }

  const payload = await request(ctx, '/id-mapping', {
    'fmt': 'json',
    ...filters,
    'page[limit]': input.pageLimit,
    'page[offset]': input.pageOffset,
  })
  return { mappings: objectArray(payload, 'payload') }
}

export async function getMacroIndicators(
  input: z.infer<typeof getMacroIndicatorsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 上游只认大写的 alpha-3 国家码。
  const path = `/macro-indicator/${encodeURIComponent(input.country.toUpperCase())}`
  const payload = await request(ctx, path, { fmt: 'json', indicator: input.indicator })
  return { indicators: objectArray(payload, 'payload') }
}

export async function getUstYieldRates(
  input: z.infer<typeof getUstYieldRatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/ust/yield-rates', {
    'fmt': 'json',
    'from': input.dateFrom,
    'to': input.dateTo,
    'filter[year]': input.filterYear,
    'page[limit]': input.pageLimit,
    'page[offset]': input.pageOffset,
  })
  return { rates: objectArray(payload, 'payload') }
}

export async function getUserInfo(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { user: normalizeUser(await request(ctx, USER_PATH)) }
}
