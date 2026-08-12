/**
 * Outline 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/outline/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。凭证在 **Authorization 头**,不进 URL。
 *
 * Outline 既有云端也有**自建实例**,故 API base 可配。上游把 `baseUrl` 放在 api_key 的
 * `extraFields`(非 secret),这里落在 **`providerConfig`(`ctx.config.baseUrl`)** —— 按
 * 四条凭证通道的分界,base URL override 不是密钥,不该占 secret 通道。缺省走云端。
 *
 * 六个 action 是同一形状的 POST:路径就是 Outline 的 RPC 名(`collections.list` 之类),
 * 参数全在 JSON body 上,响应从 `data` 里取再按 outputSchema 裁剪。
 * 四处上游细节决定了这里的形状:
 * - **`baseUrl` 要归一**:去掉 query/hash/末尾斜杠,不以 `/api` 结尾就补上 —— 用户多半会
 *   照着浏览器地址栏填 `https://wiki.example.com`,少了 `/api` 每个请求都 404。
 * - **必填断言不能只靠 Zod**:`query` / `id` / `shareId` 声明成 `min(1)`,但纯空白串能过
 *   `min(1)`,上游用 `optionalString` 统一去空白后再判,故这层必须保留。
 * - **`get_document` 的二选一**:refine 在 schema 层拦掉两个都不给的情形,但**去空白后**
 *   才知道 `id: '  '` 其实等于没给,故运行期还要再判一次。
 * - **`statusFilter` 逐项去空白**,滤空后为空数组则整个参数不发(空数组打过去会被 Outline
 *   当成"过滤到零个状态",结果集直接空掉)。
 *
 * 与上游的有意偏离:
 * - 上游把 404/422 压成 400、把 403 压成 401、把其余非 2xx 压成 502。这里把原始状态原样
 *   交给 `upstreamError`(404 仍是 not_found、403 仍是 permission_denied),收敛各 provider
 *   互不相同的错误口径正是 `_runtime/upstreamError.ts` 存在的理由。
 * - 上游的 `phase: 'validate'` 分支只服务 `credentialValidators`,平台侧的 credentialProbe
 *   自己做这层分账,故不迁。
 * - 不发 `user-agent`:上游那个值标识的是 open-connector 进程,在这里已无意义。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getCollectionInput,
  listCollectionDocumentsInput,
  listCollectionsInput,
  listDocumentsInput,
  searchDocumentsInput,
} from './schema'
import type { getDocumentInput } from './schema.handwritten'
import { assertPublicHttpUrl, guardedFetch } from '../_runtime/guardedFetch'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'outline'
/** 没配 `providerConfig.baseUrl` 时的云端地址。 */
const CLOUD_API_BASE = 'https://app.getoutline.com/api'

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString` 的等价物:非字符串、或去空白后为空,都算缺失。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `nullableString`:`null` 是"上游明确说这里没有",与"字段缺席"不是一回事。 */
function nullableText(value: unknown): string | null | undefined {
  return value === null ? null : text(value)
}

function nullableBoolean(value: unknown): boolean | null | undefined {
  if (value === null) return null
  return typeof value === 'boolean' ? value : undefined
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

/** 丢掉值为 undefined 的键(上游 `compactObject`);`null` 要留住。 */
function compact(input: Record<string, unknown>): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/** 上游回的形状不符合契约 —— 是上游的问题,不是调用方的错。 */
function responseError(message: string): TBError {
  return new TBError('unavailable', message, { retryable: true })
}

/** 配置错误(providerConfig.baseUrl 不合规):调用方要改配置,重试没有意义。 */
function configError(message: string): TBError {
  return new TBError('invalid_argument', `${SERVICE} 的 baseUrl ${message}`)
}

/**
 * 归一挂载配置里的 API base。
 *
 * 强制 https 是上游的规矩,这里保留:Outline 的 API key 走 Authorization 头,明文 http 会把
 * 它暴露在链路上。自建实例若只有内网地址,`assertPublicHttpUrl` 会拒 —— 插件与网关同进程,
 * 放行等于把网关变成打内网的跳板(SSRF)。
 */
function resolveApiBase(ctx: ProviderContext): string {
  const configured = ctx.config?.baseUrl
  if (configured !== undefined && typeof configured !== 'string') {
    throw configError('必须是字符串')
  }
  const candidate = text(configured) ?? CLOUD_API_BASE

  let url: URL
  try {
    url = assertPublicHttpUrl(candidate)
  } catch (error) {
    const detail = error instanceof Error ? error.message : '不可用'
    throw configError(
      `不可用(${detail})。自建 Outline 必须是**公网可达**的 https 地址:`
      + '插件与网关同进程,指向内网或保留地址会被出站校验拒绝',
    )
  }
  if (url.protocol !== 'https:') throw configError('必须用 https')

  url.search = ''
  url.hash = ''
  const path = url.pathname.replace(/\/+$/, '')
  const normalized = `${url.origin}${path}`
  // 用户多半照着浏览器地址栏填 `https://wiki.example.com`,少了 `/api` 每个请求都 404。
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`
}

/** Outline 的错误消息在 `message` / `error` / `status` 三处之一。 */
function errorMessage(status: number, payload: unknown): string {
  const body = record(payload)
  return text(body?.message)
    ?? text(body?.error)
    ?? text(body?.status)
    ?? `outline request failed with status ${status}`
}

async function request(ctx: ProviderContext, path: string, body: Json = {}): Promise<unknown> {
  // 取凭证与解析 baseUrl 放在 try 外:它们抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)
  const apiBase = resolveApiBase(ctx)

  let response: Response
  try {
    response = await guardedFetch(`${apiBase}/${path}`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障。
    if (error instanceof TBError) throw error
    const message = error instanceof Error ? error.message : 'unknown network error'
    throw upstreamError(502, `outline ${path} failed before receiving response: ${message}`)
  }

  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw)
    } catch {
      // 2xx 上回非 JSON 只能是上游坏了;错误响应上回 HTML 错误页却很常见,那时把原文当消息
      // 比报"响应不是 JSON"有用得多(自建实例前面挂反代时尤其常见)。
      if (response.ok) throw responseError('outline 返回了非 JSON 响应')
      payload = { message: raw.trim() }
    }
  }
  if (!response.ok) throw upstreamError(response.status, errorMessage(response.status, payload))
  return payload
}

/** Outline 把结果统一裹在 `data` 里;没有这层就说明响应不是它该有的形状。 */
function readData(payload: unknown): unknown {
  const body = record(payload)
  if (body === undefined || !('data' in body)) {
    throw responseError('outline 响应里没有 data')
  }
  return body.data
}

function requireObject(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw responseError(`outline ${label} 不是对象`)
  return result
}

function requireObjectArray(value: unknown, label: string): Json[] {
  if (!Array.isArray(value)) throw responseError(`outline ${label} 不是数组`)
  return value.map((item, index) => requireObject(item, `${label}[${index}]`))
}

function requireText(value: unknown, label: string): string {
  const result = text(value)
  if (result === undefined) throw responseError(`outline 响应里没有 ${label}`)
  return result
}

/** 入参里的必填串:纯空白能过 Zod 的 `min(1)`,但对 Outline 等于没给。 */
function requireInputText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} is required.`)
  return result
}

