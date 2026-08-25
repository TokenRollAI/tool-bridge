/**
 * Grafana 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/grafana/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。凭证走 **header**(`authorization: Bearer <service account token>`),
 * 不进 URL。
 *
 * Grafana 既有 Grafana Cloud 也有**自建实例**,没有可兜底的公共地址,故实例根地址是**必配项**。
 * 上游把 `baseUrl` 放在 api_key 的 `extraFields`(`required: true`、`secret: false`),这里落在
 * **`providerConfig`(`ctx.config.baseUrl`)** —— 按四条凭证通道的分界,base URL override 不是
 * 密钥,不该占 secret 通道(与 `outline` 同一处理,区别只在 Grafana 没有云端缺省值)。
 *
 * 五处上游细节决定了这里的形状:
 * - **folders / dashboards 走 App Platform API,版本必须协商出来**:`dashboard.grafana.app`
 *   在 Grafana 12.1 上服务 v1beta1/v0alpha1/v2alpha1、12.4 上多一个 v2beta1、13.0 才有 v1。
 *   写死版本号会在别的小版本上收到 Kubernetes 风格的 404("the server could not find the
 *   requested resource")。故先 `GET /apis/<group>` 问一遍服务端服务哪些版本,按
 *   v1 → v1beta1 → v0alpha1 取第一个命中的;**只认 v1 血统**,v2 是另一套资源 schema,不能混用。
 *   协商结果按 `baseUrl|group` 缓存(进程内,LRU 上限 256):否则每次 folder 调用都要多打一趟。
 *   协商失败(老实例没有这个端点)静默退回 v1 —— 探测是 best-effort,不该让业务调用失败。
 * - **datasources 与告警走的是老 REST API(`/api/...`)**,它不随版本漂移,所以这几个 action
 *   不参与版本协商。这条分界是上游有意为之,照抄。
 *   `search_dashboards` 同样走 `/api/search`(不是 App Platform)。
 * - **父子关系用 annotation 表达**:folder 的 `parentUid`、dashboard 的 `folderUid` 都写进
 *   `metadata.annotations['grafana.app/folder']`,不是顶层字段。
 * - **`/api/search` 的多值参数靠重复同名 query 表达**(`tag` / `dashboardUIDs` / `folderUIDs`),
 *   不能拼成逗号串;逐项去空白后丢空。
 * - **一批 action 的必填字段在上游 schema 里没标 required**(`get/update/delete_data_source`
 *   的 `uid`、`create/update_data_source` 的 `dataSource`),runtime 里却有断言。schema.ts 忠实
 *   反映上游,必填断言保留在这层并抛 `invalid_argument`。
 *
 * 与上游的有意偏离:
 * - 上游 `createGrafanaError` 把 404/409/412/422 一律压成 400、把 5xx 压成 502。这里把原始状态
 *   交给 `upstreamError`(404 仍是 not_found、409 仍是 conflict),收敛各 provider 互不相同的
 *   错误口径正是 `_runtime/upstreamError.ts` 存在的理由。412 仍归 invalid_argument ——
 *   Grafana 用它表达 resourceVersion 冲突,调用方要做的是重取再改,与参数写错同类。
 * - 上游的 `phase: 'validate'` 分支只服务 `credentialValidators`(把 401/403 说成 400)。
 *   平台侧的 credentialProbe 自己做这层分账,故不迁。
 * - 上游还导出一个 `proxy`(把任意 `/api/*` 透传给实例)。tool-bridge 没有"任意透传"这一档
 *   ——那等于把整个 Grafana API 交给 agent,绕过 effect 标注与出参裁剪,故不迁。
 * - 不发 `user-agent`:上游那个值标识的是 open-connector 进程,在这里已无意义。
 * - 上游按超时/`AbortError` 把传输失败分成 504/502;本地没有 signal 可传,那条分支不可达,
 *   故只保留 502。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createDashboardInput,
  createDataSourceInput,
  createFolderInput,
  deleteDashboardInput,
  deleteDataSourceInput,
  deleteFolderInput,
  getAlertRuleInput,
  getDashboardInput,
  getDataSourceInput,
  getFolderInput,
  listAlertInstancesInput,
  listAlertRulesInput,
  listContactPointsInput,
  listDataSourcesInput,
  listFoldersInput,
  searchDashboardsInput,
  updateDashboardInput,
  updateDataSourceInput,
  updateFolderInput,
} from './schema'
import {
  booleanValue as boolean,
  compactDefined as compact,
  integerValue as integer,
  asJsonObject as record,
  trimmedText as text,
} from '../_runtime/jsonValue'
import { createProviderHttpClient, type ProviderQuery } from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { assertPublicHttpUrl } from '../_runtime/guardedFetch'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'grafana'
/** 不给 `namespace` 时用的组织命名空间(单组织实例就是这个)。 */
const DEFAULT_NAMESPACE = 'default'
/** 父 folder 挂在这个 annotation 上,不是顶层字段。 */
const FOLDER_PARENT_ANNOTATION = 'grafana.app/folder'
/** 协商不出版本时的退路(最新的 v1 血统)。 */
const DEFAULT_API_VERSION = 'v1'
/** 只认 v1 血统:v2 是另一套资源 schema,不能与这里的 metadata/spec 形状互换。 */
const API_VERSION_PREFERENCE: readonly string[] = [DEFAULT_API_VERSION, 'v1beta1', 'v0alpha1']
const API_GROUPS = {
  dashboards: 'dashboard.grafana.app',
  folders: 'folder.grafana.app',
} as const
const API_VERSION_CACHE_MAX = 256
const http = createProviderHttpClient({ service: SERVICE })

