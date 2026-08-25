/**
 * Shopify REST Admin (Legacy) 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/shopify/runtime.ts`,语义等价、写法本地化:
 * 凭证经 `ctx.credentials` 取(多字段),出站走 `guardedFetch`,错误抛 `TBError` 七码。
 * 凭证走 `X-Shopify-Access-Token` 请求头,不进 URL。
 *
 * 凭证是**两个字段**(对应上游 `definition.ts` 的 api_key + extraFields,字段名逐字一致):
 * `apiKey`(Admin API access token)与 `shopDomain`(店铺的 myshopify.com 域名)。后者不是
 * 密钥,但它决定出站主机 —— 放 providerConfig 里等于让任何对该节点有 read 的 SK 都能改
 * 出站目标,故与 token 一起走 authRef。
 *
 * 四处上游细节决定了这里的形状:
 * - **base URL 由 shopDomain 现算**:`https://<shop>.myshopify.com/admin/api/2026-04`。
 *   上游把它缓存在凭证 metadata 里,tool-bridge 的凭证只存字段,故每次调用现拼,并把上游
 *   `normalizeShopDomain` 的校验(可以是 URL 也可以是裸域名 / 必须是 myshopify.com /
 *   每段是合法 DNS label)一并带过来 —— 这层校验同时是出站目标的第一道闸。
 * - **分页 cursor 藏在 Link 响应头里**,要按 `rel="next"` / `rel="previous"` 找到那个 URL、
 *   再从它的 query 里把 `page_info` 抠出来。出参要的是能直接回填进 `page_info` 入参的值,
 *   不是整个链接。
 * - **`page_info` 与其他筛选参数互斥**:Shopify 会对"cursor + 筛选"直接 400,故先在本层拒
 *   (`limit` 与路径上的 `blog_id` 除外)。
 * - list 类出参是**裁剪 + `raw` 全量**的双份形状:命名字段给 agent 读,`raw` 保留上游原始对象。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  countArticlesInput,
  countBlogsInput,
  countPagesInput,
  getArticleInput,
  getBlogInput,
  getPageInput,
  listArticlesInput,
  listArticleTagsInput,
  listBlogArticleTagsInput,
  listBlogsInput,
  listPagesInput,
} from './schema'
import { createProviderHttpClient, type ProviderQuery } from '../_runtime/providerHttp'
import { asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireCredential } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'shopify'
/** 上游钉死的 REST 版本;换版本会改变出参形状,不随调用方走。 */
const REST_API_VERSION = '2026-04'
const MYSHOPIFY_SUFFIX = '.myshopify.com'
const http = createProviderHttpClient({ service: SERVICE })

type Json = Record<string, unknown>

interface Pagination {
  nextPageInfo: string | null
  previousPageInfo: string | null
}

interface RestResult {
  pagination: Pagination
  payload: unknown
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错。 */
function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw new TBError('unavailable', `Shopify 响应缺少 ${label}`, { retryable: true })
  return result
}

function requireRecordArray(value: unknown, label: string): Json[] {
  if (!Array.isArray(value)) {
    throw new TBError('unavailable', `Shopify 响应缺少 ${label} 数组`, { retryable: true })
  }
  return value.map(item => requireRecord(item, label))
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new TBError('unavailable', `Shopify 响应缺少 ${label} 数组`, { retryable: true })
  }
  return value.map(item => String(item))
}

function isDnsLabel(value: string): boolean {
  if (value === '' || value.startsWith('-') || value.endsWith('-') || value.length > 63) return false
  for (const char of value) {
    const code = char.charCodeAt(0)
    const isDigit = code >= 48 && code <= 57
    const isLowercaseLetter = code >= 97 && code <= 122
    if (!isDigit && !isLowercaseLetter && char !== '-') return false
  }
  return true
}

function isMyshopifyDomain(host: string): boolean {
  if (!host.endsWith(MYSHOPIFY_SUFFIX) || host.length <= MYSHOPIFY_SUFFIX.length) return false
  return host.slice(0, -MYSHOPIFY_SUFFIX.length).split('.').every(segment => isDnsLabel(segment))
}

/**
 * 归一店铺域名。接受裸域名(`acme.myshopify.com`)与完整后台地址
 * (`https://acme.myshopify.com/admin/...`)两种填法 —— 配置的人多半是从浏览器地址栏粘的。
 *
 * 只放行 `*.myshopify.com`:这既是上游的规则,也是本 provider 出站目标的白名单。
 */
