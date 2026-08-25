/**
 * Umami 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/umami/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 凭证在 **`Authorization: Bearer` 请求头**里,不在 URL 上。
 *
 * 八个 action 都是 GET,差别只在路径与 query。三处上游细节决定了这里的形状:
 * - 四个带时间范围的 action(stats / pageviews / metrics / events)共用同一套 query:
 *   `startAt`、`endAt`(毫秒时间戳)、`timezone` 必填,后面跟一串同名的可选维度过滤器。
 *   抽成 `dateRangeQuery` 一处,免得漏发某个过滤器时四个 action 各错各的。
 * - 分页接口回的是 `{data, count, page, pageSize}` 信封,`data` 才是列表;而 `count` /
 *   `page` / `pageSize` 的**取值域**(非负 / 正整数)是出参契约的一部分,上游破了就归
 *   unavailable —— 把 `page: 0` 透出去等于让调用方拿着一个不能用的游标继续翻。
 * - `get_metrics` 的响应顶层就是**裸数组**(不是信封),故它单独走一条整形路径。
 *
 * 与上游的两处有意偏离:
 * - 上游 `mapUmamiError` 把 401/403 之外的一切非枚举状态压成 502(含 409),这里不保留:
 *   状态码归一由共用的 `upstreamError` 统一口径,每个 provider 各压一套正是它要消灭的东西。
 * - 上游 `readResponsePayload` 把非 JSON 响应体包成 `{message: text}`,于是 2xx 上回一张
 *   HTML 错误页会被当成合法业务对象透出(`{user: {message: '<html>…'}}`)。这里只在**错误
 *   响应**上保留这个取法(用来捞错误消息),2xx 非 JSON 归 unavailable。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getMetricsInput,
  getPageviewsInput,
  getRealtimeInput,
  getWebsiteInput,
  getWebsiteStatsInput,
  listEventsInput,
  listWebsitesInput,
} from './schema'
import { asJsonObject as asRecord, trimmedText as optionalText } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'umami'
const API_BASE = 'https://api.umami.is'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>
type Query = Record<string, string | undefined>

/** 四个带时间范围的 action 共用的入参切面。 */
interface DateRangeFilters {
  browser?: string
  city?: string
  country?: string
  device?: string
  endAt: number
  host?: string
  os?: string
  referrer?: string
  region?: string
  startAt: number
  timezone: string
  title?: string
  url?: string
}

/**
 * 必填字符串入参。schema 上是 `min(1)`,拦得住空串**拦不住纯空白** —— 而纯空白的
 * websiteId 会拼出 `/api/websites/%20`,timezone 则让上游按 UTC 静默算错一批数字。
 */
function requiredText(value: unknown, field: string): string {
  const text = optionalText(value)
  if (text === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return text
}

/** 错误消息藏在 `error`(字符串或对象)与 `message` 三处之一,纯文本体则整段拿来用。 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return optionalText(payload)
  const body = asRecord(payload)
  if (body === undefined) return undefined
  return optionalText(body.error)
    ?? optionalText(asRecord(body.error)?.message)
    ?? optionalText(body.message)
}

async function request(ctx: ProviderContext, path: string, query: Query = {}): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const response = await http.request({
    path,
    query: Object.entries(query),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    invalidJson: 'text',
    mapError: ({ data, status, statusText }) => upstreamError(
      status,
      errorMessage(data) ?? (statusText || `umami 返回 HTTP ${status}`),
    ),
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined ? 'umami 请求失败' : `umami 请求失败: ${message}`,
    ),
  })
  if (response.bodyKind === 'invalid-json') throw upstreamError(502, 'umami 返回了非 JSON 响应')
  return response.bodyKind === 'empty' ? null : response.data
}

/** 响应里契约要求是对象的位置;不是就是上游破了契约,不是调用方的错。 */
function responseRecord(value: unknown, field: string): Json {
  const object = asRecord(value)
  if (object === undefined) throw upstreamError(502, `umami 响应的 ${field} 不是对象`)
  return object
}

function responseArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw upstreamError(502, `umami 响应的 ${field} 不是数组`)
  return value
}

function objectArray(value: unknown, field: string): Json[] {
  return responseArray(value, field).map(item => responseRecord(item, `${field} 列表项`))
}

