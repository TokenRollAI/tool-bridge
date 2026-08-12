/**
 * Tavily 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/tavily/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入),出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 凭证走 **`Authorization: Bearer <apiKey>` 请求头**,不进 URL,日志脱敏只需照顾 header。
 *
 * 四处上游细节决定了这里的形状:
 * - 五个 POST action(search/extract/map/crawl/create_research)把**校验后的入参原样**当 JSON
 *   body 发,不做任何键重命名 —— schema 侧是 `strictObject`,未声明的键在 Zod 那层就被拒了,
 *   所以"原样转发"不会把调用方塞的垃圾带给上游。
 * - `get_research` 是唯一的 GET + 路径参数,`request_id` 要 `encodeURIComponent`。
 * - 2xx 空 body 归一成 `{}`(上游 `if (!text) return {}`):`/research` 这类接口偶尔只回 202 无体,
 *   那不是错误。
 * - 错误消息按 `detail` → `error` → `message` 取;错误体不是 JSON(HTML 错误页)时用原始文本。
 *   Tavily 有两个**自有状态码** 432/433(套餐额度/按量额度用尽),公共归一表的
 *   "<500 一律 invalid_argument"兜底刚好与上游一致,不需要单独列。
 *
 * 与上游的一处有意偏离:上游把 404 也压成 400,这里走公共表归 `not_found` ——
 * "研究任务 id 不存在"和"参数非法"对调用方是两件不同的事,压成一个码会让 agent 无法区分。
 *
 * 出参不做裁剪:生成的 outputSchema 是 `looseObject`(声明就是 passthrough),而且把
 * `answer`/`images`/`usage` 这些**按开关才返回**的字段标成了必填 —— 照声明补齐等于编造数据,
 * 故这层只保证"顶层是对象",内容原样透出。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  crawlInput,
  createResearchInput,
  extractInput,
  getResearchInput,
  mapInput,
  searchInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'tavily'
const API_BASE = 'https://api.tavily.com'
/** 上游 `defaultTimeoutMs`:crawl / research 是慢接口,30s 是它选的上限。 */
const REQUEST_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `extractTavilyErrorMessage`:错误体是裸串时它自己就是消息。 */
function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  const body = record(payload)
  return text(body?.detail) ?? text(body?.error) ?? text(body?.message)
    ?? `Tavily 返回 HTTP ${status}`
}

interface RequestOptions {
  body?: Json
  method: 'GET' | 'POST'
  path: string
}

async function request(ctx: ProviderContext, options: RequestOptions): Promise<Json> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await guardedFetch(`${API_BASE}${options.path}`, {
      method: options.method,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch (error) {
    // guardedFetch 拦下的出站(EgressBlockedError)已经是 TBError,原样冒上去。
    if (error instanceof TBError) throw error
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, `Tavily ${REQUEST_TIMEOUT_MS / 1000}s 内没有返回`)
    }
    throw upstreamError(502, error instanceof Error ? `Tavily 请求失败:${error.message}` : 'Tavily 请求失败')
  }

  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  if (raw !== '') {
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      // 错误响应回 HTML 错误页很常见,那时原始文本就是最好的消息;2xx 回非 JSON 只能是上游坏了。
      if (response.ok) throw upstreamError(502, 'Tavily 返回了非 JSON 响应')
      payload = raw
    }
  }
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))

  // 空 body 的 2xx 是成功(上游同此);非对象的 2xx 则是上游违约。
  if (raw === '') return {}
  const result = record(payload)
  if (result === undefined) throw upstreamError(502, 'Tavily 响应不是对象')
  return result
}

export function search(input: z.infer<typeof searchInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { method: 'POST', path: '/search', body: input })
}

export function extract(input: z.infer<typeof extractInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { method: 'POST', path: '/extract', body: input })
}

export function map(input: z.infer<typeof mapInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { method: 'POST', path: '/map', body: input })
}

export function crawl(input: z.infer<typeof crawlInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { method: 'POST', path: '/crawl', body: input })
}

export function createResearch(
  input: z.infer<typeof createResearchInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, { method: 'POST', path: '/research', body: input })
}

export function getResearch(input: z.infer<typeof getResearchInput>, ctx: ProviderContext): Promise<Json> {
  // 上游 `String(input.request_id)` 后 encodeURIComponent:id 进路径段,不能拼裸串。
  return request(ctx, { method: 'GET', path: `/research/${encodeURIComponent(input.request_id)}` })
}

export function getUsage(_input: Json, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { method: 'GET', path: '/usage' })
}
