/**
 * Confluence 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/confluence/runtime.ts`,语义等价、写法本地化:
 * 凭证经 `ctx.credentials` 取(多字段),出站走 `guardedFetch`,错误抛 `TBError` 七码。
 * 凭证走 `Authorization: Basic` 请求头,不进 URL。
 *
 * 凭证是**三个字段**(对应上游 `definition.ts` 的 api_key + extraFields,字段名逐字一致):
 * `apiKey`(Atlassian API token,当 Basic 的密码)、`email`(当 Basic 的用户名)、
 * `siteUrl`(站点根,用来拼出 `https://<site>.atlassian.net/wiki/api/v2`)。
 *
 * 四处上游细节决定了这里的形状:
 * - **base URL 由 siteUrl 现算**。上游在凭证校验时把 `<site>/wiki/api/v2` 存进 credential
 *   metadata,业务路径直接读那个缓存值;tool-bridge 的凭证只存字段,故每次调用现拼,
 *   并把上游 `normalizeConfluenceSiteUrl` 的三条校验(合法 URL / https / .atlassian.net)一并带过来。
 * - **limit 默认 25**:上游显式补这个默认值,不补则 Confluence 自己的默认是 25 但不保证。
 * - **分页 cursor 藏在 `_links.next` 这个 URL 里**,要从它的 query string 里把 `cursor` 抠出来,
 *   而不是直接把整个链接透出去 —— 出参 schema 要的是能直接回填进 `cursor` 入参的那个值。
 * - 出参是**裁剪 + `raw` 全量**的双份形状:命名字段给 agent 读,`raw` 保留上游原始对象。
 *
 * 与上游的有意偏离:上游 `notFoundAsInvalidInput` 这个开关是**死代码**(命中分支与兜底分支
 * 都返回 404),故不迁;404 由公共 `upstreamError` 归成 not_found。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createPageInput,
  getPageInput,
  listSpacesInput,
  searchContentInput,
  updatePageInput,
} from './schema'
import { type ProviderContext, requireCredential } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'confluence'
/** 照搬上游的 30s 单请求上限。 */
const REQUEST_TIMEOUT_MS = 30_000
/** 上游显式补的分页默认值,不是 Confluence 的服务端默认。 */
const DEFAULT_LIMIT = 25

type Json = Record<string, unknown>
type QueryValue = number | string | undefined

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** 丢掉值为 undefined 的键(上游 `compactObject`);`null` 要留住。 */
function compact<T>(input: Record<string, T | undefined>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Record<string, T>
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错。 */
function requireRecord(value: unknown, message: string): Json {
  const result = record(value)
  if (result === undefined) throw upstreamError(502, message)
  return result
}

/**
 * 上游 `normalizeConfluenceSiteUrl`:补协议、校 https、限定 atlassian.net Cloud 站点。
 * 最后一条不只是校验口味 —— 它把这个由租户填写的主机名钉在一个已知域下,
 * 是 `guardedFetch` 之外的第二道出站边界。
 */
function siteBaseUrl(ctx: ProviderContext): string {
  const raw = requireCredential(ctx, SERVICE, 'siteUrl')
  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    throw new TBError('invalid_argument', 'Confluence siteUrl must be a valid URL')
  }
  if (url.protocol !== 'https:') {
    throw new TBError('invalid_argument', 'Confluence siteUrl must use https')
  }
  if (!url.hostname.endsWith('.atlassian.net')) {
    throw new TBError('invalid_argument', 'Confluence siteUrl must be an atlassian.net Cloud site')
  }
  return `https://${url.hostname}/wiki/api/v2`
}

