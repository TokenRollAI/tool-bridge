/**
 * Gmail 46 个 action 共用的出站与整形底座。
 *
 * 迁移自 open-connector `src/providers/gmail/executors.ts` 的 `fetchJson` / `fetchEmpty` /
 * `gmailUserUrl` / `assertGmailResponse` 一族,语义等价、写法本地化:凭证从 `ctx.upstreamAuth`
 * 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * **凭证是平台托管 OAuth2 换来的 access token**(见 `../index.ts` 的 `oauth` 声明),经
 * `Authorization: Bearer <token>` 请求头发出,不进 URL。插件不知道它是 OAuth 来的,也不参与
 * 刷新 —— `requireApiKey` 拿到的就是平台按需刷新后的当前令牌。
 *
 * 三处上游细节决定了这里的形状:
 * - **`userId` 恒为 `me`**:上游 `createContext` 把它钉死成 `"me"`,而好几个 action 的入参里
 *   仍然收一个 `userId` 字段 —— 那个字段上游从来不用(`buildLabelPayload` /
 *   `updateSettingsResource` 还专门把它从请求体里滤掉)。这里照抄:收下但忽略,免得让调用方
 *   以为能拿别人的邮箱。
 * - **只发两个头**:`authorization`,以及有请求体时的 `content-type`。上游没发 `accept`,
 *   Gmail 也不需要 —— 不擅自加,免得出参形状随一个我们没验证过的头漂移。
 * - **403 有两种含义**:配额/限流(`error.errors[].reason` 是 rateLimitExceeded 一族)与权限
 *   不足。前者可重试、后者不可,只看 HTTP 状态会把两者都压成 permission_denied,agent 于是
 *   对一次限流永不重试。故先看 reason、再退回状态归一。
 */

import { TBError } from '@tool-bridge/plugin-sdk'
import { type ProviderContext, requireApiKey } from '../../_runtime/plugin'
import { upstreamError } from '../../_runtime/upstreamError'
import { guardedFetch } from '../../_runtime/guardedFetch'

export const SERVICE = 'gmail'

const API_BASE = 'https://gmail.googleapis.com/gmail/v1'

/** 上游 `createContext` 钉死的 userId;入参里的 `userId` 一律忽略。 */
const USER_ID = 'me'

/**
 * Google 把"配额耗尽/限流"塞在 403 里(而不是 429)。这些 reason 出现时一律按 429 归一,
 * 拿到 `rate_limited` + retryable —— 归 permission_denied 的话调用方会当成"换个 key 也没用"。
 */
const RATE_LIMIT_REASONS = new Set([
  'dailyLimitExceeded',
  'quotaExceeded',
  'rateLimitExceeded',
  'userRateLimitExceeded',
])

export type Json = Record<string, unknown>
export type QueryValue = boolean | number | string | string[] | undefined

export interface GmailRequest {
  /** JSON 请求体;给了才发 `content-type`(与上游 `if (init.body)` 等价)。 */
  body?: Json
  method?: string
  /** `users/me/` 之后的路径段,逐段 encodeURIComponent。 */
  path: readonly string[]
  /** query 参数;数组展开成**重复的同名**参数(labelIds / historyTypes 靠这个表达多值)。 */
  query?: Record<string, QueryValue>
}

/** 上游 `trimmedString`:`null`/`undefined` 与纯空白一律折成空串。 */
export function trimmedString(value: unknown): string {
  return String(value ?? '').trim()
}

/** 上游 `toStringArray`:非数组给空数组,逐项去空白后丢空。 */
export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item).trim()).filter(Boolean)
}

/** 上游 `normalizeFormat`:空白或缺席都退回 fallback。 */
export function normalizeFormat(value: unknown, fallback: string): string {
  return trimmedString(value) || fallback
}

export function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错。 */
export function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw new TBError('unavailable', `Gmail 的 ${label} 不是对象`, { retryable: true })
  return result
}

/** 原样取一个字符串字段(不去空白:snippet / historyId 的空白也是内容)。 */
export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * 列表字段 → 对象数组。缺席或 `null` 当"一条都没有"(Gmail 的空列表就这么表达);给了个
 * 非数组则是上游形状不符契约,归 `unavailable` —— 上游那边这种情况会静默变成空表,
 * "一条都没有"与"我们看不懂上游返回"混成一个结果,排障时无从下手。
 */
export function recordArray(value: unknown, label: string): Json[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new TBError('unavailable', `Gmail 的 ${label} 不是数组`, { retryable: true })
  }
  return value.map(item => requireRecord(item, `${label} 的元素`))
}

/**
 * 上游 `normalizeNullableObjectResponse`:空的 filters / forwardingAddresses 列表 Gmail 回的是
 * `null`(而不是 `{}` 或 `{filter: []}`),那不是故障,是"一条都没有"。
 */
export function nullableRecord(value: unknown, label: string): Json {
  if (value === null) return {}
  return requireRecord(value, label)
}