type AppResource = keyof typeof API_GROUPS
type Json = Record<string, unknown>
type Method = 'DELETE' | 'GET' | 'POST' | 'PUT'
type QueryValue = boolean | number | string | undefined

/**
 * `baseUrl|group` → 服务端服务的版本。进程内缓存:插件与网关同进程,这张表跨请求活着,
 * 于是每个租户每个资源组只协商一次。键里带 baseUrl 是必须的 —— 不同实例的 Grafana 版本不同。
 */
const apiVersionCache = new Map<string, string>()

/** 这次调用要打的实例与用的凭证。 */
interface Target {
  apiKey: string
  baseUrl: string
}

/** 上游 `requireString`:schema 没标 required(或 `min(1)` 放过纯空白)的字段,断言落在这层。 */
function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} is required`)
  return result
}

/** 上游 `requireObject`:`dataSource` / `spec` 在 schema 里是 optional,必填断言落在这层。 */
function requireObject(value: unknown, field: string): Json {
  const object = record(value)
  if (object === undefined) throw new TBError('invalid_argument', `${field} object is required`)
  return object
}

/** 只保留对象项(上游 `objectArrayOrEmpty`);不是数组就当空列表。 */
function objectArray(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const fields = record(item)
    return fields === undefined ? [] : [fields]
  })
}

/** 多值 query 的取值:逐项去空白、丢空(上游 `stringArray`)。 */
function stringArray(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined
  return value.flatMap((item) => {
    const trimmed = text(item)
    return trimmed === undefined ? [] : [trimmed]
  })
}

/** 配置错误(providerConfig.baseUrl 不合规):调用方要改配置,重试没有意义。 */
function configError(message: string): TBError {
  return new TBError('invalid_argument', `${SERVICE} 的 baseUrl ${message}`)
}

/**
 * 归一挂载配置里的实例地址。
 *
 * 强制 https 是上游的规矩,这里保留:service account token 走 Authorization 头,明文 http
 * 会把它暴露在链路上。自建实例若只有内网地址,`assertPublicHttpUrl` 会拒 —— 插件与网关
 * 同进程,放行等于把网关变成打内网的跳板(SSRF)。消息里写清这一点,否则用户只看到
 * "指向私有或保留地址"会以为是自己填错了格式。
 */
function resolveBaseUrl(ctx: ProviderContext): string {
  const configured = ctx.config?.baseUrl
  if (configured !== undefined && typeof configured !== 'string') throw configError('必须是字符串')
  const candidate = text(configured)
  if (candidate === undefined) {
    throw configError(
      '是必配项:给挂载节点配 providerConfig.baseUrl 指向你的 Grafana 实例'
      + '(如 https://your-stack.grafana.net)。Grafana 没有公共缺省地址,拿不到它无法出站',
    )
  }

  let url: URL
  try {
    url = assertPublicHttpUrl(candidate)
  } catch (error) {
    const detail = error instanceof Error ? error.message : '不可用'
    throw configError(
      `不可用(${detail})。自建 Grafana 必须是**公网可达**的 https 地址:`
      + '插件与网关同进程,指向内网或保留地址会被出站校验拒绝',
    )
  }
  if (url.protocol !== 'https:') throw configError('必须用 https')

  url.search = ''
  url.hash = ''
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

function resolveTarget(ctx: ProviderContext): Target {
  // 两者都抛配置错误,放在传输 try 外面,不该被 502 兜底吞掉。
  return { apiKey: requireApiKey(ctx, SERVICE), baseUrl: resolveBaseUrl(ctx) }
}

/** Grafana 的错误消息在 `message` / `error` / `detail` / `title` 之一,或整个体就是一段文本。 */
function errorMessage(payload: unknown, status: number, statusText: string): string {
  const direct = text(payload)
  if (direct !== undefined) return direct
  const fields = record(payload)
  const message = text(fields?.message) ?? text(fields?.error) ?? text(fields?.detail) ?? text(fields?.title)
  return message ?? text(statusText) ?? `Grafana request failed with ${status}`
}

interface RequestInput {
  body?: Json
  method: Method
  /** 重复同名参数表达的多值 query(`/api/search` 的 tag / UID 列表)。 */
  multiValueQuery?: Record<string, string[] | undefined>
  path: string
  query?: Record<string, QueryValue>
}

async function request(target: Target, input: RequestInput): Promise<unknown> {
  const query: ProviderQuery = [
    ...Object.entries(input.query ?? {}),
    ...Object.entries(input.multiValueQuery ?? {}),
  ]
  const result = await http.request({
    // 尾斜杠保住实例部署上下文路径(`/grafana`)；薄层再强制 path 不得换 origin。
    baseUrl: `${target.baseUrl}/`,
    path: input.path,
    method: input.method,
    query,
    headers: { accept: 'application/json', authorization: `Bearer ${target.apiKey}` },
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJson: 'text',
    mapError: ({ data, status, statusText }) => upstreamError(
      status,
      errorMessage(data, status, statusText),
    ),
    mapTransportError: ({ message }) => upstreamError(
      502,
      `Grafana request failed: ${message ?? 'unknown network error'}`,
    ),
  })
  return result.data === undefined ? null : result.data
}

function cacheApiVersion(key: string, version: string): void {
  apiVersionCache.delete(key)
  if (apiVersionCache.size >= API_VERSION_CACHE_MAX) {
    const oldest = apiVersionCache.keys().next().value
    if (oldest !== undefined) apiVersionCache.delete(oldest)
  }
  apiVersionCache.set(key, version)
}

/**
 * 问服务端这个资源组服务哪些版本,取偏好表里第一个命中的。
 *
 * 探测失败(端点不存在、凭证不足、实例太老)**不让业务调用失败**:退回 v1 与上游一致,
 * 真正的 404 会在随后的业务请求上以 Grafana 自己的消息报出来,比在这里编一个更准。
 */
async function resolveApiVersion(target: Target, group: string): Promise<string> {
  const key = `${target.baseUrl}|${group}`
  const cached = apiVersionCache.get(key)
  if (cached !== undefined) return cached

  try {
    const payload = await request(target, { method: 'GET', path: `/apis/${group}` })
    const served = new Set(objectArray(record(payload)?.versions)
      .map(entry => text(entry.version))
      .filter((version): version is string => version !== undefined))
    const match = API_VERSION_PREFERENCE.find(version => served.has(version))
    if (match !== undefined) {
      cacheApiVersion(key, match)
      return match
    }
  } catch {
    // best-effort,见函数注释。
  }
  return DEFAULT_API_VERSION
}

/** App Platform 的集合路径(folders / dashboards)。 */
async function appPath(target: Target, resource: AppResource, namespace: unknown): Promise<string> {
  const group = API_GROUPS[resource]
  const version = await resolveApiVersion(target, group)
  const ns = encodeURIComponent(text(namespace) ?? DEFAULT_NAMESPACE)
  return `/apis/${group}/${version}/namespaces/${ns}/${resource}`
}

/** App Platform 的单资源路径。 */
async function appResourcePath(
  target: Target,
  resource: AppResource,
  namespace: unknown,
  uid: unknown,
): Promise<string> {
  const collection = await appPath(target, resource, namespace)
  return `${collection}/${encodeURIComponent(requireText(uid, 'uid'))}`
}

/** folder / dashboard 共用的资源信封:uid 进 `metadata.name`,父级进 annotation。 */
function resourceBody(input: {
  generateName?: string
  parent?: string
  resourceVersion?: string
  spec: Json
  uid?: string
}): Json {
  return {
    metadata: compact({
      name: text(input.uid),
      generateName: text(input.generateName),
      resourceVersion: text(input.resourceVersion),
      annotations: input.parent === undefined ? undefined : { [FOLDER_PARENT_ANNOTATION]: input.parent },
    }),
    spec: input.spec,
  }
}

/**
 * folder / dashboard 的归一出参:缺失字段一律给 `null` 而不是丢键 —— 出参 schema 声明的是
 * nullable,`null` 在这里表示"Grafana 确实没给这个字段",与"我们没去取"不是一回事。
 */
function normalizeAppResource(value: unknown, parentKey: 'folderUid' | 'parentUid'): Json {
  const fields = record(value) ?? {}
  const metadata = record(fields.metadata) ?? {}
  const spec = record(fields.spec) ?? {}
  const annotations = record(metadata.annotations) ?? {}
  return {
    uid: text(metadata.name) ?? text(metadata.uid) ?? null,
    title: text(spec.title) ?? null,
    namespace: text(metadata.namespace) ?? null,
    resourceVersion: text(metadata.resourceVersion) ?? null,
    [parentKey]: text(annotations[FOLDER_PARENT_ANNOTATION]) ?? null,
    raw: fields,
  }
}

/** `/api/search` 的结果项:原样透出 + 六个常用字段补 null(上游 `normalizeSearchItem`)。 */
function normalizeSearchItem(value: Json): Json {
  return {
    ...value,
    id: integer(value.id) ?? null,
    uid: text(value.uid) ?? null,
    title: text(value.title) ?? null,
    type: text(value.type) ?? null,
    url: text(value.url) ?? null,
    isStarred: boolean(value.isStarred) ?? null,
  }
}

/** datasource:原样透出 + 八个常用字段补 null(上游 `normalizeDataSource`)。 */
function normalizeDataSource(value: unknown): Json {
  const fields = record(value) ?? {}
  return {
    ...fields,
    id: integer(fields.id) ?? null,
    uid: text(fields.uid) ?? null,
    name: text(fields.name) ?? null,
    type: text(fields.type) ?? null,
    access: text(fields.access) ?? null,
    url: text(fields.url) ?? null,
    isDefault: boolean(fields.isDefault) ?? null,
    readOnly: boolean(fields.readOnly) ?? null,
  }
}

/** 删除类 action 的统一出参:上游把响应体原样挂在 `raw`(没有体就是 null)。 */
function deleted(payload: unknown): Json {
  return { deleted: true, raw: record(payload) ?? null }
}

/** datasource 的单资源路径(老 REST API,按 uid 而不是 id)。 */
function dataSourcePath(uid: unknown): string {
  return `/api/datasources/uid/${encodeURIComponent(requireText(uid, 'uid'))}`
}

export async function listFolders(input: z.infer<typeof listFoldersInput>, ctx: ProviderContext): Promise<Json> {
  const target = resolveTarget(ctx)
  const payload = await request(target, {
    method: 'GET',
    path: await appPath(target, 'folders', input.namespace),
    // Kubernetes 风格的分页:游标叫 `continue`,入参里叫 `continueToken`。
    query: compact({ limit: input.limit, continue: text(input.continueToken) }),
  })
  const fields = record(payload) ?? {}
  return {
    folders: objectArray(fields.items).map(item => normalizeAppResource(item, 'parentUid')),
    continueToken: text(record(fields.metadata)?.continue) ?? null,
    raw: fields,
  }
}

export async function getFolder(input: z.infer<typeof getFolderInput>, ctx: ProviderContext): Promise<Json> {
  const target = resolveTarget(ctx)
  const payload = await request(target, {
    method: 'GET',
    path: await appResourcePath(target, 'folders', input.namespace, input.uid),
  })
  return { folder: normalizeAppResource(payload, 'parentUid') }
}

export async function createFolder(input: z.infer<typeof createFolderInput>, ctx: ProviderContext): Promise<Json> {
  const target = resolveTarget(ctx)
  const payload = await request(target, {
    method: 'POST',
    path: await appPath(target, 'folders', input.namespace),
    body: resourceBody({
      uid: input.uid,
      generateName: input.generateName,
      parent: text(input.parentUid),
      spec: { title: requireText(input.title, 'title') },
    }),
  })
  return { folder: normalizeAppResource(payload, 'parentUid') }
}

export async function updateFolder(input: z.infer<typeof updateFolderInput>, ctx: ProviderContext): Promise<Json> {
  const target = resolveTarget(ctx)
  const uid = requireText(input.uid, 'uid')
  const payload = await request(target, {
    method: 'PUT',
    path: await appResourcePath(target, 'folders', input.namespace, uid),
    // 更新时 `metadata.name` 必须等于路径上的 uid,故拿它当兜底值。
    body: resourceBody({
      uid,
      resourceVersion: input.resourceVersion,
      parent: text(input.parentUid),
      spec: { title: requireText(input.title, 'title') },
    }),
  })
  return { folder: normalizeAppResource(payload, 'parentUid') }
}

export async function deleteFolder(input: z.infer<typeof deleteFolderInput>, ctx: ProviderContext): Promise<Json> {
  const target = resolveTarget(ctx)
  const payload = await request(target, {
    method: 'DELETE',
    path: await appResourcePath(target, 'folders', input.namespace, input.uid),
  })
  return deleted(payload)
}

export async function searchDashboards(
  input: z.infer<typeof searchDashboardsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // `/api/search` 是老 REST API,不参与 App Platform 的版本协商。
  const payload = await request(resolveTarget(ctx), {
    method: 'GET',
    path: '/api/search',
    query: compact({
      query: text(input.query),
      type: text(input.type),
      starred: input.starred,
      limit: input.limit,
      page: input.page,
    }),
    multiValueQuery: {
      tag: stringArray(input.tags),
      dashboardUIDs: stringArray(input.dashboardUids),
      folderUIDs: stringArray(input.folderUids),
    },
  })
  const results = objectArray(payload)
  return { results: results.map(normalizeSearchItem), raw: results }
}

export async function getDashboard(input: z.infer<typeof getDashboardInput>, ctx: ProviderContext): Promise<Json> {
  const target = resolveTarget(ctx)
  const payload = await request(target, {
    method: 'GET',
    path: await appResourcePath(target, 'dashboards', input.namespace, input.uid),
  })
  return { dashboard: normalizeAppResource(payload, 'folderUid') }
}

export async function createDashboard(
  input: z.infer<typeof createDashboardInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const target = resolveTarget(ctx)
  const payload = await request(target, {
    method: 'POST',
    path: await appPath(target, 'dashboards', input.namespace),
    body: resourceBody({
      uid: input.uid,
      generateName: input.generateName,
      parent: text(input.folderUid),
      spec: requireObject(input.spec, 'spec'),
    }),
  })
  return { dashboard: normalizeAppResource(payload, 'folderUid') }
}

export async function updateDashboard(
  input: z.infer<typeof updateDashboardInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const target = resolveTarget(ctx)
  const uid = requireText(input.uid, 'uid')
  const payload = await request(target, {
    method: 'PUT',
    path: await appResourcePath(target, 'dashboards', input.namespace, uid),
    body: resourceBody({
      uid,
      resourceVersion: input.resourceVersion,
      parent: text(input.folderUid),
      spec: requireObject(input.spec, 'spec'),
    }),
  })
  return { dashboard: normalizeAppResource(payload, 'folderUid') }
}

export async function deleteDashboard(
  input: z.infer<typeof deleteDashboardInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const target = resolveTarget(ctx)
  const payload = await request(target, {
    method: 'DELETE',
    path: await appResourcePath(target, 'dashboards', input.namespace, input.uid),
  })
  return deleted(payload)
}

export async function listDataSources(
  _input: z.infer<typeof listDataSourcesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(resolveTarget(ctx), { method: 'GET', path: '/api/datasources' })
  const records = objectArray(payload)
  return { dataSources: records.map(normalizeDataSource), raw: records }
}

export async function getDataSource(input: z.infer<typeof getDataSourceInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(resolveTarget(ctx), { method: 'GET', path: dataSourcePath(input.uid) })
  return { dataSource: normalizeDataSource(payload) }
}

export async function createDataSource(
  input: z.infer<typeof createDataSourceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(resolveTarget(ctx), {
    method: 'POST',
    path: '/api/datasources',
    body: requireObject(input.dataSource, 'dataSource'),
  })
  // 创建/更新的响应把资源包在 `datasource` 里,没有信封时整个体就是资源。
  return {
    dataSource: normalizeDataSource(record(payload)?.datasource ?? payload),
    raw: record(payload) ?? {},
  }
}

export async function updateDataSource(
  input: z.infer<typeof updateDataSourceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(resolveTarget(ctx), {
    method: 'PUT',
    path: dataSourcePath(input.uid),
    body: requireObject(input.dataSource, 'dataSource'),
  })
  return {
    dataSource: normalizeDataSource(record(payload)?.datasource ?? payload),
    raw: record(payload) ?? {},
  }
}

export async function deleteDataSource(
  input: z.infer<typeof deleteDataSourceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(resolveTarget(ctx), { method: 'DELETE', path: dataSourcePath(input.uid) })
  return deleted(payload)
}

export async function listAlertRules(
  _input: z.infer<typeof listAlertRulesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(resolveTarget(ctx), { method: 'GET', path: '/api/v1/provisioning/alert-rules' })
  return { alertRules: objectArray(payload) }
}

export async function getAlertRule(input: z.infer<typeof getAlertRuleInput>, ctx: ProviderContext): Promise<Json> {
  const uid = encodeURIComponent(requireText(input.uid, 'uid'))
  const payload = await request(resolveTarget(ctx), {
    method: 'GET',
    path: `/api/v1/provisioning/alert-rules/${uid}`,
  })
  return { alertRule: record(payload) ?? {} }
}

export async function listAlertInstances(
  input: z.infer<typeof listAlertInstancesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(resolveTarget(ctx), {
    method: 'GET',
    // 内置 Alertmanager 的 v2 端点,与 App Platform 的版本协商无关。
    path: '/api/alertmanager/grafana/api/v2/alerts',
    query: compact({ active: input.active, silenced: input.silenced, inhibited: input.inhibited }),
  })
  return { alertInstances: objectArray(payload) }
}

export async function listContactPoints(
  _input: z.infer<typeof listContactPointsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(resolveTarget(ctx), { method: 'GET', path: '/api/v1/provisioning/contact-points' })
  return { contactPoints: objectArray(payload) }
}