function shopHost(ctx: ProviderContext): string {
  const raw = requireCredential(ctx, SERVICE, 'shopDomain').trim()
  let host = raw
  if (raw.includes('://')) {
    try {
      host = new URL(raw).hostname
    } catch {
      throw new TBError('invalid_argument', 'shopDomain 必须是 myshopify.com 域名或其地址')
    }
  } else {
    host = raw.split('/')[0] ?? ''
  }

  const normalized = host.toLowerCase()
  if (!isMyshopifyDomain(normalized)) {
    throw new TBError('invalid_argument', 'shopDomain 必须是 myshopify.com 域名或其地址')
  }
  return normalized
}

/** 上游 `extractShopifyErrorMessage`:errors 可能是串、数组,也可能是 {字段: [消息]} 的对象。 */
function errorDetail(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  const body = record(payload)
  if (body === undefined) return undefined

  const errors = body.errors
  if (typeof errors === 'string') return errors
  if (Array.isArray(errors)) return errors.map(item => String(item)).join('; ')
  const errorRecord = record(errors)
  if (errorRecord !== undefined) {
    return Object.entries(errorRecord)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
      .join('; ')
  }
  return text(body.error) ?? text(body.message)
}

/** Link 头形如 `<https://…?page_info=abc>; rel="next"`;要的是 page_info,不是整个链接。 */
function pageInfoForRel(linkHeader: string | null, rel: 'next' | 'previous'): string | null {
  if (linkHeader === null || linkHeader === '') return null
  for (const item of linkHeader.split(',')) {
    const [urlPart, ...parameterParts] = item.trim().split(';')
    if (urlPart === undefined || !urlPart.startsWith('<') || !urlPart.endsWith('>')) continue
    const hasRel = parameterParts.some((part) => {
      const normalized = part.trim().toLowerCase()
      return normalized === `rel="${rel}"` || normalized === `rel=${rel}`
    })
    if (!hasRel) continue
    try {
      return new URL(urlPart.slice(1, -1)).searchParams.get('page_info')
    } catch {
      return null
    }
  }
  return null
}

async function request(
  ctx: ProviderContext,
  path: string,
  query?: Record<string, string>,
): Promise<RestResult> {
  const result = await http.request({
    baseUrl: `https://${shopHost(ctx)}/admin/api/${REST_API_VERSION}/`,
    path,
    query: Object.entries(query ?? {}) satisfies ProviderQuery,
    headers: {
      'accept': 'application/json',
      'x-shopify-access-token': requireCredential(ctx, SERVICE, 'apiKey'),
    },
    invalidJsonMessage: 'Shopify REST 返回了非 JSON 响应',
    mapError: ({ data, status }) => {
      const detail = errorDetail(data)
      return upstreamError(
        status,
        detail === undefined
          ? `Shopify REST 返回 HTTP ${status}`
          : `Shopify REST 返回 HTTP ${status}: ${detail}`,
      )
    },
  })

  return {
    payload: result.data === undefined ? null : result.data,
    pagination: {
      nextPageInfo: pageInfoForRel(result.headers.get('link'), 'next'),
      previousPageInfo: pageInfoForRel(result.headers.get('link'), 'previous'),
    },
  }
}

/** 上游 `readId`:这些 id 在生成的 schema 里有一半是 optional,必填断言留在本层。 */
function requireId(value: unknown, field: string): string {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TBError('invalid_argument', `${field} 必须是正整数`)
  }
  return String(value)
}

function queryValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return String(value)
  return undefined
}

function pickQuery(input: Json, keys: readonly string[]): Record<string, string> {
  const query: Record<string, string> = {}
  for (const key of keys) {
    const value = queryValue(input[key])
    if (value !== undefined) query[key] = value
  }
  return query
}

/**
 * `page_info` 是**游标**:Shopify 对"游标 + 筛选"直接 400,因为筛选条件已经烘进游标里了。
 * 提前拒掉,顺带把这条规则讲给调用方(`limit` 与路径上的 `blog_id` 不算筛选)。
 */
function assertPageInfoBoundary(input: Json): void {
  if (input.page_info === undefined) return
  for (const key of Object.keys(input)) {
    if (key !== 'page_info' && key !== 'limit' && key !== 'blog_id') {
      throw new TBError('invalid_argument', 'page_info 不能与其他筛选参数同用,只允许再带 limit')
    }
  }
}

async function getResource(ctx: ProviderContext, path: string, key: string): Promise<Json> {
  const { payload } = await request(ctx, path)
  return requireRecord(requireRecord(payload, `${key} 响应`)[key], key)
}

async function listResources(
  input: Json,
  ctx: ProviderContext,
  options: { keys: readonly string[], path: string, resultKey: string },
): Promise<Json> {
  assertPageInfoBoundary(input)
  const { payload, pagination } = await request(ctx, options.path, pickQuery(input, options.keys))
  const body = requireRecord(payload, `${options.resultKey} 响应`)
  return {
    [options.resultKey]: requireRecordArray(body[options.resultKey], options.resultKey),
    pagination,
    raw: body,
  }
}

