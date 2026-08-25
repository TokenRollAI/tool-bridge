/**
 * Ghost(Content API)的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/ghost/executors.ts`,语义等价、写法本地化:
 * 凭证经 `ctx.credentials` 取(多字段),出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * ⚠️ **凭证进 URL**:Ghost Content API 只认 `?key=<content api key>` 这一种鉴权方式(不是
 * Admin API 的 JWT —— 上游走的是 Content API,这里照它),故 API key 会出现在出站 URL 的
 * query 上。部署侧的请求日志、APM、代理访问日志都要对本 provider 的 `key` 参数做脱敏。
 *
 * 凭证是**两个字段**(对应上游 `definition.ts` 的 api_key + extraFields,字段名逐字一致):
 * `apiKey`(Content API key)与 `siteUrl`(站点公开地址)。后者不是密钥,但它决定出站主机 ——
 * 放 providerConfig 里等于让任何对该节点有 read 的 SK 都能改出站目标,故与 key 一起走 authRef。
 *
 * 四处上游细节决定了这里的形状:
 * - **base URL 由 siteUrl 现算**:`<siteUrl>/ghost/api/content/v5.0`。上游把它缓存在凭证
 *   metadata 里并校验一致性,tool-bridge 的凭证只存字段、没有 metadata,故每次调用现拼,
 *   并把上游 `normalizeGhostSiteUrl` 的归一(必须是 http(s)、剥掉 query/fragment/内嵌凭证、
 *   去掉末尾斜杠)一并带过来 —— 这层归一同时是出站目标的第一道闸。
 * - **路径末尾的斜杠是必需的**(`/posts/`、`/posts/slug/x/`):Ghost 对少斜杠的路径回 301,
 *   跟随重定向会白跑一跳,而 `guardedFetch` 跨源跳转还会剥凭证头(这里凭证在 query 上倒是
 *   剥不掉 —— 更该一次打对)。
 * - **单资源读取是"集合端点 + 取第一个"**:响应仍是 `{posts: [...]}`,出参要的是单数键
 *   (`post`),空数组归一成 `null` 而不是报 not_found(上游如此)。
 * - **id 与 slug 走的是两条路径**,二者都没给时上游有必填断言(生成的 schema 里两个都是
 *   optional,断言留在本层)。
 *
 * 与上游的一处有意偏离(在错误归一上,理由是 tool-bridge 的七码语义):上游把 401/403 与
 * 单资源读取的 404 统统压成 400、其余状态一律压成 502(可重试)。这里走公共 `upstreamError`
 * 按状态归一 —— 凭证无效(401/403)重试永远不会变,而"这篇 post 不存在"(404)与"参数不对"
 * 对调用方是两件事。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getAuthorInput,
  getPageInput,
  getPostInput,
  getTagInput,
  listAuthorsInput,
  listPagesInput,
  listPostsInput,
  listTagsInput,
} from './schema'
import {
  createProviderHttpClient,
  type ProviderQuery,
  type ResponseBodyKind,
} from '../_runtime/providerHttp'
import { asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireCredential } from '../_runtime/plugin'
import { assertPublicHttpUrl } from '../_runtime/guardedFetch'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'ghost'
/** 上游钉死的 Content API 路径与版本;换版本会改变出参形状,不随调用方走。 */
const CONTENT_PATH_PREFIX = '/ghost/api/content'
const CONTENT_API_VERSION = 'v5.0'
const http = createProviderHttpClient({ service: SERVICE })

type Json = Record<string, unknown>
/** 四个集合共用 browse/read 两套逻辑,出参键由集合名决定。 */
type Collection = 'authors' | 'pages' | 'posts' | 'tags'

type BrowseInput = z.infer<typeof listPostsInput>
type ReadInput = z.infer<typeof getPostInput>

/**
 * 把租户填的站点地址归一成 Content API base。
 *
 * 这是**出站边界**:siteUrl 由用户自填,内网地址会被 `assertPublicHttpUrl` 拦下(防 SSRF)。
 * 拦下时不复用它的通用文案 —— 那句话说的是"出站目标",用户看不出问题出在自己配的凭证上。
 */
function contentBaseUrl(ctx: ProviderContext): string {
  const raw = requireCredential(ctx, SERVICE, 'siteUrl')
  let url: URL
  try {
    url = assertPublicHttpUrl(raw)
  } catch {
    // 不回显 siteUrl 本身:错误消息会进日志,凭证字段不该跟着走。
    throw new TBError(
      'invalid_argument',
      'Ghost 凭证里的 siteUrl 不是可出站的公网 http(s) 地址 —— 插件会拦下私有网段、回环与云元数据地址'
      + '(防 SSRF)。请把这个 Ghost 站点的公开地址填进凭证的 siteUrl 字段',
    )
  }
  if (url.username !== '' || url.password !== '') {
    throw new TBError('invalid_argument', 'Ghost 凭证里的 siteUrl 不能内嵌用户名或密码')
  }

  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  const site = url.toString().replace(/\/$/, '')
  return `${site}${CONTENT_PATH_PREFIX}/${CONTENT_API_VERSION}`
}

