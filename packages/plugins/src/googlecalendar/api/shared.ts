/**
 * Google Calendar 各 handler 共用的请求层:URL/query 拼装、凭证、错误归一、写字段白名单。
 *
 * 迁移自 open-connector `src/providers/googlecalendar/runtime-shared.ts`。37 个 action 按上游
 * 的分组落在同目录的五个模块里(calendars / events / aggregate / freebusy / misc)。
 *
 * ## 凭证在 header,且是 OAuth 换来的
 *
 * `authorization: Bearer <access token>`,不在 URL。这个 token 是**平台托管 OAuth2**
 * (见 `../index.ts` 的 `oauth` 声明)用授权码换来、并按需刷新后注入的;插件侧照常
 * `requireApiKey(ctx, SERVICE)` 取,不需要知道它是 OAuth 来的,也不碰 refresh_token
 * 与 client 凭证 —— 那些在平台侧,插件永远看不到。
 *
 * ## 四处上游细节决定了这里的形状
 *
 * 1. **403 身兼两职**:Google 用它同时表达"配额/限流"与"权限不足"。判据是错误体
 *    `error.errors[].reason`(`rateLimitExceeded` 一族)。归错了 agent 就会对一个永远
 *    不会变的权限错误无限重试,或反过来把等一会儿就好的限流当成死路。
 * 2. **syncToken 过期是 410**:Google 用 410 说"你手上的增量令牌太旧,做一次全量同步再
 *    拿新的"。只有**发了 syncToken 的请求**才该这么解读,故由调用方用 `syncTokenAware`
 *    标出来(同上游)。
 * 3. **重复同名 query 参数**:`eventTypes` / `sharedExtendedProperty` 这些既收单串也收
 *    数组,数组要展开成重复的同名参数,不能拼成逗号串。
 * 4. **写操作按白名单挑字段**:Google 的 PUT 是整体替换,把读回来的完整资源原样 PUT
 *    回去会连 `etag` / `kind` / 只读字段一起发,Google 直接 400。故每类资源都有一张
 *    可写字段表,读改写与 PATCH 都只走表内字段(见各模块的 `*WritableKeys`)。
 *
 * ## 与上游的有意偏离
 *
 * - **不发 `user-agent`**:上游报的是它自己的名字,照抄等于把流量记在别人账上;
 *   Google Calendar 也不要求这个头。
 * - 上游 `asObject()` 对**入参**的"必须是对象"断言全部去掉:入参已由 Zod 的
 *   `strictObject` 保证,再断言一次是死代码。落在**上游响应**上的同类断言保留,
 *   但归 `unavailable`(上游违约,不是调用方的错),不像上游那样报 400。
 * - 错误消息回显上游原文时**截断**:Google 的错误页可能是整页 HTML,原样塞进 message
 *   会把日志和 agent 的上下文一起淹掉。
 */

import { TBError } from '@tool-bridge/plugin-sdk'
import {
  createProviderHttpClient,
  type ProviderHttpErrorContext,
  type ProviderHttpRequest,
  type ProviderHttpResult,
} from '../../_runtime/providerHttp'
import { asJsonObject, compactDefined, trimmedText } from '../../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../../_runtime/plugin'
import { upstreamError } from '../../_runtime/upstreamError'

export const SERVICE = 'googlecalendar'
export const API_BASE = 'https://www.googleapis.com/calendar/v3'
const REQUEST_TIMEOUT_MS = 30_000
const GOOGLE_API_ORIGIN = new URL(API_BASE).origin
const http = createProviderHttpClient({ baseUrl: `${GOOGLE_API_ORIGIN}/`, service: SERVICE })
/** 错误消息里最多回显多少上游原文。 */
const MAX_ERROR_MESSAGE_LENGTH = 500

/** 配额/限流的 reason:403 带上它们时按 429 归一(可重试),不是权限问题。 */
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'dailyLimitExceeded',
])

