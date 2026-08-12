/**
 * Semantic Scholar(Graph API + Recommendations API)的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/semantic_scholar/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 凭证在 **header**(`x-api-key`),不在 URL。
 *
 * ## 限速是这个 provider 的主要失败模式
 *
 * Semantic Scholar 的免费配额很紧(共享池按秒计),批量拉取时 429 是**常态**而非异常。
 * 故 429 一律归 `rate_limited` + `retryable: true`,让调用方退避重试;这里**不做**任何
 * 进程内 sleep 或重试 —— 本仓库所有迁移产物都把退避交给上层(见 `pubmed/api.ts` 的同款说明)。
 *
 * ## 三处上游细节决定了这里的形状
 *
 * 1. **两个 API family 有各自的 base URL**:`/graph/v1` 与 `/recommendations/v1`。
 *    推荐接口的出参键名也不同(`recommendedPapers` 而不是 `data`),整形时两个都要认。
 * 2. **`openAccessPdf` 是"存在即为真"的旗标参数**:要发成 `?openAccessPdf=`(空值),
 *    发 `?openAccessPdf=true` 上游不认;为 false 时**整个参数都不发**。
 *    写成普通布尔串会让"只要有 PDF 的"这个过滤条件静默失效。
 * 3. **分页游标有两套**:`search_papers` 用 `offset`,`bulk_search_papers` 用 `token`。
 *    两者不能混用(把 token 发给 relevance search 会被忽略,结果是静默重复第一页)。
 *
 * ## 与上游的有意偏离
 *
 * - **不发 `user-agent`**:上游报的是它自己的名字,照抄等于把流量记在别人账上。
 * - 上游在 execute 阶段把 401 与 403 **都压成 401**;这里各自保留(同为
 *   `permission_denied`,只是 HTTP 状态不同)—— "key 无效"与"这个 key 没有该端点的权限"
 *   对使用者是两件事,压掉之后无从区分。
 * - 上游把非 2xx 的 5xx 与 `status || 500` 混在一处;这里把原始状态原样交给 `upstreamError`。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  autocompletePapersInput,
  bulkSearchPapersInput,
  getAuthorInput,
  getAuthorPapersInput,
  getAuthorsInput,
  getPaperAuthorsInput,
  getPaperCitationsInput,
  getPaperInput,
  getPaperReferencesInput,
  getPapersInput,
  matchPaperTitleInput,
  recommendForPaperInput,
  recommendPapersInput,
  searchAuthorsInput,
  searchPapersInput,
  searchSnippetsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'semantic_scholar'
const GRAPH_BASE = 'https://api.semanticscholar.org/graph/v1'
const RECOMMENDATIONS_BASE = 'https://api.semanticscholar.org/recommendations/v1'
const REQUEST_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>
type Family = 'graph' | 'recommendations'
/** query 值都已在调用处 stringify(见 `params`)。 */
type Params = Record<string, string | undefined>

interface S2Request {
  body?: Json
  family: Family
  method: 'GET' | 'POST'
  params?: Params
  path: string
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalRawString(...)?.trim()`:错误消息取值用。 */
function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim()
  return result === '' ? undefined : result
}

/**
 * schema 已用 `.regex(/\S/)` 挡掉纯空白,这里只做**去空白**:id 带着前后空格会被编进路径,
 * 换回来的 404 看起来像"论文不存在"。
 */
function id(value: string, field: string): string {
  const result = trimmed(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} 是必填的`)
  return result
}

/** 上游 `normalizeArray`:不是数组就当空 —— 少一族结果比整个调用失败好。 */
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 上游 `normalizeRawObject`。 */
function rawObject(value: unknown): Json {
  return record(value) ?? {}
}

