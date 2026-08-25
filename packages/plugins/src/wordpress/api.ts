/**
 * WordPress(REST API v2)的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/wordpress/runtime.ts`,语义等价、写法本地化:
 * 凭证经 `ctx.credentials` 取(多字段),出站走 `guardedFetch`,错误抛 `TBError` 七码。
 * 凭证走 `Authorization: Basic` 请求头(**不是 Bearer**:WordPress 应用密码就是 Basic 的
 * 密码位),不进 URL。
 *
 * 凭证是**三个字段**(对应上游 `definition.ts` 的 api_key + extraFields,字段名逐字一致):
 * `apiKey`(应用密码,当 Basic 的密码)、`siteUrl`(站点根地址)、`username`(当 Basic 的用户名)。
 *
 * 五处上游细节决定了这里的形状:
 * - **base URL 由 siteUrl 现算**:`<siteUrl>/wp-json/wp/v2`。siteUrl 是**用户自建实例**的
 *   地址,故它同时是出站边界:`assertPublicHttpUrl` 会拦下私有网段、回环与云元数据地址
 *   (防 SSRF)。上游 `normalizeWordpressSiteUrl` 的归一一并带过来:剥 query/fragment、
 *   去末尾斜杠、**摘掉用户可能直接粘上的 `/wp-json` 或 `/wp-json/wp/v2` 后缀**
 *   (不摘就会双拼成 `…/wp-json/wp/v2/wp-json/wp/v2`,每个请求都 404)。
 * - **分页在响应头上**,不在 body 里:`X-WP-Total` / `X-WP-TotalPages`。列表出参的
 *   `pagination` 只能从 headers 读,值不是整数就给 `null`(上游如此)。
 * - **数组型 query 参数是逗号串**(`include=1,2`),不是重复的同名参数 —— WordPress 的
 *   `WP_REST_Request` 按逗号拆;发成重复参数只有最后一个生效。
 * - **`include` 与 `exclude` 不许有交集**:WordPress 对这种组合静默返回空集合,上游在本地
 *   先拒(保留)。
 * - **更新走 POST,不是 PUT**:WordPress 两种都收,上游用 POST(照抄,少一次 405 的风险)。
 * - 上游 `optionalString` 会 trim 且把空串当没给:`content: '  '` 整个键不发 —— 于是"更新时
 *   把正文清空"这件事做不到。这是上游行为,照搬(Zod 的 `min(1)` 也拦不住纯空白串)。
 *
 * 与上游的四处有意偏离:
 * - 上游 `normalizeWordpressSiteUrl` 在 `OOMOL_CONNECT_ALLOW_PRIVATE_NETWORK` 开启时放行
 *   http 与内网地址。本仓库的插件没有这个开关(出站策略统一在 `guardedFetch`),故这里
 *   **只接受 https**:应用密码是以 Basic 头**明文**发送的,http 等于把它交给链路上任何人。
 * - 上游把 `notFoundAsInvalidInput` 路径上的 404 压成 400。这里保留 `not_found` —— 调用方要
 *   能区分"参数不对"和"这个 post 不存在"。同理 409 走公共归一成 `conflict`,而不是上游的 502。
 * - 上游在**凭证校验**阶段把 401/403 压成 400。tool-bridge 里没有这个阶段(挂载探针就是一次
 *   普通的 `get_current_user` 调用),故不迁;401/403 一律 `permission_denied`。
 * - siteUrl 里内嵌用户名/密码当场拒(上游不查)。REST 请求的凭证只该走 Basic 头,URL 里的
 *   userinfo 会跟着日志走,而且两处凭证谁生效取决于实现,不留这个歧义。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createCategoryInput,
  createPageInput,
  createPostInput,
  createTagInput,
  deleteCommentInput,
  deletePageInput,
  deletePostInput,
  getCurrentUserInput,
  getPageInput,
  getPostInput,
  listCategoriesInput,
  listCommentsInput,
  listPagesInput,
  listPostsInput,
  listTagsInput,
  updateCommentInput,
  updatePageInput,
  updatePostInput,
} from './schema'
import {
  createProviderHttpClient,
  type ProviderHttpErrorContext,
  type ProviderHttpResult,
  type ProviderQuery,
  type ResponseBodyKind,
} from '../_runtime/providerHttp'
import { compactDefined as compact, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireCredential } from '../_runtime/plugin'
import { assertPublicHttpUrl } from '../_runtime/guardedFetch'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'wordpress'
/** REST v2 的路径前缀,以及用户可能直接粘进 siteUrl 的那两种 REST 根。 */
const API_PATH = 'wp-json/wp/v2'
const REST_ROOT_SUFFIXES = ['/wp-json/wp/v2', '/wp-json']
/** 上游凭证校验打的端点,也是本 provider 的 `get_current_user`。 */
const CURRENT_USER_PATH = '/users/me'
const http = createProviderHttpClient({ service: SERVICE })

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | readonly (number | string)[] | undefined