export type Json = Record<string, unknown>
/** 只有字符串与字符串数组会落到 query 上(数字/布尔在调用处先 stringify,同上游)。 */
export type Query = Record<string, string | string[] | undefined>

export interface CalendarRequest {
  /** 有 body 即默认 POST(同上游);要 PUT/PATCH/DELETE 就显式给 method。 */
  body?: unknown
  method?: ProviderHttpRequest['method']
  query?: Query
  /** 本次请求发了 syncToken:410 要改写成"重新全量同步"的指引(见文件头第 2 条)。 */
  syncTokenAware?: boolean
  url: string
}

/** 上游 `optionalString` 的等价物:去空白后仍非空才算有值。 */
export const text = trimmedText

export const record = asJsonObject

/** 契约说好是对象的地方上游回了别的东西 —— 上游违约,不是调用方的错。 */
export function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) {
    throw new TBError('unavailable', `${label}不是对象`, { retryable: true })
  }
  return result
}

/**
 * 丢掉值为 undefined 的键(上游 `compactObject`);`null` 要留住。
 *
 * 泛型透传值类型,好让 `compact({...})` 的结果能直接当 `Query` 用 —— 退化成
 * `Record<string, unknown>` 就得在每个调用处补一次断言。
 */
export const compact = compactDefined

/** 上游 `stringifyBoolean`:布尔进 query 前先变字符串。 */
export function bool(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : String(value)
}

/** 上游 `stringifyInteger`。 */
export function int(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value)
}

/**
 * schema 把它标成必填(`min(1)`),但纯空白串能过 `min(1)`;上游在 executor 里另有一道
 * 去空白后的必填断言,保留 —— 否则会打出一个 `/calendars/%20%20/events` 这样的请求,
 * 换回来的 404 会让调用方以为日历不存在。
 */
export function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} 是必填的`)
  return result
}

/** 白名单挑字段(上游 `pickWritableFields` / `pickKnownFields`):缺席的键不出现在结果里。 */
export function pickKnownFields(input: Json, keys: readonly string[]): Json {
  return Object.fromEntries(keys.flatMap(key => (input[key] === undefined ? [] : [[key, input[key]]])))
}

/**
 * 上游既收单串也收数组的 query 参数(`eventTypes` 一族)。
 *
 * 空串按"没给"处理,但**不去空白** —— 与上游 `pickRepeatedString` 逐字一致。这些字段的
 * 合法值是 Google 定义的枚举/键值串,带空白的值上游会以 400 拒掉,本地再拦一次没有收益。
 */
export function repeated(value: string | string[] | undefined): string | string[] | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value === '' ? undefined : value
  const items = value.filter(item => item !== '')
  return items.length > 0 ? items : undefined
}

function requestTarget(url: string, query: Query | undefined): {
  path: string
  query: NonNullable<ProviderHttpRequest['query']>
} {
  const target = new URL(url)
  if (target.origin !== GOOGLE_API_ORIGIN) {
    throw new TBError('invalid_argument', 'Google Calendar 请求必须保持在 Google API origin')
  }
  return {
    path: target.pathname.replace(/^\/+/, ''),
    query: [
      ...target.searchParams.entries(),
      ...Object.entries(query ?? {}),
    ],
  }
}

function truncate(value: string): string {
  return value.length <= MAX_ERROR_MESSAGE_LENGTH ? value : `${value.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
}

/** 从 Google 的错误体里取消息与 reason 列表;非 JSON(错误页)就用原文当消息。 */
function readError(context: ProviderHttpErrorContext): { message: string, reasons: string[] } {
  const fallback = `Google Calendar 返回 HTTP ${context.status}`
  if (context.bodyKind === 'empty') return { message: fallback, reasons: [] }
  if (context.bodyKind !== 'json') return { message: truncate(String(context.data)), reasons: [] }

  const payload = context.data
  const body = record(payload)
  const error = record(body?.error)
  const reasons = Array.isArray(error?.errors)
    ? error.errors.map(item => text(record(item)?.reason)).filter((item): item is string => item !== undefined)
    : []
  // `error_description` 是令牌端点那一族的字段名(access token 失效时会走到这里)。
  const serialized = JSON.stringify(payload)
  const message = text(error?.message)
    ?? text(body?.error_description)
    ?? (serialized === undefined ? fallback : truncate(serialized))
  return { message, reasons }
}

