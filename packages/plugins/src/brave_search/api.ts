/**
 * Brave Search 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/brave_search/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 四个 action 是同一形状的 GET:参数全在 query string 上,响应按各自的 outputSchema 裁剪。
 * 三处上游细节决定了这里的形状:
 * - Brave 的错误体带**稳定错误码**(`error.code`),它比 HTTP 状态更准:配额耗尽可能以
 *   非 429 的状态回 `QUOTA_LIMITED`,故先看码、再退回状态归一。
 * - `goggles` 既收单个字符串也收字符串数组,数组要展开成**重复的同名** query 参数。
 * - 所有字符串参数都按"去空白后仍非空才发"处理 —— 上游用 `optionalString` 统一做了这件事,
 *   Zod 的 `min(1)` 拦不住纯空白串,故这层必须保留。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { imageSearchInput, newsSearchInput, videoSearchInput, webSearchInput } from './schema'
import { compactDefined as compact, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'brave_search'
const API_BASE = 'https://api.search.brave.com'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | string[] | undefined

/** 配额/限流:这些码出现时一律按 429 处理,不管上游给的是什么状态。 */
const RATE_LIMIT_CODES = new Set(['QUOTA_LIMITED', 'RATE_LIMITED', 'USAGE_LIMIT_EXCEEDED'])
/** 凭证无效或订阅不存在:调用方要换 key,不是重试能解决的。 */
const AUTH_CODES = new Set(['SUBSCRIPTION_TOKEN_INVALID', 'SUBSCRIPTION_NOT_FOUND'])
/** 请求本身不被接受(套餐不含该选项、参数非法):归 invalid_argument。 */
const INVALID_CODES = new Set(['RESOURCE_NOT_ALLOWED', 'OPTION_NOT_IN_PLAN', 'INVALID_URL'])

/** 出参里 `null` 与"字段缺席"是两回事:前者是上游明确说"这一族没有结果"。 */
function nullableRecord(value: unknown): Json | null | undefined {
  return value === null ? null : record(value)
}

function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) {
    // 契约说好是对象;不是就是上游出问题,不是调用方的错。
    throw new TBError('unavailable', `${label}不是对象`, { retryable: true })
  }
  return result
}

function objectArray(value: unknown): Json[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map(item => requireRecord(item, 'Brave Search 结果项'))
}

/** 纯空白的 q 能过 Zod 的 `min(1)`,但打到上游就是一次必然失败的空查询,先挡下。 */
function searchTerm(value: string): string {
  const term = text(value)
  if (term === undefined) throw new TBError('invalid_argument', 'q 不能是空白')
  return term
}

/** goggles 的两种形态:单串去空白;数组逐项去空白后丢空,全空则整个参数不发。 */
function goggles(value: string | string[] | undefined): string | string[] | undefined {
  if (value === undefined || typeof value === 'string') return text(value)
  const items = value.map(item => text(item)).filter((item): item is string => item !== undefined)
  return items.length > 0 ? items : undefined
}

/** Brave 错误 → TBError。稳定错误码优先,拿不到码再按 HTTP 状态走公共归一表。 */
function braveSearchError(status: number, payload: unknown): TBError {
  const error = record(record(payload)?.error)
  const message = text(error?.detail) ?? text(error?.code) ?? `Brave Search 返回 HTTP ${status}`
  const code = text(error?.code)
  if (code !== undefined) {
    if (RATE_LIMIT_CODES.has(code)) return upstreamError(429, message)
    if (AUTH_CODES.has(code)) return upstreamError(401, message)
    if (INVALID_CODES.has(code)) return upstreamError(400, message)
  }
  return upstreamError(status, message)
}

async function request(ctx: ProviderContext, path: string, query: Record<string, QueryValue>): Promise<unknown> {
  const { data } = await http.request({
    path,
    method: 'GET',
    query: Object.entries(query),
    headers: {
      'accept': 'application/json',
      'x-subscription-token': requireApiKey(ctx, SERVICE),
    },
    invalidJsonMessage: 'Brave Search 返回了非 JSON 响应',
    mapError: ({ data: payload, status }) => braveSearchError(status, payload),
  })
  return data ?? null
}

