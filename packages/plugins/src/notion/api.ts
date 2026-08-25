/**
 * Notion(公开 API)的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/notion/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。凭证走 `Authorization: Bearer` 请求头,不进 URL。
 *
 * 只迁 api_key(internal integration secret)这条凭证路径。上游 `definition.ts` 还声明了
 * OAuth2(authorize/token + 一串读写 scope),那条路径要平台的 providerOAuth 支撑;两者拿到的
 * 都是 Bearer token,handler 一行都不用改。
 *
 * 六处上游细节决定了这里的形状:
 * - **`Notion-Version` 头必带**,且值钉死在 `2026-03-11`(上游 `notionCoreVersion`)。少了这个头
 *   Notion 一律 400;换版本会改变出参形状,故它不随调用方走。
 * - **大部分 action 是薄透传**:出参就是 Notion 的原始对象(`z.looseObject`),不做裁剪 ——
 *   Notion 的对象形状随 property 类型变化,裁剪等于丢数据。空响应体归一成 `{}`(上游如此)。
 * - **`get_page` 打两跳**:页面本体与一级子块并发取,合成 `{page, block_children}`。
 * - **`append_block` 是 `append_block_children` 的糖**:把一段纯文本包成 paragraph 块。
 * - **`create_page` 有三条互斥的入参路径**(官方 `parent` 对象 / `parentId` + `title` 简化写法 /
 *   纯 `markdown`),彼此的冲突组合上游逐条给了明确文案。这段断言是这个 provider 里最容易迁丢的
 *   逻辑,原样保留(消息也逐字保留)。
 * - **`update_block` 的入参是 looseObject**:除 `blockId` 外的字段原样进 body(Notion 的块字段
 *   随块类型变化,枚举不完)。
 *
 * 与上游的三处有意偏离:
 * - **id 进路径时做 URL 编码**。上游直接字符串拼接,于是一个含 `/` 或 `..` 的 id 能把请求
 *   拐到别的端点上(`pageId = '../users/me'`)。合法的 Notion id 编码前后一模一样,故这不改变
 *   正常行为,只关掉那条路径穿越。
 * - **2xx 上回非 JSON 归 unavailable**。上游对响应体直接 `JSON.parse`,解析失败会抛裸
 *   `SyntaxError` —— 冒到 plugin-sdk 会变成 `internal` 500「插件崩了」,把"上游回了 HTML"
 *   这条真正的原因抹掉。
 * - **错误响应的正文只读一次**。上游 `assertNotionResponse` 与 `parseJsonBody` 各读一次
 *   `response.text()`,真实 fetch 下第二次会抛"body already used"(错误路径提前 throw 才没暴露)。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  appendBlockChildrenInput,
  appendBlockInput,
  createDatabaseInput,
  createDataSourceInput,
  deleteBlockInput,
  getPageInput,
  listBlockChildrenInput,
  listDataSourceTemplatesInput,
  listUsersInput,
  queryDataSourceInput,
  retrieveBlockInput,
  retrieveDatabaseInput,
  retrieveDataSourceInput,
  retrievePageInput,
  retrievePageMarkdownInput,
  retrievePagePropertyInput,
  retrieveUserInput,
  searchInput,
  updateBlockInput,
  updateDatabaseInput,
  updateDataSourceInput,
  updatePageInput,
  updatePageMarkdownInput,
} from './schema'
import type { createPageInput, movePageInput } from './schema.handwritten'
import {
  booleanValue as bool,
  compactDefined as compact,
  asJsonObject as record,
} from '../_runtime/jsonValue'
import {
  createProviderHttpClient,
  type ProviderQuery,
  type ResponseBodyKind,
} from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'notion'
const API_BASE = 'https://api.notion.com/v1'
/** 上游钉死的 API 版本;Notion 缺这个头一律 400,换版本会改变出参形状。 */
const NOTION_VERSION = '2026-03-11'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>
type QueryValue = number | string | string[] | undefined

interface RequestInput {
  body?: Json
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST'
  path: string
  query?: Record<string, QueryValue>
}