function calendarError(context: ProviderHttpErrorContext, syncTokenAware: boolean): TBError {
  const { message, reasons } = readError(context)
  if (syncTokenAware && context.status === 410) {
    // 归 invalid_argument:能修的是调用方去掉 syncToken 重来一次全量同步,重试同一个
    // 请求永远是同样的 410。
    return new TBError(
      'invalid_argument',
      `syncToken 已过期,去掉 syncToken 重新做一次全量同步(上游:${message})`,
    )
  }
  if (context.status === 403 && reasons.some(reason => RATE_LIMIT_REASONS.has(reason))) {
    return upstreamError(429, message)
  }
  return upstreamError(context.status, message)
}

async function send(ctx: ProviderContext, input: CalendarRequest): Promise<ProviderHttpResult> {
  const hasBody = input.body !== undefined
  const target = requestTarget(input.url, input.query)
  return await http.request({
    method: input.method ?? (hasBody ? 'POST' : 'GET'),
    path: target.path,
    query: target.query,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
    },
    ...(hasBody ? { json: input.body } : {}),
    invalidJson: 'text',
    timeoutMs: REQUEST_TIMEOUT_MS,
    mapError: context => calendarError(context, input.syncTokenAware ?? false),
    mapTransportError: ({ kind, message }) => kind === 'timeout'
      ? upstreamError(504, `Google Calendar 请求超时(${REQUEST_TIMEOUT_MS / 1000} 秒)`)
      : upstreamError(502, `Google Calendar 请求失败:${message ?? 'unknown network error'}`),
  })
}

export async function requestJson(ctx: ProviderContext, input: CalendarRequest): Promise<unknown> {
  const response = await send(ctx, input)
  if (response.bodyKind === 'empty') {
    throw new TBError('unavailable', 'Google Calendar 在应回 JSON 的地方回了空响应体', { retryable: true })
  }
  if (response.bodyKind !== 'json') {
    throw new TBError('unavailable', 'Google Calendar 返回了非 JSON 响应', { retryable: true })
  }
  return response.data
}

export async function requestRecord(ctx: ProviderContext, input: CalendarRequest): Promise<Json> {
  return requireRecord(await requestJson(ctx, input), 'Google Calendar 响应')
}

/** 期待空响应体的写操作(DELETE / clear):读掉 body 释放连接后丢弃。 */
export async function requestNoContent(ctx: ProviderContext, input: CalendarRequest): Promise<void> {
  await send(ctx, input)
}

/** 上游 `deleteWithSuccess`:删除类 action 的出参统一是 `{ success: true }`。 */
export async function deleteWithSuccess(ctx: ProviderContext, url: string): Promise<Json> {
  await requestNoContent(ctx, { url, method: 'DELETE' })
  return { success: true }
}

export function calendarUrl(calendarId: string): string {
  return `${API_BASE}/calendars/${encodeURIComponent(calendarId)}`
}

export function calendarListEntryUrl(calendarId: string): string {
  return `${API_BASE}/users/me/calendarList/${encodeURIComponent(calendarId)}`
}

export function eventsUrl(calendarId: string): string {
  return `${calendarUrl(calendarId)}/events`
}

export function eventUrl(calendarId: string, eventId: string): string {
  return `${eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`
}

export function aclRuleUrl(calendarId: string, ruleId: string): string {
  return `${calendarUrl(calendarId)}/acl/${encodeURIComponent(ruleId)}`
}

export function settingUrl(settingId: string): string {
  return `${API_BASE}/users/me/settings/${encodeURIComponent(settingId)}`
}

export type { ProviderContext }