/** 上游 `asObject`:不是对象就当空对象(criteria/action 两个自由字段用它)。 */
export function asObject(value: unknown): Json {
  return record(value) ?? {}
}

/** 丢掉值为 undefined 的键;`null` 要留住。 */
export function compact(input: Record<string, unknown>): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/** 上游 `buildLabelMutationPayload`:两个字段恒存在(可以是空数组),不做"没给就不发"。 */
export function labelMutationPayload(input: { addLabelIds?: string[], removeLabelIds?: string[] }): Json {
  return {
    addLabelIds: toStringArray(input.addLabelIds),
    removeLabelIds: toStringArray(input.removeLabelIds),
  }
}

/**
 * 请求体 = 入参去掉 `userId` 与未给的字段。上游 `buildLabelPayload` /
 * `updateSettingsResource` 共用这个口径:`userId` 是平台层概念(恒为 me),不该进 Gmail 的
 * 请求体 —— 发过去 Gmail 会 400。
 */
export function bodyFromInput(input: object, drop: readonly string[] = []): Json {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) =>
      key !== 'userId' && !drop.includes(key) && value !== undefined),
  )
}

/**
 * 上游 `hydrateInBatches`:列表接口只回 id,详情要逐个再打一次。分批(10 个一批)而不是
 * 一次 `Promise.all` 全发 —— 一页 500 条时那是 500 个并发请求,Gmail 当场 429。
 */
export async function hydrateInBatches<T, TResult>(
  items: T[],
  hydrate: (item: T) => Promise<TResult>,
  batchSize = 10,
): Promise<TResult[]> {
  const hydrated: TResult[] = []
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize)
    hydrated.push(...(await Promise.all(batch.map(item => hydrate(item)))))
  }
  return hydrated
}

function buildUrl(path: readonly string[], query: Record<string, QueryValue>): string {
  const segments = path.map(segment => encodeURIComponent(segment)).join('/')
  const url = new URL(`${API_BASE}/users/${encodeURIComponent(USER_ID)}${segments === '' ? '' : `/${segments}`}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      // labelIds / historyTypes 的多值靠重复同名参数表达,不能拼成逗号串。
      for (const item of value) url.searchParams.append(key, item)
      continue
    }
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/** Google 的错误体:`{error: {code, message, errors: [{reason, ...}]}}`,也可能是 `{error: "..."}`。 */
function errorMessage(payload: unknown): string | undefined {
  const error = record(payload)?.error
  if (typeof error === 'string') return trimmedString(error) || undefined
  return trimmedString(record(error)?.message) || undefined
}

function errorReasons(payload: unknown): string[] {
  const errors = record(record(payload)?.error)?.errors
  if (!Array.isArray(errors)) return []
  return errors.map(item => trimmedString(record(item)?.reason)).filter(Boolean)
}

function gmailError(status: number, payload: unknown): TBError {
  const message = errorMessage(payload) ?? `Gmail 返回 HTTP ${status}`
  if (status === 403 && errorReasons(payload).some(reason => RATE_LIMIT_REASONS.has(reason))) {
    return upstreamError(429, message)
  }
  return upstreamError(status, message)
}

async function send(ctx: ProviderContext, input: GmailRequest): Promise<{ payload: unknown }> {
  const hasBody = input.body !== undefined
  const headers: Record<string, string> = {
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  if (hasBody) headers['content-type'] = 'application/json'

  const response = await guardedFetch(buildUrl(input.path, input.query ?? {}), {
    method: input.method ?? 'GET',
    headers,
    ...(hasBody ? { body: JSON.stringify(input.body) } : {}),
  })

  const body = await response.text()
  let payload: unknown = null
  if (body !== '') {
    try {
      payload = JSON.parse(body)
    } catch {
      // 2xx 上回非 JSON 只能是上游坏了;错误响应回 HTML 错误页(Google 的 502 页面就是)
      // 很常见,那时按 HTTP 状态归一比报"响应不是 JSON"准,也不用把上游正文回显给调用方。
      if (response.ok) {
        throw new TBError('unavailable', 'Gmail 返回了非 JSON 响应', { retryable: true })
      }
    }
  }
  if (!response.ok) throw gmailError(response.status, payload)
  return { payload }
}

/** 上游 `fetchJson`:成功时把响应体交给调用方整形(空体 → `null`,由调用方判契约)。 */
export async function requestJson(ctx: ProviderContext, input: GmailRequest): Promise<unknown> {
  return (await send(ctx, input)).payload
}

/** 上游 `fetchEmpty`:只关心成败(DELETE / batchModify / stop 都回 204 空体)。 */
export async function requestEmpty(ctx: ProviderContext, input: GmailRequest): Promise<void> {
  await send(ctx, input)
}

/** 上游 `fetchJson` + 形状断言:出参声明说是对象的那些 action 用它。 */
export async function requestRecord(ctx: ProviderContext, input: GmailRequest, label: string): Promise<Json> {
  return requireRecord(await requestJson(ctx, input), label)
}