async function countResources(
  input: Json,
  ctx: ProviderContext,
  options: { keys: readonly string[], path: string },
): Promise<Json> {
  const { payload } = await request(ctx, options.path, pickQuery(input, options.keys))
  const count = requireRecord(payload, 'count 响应').count
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw new TBError('unavailable', 'Shopify 返回的 count 不是非负整数', { retryable: true })
  }
  return { count }
}

/** 上游 `buildArticleTagQuery`:popular 用 `1` 而不是 `true` 表达,且只在为真时发。 */
function articleTagQuery(input: { limit?: number, popular?: boolean }): Record<string, string> {
  const query: Record<string, string> = {}
  const limit = queryValue(input.limit)
  if (limit !== undefined) query.limit = limit
  if (input.popular === true) query.popular = '1'
  return query
}

const PAGE_FILTER_KEYS = [
  'created_at_min',
  'created_at_max',
  'updated_at_min',
  'updated_at_max',
  'published_at_min',
  'published_at_max',
] as const

export async function getShop(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { shop: await getResource(ctx, '/shop.json', 'shop') }
}

export function listBlogs(input: z.infer<typeof listBlogsInput>, ctx: ProviderContext): Promise<Json> {
  return listResources(input, ctx, {
    path: '/blogs.json',
    resultKey: 'blogs',
    keys: ['handle', 'since_id', 'limit', 'page_info'],
  })
}

export async function getBlog(input: z.infer<typeof getBlogInput>, ctx: ProviderContext): Promise<Json> {
  return { blog: await getResource(ctx, `/blogs/${requireId(input.blog_id, 'blog_id')}.json`, 'blog') }
}

export function countBlogs(input: z.infer<typeof countBlogsInput>, ctx: ProviderContext): Promise<Json> {
  return countResources(input, ctx, { path: '/blogs/count.json', keys: [] })
}

export function listPages(input: z.infer<typeof listPagesInput>, ctx: ProviderContext): Promise<Json> {
  return listResources(input, ctx, {
    path: '/pages.json',
    resultKey: 'pages',
    keys: ['title', 'handle', 'published_status', 'since_id', ...PAGE_FILTER_KEYS, 'limit', 'page_info'],
  })
}

export async function getPage(input: z.infer<typeof getPageInput>, ctx: ProviderContext): Promise<Json> {
  return { page: await getResource(ctx, `/pages/${requireId(input.page_id, 'page_id')}.json`, 'page') }
}

export function countPages(input: z.infer<typeof countPagesInput>, ctx: ProviderContext): Promise<Json> {
  return countResources(input, ctx, {
    path: '/pages/count.json',
    keys: ['title', 'published_status', ...PAGE_FILTER_KEYS],
  })
}

export function listArticles(input: z.infer<typeof listArticlesInput>, ctx: ProviderContext): Promise<Json> {
  return listResources(input, ctx, {
    path: `/blogs/${requireId(input.blog_id, 'blog_id')}/articles.json`,
    resultKey: 'articles',
    keys: [
      'author',
      'handle',
      'tag',
      'published_status',
      'since_id',
      ...PAGE_FILTER_KEYS,
      'limit',
      'page_info',
    ],
  })
}

export async function getArticle(input: z.infer<typeof getArticleInput>, ctx: ProviderContext): Promise<Json> {
  const blogId = requireId(input.blog_id, 'blog_id')
  const articleId = requireId(input.article_id, 'article_id')
  return { article: await getResource(ctx, `/blogs/${blogId}/articles/${articleId}.json`, 'article') }
}

export function countArticles(input: z.infer<typeof countArticlesInput>, ctx: ProviderContext): Promise<Json> {
  return countResources(input, ctx, {
    path: `/blogs/${requireId(input.blog_id, 'blog_id')}/articles/count.json`,
    keys: ['published_status', ...PAGE_FILTER_KEYS],
  })
}

export async function listArticleTags(
  input: z.infer<typeof listArticleTagsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { payload } = await request(ctx, '/articles/tags.json', articleTagQuery(input))
  return { tags: requireStringArray(requireRecord(payload, 'article tags 响应').tags, 'tags') }
}

export async function listBlogArticleTags(
  input: z.infer<typeof listBlogArticleTagsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/blogs/${requireId(input.blog_id, 'blog_id')}/articles/tags.json`
  const { payload } = await request(ctx, path, articleTagQuery(input))
  return { tags: requireStringArray(requireRecord(payload, 'blog article tags 响应').tags, 'tags') }
}

export async function listArticleAuthors(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const { payload } = await request(ctx, '/articles/authors.json')
  return { authors: requireStringArray(requireRecord(payload, 'article authors 响应').authors, 'authors') }
}
