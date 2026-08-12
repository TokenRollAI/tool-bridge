/**
 * Metabase 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/metabase/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入),出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 凭证走 **`x-api-key` 请求头**,不进 URL。
 *
 * Metabase 是**用户自建实例**:上游把实例地址放在 api_key 的 `extraFields.instanceUrl`
 * (`required: true`、`secret: false`),这里落到 **`providerConfig`(`ctx.config.instanceUrl`)** ——
 * 按四条凭证通道的分界,实例地址是配置不是密钥,不该占 secret 通道。缺它就拒:没有默认实例
 * 可以兜底,静默落到某个地址只会变成一次莫名的 401。
 *
 * 实例地址的规范化是这层最要紧的部分(上游 `normalizeMetabaseUrls`),逐条保留:
 * - 没写 scheme 的裸主机名补 `https://`;
 * - **必须 https** —— 自建实例的 API key 走明文 HTTP 就是把凭证送出去;
 * - URL 里**不许带 userinfo**(`user:pass@host`),否则等于第二套凭证藏在配置里;
 * - 丢掉 query 与 fragment,去掉结尾斜杠;
 * - 结尾是 `/api` 的**先剥掉**再统一补 —— 上游文档两种写法都收,不剥就拼出 `/api/api/...`;
 * - 过 `assertPublicHttpUrl`:自建实例地址是租户填的,不挡就是一个现成的 SSRF 入口
 *   (出站时 `guardedFetch` 还会再逐跳校验一遍,这里挡在**配置**层是为了让错误说得清)。
 *
 * 另外三处上游细节:
 * - 入参是 camelCase,线上参数名有一批是 **kebab-case**(`canQuery` → `can-query`、
 *   `legacyMbql` → `legacy-mbql`、`personalOnly` → `personal-only` …),照抄别改。
 * - 列表端点**两种形状都要认**:裸数组,或 `{data: [...]}`(search 与部分 list 走后者);
 *   都拿不到就给空数组,而不是报错。
 * - 出参一律带 `raw`:裁剪后的字段是稳定契约,`raw` 是逃生阀,上游加字段不必等我们改代码。
 *
 * 与上游的两处有意偏离:
 * - 上游 `createMetabaseError` 把一切 4xx 压成 400、403 压成 401。这里走公共表:
 *   404 仍是 `not_found`、403 仍是 `permission_denied` —— "这个 dashboard 不存在"和
 *   "参数非法"对 agent 是两件不同的事。
 * - 不发 `user-agent`:上游那个值标识的是 open-connector 进程,在这里已无意义。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getCardInput,
  getCollectionInput,
  getDashboardInput,
  getDatabaseInput,
  listCardsInput,
  listCollectionsInput,
  listDashboardsInput,
  listDatabasesInput,
  searchInput,
} from './schema'
import { assertPublicHttpUrl, guardedFetch } from '../_runtime/guardedFetch'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'metabase'
const API_PATH_PREFIX = '/api'
const CURRENT_USER_PATH = '/user/current'

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | string[] | undefined

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function configError(message: string): TBError {
  return new TBError('invalid_argument', `${SERVICE} 的 ${message}`)
}

/**
 * 挂载配置里的实例地址 → API base(`<instance>/api`)。
 * 见文件头注释:每一条判定都对应上游 `normalizeMetabaseUrls` 的一行。
 */
function resolveApiBase(ctx: ProviderContext): string {
  const configured = ctx.config?.instanceUrl
  if (configured !== undefined && typeof configured !== 'string') {
    throw configError('instanceUrl 必须是字符串')
  }
  const raw = text(configured)
  if (raw === undefined) {
    throw configError('instanceUrl 必填:给挂载节点配 config.instanceUrl 指向你的 Metabase 实例')
  }
  // 裸主机名补 https(上游 `hasUrlScheme`);assertPublicHttpUrl 顺带挡私有/保留地址。
  const url = assertPublicHttpUrl(raw.includes('://') ? raw : `https://${raw}`)
  if (url.protocol !== 'https:') throw configError('instanceUrl 必须用 https')
  if (url.username !== '' || url.password !== '') {
    throw configError('instanceUrl 不能带用户名密码')
  }
  url.search = ''
  url.hash = ''
  let pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
  // 上游文档两种写法都收:结尾的 /api 先剥掉,下面统一补,免得拼出 /api/api。
  if (pathname.endsWith(API_PATH_PREFIX)) pathname = pathname.slice(0, -API_PATH_PREFIX.length)
  url.pathname = pathname
  const instanceUrl = url.toString().replace(/\/+$/, '')
  return `${instanceUrl}${API_PATH_PREFIX}`
}

/**
 * 路径段的必填断言 + 形状校验(上游 `toPathSegment`)。
 * 一部分 action 的 `id` 在 schema 里是 optional(忠实反映上游),但拼进 URL 前必须有值;
 * 带 `/` `?` `#` 的值会改写请求的语义,当场拒而不是转义后打过去。
 */
function pathSegment(value: number | string | undefined, field: string): string {
  const segment = value === undefined ? '' : String(value)
  if (segment === '' || segment.includes('/') || segment.includes('?') || segment.includes('#')) {
    throw new TBError('invalid_argument', `${field} 必须是一个 Metabase 路径段`)
  }
  return encodeURIComponent(segment)
}

/** 上游 `readErrorMessage`:message → error → cause,最后把 `errors` 整个序列化。 */
function errorMessage(payload: unknown, status: number): string {
  const body = record(payload)
  const errors = body?.errors
  const serialized = typeof errors === 'object' && errors !== null ? JSON.stringify(errors) : undefined
  return text(body?.message) ?? text(body?.error) ?? text(body?.cause) ?? serialized
    ?? `Metabase 返回 HTTP ${status}`
}