/** 上游 `readNullableInteger`:非整数(含缺席、浮点、字符串)一律 null,不猜。 */
function nullableInt(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * 把入参里指定的键搬进 query 并 stringify。
 *
 * `openAccessPdf` 例外:它是旗标参数(见文件头第 2 条),true 发空值、false 整个不发。
 */
function params(input: Json, keys: readonly string[]): Params {
  const result: Params = {}
  for (const key of keys) {
    const value = input[key]
    if (value === undefined || value === null) continue
    if (key === 'openAccessPdf') {
      if (value === true) result[key] = ''
      continue
    }
    result[key] = String(value)
  }
  return result
}

const PAPER_SEARCH_FILTER_KEYS = [
  'query',
  'fields',
  'limit',
  'year',
  'venue',
  'fieldsOfStudy',
  'publicationTypes',
  'publicationDateOrYear',
  'minCitationCount',
  'openAccessPdf',
] as const

/** relevance search 用 `offset` 翻页,bulk search 用 `token` —— 见文件头第 3 条。 */
function paperSearchParams(input: Json, pagingKey: 'offset' | 'token'): Params {
  return { ...params(input, PAPER_SEARCH_FILTER_KEYS), ...params(input, [pagingKey]) }
}

function buildUrl(input: S2Request): string {
  const base = input.family === 'graph' ? GRAPH_BASE : RECOMMENDATIONS_BASE
  const url = new URL(`${base}${input.path}`)
  for (const [key, value] of Object.entries(input.params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return url.toString()
}

/** 空体(含纯空白)读成 null;非 JSON 是上游违约。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body.trim() === '') return null
  try {
    return JSON.parse(body)
  } catch {
    throw new TBError('unavailable', 'Semantic Scholar 返回了非 JSON 响应', { retryable: true })
  }
}

/** 错误消息:上游把它散在 `message` / `error` / `detail` 三个键上,还可能直接是一个字符串。 */
function errorMessage(payload: unknown, status: number): string {
  const direct = trimmed(payload)
  if (direct !== undefined) return direct
  const body = record(payload)
  return trimmed(body?.message)
    ?? trimmed(body?.error)
    ?? trimmed(body?.detail)
    ?? `Semantic Scholar 返回 HTTP ${status}`
}

async function request(ctx: ProviderContext, input: S2Request): Promise<unknown> {
  const headers: Record<string, string> = {
    'accept': 'application/json',
    'x-api-key': requireApiKey(ctx, SERVICE),
  }
  if (input.method === 'POST') headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await guardedFetch(buildUrl(input), {
      method: input.method,
      headers,
      // 上游对 POST 一律发 body(没给就发 `{}`),保留:batch 端点不接受空请求。
      body: input.method === 'POST' ? JSON.stringify(input.body ?? {}) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障。
    if (error instanceof TBError) throw error
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, `Semantic Scholar 请求超时(${REQUEST_TIMEOUT_MS / 1000} 秒)`)
    }
    const message = error instanceof Error ? error.message : 'unknown network error'
    throw upstreamError(502, `Semantic Scholar 请求失败:${message}`)
  }

  const payload = await readPayload(response)
  // 429 走公共归一表 → rate_limited + retryable(限速是这个 provider 的常态,见文件头)。
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return payload
}

/** 论文列表族的出参:`data`(graph)与 `recommendedPapers`(recommendations)是同一个位置。 */
function normalizePaperList(payload: unknown): Json {
  const body = record(payload)
  return {
    total: nullableInt(body?.total),
    offset: nullableInt(body?.offset),
    next: nullableInt(body?.next),
    token: nullableString(body?.token),
    papers: array(body?.data ?? body?.recommendedPapers),
    raw: rawObject(payload),
  }
}

function normalizeAuthorList(payload: unknown): Json {
  const body = record(payload)
  return {
    total: nullableInt(body?.total),
    offset: nullableInt(body?.offset),
    next: nullableInt(body?.next),
    authors: array(body?.data),
    raw: rawObject(payload),
  }
}

/** 引用/参考文献的出参保留上游的 `data` 键名(它装的是"边"而不是论文本体)。 */
function normalizeEdgeList(payload: unknown): Json {
  const body = record(payload)
  return {
    total: nullableInt(body?.total),
    offset: nullableInt(body?.offset),
    next: nullableInt(body?.next),
    data: array(body?.data),
    raw: rawObject(payload),
  }
}

export async function getPaper(input: z.infer<typeof getPaperInput>, ctx: ProviderContext): Promise<Json> {
  const paper = await request(ctx, {
    family: 'graph',
    method: 'GET',
    path: `/paper/${encodeURIComponent(id(input.paperId, 'paperId'))}`,
    params: params(input, ['fields']),
  })
  return { paper }
}

export async function getPapers(input: z.infer<typeof getPapersInput>, ctx: ProviderContext): Promise<Json> {
  const papers = await request(ctx, {
    family: 'graph',
    method: 'POST',
    path: '/paper/batch',
    // fields 在 query 上,ids 在 body 里 —— batch 端点就是这么分的。
    params: params(input, ['fields']),
    body: { ids: input.paperIds.map(item => id(item, 'paperId')) },
  })
  // batch 端点回的是**数组**,且缺失的 id 位置是 null(顺序与请求一致),原样透出。
  return { papers: array(papers) }
}

export async function searchPapers(
  input: z.infer<typeof searchPapersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return normalizePaperList(await request(ctx, {
    family: 'graph',
    method: 'GET',
    path: '/paper/search',
    params: paperSearchParams(input, 'offset'),
  }))
}

export async function bulkSearchPapers(
  input: z.infer<typeof bulkSearchPapersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return normalizePaperList(await request(ctx, {
    family: 'graph',
    method: 'GET',
    path: '/paper/search/bulk',
    params: paperSearchParams(input, 'token'),
  }))
}

export async function matchPaperTitle(
  input: z.infer<typeof matchPaperTitleInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    family: 'graph',
    method: 'GET',
    path: '/paper/search/match',
    params: params(input, ['query', 'fields']),
  })
  // 匹配不到时上游回 404(由 request 抛错);这里的 `paper` 为空只出现在响应不是对象时。
  return { paper: record(payload), raw: rawObject(payload) }
}