/** 逐项去空白后丢空;全空则整个参数不发(空数组会被 Outline 当成"过滤到零个状态")。 */
function statusFilter(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map(item => text(item)).filter((item): item is string => item !== undefined)
  return items.length > 0 ? items : undefined
}

function normalizeSort(value: unknown): { direction: string, field: string } | undefined {
  const sort = record(value)
  if (sort === undefined) return undefined
  const field = text(sort.field)
  const direction = text(sort.direction)
  // 两个都齐才算一份可用的排序元数据,缺一个就整份丢掉(上游同样口径)。
  if (field === undefined || direction === undefined) return undefined
  return { field, direction }
}

function normalizeCollection(input: Json): Json {
  return compact({
    id: requireText(input.id, 'collection.id'),
    urlId: nullableText(input.urlId),
    name: requireText(input.name, 'collection.name'),
    description: nullableText(input.description),
    sort: normalizeSort(input.sort),
    index: nullableText(input.index),
    color: nullableText(input.color),
    icon: nullableText(input.icon),
    permission: nullableText(input.permission),
    sharing: nullableBoolean(input.sharing),
    createdAt: nullableText(input.createdAt),
    updatedAt: nullableText(input.updatedAt),
    archivedAt: nullableText(input.archivedAt),
    deletedAt: nullableText(input.deletedAt),
    // 裁剪掉的字段仍从 raw 里可得:Outline 各版本的字段集不一样,裁死会让自建实例丢东西。
    raw: input,
  })
}

function normalizeUser(value: unknown): Json | undefined {
  const user = record(value)
  if (user === undefined) return undefined
  const id = text(user.id)
  const name = text(user.name)
  // id 与 name 都没有的"用户"没有任何标识价值,整份丢掉。
  if (id === undefined && name === undefined) return undefined
  return compact({
    id,
    name,
    avatarUrl: nullableText(user.avatarUrl),
    email: nullableText(user.email),
    role: nullableText(user.role),
    isSuspended: nullableBoolean(user.isSuspended),
    lastActiveAt: nullableText(user.lastActiveAt),
    createdAt: nullableText(user.createdAt),
  })
}

function normalizeDataAttributes(value: unknown): Json[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .map(item => record(item))
    .filter((item): item is Json => item !== undefined)
    .map(item => compact({
      dataAttributeId: requireText(item.dataAttributeId, 'document.dataAttributes[].dataAttributeId'),
      value: item.value,
      updatedAt: nullableText(item.updatedAt),
    }))
}