/** Ghost 的错误文案:`errors[0].message` 优先,其次 `message`,最后按状态兜底。 */
function errorMessage(status: number, payload: unknown): string {
  const body = record(payload)
  const errors = body?.errors
  if (Array.isArray(errors)) {
    const message = text(record(errors[0])?.message)
    if (message !== undefined) return message
  }
  return text(body?.message) ?? `Ghost 返回 HTTP ${status}`
}

function errorPayload(data: unknown, bodyKind: ResponseBodyKind): unknown {
  return bodyKind === 'invalid-json' ? { message: data } : data
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, number | string | undefined> = {},
): Promise<unknown> {
  const result = await http.request({
    // base 里已经带 /ghost/api/content/v5.0；薄层会保住这段部署路径。
    baseUrl: `${contentBaseUrl(ctx)}/`,
    path,
    query: [
      ['key', requireCredential(ctx, SERVICE, 'apiKey')],
      ...Object.entries(query),
    ] satisfies ProviderQuery,
    headers: { accept: 'application/json' },
    invalidJsonMessage: 'Ghost 返回了非 JSON 响应',
    mapError: ({ bodyKind, data, status }) => upstreamError(
      status,
      errorMessage(status, errorPayload(data, bodyKind)),
    ),
  })
  return result.data === undefined ? {} : result.data
}

/** 上游 `browseQuery`:整数原样发,字符串去空白后仍非空才发。 */
function browseQuery(input: BrowseInput): Record<string, number | string | undefined> {
  return {
    limit: input.limit,
    page: input.page,
    include: text(input.include),
    fields: text(input.fields),
    formats: text(input.formats),
    filter: text(input.filter),
    order: text(input.order),
  }
}

/** 单资源读取只认这三个投影参数(没有 filter/order/分页)。 */
function readQuery(input: ReadInput): Record<string, string | undefined> {
  return {
    include: text(input.include),
    fields: text(input.fields),
    formats: text(input.formats),
  }
}

/**
 * 集合浏览。缺集合键或键不是数组时给 `[]`、meta 缺失时给 `null` —— 上游如此,且出参声明里
 * 两者都是 optional,故不按"契约破了"处理(这是个公开只读 API,空站点本来就没有内容)。
 */
async function browse(input: BrowseInput, ctx: ProviderContext, collection: Collection): Promise<Json> {
  const payload = record(await request(ctx, `/${collection}/`, browseQuery(input))) ?? {}
  const items = payload[collection]
  return {
    [collection]: Array.isArray(items) ? items.map(item => record(item) ?? {}) : [],
    meta: record(payload.meta) ?? null,
  }
}

/**
 * 单资源读取。id 与 slug 打不同路径(id 优先),两个都没给是**调用方**的错 —— 生成的 schema
 * 里两者都 optional,这条必填断言只能留在本层。
 */
async function read(input: ReadInput, ctx: ProviderContext, collection: Collection): Promise<Json> {
  const id = text(input.id)
  const slug = text(input.slug)
  if (id === undefined && slug === undefined) {
    throw new TBError('invalid_argument', 'id or slug is required')
  }

  const path = id === undefined
    ? `/${collection}/slug/${encodeURIComponent(slug!)}/`
    : `/${collection}/${encodeURIComponent(id)}/`
  const payload = record(await request(ctx, path, readQuery(input))) ?? {}
  const items = payload[collection]
  const resource = Array.isArray(items) ? record(items[0]) : undefined
  // 出参是单数键(posts → post),取集合里的第一个;空集合归一成 null。
  return { [collection.slice(0, -1)]: resource ?? null }
}

export function listPosts(input: z.infer<typeof listPostsInput>, ctx: ProviderContext): Promise<Json> {
  return browse(input, ctx, 'posts')
}

export function getPost(input: z.infer<typeof getPostInput>, ctx: ProviderContext): Promise<Json> {
  return read(input, ctx, 'posts')
}

export function listPages(input: z.infer<typeof listPagesInput>, ctx: ProviderContext): Promise<Json> {
  return browse(input, ctx, 'pages')
}

export function getPage(input: z.infer<typeof getPageInput>, ctx: ProviderContext): Promise<Json> {
  return read(input, ctx, 'pages')
}

export function listTags(input: z.infer<typeof listTagsInput>, ctx: ProviderContext): Promise<Json> {
  return browse(input, ctx, 'tags')
}

export function getTag(input: z.infer<typeof getTagInput>, ctx: ProviderContext): Promise<Json> {
  return read(input, ctx, 'tags')
}

export function listAuthors(input: z.infer<typeof listAuthorsInput>, ctx: ProviderContext): Promise<Json> {
  return browse(input, ctx, 'authors')
}

export function getAuthor(input: z.infer<typeof getAuthorInput>, ctx: ProviderContext): Promise<Json> {
  return read(input, ctx, 'authors')
}

export async function readSettings(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = record(await request(ctx, '/settings/'))
  return { settings: record(payload?.settings) ?? null }
}