async function request(ctx: ProviderContext, path: string, query?: Record<string, QueryValue>): Promise<unknown> {
  // 取凭证与解配置放在 try 外:它们抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)
  const url = new URL(`${resolveApiBase(ctx)}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      // `models` 是多选,展开成重复的同名参数(拼成逗号串 Metabase 不认)。
      for (const item of value) url.searchParams.append(key, item)
      continue
    }
    url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { 'accept': 'application/json', 'x-api-key': apiKey },
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 500,
    // 把"上游不通/出网被拦"说成插件自身故障。
    if (error instanceof TBError) throw error
    throw upstreamError(502, `Metabase 请求失败:${error instanceof Error ? error.message : '未知错误'}`)
  }

  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  if (raw !== '') {
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      // 2xx 回非 JSON 只能是上游坏了;错误响应回 HTML/纯文本很常见,那时原文就是最好的消息。
      if (response.ok) throw upstreamError(502, 'Metabase 返回了非 JSON 响应')
      payload = { message: raw }
    }
  }
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return payload
}

function requireObject(payload: unknown, label: string): Json {
  const object = record(payload)
  if (object === undefined) {
    // 契约说好是对象;不是就是上游破了契约,不是调用方的错。
    throw new TBError('unavailable', `${label} 响应不是对象`, { retryable: true })
  }
  return object
}

/**
 * 列表项的两种形状:裸数组,或 `{data: [...]}`。都不是就给空数组(上游 `readListItems`)——
 * 这里**不报错**是刻意的:Metabase 的 list 端点在无权限时回的是空信封而不是 4xx。
 */
function listItems(payload: unknown): Json[] {
  const body = record(payload)
  const data = body?.data
  const candidate = Array.isArray(payload) ? payload : (Array.isArray(data) ? data : [])
  // 项不是对象时包一层,免得把裸值塞进声明成对象数组的出参里。
  return candidate.map(item => record(item) ?? { value: item })
}

/** `raw` 逃生阀:响应不是对象时(比如裸数组)包成 `{data: ...}`(上游 `toRawObject`)。 */
function rawObject(payload: unknown): Json {
  return record(payload) ?? { data: payload }
}

export async function getCurrentUser(_input: Json, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, CURRENT_USER_PATH)
  return { user: requireObject(payload, 'Metabase 用户'), raw: rawObject(payload) }
}

export async function listDatabases(input: z.infer<typeof listDatabasesInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/database', {
    'include': text(input.include),
    'include_analytics': input.includeAnalytics,
    'saved': input.saved,
    'include_editable_data_model': input.includeEditableDataModel,
    'exclude_uneditable_details': input.excludeUneditableDetails,
    'include_only_uploadable': input.includeOnlyUploadable,
    'router_database_id': input.routerDatabaseId,
    // 这两个是 kebab-case,不是 snake_case —— Metabase 的 query 参数命名不统一。
    'can-query': input.canQuery,
    'can-write-metadata': input.canWriteMetadata,
  })
  return { databases: listItems(payload), raw: rawObject(payload) }
}

export async function getDatabase(input: z.infer<typeof getDatabaseInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, `/database/${pathSegment(input.id, 'id')}`, {
    include: text(input.include),
    include_editable_data_model: input.includeEditableDataModel,
    exclude_uneditable_details: input.excludeUneditableDetails,
  })
  return { database: requireObject(payload, 'Metabase 数据库'), raw: rawObject(payload) }
}

export async function listCollections(
  input: z.infer<typeof listCollectionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/collection', {
    'archived': input.archived,
    'exclude-other-user-collections': input.excludeOtherUserCollections,
    'namespace': text(input.namespace),
    'personal-only': input.personalOnly,
  })
  return { collections: listItems(payload), raw: rawObject(payload) }
}

export async function getCollection(input: z.infer<typeof getCollectionInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, `/collection/${pathSegment(input.id, 'id')}`)
  return { collection: requireObject(payload, 'Metabase 集合'), raw: rawObject(payload) }
}

export async function listCards(input: z.infer<typeof listCardsInput>, ctx: ProviderContext): Promise<Json> {
  // 线上参数名是 `f`,不是入参里的 `filter`。
  const payload = await request(ctx, '/card', { f: text(input.filter), model_id: input.modelId })
  return { cards: listItems(payload), raw: rawObject(payload) }
}

export async function getCard(input: z.infer<typeof getCardInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, `/card/${pathSegment(input.id, 'id')}`, { 'legacy-mbql': input.legacyMbql })
  return { card: requireObject(payload, 'Metabase 卡片'), raw: rawObject(payload) }
}

export async function listDashboards(input: z.infer<typeof listDashboardsInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/dashboard', { f: text(input.filter) })
  return { dashboards: listItems(payload), raw: rawObject(payload) }
}

export async function getDashboard(input: z.infer<typeof getDashboardInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, `/dashboard/${pathSegment(input.id, 'id')}`)
  return { dashboard: requireObject(payload, 'Metabase 仪表盘'), raw: rawObject(payload) }
}

export async function search(input: z.infer<typeof searchInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/search', {
    // 线上参数名是 `q`;`collection` / `table_db_id` 也与入参名不同。
    q: text(input.query),
    context: text(input.context),
    archived: input.archived,
    collection: input.collectionId,
    table_db_id: input.tableDatabaseId,
    models: input.models,
    include_dashboard_questions: input.includeDashboardQuestions,
    include_metadata: input.includeMetadata,
  })
  return { results: listItems(payload), raw: rawObject(payload) }
}
