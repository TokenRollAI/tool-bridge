/**
 * Exa 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/exa/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 凭证在 **`x-api-key` 请求头**里,不在 URL 上。
 *
 * 四个 action 是同一形状的 POST:入参整体当 JSON body 发给对应端点,响应按各自的
 * outputSchema 裁剪。三处上游细节决定了这里的形状:
 * - `includeDomains` 与 `excludeDomains` **不能同时给** —— 这是跨字段约束,Zod 的
 *   strictObject 表达不了,故留在这一层(search 与 find_similar 各有一份)。
 * - 2xx 空响应体按 `{}` 处理(上游如此),但 2xx 回非 JSON 是上游破契约,归 unavailable。
 * - 错误体的消息藏在 `error` / `message` / `detail` 三个键之一,也可能整个 body 就是一段
 *   纯文本(Exa 的网关错误页),三种都要认。
 *
 * 上游 `buildExaError` 按"校验期/执行期"把状态码压成别的值(执行期 404/422 都压成 400),
 * 这里不保留:状态码归一由共用的 `upstreamError` 统一口径,每个 provider 各压一套正是
 * 它要消灭的东西 —— 于是 404 在这里如实回 `not_found`。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { answerInput, findSimilarInput, getContentsInput, searchInput } from './schema'
import {
  asJsonObject as asRecord,
  compactDefined as compact,
  trimmedText as optionalText,
} from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'exa'
const API_BASE = 'https://api.exa.ai'
const http = createProviderHttpClient({ baseUrl: API_BASE, service: SERVICE })
const SEARCH_PATH = '/search'
const CONTENTS_PATH = '/contents'
const ANSWER_PATH = '/answer'
const FIND_SIMILAR_PATH = '/findSimilar'

type Json = Record<string, unknown>

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return optionalText(payload)
  const object = asRecord(payload)
  if (object === undefined) return undefined
  return optionalText(object.error) ?? optionalText(object.message) ?? optionalText(object.detail)
}

async function request(ctx: ProviderContext, path: string, body: Json): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const { bodyKind, data } = await http.request({
    path,
    method: 'POST',
    headers: { 'accept': 'application/json', 'x-api-key': apiKey },
    json: body,
    invalidJson: 'text',
    mapError: ({ data: payload, status, statusText }) => upstreamError(
      status,
      errorMessage(payload) ?? (statusText || `exa 返回 HTTP ${status}`),
    ),
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined ? 'exa 请求失败' : `exa 请求失败: ${message}`,
    ),
  })
  // 2xx 空体按 `{}` 处理(上游如此);2xx 回非 JSON 则是上游破了契约。
  if (bodyKind === 'empty') return {}
  if (bodyKind === 'invalid-json') throw upstreamError(502, 'exa 返回了非 JSON 响应')
  return data
}

/** 响应里契约要求的字段;取不到是**上游**破了契约,不是调用方的错。 */
function responseText(value: unknown, field: string): string {
  const text = optionalText(value)
  if (text === undefined) throw upstreamError(502, `exa 响应缺少 ${field}`)
  return text
}

function responseRecord(payload: unknown, field: string): Json {
  const object = asRecord(payload)
  if (object === undefined) throw upstreamError(502, `exa ${field} 响应不是对象`)
  return object
}

function responseArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw upstreamError(502, `exa 响应的 ${field} 不是数组`)
  return value
}

/** 结果项按 outputSchema 的 looseObject 原样透出,只校验"是对象"。 */
function resultItems(value: unknown, field: string): Json[] {
  return responseArray(value, field).map(item => responseRecord(item, `${field} 结果项`))
}

/**
 * `includeDomains` 与 `excludeDomains` 同时给会被 Exa 拒,但那是一次注定失败的往返,
 * 且它回的消息很含糊 —— 本地挡下,归 invalid_argument(参数非法,重试不会变)。
 */
function assertDomainFilters(input: { excludeDomains?: unknown, includeDomains?: unknown }): void {
  if (input.includeDomains !== undefined && input.excludeDomains !== undefined) {
    throw new TBError('invalid_argument', 'includeDomains 与 excludeDomains 不能同时提供')
  }
}

/** search / find_similar 共用的出参形状(find_similar 不带 searchType 与 output)。 */
function normalizeResults(object: Json, extra: Json = {}): Json {
  return compact({
    requestId: responseText(object.requestId, 'requestId'),
    results: resultItems(object.results, 'results'),
    ...extra,
    costDollars: asRecord(object.costDollars),
  })
}

export async function search(input: z.infer<typeof searchInput>, ctx: ProviderContext): Promise<Json> {
  assertDomainFilters(input)
  const object = responseRecord(await request(ctx, SEARCH_PATH, compact(input)), '搜索')
  return normalizeResults(object, {
    searchType: optionalText(object.searchType),
    output: asRecord(object.output),
  })
}

export async function getContents(
  input: z.infer<typeof getContentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const object = responseRecord(await request(ctx, CONTENTS_PATH, compact(input)), 'contents')
  return compact({
    requestId: responseText(object.requestId, 'requestId'),
    results: resultItems(object.results, 'results'),
    // statuses 是可选的:字段缺席与"空数组"不是一回事,前者不该被伪造成后者。
    statuses: object.statuses === undefined ? undefined : resultItems(object.statuses, 'statuses'),
    costDollars: asRecord(object.costDollars),
  })
}

export async function answer(input: z.infer<typeof answerInput>, ctx: ProviderContext): Promise<Json> {
  const object = responseRecord(await request(ctx, ANSWER_PATH, compact(input)), 'answer')
  return compact({
    // answer 既可能是一段文本,也可能是结构化对象(取决于 Exa 选的答案形态)。
    // 文本这里**不 trim**:它是内容而非标识符,首尾空白由调用方自己决定怎么处理。
    answer: typeof object.answer === 'string' ? object.answer : asRecord(object.answer),
    citations: resultItems(object.citations, 'citations'),
    costDollars: asRecord(object.costDollars),
  })
}

export async function findSimilar(
  input: z.infer<typeof findSimilarInput>,
  ctx: ProviderContext,
): Promise<Json> {
  assertDomainFilters(input)
  return normalizeResults(responseRecord(await request(ctx, FIND_SIMILAR_PATH, compact(input)), '搜索'))
}