/** 契约说好是对象;不是就是上游出问题,不是调用方的错。 */
function requireRecord(value: unknown, message: string): Json {
  const result = record(value)
  if (result === undefined) throw upstreamError(502, message)
  return result
}

/** 上游 `optionalQueryArray`:空数组等于没给。 */
function list(value: readonly (number | string)[] | undefined): readonly (number | string)[] | undefined {
  return value !== undefined && value.length > 0 ? value : undefined
}

/**
 * 把租户填的站点地址归一成 REST v2 base。
 *
 * 这是**出站边界**:siteUrl 由用户自填,内网地址会被 `assertPublicHttpUrl` 拦下(防 SSRF)。
 * 拦下时不复用它的通用文案 —— 那句话说的是"出站目标",用户看不出问题出在自己配的凭证上。
 */
function apiBaseUrl(ctx: ProviderContext): string {
  const raw = requireCredential(ctx, SERVICE, 'siteUrl').trim()
  let url: URL
  try {
    url = assertPublicHttpUrl(raw)
  } catch {
    // 不回显 siteUrl 本身:错误消息会进日志,凭证字段不该跟着走。
    throw new TBError(
      'invalid_argument',
      'WordPress 凭证里的 siteUrl 不是可出站的公网 http(s) 地址 —— 插件会拦下私有网段、回环与'
      + '云元数据地址(防 SSRF)。请把这个 WordPress 站点的公网地址填进凭证的 siteUrl 字段',
    )
  }
  if (url.protocol !== 'https:') {
    throw new TBError(
      'invalid_argument',
      'WordPress 凭证里的 siteUrl 必须用 https —— 应用密码是以 Basic 头明文发送的',
    )
  }
  if (url.username !== '' || url.password !== '') {
    throw new TBError('invalid_argument', 'WordPress 凭证里的 siteUrl 不能内嵌用户名或密码')
  }

  url.hash = ''
  url.search = ''
  let pathname = url.pathname.replace(/\/+$/, '')
  // 用户可能直接粘了 REST 根地址,先摘掉再拼,否则每个请求都会双拼成 404。
  const lowered = pathname.toLowerCase()
  for (const suffix of REST_ROOT_SUFFIXES) {
    if (lowered.endsWith(suffix)) {
      pathname = pathname.slice(0, pathname.length - suffix.length)
      break
    }
  }
  pathname = pathname.replace(/\/+$/, '')
  return new URL(API_PATH, `${url.origin}${pathname}/`).toString()
}

/**
 * `Basic base64(username:应用密码)`。
 *
 * 上游用 `node:Buffer` 做 base64,这里换成 `btoa` —— 插件要能在 Workers 里跑。
 * 用户名可能含非 ASCII,先走 TextEncoder 再逐字节转,免得 btoa 直接抛。
 * 应用密码原样发:WordPress 展示时带空格,服务端比对前自己会剔掉非字母数字字符。
 */