export async function autocompletePapers(
  input: z.infer<typeof autocompletePapersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    family: 'graph',
    method: 'GET',
    path: '/paper/autocomplete',
    params: params(input, ['query', 'limit']),
  })
  const body = record(payload)
  // autocomplete 的结果键上游见过两种(`matches` 与 `data`),两个都认。
  return { completions: array(body?.matches ?? body?.data), raw: rawObject(payload) }
}

export async function getPaperAuthors(
  input: z.infer<typeof getPaperAuthorsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return normalizeAuthorList(await request(ctx, {
    family: 'graph',
    method: 'GET',
    path: `/paper/${encodeURIComponent(id(input.paperId, 'paperId'))}/authors`,
    params: params(input, ['fields', 'limit', 'offset']),
  }))
}

export async function getPaperCitations(
  input: z.infer<typeof getPaperCitationsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return normalizeEdgeList(await request(ctx, {
    family: 'graph',
    method: 'GET',
    path: `/paper/${encodeURIComponent(id(input.paperId, 'paperId'))}/citations`,
    params: params(input, ['fields', 'limit', 'offset']),
  }))
}

export async function getPaperReferences(
  input: z.infer<typeof getPaperReferencesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return normalizeEdgeList(await request(ctx, {
    family: 'graph',
    method: 'GET',
    path: `/paper/${encodeURIComponent(id(input.paperId, 'paperId'))}/references`,
    params: params(input, ['fields', 'limit', 'offset']),
  }))
}

export async function searchAuthors(
  input: z.infer<typeof searchAuthorsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return normalizeAuthorList(await request(ctx, {
    family: 'graph',
    method: 'GET',
    path: '/author/search',
    params: params(input, ['query', 'fields', 'limit', 'offset']),
  }))
}

export async function getAuthor(input: z.infer<typeof getAuthorInput>, ctx: ProviderContext): Promise<Json> {
  const author = await request(ctx, {
    family: 'graph',
    method: 'GET',
    path: `/author/${encodeURIComponent(id(input.authorId, 'authorId'))}`,
    params: params(input, ['fields']),
  })
  return { author }
}

export async function getAuthors(input: z.infer<typeof getAuthorsInput>, ctx: ProviderContext): Promise<Json> {
  const authors = await request(ctx, {
    family: 'graph',
    method: 'POST',
    path: '/author/batch',
    params: params(input, ['fields']),
    body: { ids: input.authorIds.map(item => id(item, 'authorId')) },
  })
  return { authors: array(authors) }
}

export async function getAuthorPapers(
  input: z.infer<typeof getAuthorPapersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return normalizePaperList(await request(ctx, {
    family: 'graph',
    method: 'GET',
    path: `/author/${encodeURIComponent(id(input.authorId, 'authorId'))}/papers`,
    params: params(input, ['fields', 'limit', 'offset']),
  }))
}

export async function searchSnippets(
  input: z.infer<typeof searchSnippetsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    family: 'graph',
    method: 'GET',
    path: '/snippet/search',
    params: params(input, ['query', 'limit']),
  })
  const body = record(payload)
  return {
    total: nullableInt(body?.total),
    offset: nullableInt(body?.offset),
    next: nullableInt(body?.next),
    snippets: array(body?.data),
    raw: rawObject(payload),
  }
}

export async function recommendForPaper(
  input: z.infer<typeof recommendForPaperInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return normalizePaperList(await request(ctx, {
    family: 'recommendations',
    method: 'GET',
    path: `/papers/forpaper/${encodeURIComponent(id(input.paperId, 'paperId'))}`,
    params: params(input, ['fields', 'limit']),
  }))
}

export async function recommendPapers(
  input: z.infer<typeof recommendPapersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const negativePaperIds = input.negativePaperIds?.map(item => id(item, 'paperId'))
  return normalizePaperList(await request(ctx, {
    family: 'recommendations',
    method: 'POST',
    // 末尾这个斜杠是上游端点要求的,去掉会 404。
    path: '/papers/',
    params: params(input, ['fields', 'limit']),
    body: {
      positivePaperIds: input.positivePaperIds.map(item => id(item, 'paperId')),
      // 没给就整个键不发(上游 `compactObject`),发 `null` 会被当成非法入参。
      ...(negativePaperIds === undefined ? {} : { negativePaperIds }),
    },
  }))
}