/** 上游 `asNonEmptyString`:**不去空白**,只看长度(照上游,免得改变接受集合)。 */
function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function array(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

/** 上游 `providerInputError` 那一族:调用方给的参数组合不成立。 */
function inputError(message: string): TBError {
  return new TBError('invalid_argument', message)
}

/**
 * Notion 的错误文案:`message` 优先,其次 `error`,再退回原始正文。
 * 上游同时看 `code === 'validation_error'`,但那条分支与默认分支的结果相同(都归 400),
 * 故这里不重复判 —— 归一由公共 `upstreamError` 按状态做。
 */
function errorMessage(status: number, payload: unknown, bodyKind: ResponseBodyKind): string {
  if (bodyKind === 'empty') return `notion request failed with ${status}`
  if (bodyKind === 'invalid-json' || bodyKind === 'text') {
    return nonEmpty(payload) ?? `notion request failed with ${status}`
  }
  const parsed = record(payload)
  return nonEmpty(parsed?.message)
    ?? nonEmpty(parsed?.error)
    ?? JSON.stringify(payload)
    ?? `notion request failed with ${status}`
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<Json> {
  const hasBody = input.body !== undefined
  const { data } = await http.request({
    path: input.path,
    method: input.method ?? 'GET',
    // filter_properties[] 靠**重复同名参数**表达;空数组在调用处就丢掉了。
    query: Object.entries(input.query ?? {}) satisfies ProviderQuery,
    headers: {
      'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
      'notion-version': NOTION_VERSION,
    },
    ...(hasBody ? { json: input.body } : {}),
    invalidJsonMessage: 'Notion 返回了非 JSON 响应',
    mapError: ({ bodyKind, data: payload, status }) => upstreamError(
      status,
      errorMessage(status, payload, bodyKind),
    ),
  })
  // 空响应体归一成 `{}`(上游 `payload ?? {}`):DELETE 之类的端点可能什么都不回。
  if (data === undefined) return {}
  const result = record(data)
  if (result === undefined) {
    throw new TBError('unavailable', 'Notion 返回的不是 JSON 对象', { retryable: true })
  }
  return result
}

/** 分页参数在 6 个 action 上是同一对键。 */
function pageQuery(input: { pageSize?: number, startCursor?: string }): Record<string, QueryValue> {
  return { page_size: input.pageSize, start_cursor: nonEmpty(input.startCursor) }
}

/** Notion 的 title property 值:一条纯文本 rich text。 */
function titleProperty(title: string): Json {
  return { title: [{ type: 'text', text: { content: title } }] }
}

function isSamePageParent(parent: Json, parentId: string): boolean {
  return typeof parent.page_id === 'string' && parent.page_id === parentId
}

/**
 * `create_page` 的三条互斥入参路径,以及它们之间的冲突组合。这段是本 provider 最容易迁丢的
 * 逻辑,消息与上游逐字一致:
 * - 官方 `parent` 对象:此时 `title` 不许用(要走 `properties`),`parentId` 若同时给了必须指同一个页面;
 * - 简化写法 `parentId` + `title`:两者必须成对;
 * - 纯 `markdown`:可以什么父级都不给(建在集成的默认位置),但不能与 `children` 同用。
 */
function createPageBody(input: z.infer<typeof createPageInput>): Json {
  const parent = record(input.parent)
  const parentId = nonEmpty(input.parentId)
  const children = array(input.children)
  const nonEmptyChildren = children !== undefined && children.length > 0 ? children : undefined
  const markdown = typeof input.markdown === 'string' ? input.markdown : undefined
  const icon = record(input.icon)
  const cover = record(input.cover)
  const template = record(input.template)
  const properties = record(input.properties)

  if (markdown !== undefined && nonEmptyChildren !== undefined) {
    throw inputError('markdown cannot be used with children')
  }

  if (parent !== undefined) {
    if (typeof input.title === 'string') {
      throw inputError('title cannot be used with parent; use properties instead')
    }
    if (parentId !== undefined && !isSamePageParent(parent, parentId)) {
      throw inputError('parent and parentId must describe the same page parent')
    }
    return compact({ parent, properties, children: nonEmptyChildren, markdown, template, icon, cover })
  }

  const title = nonEmpty(input.title)
  if (parentId === undefined && markdown === undefined) {
    throw inputError('parent, parentId + title, or markdown is required')
  }
  if (parentId !== undefined && title === undefined) {
    throw inputError('title is required with parentId')
  }

  return compact({
    parent: parentId === undefined ? undefined : { page_id: parentId },
    properties: title === undefined ? properties : { ...properties, title: titleProperty(title) },
    children: nonEmptyChildren,
    markdown,
    template,
    icon,
    cover,
  })
}

export function search(input: z.infer<typeof searchInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, {
    method: 'POST',
    path: '/search',
    // query 恒发(上游 `String(input.query)`),空串在 Notion 侧就是"列出全部可见对象"。
    body: compact({
      query: String(input.query),
      filter: record(input.filter),
      sort: record(input.sort),
      page_size: input.pageSize,
      start_cursor: nonEmpty(input.startCursor),
    }),
  })
}

export function retrievePage(input: z.infer<typeof retrievePageInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { path: `/pages/${encodeURIComponent(input.pageId)}` })
}