function basicAuthHeader(ctx: ProviderContext): string {
  const username = requireCredential(ctx, SERVICE, 'username').trim()
  if (username === '') {
    throw new TBError('invalid_argument', 'WordPress 凭证里的 username 不能是空白')
  }
  const applicationPassword = requireCredential(ctx, SERVICE, 'apiKey')
  const bytes = new TextEncoder().encode(`${username}:${applicationPassword}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

/** 数组型参数是逗号串(WordPress 按逗号拆),不是重复的同名参数。 */
function queryPairs(query: Record<string, QueryValue> = {}): ProviderQuery {
  return Object.entries(query).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.map(String).join(',') : value,
  ] as const)
}

/** WordPress 的错误体是 `{code, message, data}`;拿不到 message 就退回 statusText。 */
function errorMessage(payload: unknown, context: ProviderHttpErrorContext): string {
  return text(record(payload)?.message)
    ?? (text(context.statusText) === undefined
      ? 'WordPress request failed'
      : `WordPress request failed: ${context.statusText}`)
}

interface RequestOptions {
  body?: Json
  method?: 'DELETE' | 'GET' | 'POST'
  path: string
  query?: Record<string, QueryValue>
}

function jsonPayload(data: unknown, bodyKind: ResponseBodyKind): unknown {
  return bodyKind === 'json' ? data : null
}

async function requestResponse(ctx: ProviderContext, options: RequestOptions): Promise<ProviderHttpResult> {
  return http.request({
    baseUrl: `${apiBaseUrl(ctx)}/`,
    path: options.path,
    method: options.method ?? 'GET',
    query: queryPairs(options.query),
    headers: { accept: 'application/json', authorization: basicAuthHeader(ctx) },
    ...(options.body === undefined ? {} : { json: options.body }),
    // 上游 response.json().catch(() => null)：成功或错误上的非 JSON 都按 null。
    invalidJson: 'text',
    mapError: context => upstreamError(
      context.status || 502,
      errorMessage(jsonPayload(context.data, context.bodyKind), context),
    ),
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined ? 'WordPress request failed' : `WordPress request failed: ${message}`,
    ),
  })
}

async function requestObject(ctx: ProviderContext, options: RequestOptions): Promise<Json> {
  const result = await requestResponse(ctx, options)
  const payload = jsonPayload(result.data, result.bodyKind)
  return requireRecord(payload, 'WordPress response must be a JSON object')
}

/** 分页只在响应头上;值不是整数就给 null。 */
function headerInteger(headers: Headers, name: string): number | null {
  const value = headers.get(name)
  if (value === null || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

function readPagination(headers: Headers): Json {
  return {
    total: headerInteger(headers, 'x-wp-total'),
    totalPages: headerInteger(headers, 'x-wp-totalpages'),
  }
}

/**
 * 上游的必填断言:生成的 schema 里 `get_post` / `get_page` 的 `id` 是 optional
 * (上游 action 声明没写 required),必填这件事只在 executor 里,故留在本层。
 */
function requireId(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new TBError('invalid_argument', 'id must be an integer')
  return parsed
}

/** WordPress 对 include ∩ exclude ≠ ∅ 静默返回空集合;上游在本地先拒(保留)。 */
function assertNoIncludeExcludeOverlap(input: {
  exclude?: readonly number[] | undefined
  include?: readonly number[] | undefined
}): void {
  if (input.include === undefined || input.exclude === undefined) return
  const include = new Set(input.include.map(String))
  if (input.exclude.some(item => include.has(String(item)))) {
    throw new TBError('invalid_argument', 'include and exclude must not contain the same ID.')
  }
}

async function listCollection(
  ctx: ProviderContext,
  input: { exclude?: readonly number[] | undefined, include?: readonly number[] | undefined },
  path: string,
  outputKey: string,
  query: Record<string, QueryValue>,
): Promise<Json> {
  assertNoIncludeExcludeOverlap(input)
  const response = await requestResponse(ctx, { path, query })
  const payload = jsonPayload(response.data, response.bodyKind)
  if (!Array.isArray(payload)) {
    throw upstreamError(502, 'WordPress list response must be an array')
  }
  return { [outputKey]: payload, pagination: readPagination(response.headers) }
}

async function getResource(
  ctx: ProviderContext,
  input: { id?: number | undefined },
  collectionPath: string,
  outputKey: string,
): Promise<Json> {
  const id = requireId(input.id)
  const payload = await requestObject(ctx, { path: `${collectionPath}/${encodeURIComponent(String(id))}` })
  return { [outputKey]: payload }
}

async function createResource(
  ctx: ProviderContext,
  path: string,
  outputKey: string,
  body: Json,
): Promise<Json> {
  const payload = await requestObject(ctx, { path, method: 'POST', body })
  return { [outputKey]: payload }
}

async function updateResource(
  ctx: ProviderContext,
  input: { id: number },
  collectionPath: string,
  outputKey: string,
  body: Json,
): Promise<Json> {
  const id = requireId(input.id)
  const payload = await requestObject(ctx, {
    // WordPress 两种方法都收,上游用 POST。
    path: `${collectionPath}/${encodeURIComponent(String(id))}`,
    method: 'POST',
    body,
  })
  return { [outputKey]: payload }
}

async function deleteResource(
  ctx: ProviderContext,
  input: { force?: boolean | undefined, id: number },
  collectionPath: string,
): Promise<Json> {
  const id = requireId(input.id)
  const payload = await requestObject(ctx, {
    path: `${collectionPath}/${encodeURIComponent(String(id))}`,
    method: 'DELETE',
    query: { force: input.force },
  })
  return {
    // 上游只认 `deleted === true`:少了这一步,"移入回收站"会被当成删除成功。
    deleted: payload.deleted === true,
    previous: record(payload.previous) ?? null,
  }
}

export function getCurrentUser(
  _input: z.infer<typeof getCurrentUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // context=edit 才能拿到当前用户的邮箱等自有字段(上游凭证校验打的正是这个组合)。
  return requestObject(ctx, { path: CURRENT_USER_PATH, query: { context: 'edit' } })
    .then(user => ({ user }))
}

export function listPosts(input: z.infer<typeof listPostsInput>, ctx: ProviderContext): Promise<Json> {
  return listCollection(ctx, input, '/posts', 'posts', compact<QueryValue>({
    search: text(input.search),
    status: list(input.status),
    categories: list(input.categories),
    tags: list(input.tags),
    include: list(input.include),
    exclude: list(input.exclude),
    author: list(input.author),
    slug: list(input.slug),
    per_page: input.perPage,
    page: input.page,
    order: text(input.order),
    orderby: text(input.orderby),
  }))
}

export function getPost(input: z.infer<typeof getPostInput>, ctx: ProviderContext): Promise<Json> {
  return getResource(ctx, input, '/posts', 'post')
}

/** 创建与更新 post 共用同一份 body(上游 `buildPostBody`)。 */
function postBody(input: z.infer<typeof createPostInput> | z.infer<typeof updatePostInput>): Json {
  return compact<unknown>({
    title: text(input.title),
    content: text(input.content),
    excerpt: text(input.excerpt),
    slug: text(input.slug),
    status: text(input.status),
    categories: list(input.categories),
    tags: list(input.tags),
    featured_media: input.featuredMedia,
    meta: record(input.meta),
  })
}

export function createPost(input: z.infer<typeof createPostInput>, ctx: ProviderContext): Promise<Json> {
  return createResource(ctx, '/posts', 'post', postBody(input))
}

export function updatePost(input: z.infer<typeof updatePostInput>, ctx: ProviderContext): Promise<Json> {
  return updateResource(ctx, input, '/posts', 'post', postBody(input))
}

export function deletePost(input: z.infer<typeof deletePostInput>, ctx: ProviderContext): Promise<Json> {
  return deleteResource(ctx, input, '/posts')
}

export function listPages(input: z.infer<typeof listPagesInput>, ctx: ProviderContext): Promise<Json> {
  return listCollection(ctx, input, '/pages', 'pages', compact<QueryValue>({
    search: text(input.search),
    status: list(input.status),
    include: list(input.include),
    exclude: list(input.exclude),
    parent: list(input.parent),
    author: list(input.author),
    slug: list(input.slug),
    per_page: input.perPage,
    page: input.page,
    order: text(input.order),
    orderby: text(input.orderby),
  }))
}

export function getPage(input: z.infer<typeof getPageInput>, ctx: ProviderContext): Promise<Json> {
  return getResource(ctx, input, '/pages', 'page')
}

function pageBody(input: z.infer<typeof createPageInput> | z.infer<typeof updatePageInput>): Json {
  return compact<unknown>({
    title: text(input.title),
    content: text(input.content),
    excerpt: text(input.excerpt),
    slug: text(input.slug),
    status: text(input.status),
    parent: input.parent,
    featured_media: input.featuredMedia,
    menu_order: input.menuOrder,
    meta: record(input.meta),
  })
}

export function createPage(input: z.infer<typeof createPageInput>, ctx: ProviderContext): Promise<Json> {
  return createResource(ctx, '/pages', 'page', pageBody(input))
}

export function updatePage(input: z.infer<typeof updatePageInput>, ctx: ProviderContext): Promise<Json> {
  return updateResource(ctx, input, '/pages', 'page', pageBody(input))
}

export function deletePage(input: z.infer<typeof deletePageInput>, ctx: ProviderContext): Promise<Json> {
  return deleteResource(ctx, input, '/pages')
}

/** 分类与标签(taxonomy term)共用同一份 list query 与 body。 */
function termListQuery(
  input: z.infer<typeof listCategoriesInput> | z.infer<typeof listTagsInput>,
): Record<string, QueryValue> {
  return compact<QueryValue>({
    search: text(input.search),
    include: list(input.include),
    exclude: list(input.exclude),
    // term 的 parent 是**单个** ID(post/page/comment 那边才是数组)。
    parent: input.parent,
    slug: list(input.slug),
    hide_empty: input.hideEmpty,
    per_page: input.perPage,
    page: input.page,
    order: text(input.order),
    orderby: text(input.orderby),
  })
}

function termBody(input: z.infer<typeof createCategoryInput> | z.infer<typeof createTagInput>): Json {
  return compact<unknown>({
    name: text(input.name),
    slug: text(input.slug),
    description: text(input.description),
    parent: input.parent,
    meta: record(input.meta),
  })
}

export function listCategories(input: z.infer<typeof listCategoriesInput>, ctx: ProviderContext): Promise<Json> {
  return listCollection(ctx, input, '/categories', 'categories', termListQuery(input))
}

export function createCategory(input: z.infer<typeof createCategoryInput>, ctx: ProviderContext): Promise<Json> {
  return createResource(ctx, '/categories', 'category', termBody(input))
}

export function listTags(input: z.infer<typeof listTagsInput>, ctx: ProviderContext): Promise<Json> {
  return listCollection(ctx, input, '/tags', 'tags', termListQuery(input))
}

export function createTag(input: z.infer<typeof createTagInput>, ctx: ProviderContext): Promise<Json> {
  return createResource(ctx, '/tags', 'tag', termBody(input))
}

export function listComments(input: z.infer<typeof listCommentsInput>, ctx: ProviderContext): Promise<Json> {
  return listCollection(ctx, input, '/comments', 'comments', compact<QueryValue>({
    search: text(input.search),
    status: list(input.status),
    post: list(input.post),
    author: list(input.author),
    parent: list(input.parent),
    include: list(input.include),
    exclude: list(input.exclude),
    per_page: input.perPage,
    page: input.page,
    order: text(input.order),
    orderby: text(input.orderby),
  }))
}

export function updateComment(input: z.infer<typeof updateCommentInput>, ctx: ProviderContext): Promise<Json> {
  return updateResource(ctx, input, '/comments', 'comment', compact<unknown>({
    content: text(input.content),
    status: text(input.status),
    author_name: text(input.authorName),
    author_email: text(input.authorEmail),
    author_url: text(input.authorUrl),
  }))
}

export function deleteComment(input: z.infer<typeof deleteCommentInput>, ctx: ProviderContext): Promise<Json> {
  return deleteResource(ctx, input, '/comments')
}