/** web 与其余三个 action 的出参形状不同:前者按结果族分列,后者是一条结果列表。 */
function normalizeWebSearch(payload: unknown): Json {
  const result = requireRecord(payload, 'Brave Search 响应')
  return compact({
    type: text(result.type) ?? 'search',
    query: nullableRecord(result.query),
    web: nullableRecord(result.web),
    news: nullableRecord(result.news),
    videos: nullableRecord(result.videos),
    locations: nullableRecord(result.locations),
    discussions: nullableRecord(result.discussions),
    faq: nullableRecord(result.faq),
    infobox: nullableRecord(result.infobox),
    mixed: nullableRecord(result.mixed),
    summarizer: nullableRecord(result.summarizer),
    rich: nullableRecord(result.rich),
  })
}

/**
 * `withExtra` 区分 news 与 video/image:上游三者共用一个整形函数、都带上 `extra`,但
 * news 的 outputSchema 是不含 `extra` 的 strictObject —— 上游自己的代码与声明打架。
 * 这里以**声明**为准(它才是消费者看到的契约),故 news 不透出 `extra`。
 */
function normalizeCollection(payload: unknown, withExtra: boolean): Json {
  const result = requireRecord(payload, 'Brave Search 响应')
  return compact({
    type: text(result.type) ?? 'search',
    query: nullableRecord(result.query),
    results: objectArray(result.results),
    extra: withExtra ? nullableRecord(result.extra) : undefined,
  })
}

export async function webSearch(input: z.infer<typeof webSearchInput>, ctx: ProviderContext): Promise<Json> {
  return normalizeWebSearch(await request(ctx, '/res/v1/web/search', {
    q: searchTerm(input.q),
    search_lang: text(input.search_lang),
    ui_lang: text(input.ui_lang),
    country: text(input.country),
    safesearch: text(input.safesearch),
    count: input.count,
    offset: input.offset,
    spellcheck: input.spellcheck,
    freshness: text(input.freshness),
    result_filter: text(input.result_filter),
    extra_snippets: input.extra_snippets,
    goggles: goggles(input.goggles),
    text_decorations: input.text_decorations,
    units: text(input.units),
    operators: input.operators,
    include_fetch_metadata: input.include_fetch_metadata,
  }))
}

export async function newsSearch(input: z.infer<typeof newsSearchInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/res/v1/news/search', {
    q: searchTerm(input.q),
    search_lang: text(input.search_lang),
    ui_lang: text(input.ui_lang),
    country: text(input.country),
    safesearch: text(input.safesearch),
    count: input.count,
    offset: input.offset,
    spellcheck: input.spellcheck,
    freshness: text(input.freshness),
    extra_snippets: input.extra_snippets,
    goggles: goggles(input.goggles),
    operators: input.operators,
    include_fetch_metadata: input.include_fetch_metadata,
  })
  return normalizeCollection(payload, false)
}

export async function videoSearch(input: z.infer<typeof videoSearchInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/res/v1/videos/search', {
    q: searchTerm(input.q),
    search_lang: text(input.search_lang),
    ui_lang: text(input.ui_lang),
    country: text(input.country),
    safesearch: text(input.safesearch),
    count: input.count,
    offset: input.offset,
    spellcheck: input.spellcheck,
    freshness: text(input.freshness),
    operators: input.operators,
    include_fetch_metadata: input.include_fetch_metadata,
  })
  return normalizeCollection(payload, true)
}

export async function imageSearch(input: z.infer<typeof imageSearchInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/res/v1/images/search', {
    q: searchTerm(input.q),
    search_lang: text(input.search_lang),
    country: text(input.country),
    safesearch: text(input.safesearch),
    count: input.count,
    spellcheck: input.spellcheck,
  })
  return normalizeCollection(payload, true)
}