export function listBlockChildren(
  input: z.infer<typeof listBlockChildrenInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    path: `/blocks/${encodeURIComponent(input.blockId)}/children`,
    query: pageQuery(input),
  })
}

/** 聚合 action:页面本体与一级子块并发取(上游 `Promise.all`)。 */
export async function getPage(input: z.infer<typeof getPageInput>, ctx: ProviderContext): Promise<Json> {
  const [page, blockChildren] = await Promise.all([
    retrievePage({ pageId: input.pageId }, ctx),
    listBlockChildren({ blockId: input.pageId }, ctx),
  ])
  return { page, block_children: blockChildren }
}

export function retrievePageMarkdown(
  input: z.infer<typeof retrievePageMarkdownInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    path: `/pages/${encodeURIComponent(input.pageId)}/markdown`,
    // 布尔值发成字符串(上游如此);未给时不发这个参数。
    query: {
      include_transcript: typeof input.includeTranscript === 'boolean' ? String(input.includeTranscript) : undefined,
    },
  })
}

export function updatePageMarkdown(
  input: z.infer<typeof updatePageMarkdownInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    method: 'PATCH',
    path: `/pages/${encodeURIComponent(input.pageId)}/markdown`,
    body: compact({
      type: nonEmpty(input.type),
      insert_content: record(input.insert_content),
      replace_content_range: record(input.replace_content_range),
      update_content: record(input.update_content),
      replace_content: record(input.replace_content),
    }),
  })
}

export function retrievePageProperty(
  input: z.infer<typeof retrievePagePropertyInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    path: `/pages/${encodeURIComponent(input.pageId)}/properties/${encodeURIComponent(input.propertyId)}`,
    query: pageQuery(input),
  })
}

export function createPage(input: z.infer<typeof createPageInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { method: 'POST', path: '/pages', body: createPageBody(input) })
}

export function updatePage(input: z.infer<typeof updatePageInput>, ctx: ProviderContext): Promise<Json> {
  const properties = record(input.properties)
  return request(ctx, {
    method: 'PATCH',
    path: `/pages/${encodeURIComponent(input.pageId)}`,
    body: compact({
      // 简化写法:给了 title 就把它并进 properties(上游如此,与 create_page 不同 ——
      // 这里 title 与 parent 不冲突)。
      properties: typeof input.title === 'string'
        ? { ...properties, title: titleProperty(input.title) }
        : properties,
      icon: record(input.icon),
      cover: record(input.cover),
      template: record(input.template),
      in_trash: bool(input.in_trash),
      is_locked: bool(input.is_locked),
      erase_content: bool(input.erase_content),
    }),
  })
}

export function movePage(input: z.infer<typeof movePageInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, {
    method: 'POST',
    path: `/pages/${encodeURIComponent(input.pageId)}/move`,
    body: { parent: record(input.parent) },
  })
}

export function appendBlockChildren(
  input: z.infer<typeof appendBlockChildrenInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    method: 'PATCH',
    path: `/blocks/${encodeURIComponent(input.blockId)}/children`,
    // children 缺失时发空数组(上游如此,让 Notion 自己报 validation_error)。
    body: compact({ children: array(input.children) ?? [], position: record(input.position) }),
  })
}

