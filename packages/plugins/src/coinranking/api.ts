/**
 * Coinranking 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/coinranking/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Coinranking 的两个特点决定了这里的形状:
 * - 响应是 `{ status, data }` **信封**,且 `status: 'fail'` 可以搭配 HTTP 200 出现 ——
 *   只看 `response.ok` 会把失败当成功,故成功判定必须同时看两者。
 * - 全部 action 都是 GET + query;凭证走 `x-access-token` 头,不是 Bearer。
 */

import type { z } from 'zod/v4'
import type {
  getCoinDetailsInput,
  getCoinPriceHistoryInput,
  listCoinsInput,
  searchSuggestionsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'coinranking'
const API_BASE = 'https://api.coinranking.com/v2'

type Json = Record<string, unknown>
type Query = Record<string, number | string | undefined>

/** 值是普通对象才返回它;数组与 null 都算"不是对象"。 */
function asRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

/** 非空字符串才算有值(上游 `optionalString` 的语义:先 trim,空则视为缺失)。 */
function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * 信封里契约要求的对象字段。取不到是**上游破了契约**,不是调用方的错,
 * 故归 502(→ unavailable/retryable),与上游 `providerResponseError` 一致。
 */
function requiredRecord(value: unknown, field: string): Json {
  const record = asRecord(value)
  if (record === undefined) throw upstreamError(502, `Coinranking 返回的 ${field} 不是对象`)
  return record
}

/** 同上,但要求是对象数组(上游 `objectArray`:缺字段即报错,不静默补空数组)。 */
function objectArray(value: unknown, field: string): Json[] {
  if (!Array.isArray(value)) throw upstreamError(502, `Coinranking 返回的 ${field} 不是数组`)
  return value.map(item => requiredRecord(item, field))
}

/** `undefined` 与空串省略,`0` 必须保留 —— offset=0 是有效值,不能被真值判断吃掉。 */
function appendQuery(url: URL, query: Query): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') throw upstreamError(502, 'Coinranking 返回了空响应')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw upstreamError(502, 'Coinranking 返回了非法 JSON')
  }
}

/**
 * 上游的 `buildCoinrankingError` 把 404 压成 400、把 401 在校验期压成 400;这两条
 * 都不再保留 —— 状态码归一现在由共用的 `upstreamError` 统一口径(见 _runtime/upstreamError.ts),
 * 每个 provider 各自压一套正是它要消灭的东西。保留的是 `< 400 → 502`:
 * 那不是映射口径,而是 Coinranking 特有的"HTTP 200 也可能是失败"。
 */
function coinrankingError(httpStatus: number, payload: unknown): Error {
  const message = optionalText(asRecord(payload)?.message)
    ?? `Coinranking 请求失败(HTTP ${httpStatus})`
  return upstreamError(httpStatus >= 400 ? httpStatus : 502, message)
}

/** 所有 action 共用的一次 GET:拼 URL、带凭证头、校验信封、返回整个 payload。 */
async function request(ctx: ProviderContext, path: string, query: Query = {}): Promise<Json> {
  const url = new URL(`${API_BASE}${path}`)
  appendQuery(url, query)

  const response = await guardedFetch(url.toString(), {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'x-access-token': requireApiKey(ctx, SERVICE),
    },
  })

  const payload = await readPayload(response)
  const status = optionalText(asRecord(payload)?.status)
  if (!response.ok || status !== 'success') throw coinrankingError(response.status, payload)
  return requiredRecord(payload, 'payload')
}

export async function searchSuggestions(
  input: z.infer<typeof searchSuggestionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/search-suggestions', { query: input.query })
  const data = requiredRecord(payload.data, 'data')
  return {
    results: {
      coins: objectArray(data.coins, 'coins'),
      exchanges: objectArray(data.exchanges, 'exchanges'),
      markets: objectArray(data.markets, 'markets'),
      fiat: objectArray(data.fiat, 'fiat'),
    },
  }
}

export async function listCoins(
  input: z.infer<typeof listCoinsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/coins', {
    limit: input.limit,
    offset: input.offset,
    search: input.search,
    orderBy: input.orderBy,
    orderDirection: input.orderDirection,
    referenceCurrencyUuid: input.referenceCurrencyUuid,
    timePeriod: input.timePeriod,
  })
  const data = requiredRecord(payload.data, 'data')
  return {
    stats: requiredRecord(data.stats, 'stats'),
    coins: objectArray(data.coins, 'coins'),
  }
}

export async function getCoinDetails(
  input: z.infer<typeof getCoinDetailsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/coin/${encodeURIComponent(input.uuid)}`
  const payload = await request(ctx, path, {
    referenceCurrencyUuid: input.referenceCurrencyUuid,
    timePeriod: input.timePeriod,
  })
  const data = requiredRecord(payload.data, 'data')
  return { coin: requiredRecord(data.coin, 'coin') }
}

export async function getCoinPriceHistory(
  input: z.infer<typeof getCoinPriceHistoryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/coin/${encodeURIComponent(input.uuid)}/price-history`
  const payload = await request(ctx, path, {
    referenceCurrencyUuid: input.referenceCurrencyUuid,
    timePeriod: input.timePeriod,
  })
  const data = requiredRecord(payload.data, 'data')
  return {
    change: optionalText(data.change),
    history: objectArray(data.history, 'history'),
  }
}

export async function getReferenceCurrencies(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/reference-currencies')
  const data = requiredRecord(payload.data, 'data')
  return { currencies: objectArray(data.currencies, 'currencies') }
}

export async function getGlobalStats(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/stats')
  const data = requiredRecord(payload.data, 'data')
  return { stats: requiredRecord(data.stats, 'stats') }
}