/** `count` 可以是 0(没有匹配项),`page` / `pageSize` 不行 —— 0 页是个不能用的游标。 */
function responseInteger(value: unknown, field: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw upstreamError(502, `umami 响应的 ${field} 不是合法整数`)
  }
  return value
}

function dateRangeQuery(input: DateRangeFilters): Query {
  return {
    startAt: String(input.startAt),
    endAt: String(input.endAt),
    timezone: requiredText(input.timezone, 'timezone'),
    url: optionalText(input.url),
    referrer: optionalText(input.referrer),
    title: optionalText(input.title),
    host: optionalText(input.host),
    os: optionalText(input.os),
    browser: optionalText(input.browser),
    device: optionalText(input.device),
    country: optionalText(input.country),
    region: optionalText(input.region),
    city: optionalText(input.city),
  }
}

/** `/api/websites/{id}/…` 的公共前缀;id 进路径段前必须 encode。 */
function websitePath(websiteId: unknown, suffix = ''): string {
  return `/api/websites/${encodeURIComponent(requiredText(websiteId, 'websiteId'))}${suffix}`
}

/** `{data, count, page, pageSize}` 信封 → 平铺的列表出参。 */
function paginated(payload: unknown, listKey: string): Json {
  const envelope = responseRecord(payload, '分页')
  return {
    [listKey]: objectArray(envelope.data, 'data'),
    count: responseInteger(envelope.count, 'count', 0),
    page: responseInteger(envelope.page, 'page', 1),
    pageSize: responseInteger(envelope.pageSize, 'pageSize', 1),
    raw: envelope,
  }
}

export async function getCurrentUser(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const user = responseRecord(await request(ctx, '/api/me'), 'user')
  // `raw` 与 `user` 指向同一个对象:`/api/me` 的响应体本身就是用户对象,没有外层信封。
  return { user, raw: user }
}

export async function listWebsites(
  input: z.infer<typeof listWebsitesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/api/websites', {
    query: optionalText(input.query),
    page: input.page === undefined ? undefined : String(input.page),
    pageSize: input.pageSize === undefined ? undefined : String(input.pageSize),
  })
  return paginated(payload, 'websites')
}

export async function getWebsite(
  input: z.infer<typeof getWebsiteInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const website = responseRecord(await request(ctx, websitePath(input.websiteId)), 'website')
  return { website, raw: website }
}

export async function getWebsiteStats(
  input: z.infer<typeof getWebsiteStatsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = websitePath(input.websiteId, '/stats')
  const stats = responseRecord(await request(ctx, path, dateRangeQuery(input)), 'stats')
  return { stats, raw: stats }
}

export async function getPageviews(
  input: z.infer<typeof getPageviewsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = websitePath(input.websiteId, '/pageviews')
  const query = { ...dateRangeQuery(input), unit: optionalText(input.unit) }
  const pageviews = responseRecord(await request(ctx, path, query), 'pageviews')
  return { pageviews, raw: pageviews }
}

export async function getMetrics(
  input: z.infer<typeof getMetricsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = websitePath(input.websiteId, '/metrics')
  const query = {
    ...dateRangeQuery(input),
    type: requiredText(input.type, 'type'),
    limit: input.limit === undefined ? undefined : String(input.limit),
  }
  // metrics 的响应顶层就是数组,没有 `{data:…}` 信封 —— `raw` 也是那个数组。
  const payload = await request(ctx, path, query)
  return { metrics: objectArray(payload, 'metrics'), raw: responseArray(payload, 'metrics') }
}

export async function getRealtime(
  input: z.infer<typeof getRealtimeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // realtime 不挂在 /api/websites 下,是独立的 /api/realtime/{id}。
  const path = `/api/realtime/${encodeURIComponent(requiredText(input.websiteId, 'websiteId'))}`
  const realtime = responseRecord(await request(ctx, path), 'realtime')
  return { realtime, raw: realtime }
}

export async function listEvents(
  input: z.infer<typeof listEventsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = websitePath(input.websiteId, '/events')
  const query = {
    ...dateRangeQuery(input),
    query: optionalText(input.query),
    page: input.page === undefined ? undefined : String(input.page),
    pageSize: input.pageSize === undefined ? undefined : String(input.pageSize),
  }
  return paginated(await request(ctx, path, query), 'events')
}