/** `append_block_children` 的糖:把一段纯文本包成 paragraph 块。 */
export function appendBlock(input: z.infer<typeof appendBlockInput>, ctx: ProviderContext): Promise<Json> {
  return appendBlockChildren({
    blockId: input.pageId,
    children: [{
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: String(input.text) } }] },
    }],
  }, ctx)
}

export function retrieveBlock(input: z.infer<typeof retrieveBlockInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { path: `/blocks/${encodeURIComponent(input.blockId)}` })
}

export function updateBlock(input: z.infer<typeof updateBlockInput>, ctx: ProviderContext): Promise<Json> {
  const { blockId, ...rest } = input
  return request(ctx, {
    method: 'PATCH',
    path: `/blocks/${encodeURIComponent(blockId)}`,
    // 入参是 looseObject:除 blockId 外的字段原样进 body(块字段随块类型变化,枚举不完)。
    body: compact({ ...rest, in_trash: bool(rest.in_trash) }),
  })
}

export function deleteBlock(input: z.infer<typeof deleteBlockInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { method: 'DELETE', path: `/blocks/${encodeURIComponent(input.blockId)}` })
}

export function listUsers(input: z.infer<typeof listUsersInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { path: '/users', query: pageQuery(input) })
}

export function retrieveUser(input: z.infer<typeof retrieveUserInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { path: `/users/${encodeURIComponent(input.userId)}` })
}

export function createDatabase(input: z.infer<typeof createDatabaseInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, {
    method: 'POST',
    path: '/databases',
    body: compact({
      parent: record(input.parent),
      title: array(input.title),
      description: array(input.description),
      is_inline: bool(input.is_inline),
      initial_data_source: record(input.initial_data_source),
      icon: record(input.icon),
      cover: record(input.cover),
    }),
  })
}

export function retrieveDatabase(
  input: z.infer<typeof retrieveDatabaseInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, { path: `/databases/${encodeURIComponent(input.databaseId)}` })
}

export function updateDatabase(input: z.infer<typeof updateDatabaseInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, {
    method: 'PATCH',
    path: `/databases/${encodeURIComponent(input.databaseId)}`,
    body: compact({
      parent: record(input.parent),
      title: array(input.title),
      description: array(input.description),
      is_inline: bool(input.is_inline),
      icon: record(input.icon),
      cover: record(input.cover),
      in_trash: bool(input.in_trash),
      is_locked: bool(input.is_locked),
    }),
  })
}

export function createDataSource(
  input: z.infer<typeof createDataSourceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    method: 'POST',
    path: '/data_sources',
    body: compact({
      parent: record(input.parent),
      properties: record(input.properties),
      title: array(input.title),
      icon: record(input.icon),
    }),
  })
}

export function retrieveDataSource(
  input: z.infer<typeof retrieveDataSourceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, { path: `/data_sources/${encodeURIComponent(input.dataSourceId)}` })
}

export function updateDataSource(
  input: z.infer<typeof updateDataSourceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    method: 'PATCH',
    path: `/data_sources/${encodeURIComponent(input.dataSourceId)}`,
    body: compact({
      title: array(input.title),
      description: array(input.description),
      icon: record(input.icon),
      properties: record(input.properties),
      in_trash: bool(input.in_trash),
      parent: record(input.parent),
    }),
  })
}

export function queryDataSource(input: z.infer<typeof queryDataSourceInput>, ctx: ProviderContext): Promise<Json> {
  const filterProperties = (input.filterProperties ?? []).filter(item => item.length > 0)
  return request(ctx, {
    method: 'POST',
    path: `/data_sources/${encodeURIComponent(input.dataSourceId)}/query`,
    // 参数名带方括号,且是重复的同名参数;空数组不发(上游 `compactQuery`)。
    query: { 'filter_properties[]': filterProperties.length > 0 ? filterProperties : undefined },
    body: compact({
      filter: record(input.filter),
      sorts: array(input.sorts),
      page_size: input.pageSize,
      start_cursor: nonEmpty(input.startCursor),
      in_trash: bool(input.in_trash),
      result_type: nonEmpty(input.result_type),
    }),
  })
}

export function listDataSourceTemplates(
  input: z.infer<typeof listDataSourceTemplatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    path: `/data_sources/${encodeURIComponent(input.dataSourceId)}/templates`,
    query: pageQuery(input),
  })
}