function normalizeDocument(input: Json): Json {
  return compact({
    id: requireText(input.id, 'document.id'),
    collectionId: nullableText(input.collectionId),
    parentDocumentId: nullableText(input.parentDocumentId),
    title: requireText(input.title, 'document.title'),
    fullWidth: nullableBoolean(input.fullWidth),
    emoji: nullableText(input.emoji),
    text: nullableText(input.text),
    urlId: nullableText(input.urlId),
    pinned: nullableBoolean(input.pinned),
    templateId: nullableText(input.templateId),
    revision: integer(input.revision),
    createdAt: nullableText(input.createdAt),
    createdBy: normalizeUser(input.createdBy),
    updatedAt: nullableText(input.updatedAt),
    updatedBy: normalizeUser(input.updatedBy),
    publishedAt: nullableText(input.publishedAt),
    dataAttributes: normalizeDataAttributes(input.dataAttributes),
    archivedAt: nullableText(input.archivedAt),
    deletedAt: nullableText(input.deletedAt),
    raw: input,
  })
}

/**
 * `pagination` 是 outputSchema 里的必填字段,而 Outline 在结果不满一页时会整个略掉它,
 * 故缺省补 0(上游同样口径)。声明里 `limit` 标了 `min(1)`,补出来的 0 与之不合 ——
 * 这是上游自己的代码与声明打架,改声明会让等价闸门判不过,故保留并在此点明。
 */
function normalizePagination(payload: unknown): { limit: number, offset: number } {
  const pagination = record(record(payload)?.pagination)
  return {
    offset: integer(pagination?.offset) ?? 0,
    limit: integer(pagination?.limit) ?? 0,
  }
}

interface NavigationNode {
  children: NavigationNode[]
  id: string
  title: string
  url: string
}

function normalizeNavigationNode(input: Json, label: string): NavigationNode {
  return {
    id: requireText(input.id, `${label}.id`),
    title: requireText(input.title, `${label}.title`),
    url: requireText(input.url, `${label}.url`),
    children: Array.isArray(input.children)
      ? input.children
          .map(child => record(child))
          .filter((child): child is Json => child !== undefined)
          .map(child => normalizeNavigationNode(child, `${label}.children[]`))
      : [],
  }
}

export async function listCollections(
  input: z.infer<typeof listCollectionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, 'collections.list', compact({
    query: text(input.query),
    statusFilter: statusFilter(input.statusFilter),
    sort: text(input.sort),
    direction: text(input.direction),
    offset: integer(input.offset),
    limit: integer(input.limit),
  }))
  return {
    collections: requireObjectArray(readData(payload), 'collections.list.data').map(normalizeCollection),
    pagination: normalizePagination(payload),
  }
}

export async function getCollection(
  input: z.infer<typeof getCollectionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, 'collections.info', { id: requireInputText(input.id, 'id') })
  return { collection: normalizeCollection(requireObject(readData(payload), 'collections.info.data')) }
}

export async function listCollectionDocuments(
  input: z.infer<typeof listCollectionDocumentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, 'collections.documents', { id: requireInputText(input.id, 'id') })
  return {
    tree: requireObjectArray(readData(payload), 'collections.documents.data')
      .map(item => normalizeNavigationNode(item, 'tree[]')),
  }
}

export async function listDocuments(
  input: z.infer<typeof listDocumentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, 'documents.list', compact({
    offset: integer(input.offset),
    limit: integer(input.limit),
    sort: text(input.sort),
    direction: text(input.direction),
    collectionId: text(input.collectionId),
    userId: text(input.userId),
    backlinkDocumentId: text(input.backlinkDocumentId),
    parentDocumentId: text(input.parentDocumentId),
    statusFilter: statusFilter(input.statusFilter),
  }))
  return {
    documents: requireObjectArray(readData(payload), 'documents.list.data').map(normalizeDocument),
    pagination: normalizePagination(payload),
  }
}

export async function searchDocuments(
  input: z.infer<typeof searchDocumentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, 'documents.search', compact({
    query: requireInputText(input.query, 'query'),
    offset: integer(input.offset),
    limit: integer(input.limit),
    userId: text(input.userId),
    collectionId: text(input.collectionId),
    documentId: text(input.documentId),
    statusFilter: statusFilter(input.statusFilter),
    dateFilter: text(input.dateFilter),
    shareId: text(input.shareId),
    snippetMinWords: integer(input.snippetMinWords),
    snippetMaxWords: integer(input.snippetMaxWords),
    sort: text(input.sort),
    direction: text(input.direction),
  }))
  return {
    documents: requireObjectArray(readData(payload), 'documents.search.data').map(normalizeDocument),
    pagination: normalizePagination(payload),
  }
}

export async function getDocument(
  input: z.infer<typeof getDocumentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const id = text(input.id)
  const shareId = text(input.shareId)
  // schema 的 refine 只看"键在不在",`id: '   '` 能过它但对 Outline 等于没给,故再判一次。
  if (id === undefined && shareId === undefined) {
    throw new TBError('invalid_argument', 'Provide at least one of id or shareId.')
  }

  const payload = await request(ctx, 'documents.info', compact({ id, shareId }))
  return { document: normalizeDocument(requireObject(readData(payload), 'documents.info.data')) }
}