/** 上游用 `node:buffer` 做 base64,这里换成 `btoa` —— 插件要能在 Workers 里跑。 */
function basicAuthHeader(ctx: ProviderContext): string {
  const email = requireCredential(ctx, SERVICE, 'email')
  const apiToken = requireCredential(ctx, SERVICE, 'apiKey')
  // 邮箱可能含非 ASCII,先走 TextEncoder 再逐字节转,免得 btoa 直接抛。
  const bytes = new TextEncoder().encode(`${email}:${apiToken}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

/** Confluence 的错误文案:纯文本 body 直接用,JSON 则依次看 message / errorMessage / error / errors[].message。 */
function errorMessage(payload: unknown, response: Response): string {
  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    if (trimmed !== '') return trimmed
  }
  const body = record(payload)
  const fromList = Array.isArray(body?.errors)
    ? body.errors.map(item => text(record(item)?.message)).find(item => item !== undefined)
    : undefined
  return text(body?.message) ?? text(body?.errorMessage) ?? text(body?.error) ?? fromList
    ?? text(response.statusText) ?? 'Confluence request failed'
}

interface RequestOptions {
  body?: Json
  method: 'GET' | 'POST' | 'PUT'
  path: string
  query?: Record<string, QueryValue>
}

async function request(ctx: ProviderContext, options: RequestOptions): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: basicAuthHeader(ctx),
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  const url = new URL(options.path.replace(/^\//, ''), `${siteBaseUrl(ctx)}/`)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: options.method,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch (error) {
    // guardedFetch 拦下的出站(EgressBlockedError)已经是 TBError,原样冒上去。
    if (error instanceof TBError) throw error
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, `Confluence request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`)
    }
    throw upstreamError(
      502,
      error instanceof Error ? `Confluence request failed: ${error.message}` : 'Confluence request failed',
    )
  }

  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      // 上游对 2xx 的非 JSON 也只是把原文透出去(它的出参整形随后会判形状),这里照搬。
      payload = raw
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response))
  return payload
}

/**
 * `_links.next` 是一个**完整链接**(带 query),出参要的却是能直接回填进 `cursor` 入参的那个值,
 * 故从它的 query string 里把 `cursor` 抠出来。没有下一页时 Confluence 干脆不给这个键。
 */
function nextCursor(payload: Json): string | null {
  const link = text(record(payload._links)?.next)
  if (link === undefined) return null
  const questionIndex = link.indexOf('?')
  const search = questionIndex >= 0 ? link.slice(questionIndex) : link
  try {
    return new URLSearchParams(search).get('cursor')
  } catch {
    return null
  }
}

function normalizeSpace(value: unknown): Json {
  const space = requireRecord(value, 'Confluence space must be an object')
  return compact({
    id: text(space.id),
    key: text(space.key),
    name: text(space.name),
    type: text(space.type),
    status: text(space.status),
    homepageId: text(space.homepageId ?? record(space.homepage)?.id) ?? null,
    raw: space,
  })
}

function normalizePage(value: unknown): Json {
  const page = requireRecord(value, 'Confluence page must be an object')
  const version = record(page.version)
  return compact({
    id: text(page.id),
    status: text(page.status),
    title: text(page.title),
    spaceId: text(page.spaceId),
    parentId: text(page.parentId) ?? null,
    createdAt: text(page.createdAt),
    version: version === undefined
      ? null
      : compact({
          number: integer(version.number),
          message: text(version.message),
          minorEdit: boolean(version.minorEdit),
        }),
    body: record(page.body) ?? null,
    raw: page,
  })
}

function normalizeSearchResult(value: unknown): Json {
  const result = requireRecord(value, 'Confluence search result must be an object')
  const content = record(result.content)
  return compact({
    // 搜索结果的字段有时挂在顶层、有时挂在 content 下,两处都要看。
    id: text(result.id ?? content?.id),
    type: text(result.type ?? content?.type),
    title: text(result.title ?? content?.title),
    url: text(result.url ?? result.webUrl ?? result.link),
    excerpt: text(result.excerpt),
    containerTitle: text(record(result.resultGlobalContainer)?.title),
    raw: result,
  })
}

export async function searchContent(
  input: z.infer<typeof searchContentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireRecord(
    await request(ctx, {
      method: 'GET',
      path: '/search',
      query: compact({
        cql: input.cql,
        limit: input.limit ?? DEFAULT_LIMIT,
        cursor: text(input.cursor),
      }),
    }),
    'Confluence search response must be an object',
  )
  const results = Array.isArray(payload.results) ? payload.results : []
  return { results: results.map(normalizeSearchResult), pagination: { nextCursor: nextCursor(payload) } }
}

export async function listSpaces(input: z.infer<typeof listSpacesInput>, ctx: ProviderContext): Promise<Json> {
  const payload = requireRecord(
    await request(ctx, {
      method: 'GET',
      path: '/spaces',
      query: compact({
        limit: input.limit ?? DEFAULT_LIMIT,
        cursor: text(input.cursor),
        type: text(input.type),
        status: text(input.status),
      }),
    }),
    'Confluence spaces response must be an object',
  )
  const results = Array.isArray(payload.results) ? payload.results : []
  return { spaces: results.map(normalizeSpace), pagination: { nextCursor: nextCursor(payload) } }
}

export async function getPage(input: z.infer<typeof getPageInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'GET',
    path: `/pages/${encodeURIComponent(input.pageId)}`,
    query: compact({ 'body-format': text(input.bodyFormat) }),
  })
  return { page: normalizePage(payload) }
}

export async function createPage(input: z.infer<typeof createPageInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: '/pages',
    body: compact({
      spaceId: input.spaceId,
      status: text(input.status) ?? 'current',
      title: input.title,
      parentId: text(input.parentId),
      body: { representation: text(input.bodyRepresentation) ?? 'storage', value: input.body },
    }),
  })
  return { page: normalizePage(payload) }
}

export async function updatePage(input: z.infer<typeof updatePageInput>, ctx: ProviderContext): Promise<Json> {
  const body = text(input.body)
  const payload = await request(ctx, {
    method: 'PUT',
    path: `/pages/${encodeURIComponent(input.pageId)}`,
    body: compact({
      // Confluence 的 PUT 要求 body 里再带一次 id,少了会 400。
      id: input.pageId,
      status: text(input.status) ?? 'current',
      title: input.title,
      // 没给正文就整块省略 —— 发一个空 value 会把页面内容清空。
      body: body === undefined
        ? undefined
        : { representation: text(input.bodyRepresentation) ?? 'storage', value: body },
      version: compact({
        number: input.versionNumber,
        message: text(input.versionMessage),
        minorEdit: input.minorEdit,
      }),
    }),
  })
  return { page: normalizePage(payload) }
}
