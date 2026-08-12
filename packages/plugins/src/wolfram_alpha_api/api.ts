/**
 * Wolfram|Alpha 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/wolfram_alpha_api/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 四处上游细节决定了这里的形状:
 * - **凭证(AppID)进 query**(`?appid=`)。Wolfram 的 API 只认这一种传法,换成 header 会被
 *   当成"appid missing";迁移没有选择余地,部署侧需知凭证会出现在出站 URL 里(日志要脱敏)。
 * - 响应是**纯文本**,不是 JSON:`/v1/result` 与 `/v1/spoken` 直接回答案正文,错误也回一行
 *   文本。故消息取 body 本身,不做 JSON 解析。
 * - 凭证错误常带着 **HTTP 200** 回来(body 是 `Invalid appid`),成功路径必须查 body,
 *   否则会把一句错误提示当成答案返给调用方。
 * - `validate_query` 打的不是 api.wolframalpha.com,而是 queryrecognizer 端点,且响应字段
 *   大小写混杂(`resultsignificancescore` 全小写、`spellingCorrection` 驼峰、`timing` 在
 *   **顶层**而非 query[0] 里)—— 这几处照抄,改一个字母就静默丢字段。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { getShortAnswerInput, getSpokenResultInput, validateQueryInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'wolfram_alpha_api'
const API_BASE = 'https://api.wolframalpha.com'
const RECOGNIZER_URL = 'https://www.wolframalpha.com/queryrecognizer/query.jsp'
/** 上游给每次出站定的上限;超时按 504 归一(unavailable + retryable)。 */
const REQUEST_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>

/** 上游 `optionalString` 的等价物:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 出参声明的是 `string | null`:拿不到就明确回 null,不留字段缺席。 */
function nullableText(value: unknown): string | null {
  return text(value) ?? null
}

/** 数字也可能以字符串回来(recognizer 的 timing 就是),非有限值一律 null。 */
function nullableNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** recognizer 的 accepted 有时是布尔、有时是 `"true"` 字符串。 */
function booleanLike(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return false
}

/** 纯空白的 query 能过 Zod 的 `min(1)`,但打上游就是一次必然失败的空查询,先挡下。 */
function searchTerm(value: string): string {
  const query = text(value)
  if (query === undefined) throw new TBError('invalid_argument', 'query 不能是空白')
  return query
}

/** Wolfram 用正文而非状态码表达凭证问题,这两句是它的稳定说法。 */
function looksLikeCredentialError(body: string): boolean {
  const normalized = body.toLowerCase()
  return normalized.includes('invalid appid') || normalized.includes('appid missing')
}

/**
 * 文本错误体 → TBError。
 * 501 是 Wolfram 表达"这个查询我看不懂"的方式(不是"没实现"),归 invalid_argument
 * 才对得上调用方的修法;按 HTTP 语义压成 5xx 会让 agent 对一个永远不变的结果反复重试。
 */
function wolframError(status: number, body: string): TBError {
  const message = body.trim() || `Wolfram|Alpha 返回 HTTP ${status}`
  if (status === 400 || status === 501) return upstreamError(400, message)
  if (status === 401 || status === 403 || looksLikeCredentialError(message)) return upstreamError(401, message)
  return upstreamError(status, message)
}

async function requestText(url: URL): Promise<string> {
  let response: Response
  try {
    response = await guardedFetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    // 只归一超时;出站策略拦截等是**永久**拒绝,标成 retryable 会让调用方白重试。
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, `Wolfram|Alpha ${REQUEST_TIMEOUT_MS / 1000} 秒内没有返回`)
    }
    throw error
  }

  const body = await response.text()
  if (!response.ok) throw wolframError(response.status, body)
  // 200 也可能是凭证错误(见文件头);漏掉这一条就会把 "Invalid appid" 当答案返回。
  if (looksLikeCredentialError(body)) throw upstreamError(401, body.trim())
  return body
}

/** 带 appid 的 URL。凭证进 query 是上游 API 的要求,不是本层的选择。 */
function authorizedUrl(base: string, ctx: ProviderContext, params: Record<string, string | undefined>): URL {
  const url = new URL(base)
  url.searchParams.set('appid', requireApiKey(ctx, SERVICE))
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return url
}

/** `/v1/result` 与 `/v1/spoken` 是同一形状:回一段正文,空正文即上游异常。 */
async function textQuery(
  path: string,
  ctx: ProviderContext,
  params: Record<string, string | undefined>,
): Promise<string> {
  const answer = await requestText(authorizedUrl(`${API_BASE}${path}`, ctx, params))
  if (answer === '') {
    // 出参声明 answer/result 是必填字符串,空串顶不上;这是上游坏了,不是调用方的错。
    throw new TBError('unavailable', 'Wolfram|Alpha 返回了空响应', { retryable: true })
  }
  return answer
}

export async function validateQuery(input: z.infer<typeof validateQueryInput>, ctx: ProviderContext): Promise<Json> {
  const query = searchTerm(input.query)
  const mode = input.mode === 'voice' ? 'voice' : 'default'
  const url = authorizedUrl(RECOGNIZER_URL, ctx, { input: query, mode, output: 'json' })

  const body = await requestText(url)
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw new TBError('unavailable', 'Wolfram|Alpha 返回了非 JSON 响应', { retryable: true })
  }

  const result = record(payload)
  const queries = result?.query
  const first = Array.isArray(queries) ? record(queries[0]) : undefined
  if (first === undefined) {
    // 契约说好至少有一条 query 结果;没有就是上游出问题,不是调用方的错。
    throw new TBError('unavailable', 'Wolfram|Alpha recognizer 没有返回查询结果', { retryable: true })
  }

  return {
    query,
    mode,
    accepted: booleanLike(first.accepted),
    domain: nullableText(first.domain),
    // timing 在**顶层**,不在 query[0] 里。
    timingMs: nullableNumber(result?.timing),
    resultSignificanceScore: nullableNumber(first.resultsignificancescore),
    spellingCorrection: nullableText(first.spellingCorrection),
    summaryBoxPath: nullableText(record(first.summarybox)?.path),
  }
}

export async function getShortAnswer(input: z.infer<typeof getShortAnswerInput>, ctx: ProviderContext): Promise<Json> {
  const query = searchTerm(input.query)
  const answer = await textQuery('/v1/result', ctx, {
    i: query,
    units: input.units,
    timeout: input.timeout === undefined ? undefined : String(input.timeout),
  })
  return { query, answer }
}

export async function getSpokenResult(
  input: z.infer<typeof getSpokenResultInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const query = searchTerm(input.query)
  const result = await textQuery('/v1/spoken', ctx, {
    i: query,
    units: input.units,
    timeout: input.timeout === undefined ? undefined : String(input.timeout),
  })
  return { query, result }
}
