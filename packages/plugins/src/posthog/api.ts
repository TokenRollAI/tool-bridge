/**
 * PostHog 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/posthog/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。凭证走 `authorization: Bearer`,不进 URL。
 *
 * 57 个 action 是同一形状的 REST 调用,五处上游细节决定了这里的形状:
 * - **baseUrl 是每挂载配置**。PostHog 有 US/EU 两朵云和自托管域名,上游把它放在 api_key
 *   凭证的 `extraFields` 里。它不是密钥,故落到 `providerConfig.baseUrl`(`ctx.config`);
 *   缺了就当场拒 —— 替调用方猜一个区域会静默打到错误的云,拿到的是"这个 project 不存在"。
 * - **organization_id 三级回退**:入参 → `providerConfig.organizationId` → 现调
 *   `/api/users/@me/` 推断(只在用户有 current organization、或只属于一个组织时推得出来)。
 *   只有 `list_projects` / `get_project` 走这条,其余 action 由入参的 `project_id` 定位。
 * - **删除多数是软删除**:annotation / cohort / dashboard / feature_flag 的"删除"是
 *   `PATCH {deleted:true}`,不是 `DELETE`。只有 event/property definition 与 insight 是真
 *   `DELETE`。迁错方向要么删不掉、要么 405。
 * - **dashboard 族走 `/api/environments/{project_id}/`**,其余走 `/api/projects/{project_id}/`
 *   —— 同一个 project_id,两个路径前缀。
 * - **34.3% 的 action 在 schema 里没有 `required`**(见迁移指南),但 executor 里有必填断言。
 *   schema 忠实反映上游,必填断言保留在这里抛 `invalid_argument`。
 *
 * 与上游的有意偏离(两处,都在错误归一上):
 * - 上游对多数按 id 取的 action 设了 `notFoundAsInvalidInput`,把 404 压成 400。这里交给公共
 *   `upstreamError` 归成 `not_found` —— 迁移的目的之一就是让 1300 个 provider 的错误语义一致,
 *   而"资源不存在"本来就有专码,压成 invalid_argument 只是上游当年没有这个码。
 * - 上游的 `mode: 'validate' | 'execute'` 让凭证校验路径把 401 报成 400。tool-bridge 的
 *   credentialProbe 由平台负责分账(见 `app/src/toolNodes.ts` 的 `probePluginCredential`),
 *   插件这层不再区分,401 一律 `permission_denied`。
 *
 * 不发 `user-agent`:上游那个值(`oomol-connect/0.1`)标识的是 open-connector 进程,在这里已无意义。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  addDashboardCollaboratorInput,
  addPersonsToStaticCohortInput,
  bulkUpdateEventDefinitionTagsInput,
  bulkUpdatePropertyDefinitionTagsInput,
  cancelQueryInput,
  copyDashboardTileInput,
  createAnnotationInput,
  createCohortInput,
  createDashboardInput,
  createEventDefinitionInput,
  createFeatureFlagInput,
  createInsightInput,
  deleteAnnotationInput,
  deleteCohortInput,
  deleteDashboardInput,
  deleteEventDefinitionInput,
  deleteFeatureFlagInput,
  deleteInsightInput,
  deletePropertyDefinitionInput,
  getAnnotationInput,
  getAsyncQueryStatusInput,
  getCohortCalculationHistoryInput,
  getCohortInput,
  getCohortPersonsInput,
  getCurrentUserInput,
  getDashboardInput,
  getEventDefinitionByNameInput,
  getEventDefinitionInput,
  getEventDefinitionPrimaryPropertiesInput,
  getFeatureFlagDependentFlagsInput,
  getFeatureFlagInput,
  getFeatureFlagsLocalEvaluationInput,
  getFeatureFlagStatusInput,
  getInsightInput,
  getProjectInput,
  getPropertyDefinitionInput,
  listAnnotationsInput,
  listCohortsInput,
  listDashboardCollaboratorsInput,
  listDashboardsInput,
  listEventDefinitionsInput,
  listFeatureFlagsInput,
  listInsightsInput,
  listProjectsInput,
  listPropertyDefinitionsInput,
  moveDashboardTileInput,
  removeDashboardCollaboratorInput,
  reorderDashboardTilesInput,
  runDashboardInsightsInput,
  runQueryInput,
  updateAnnotationInput,
  updateCohortInput,
  updateDashboardInput,
  updateEventDefinitionInput,
  updateFeatureFlagInput,
  updateInsightInput,
  updatePropertyDefinitionInput,
} from './schema'
import {
  createProviderHttpClient,
  type ProviderQuery,
  type ResponseBodyKind,
} from '../_runtime/providerHttp'
import { booleanValue as bool, compactDefined as compact } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { assertPublicHttpUrl } from '../_runtime/guardedFetch'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'posthog'
/** 当前用户接口;既是 `get_current_user`,也是 organization_id 推断与凭证探针的落点。 */
const CURRENT_USER_PATH = '/api/users/@me/'
const http = createProviderHttpClient({ service: SERVICE })

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | null | undefined
/** schema 里 id 类字段统一是 `string | number` 的 union(上游路径两种都收)。 */
type PathValue = number | string | undefined

interface RequestOptions {
  body?: unknown
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST'
  path: string
  query?: Record<string, QueryValue>
}

// ---------- 响应端的取值(上游数据不可信,逐字段收) ----------

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/** `null` 与"字段缺席"是两回事:前者是上游明确置空,要原样透出。 */
function nullableStr(value: unknown): string | null | undefined {
  return value === null ? null : str(value)
}

function nullableNum(value: unknown): number | null | undefined {
  return value === null ? null : num(value)
}

function nullableBool(value: unknown): boolean | null | undefined {
  return value === null ? null : bool(value)
}

function nullableRecord(value: unknown): Json | null | undefined {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Json
}

/** 拿不到对象就当空对象:整形函数要能在残缺响应上继续走完。 */
function looseRecord(value: unknown): Json {
  return nullableRecord(value) ?? {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringList(value: unknown): string[] {
  return list(value).filter((item): item is string => typeof item === 'string')
}

/** 与 `stringList` 的区别:字段缺席时返回 undefined 而非 `[]`,写入体里靠这个区分"不改"。 */
function stringListOrUndefined(value: unknown): string[] | undefined {
  return Array.isArray(value) ? stringList(value) : undefined
}

function numberList(value: unknown): number[] {
  return list(value).filter((item): item is number => typeof item === 'number')
}

/** 上游 id 既可能是字符串也可能是数字,统一成字符串。 */
function looseId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

// ---------- 入参端的断言(schema 说 optional,executor 说必填的那一批) ----------

/** 路径段:数字转字符串,字符串去空白;拿不到值返回 undefined。 */
function optionalSegment(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }
  return undefined
}

function segment(value: PathValue, field: string): string {
  const normalized = optionalSegment(value)
  if (normalized === undefined) throw new TBError('invalid_argument', `${field} 是必填`)
  return normalized
}

/** `person_ids` 这类"schema 说可选、上游要求非空"的数组。 */
function requireNonEmptyStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new TBError('invalid_argument', `${field} 必须是非空数组`)
  const items = value.filter((item): item is string => typeof item === 'string' && item !== '')
  if (items.length === 0) throw new TBError('invalid_argument', `${field} 必须是非空数组`)
  return items
}

/** `names` 走逗号串而不是重复参数(PostHog 的 primary_properties 接口这么收)。 */
function joinStrings(value: unknown): string | undefined {
  const items = stringList(value)
  return items.length > 0 ? items.join(',') : undefined
}

/** 对象型 query 参数要序列化成 JSON 串塞进 query string。 */
function stringifyQuery(value: unknown): string | undefined {
  const object = nullableRecord(value)
  // null 与非对象一样不发:PostHog 的 override 参数没有"置空"语义。
  if (object === null || object === undefined) return undefined
  return JSON.stringify(object)
}

// ---------- 配置、凭证与出站 ----------

/**
 * 每挂载的 baseUrl。上游把它放在凭证的 extraFields 里,这里走 `providerConfig` ——
 * 它是区域/域名,不是密钥,不该占 SecretStore 的通道。
 *
 * 校验照抄上游 `normalizePosthogBaseUrl`:必须 https、不能带 userinfo、去掉尾部斜杠。
 * userinfo 那条不是洁癖 —— `https://user:pass@host` 会把凭证塞进出站 URL。
 */
function resolveBaseUrl(ctx: ProviderContext): string {
  const raw = str(ctx.config?.baseUrl)?.trim()
  if (raw === undefined || raw === '') {
    throw new TBError(
      'invalid_argument',
      `${SERVICE} 需要挂载配置 providerConfig.baseUrl(如 https://us.posthog.com、https://eu.posthog.com`
      + ' 或自托管域名)',
    )
  }
  // assertPublicHttpUrl 抛的 EgressBlockedError 也是 invalid_argument,语义一致,直接冒上去。
  const parsed = assertPublicHttpUrl(raw)
  if (parsed.protocol !== 'https:') {
    throw new TBError('invalid_argument', 'providerConfig.baseUrl 必须是 https')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new TBError('invalid_argument', 'providerConfig.baseUrl 不能带用户名或密码')
  }
  let path = parsed.pathname
  while (path.endsWith('/')) path = path.slice(0, -1)
  return `${parsed.origin}${path}`
}

interface Auth {
  baseUrl: string
  token: string
}

function resolveAuth(ctx: ProviderContext): Auth {
  // 先取凭证:缺 authRef 是最常见的配置错,先报它比先报 baseUrl 更指得准。
  const token = requireApiKey(ctx, SERVICE)
  return { baseUrl: resolveBaseUrl(ctx), token }
}

/**
 * PostHog 的错误体是 DRF 风格的 `{type, code, detail, attr}`。`attr` 指出是哪个字段出的问题,
 * 上游把它拼进消息尾巴 —— 那是排错时最有用的一段,保留。
 */
function posthogError(status: number, payload: unknown, fallback: string): TBError {
  const body = nullableRecord(payload)
  const detail = str(body?.detail) ?? str(body?.message) ?? fallback
  const attr = str(body?.attr)
  return upstreamError(status, attr === undefined || attr === '' ? detail : `${detail} (${attr})`)
}

function responsePayload(data: unknown, bodyKind: ResponseBodyKind): unknown {
  return bodyKind === 'json' ? data : undefined
}

async function request(ctx: ProviderContext, options: RequestOptions): Promise<unknown> {
  const auth = resolveAuth(ctx)
  const result = await http.request({
    baseUrl: `${auth.baseUrl}/`,
    path: options.path,
    method: options.method ?? 'GET',
    query: Object.entries(options.query ?? {}) satisfies ProviderQuery,
    // 迁移前 GET 也带 content-type，保留真实 wire。
    headers: { 'authorization': `Bearer ${auth.token}`, 'content-type': 'application/json' },
    ...(options.body === undefined ? {} : { json: options.body }),
    invalidJson: 'text',
    mapError: ({ bodyKind, data, status }) => posthogError(
      status,
      bodyKind === 'json' ? data : undefined,
      bodyKind === 'empty' ? `${SERVICE} 返回 HTTP ${status}` : String(data),
    ),
    mapTransportError: ({ message }) => new TBError(
      'unavailable',
      `${SERVICE} 请求失败:${message ?? 'undefined'}`,
      { retryable: true },
    ),
  })
  // 空体是正常成功形态:204 之外,PATCH/DELETE 也常回 200 空体。上游在这里落 `{}`,
  // 整形函数据此产出 `{deleted:true, ...}`,不能当成"响应不是 JSON"报故障。
  return responsePayload(result.data, result.bodyKind)
}

async function requestObject(ctx: ProviderContext, options: RequestOptions): Promise<Json> {
  return looseRecord(await request(ctx, options))
}

/** 上游说好该有 id 却没给 —— 契约破了,不是调用方的错。 */
function requireId(payload: Json, label: string): number {
  const id = num(payload.id)
  if (id === undefined) {
    throw new TBError('unavailable', `${SERVICE} 的 ${label} 响应缺 id`, { retryable: true })
  }
  return id
}

// ---------- organization_id 的三级回退 ----------

/** 当前组织:优先 `organization.id`;只属于一个组织时退回 `organizations[0].id`。 */
function currentOrganizationId(user: Json): string | undefined {
  const explicit = str(nullableRecord(user.organization)?.id)?.trim()
  if (explicit !== undefined && explicit !== '') return explicit
  const organizations = list(user.organizations)
  if (organizations.length !== 1) return undefined
  const only = str(looseRecord(organizations[0]).id)?.trim()
  return only === '' ? undefined : only
}

async function resolveOrganizationId(ctx: ProviderContext, explicit: PathValue): Promise<string> {
  const fromInput = optionalSegment(explicit)
  if (fromInput !== undefined) return fromInput

  const fromConfig = optionalSegment(ctx.config?.organizationId)
  if (fromConfig !== undefined) return fromConfig

  const user = await requestObject(ctx, { path: CURRENT_USER_PATH })
  const resolved = currentOrganizationId(user)
  if (resolved !== undefined) return resolved

  throw new TBError(
    'invalid_argument',
    'organization_id 是必填:当前凭证推断不出唯一的组织,请给入参 organization_id'
    + ' 或挂载配置 providerConfig.organizationId',
  )
}

// ---------- 写入体 ----------

function eventDefinitionBody(input: z.infer<typeof createEventDefinitionInput | typeof updateEventDefinitionInput>): Json {
  return compact({
    name: input.name,
    owner: input.owner,
    description: input.description,
    tags: input.tags,
    verified: input.verified,
    hidden: input.hidden,
    enforcement_mode: input.enforcement_mode,
    primary_property: input.primary_property,
    post_to_slack: input.post_to_slack,
    default_columns: input.default_columns,
  })
}

function propertyDefinitionBody(input: z.infer<typeof updatePropertyDefinitionInput>): Json {
  return compact({
    description: input.description,
    tags: input.tags,
    verified: input.verified,
    hidden: input.hidden,
    property_type: input.property_type,
  })
}

/**
 * 批量打标签的体**不 compact**:`ids` 与 `tags` 缺席时上游发的是 `[]` 而不是省略。
 * 这处最容易在迁移时"顺手加个 compact"改掉语义 —— 空数组对 `action:'set'` 是"清空全部标签"。
 */
function bulkUpdateTagsBody(input: z.infer<
  typeof bulkUpdateEventDefinitionTagsInput | typeof bulkUpdatePropertyDefinitionTagsInput
>): Json {
  return {
    ids: numberList(input.ids),
    action: input.action,
    tags: stringList(input.tags),
  }
}

function annotationBody(input: z.infer<typeof createAnnotationInput | typeof updateAnnotationInput>): Json {
  return compact({
    content: input.content,
    date_marker: input.date_marker,
    creation_type: input.creation_type,
    dashboard_item: input.dashboard_item,
    dashboard_id: input.dashboard_id,
    deleted: input.deleted,
    scope: input.scope,
  })
}

function cohortBody(input: z.infer<typeof createCohortInput | typeof updateCohortInput>): Json {
  return compact({
    name: input.name,
    description: input.description,
    groups: input.groups,
    deleted: input.deleted,
    filters: input.filters,
    query: input.query,
    is_static: input.is_static,
    _create_in_folder: input._create_in_folder,
    _create_static_person_ids: input._create_static_person_ids,
  })
}

function insightBody(input: z.infer<typeof createInsightInput | typeof updateInsightInput>): Json {
  return compact({
    name: input.name,
    description: input.description,
    query: input.query,
    filters: input.filters,
    dashboards: input.dashboards,
    tags: input.tags,
    refresh: input.refresh,
    saved: input.saved,
    favorited: input.favorited,
  })
}

function dashboardBody(input: z.infer<typeof createDashboardInput | typeof updateDashboardInput>): Json {
  return compact({
    name: input.name,
    description: input.description,
    pinned: input.pinned,
    deleted: input.deleted,
    breakdown_colors: input.breakdown_colors,
    data_color_theme_id: input.data_color_theme_id,
    tags: input.tags,
    restriction_level: input.restriction_level,
    quick_filter_ids: input.quick_filter_ids,
    use_template: input.use_template,
    use_dashboard: input.use_dashboard,
    delete_insights: input.delete_insights,
    _create_in_folder: input._create_in_folder,
  })
}

function featureFlagBody(input: z.infer<typeof createFeatureFlagInput | typeof updateFeatureFlagInput>): Json {
  return compact({
    key: input.key,
    name: input.name,
    filters: input.filters,
    active: input.active,
    tags: stringListOrUndefined(input.tags),
    evaluation_contexts: stringListOrUndefined(input.evaluation_contexts),
  })
}

// ---------- 响应整形 ----------

function mapAnnotation(value: unknown): Json {
  const payload = looseRecord(value)
  return {
    id: requireId(payload, 'annotation'),
    content: nullableStr(payload.content),
    date_marker: nullableStr(payload.date_marker),
    creation_type: str(payload.creation_type),
    dashboard_item: nullableNum(payload.dashboard_item),
    dashboard_id: nullableNum(payload.dashboard_id),
    dashboard_name: nullableStr(payload.dashboard_name),
    insight_short_id: nullableStr(payload.insight_short_id),
    insight_name: nullableStr(payload.insight_name),
    insight_derived_name: nullableStr(payload.insight_derived_name),
    created_by: nullableRecord(payload.created_by),
    created_at: nullableStr(payload.created_at),
    updated_at: str(payload.updated_at),
    deleted: bool(payload.deleted),
    scope: str(payload.scope),
    raw: payload,
  }
}

function mapAnnotationList(payload: Json): Json {
  const results = list(payload.results).map(item => mapAnnotation(item))
  return {
    count: num(payload.count) ?? results.length,
    next: nullableStr(payload.next),
    previous: nullableStr(payload.previous),
    results,
    raw: payload,
  }
}

function mapBulkUpdateTags(payload: Json): Json {
  return {
    updated: list(payload.updated),
    skipped: list(payload.skipped),
    raw: payload,
  }
}

function mapInsight(value: unknown): Json {
  const payload = looseRecord(value)
  return {
    id: requireId(payload, 'insight'),
    short_id: str(payload.short_id),
    name: nullableStr(payload.name),
    derived_name: nullableStr(payload.derived_name),
    query: nullableRecord(payload.query),
    order: num(payload.order),
    deleted: bool(payload.deleted),
    dashboards: list(payload.dashboards),
    dashboard_tiles: list(payload.dashboard_tiles).map(item => looseRecord(item)),
    last_refresh: nullableStr(payload.last_refresh),
    cache_target_age: nullableStr(payload.cache_target_age),
    next_allowed_client_refresh: nullableStr(payload.next_allowed_client_refresh),
    result: payload.result,
    hasMore: nullableBool(payload.hasMore),
    columns: Array.isArray(payload.columns) ? stringList(payload.columns) : undefined,
    created_at: nullableStr(payload.created_at),
    created_by: nullableRecord(payload.created_by),
    description: nullableStr(payload.description),
    updated_at: str(payload.updated_at),
    tags: list(payload.tags),
    favorited: bool(payload.favorited),
    last_modified_at: str(payload.last_modified_at),
    last_modified_by: nullableRecord(payload.last_modified_by),
    is_sample: bool(payload.is_sample),
    effective_restriction_level: num(payload.effective_restriction_level),
    effective_privilege_level: num(payload.effective_privilege_level),
    user_access_level: nullableStr(payload.user_access_level),
    timezone: nullableStr(payload.timezone),
    is_cached: bool(payload.is_cached),
    query_status: nullableRecord(payload.query_status),
    hogql: nullableStr(payload.hogql),
    types: Array.isArray(payload.types) ? payload.types : undefined,
    resolved_date_range: nullableRecord(payload.resolved_date_range),
    alerts: list(payload.alerts),
    last_viewed_at: nullableStr(payload.last_viewed_at),
    raw: payload,
  }
}

function mapDashboardBasic(payload: Json): Json {
  return {
    id: requireId(payload, 'dashboard'),
    name: nullableStr(payload.name),
    description: str(payload.description),
    pinned: bool(payload.pinned),
    created_at: str(payload.created_at),
    created_by: nullableRecord(payload.created_by),
    last_accessed_at: nullableStr(payload.last_accessed_at),
    last_viewed_at: nullableStr(payload.last_viewed_at),
    is_shared: bool(payload.is_shared),
    deleted: bool(payload.deleted),
    creation_mode: str(payload.creation_mode),
    tags: list(payload.tags),
    restriction_level: num(payload.restriction_level),
    effective_restriction_level: num(payload.effective_restriction_level),
    effective_privilege_level: num(payload.effective_privilege_level),
    user_access_level: nullableStr(payload.user_access_level),
    access_control_version: str(payload.access_control_version),
    last_refresh: nullableStr(payload.last_refresh),
    team_id: num(payload.team_id),
  }
}

/** 详情比列表项多一组字段;`tiles` 缺席时是 `null`(上游明确区分"没有 tiles"与"没请求 tiles")。 */
function mapDashboard(value: unknown): Json {
  const payload = looseRecord(value)
  return {
    ...mapDashboardBasic(payload),
    filters: nullableRecord(payload.filters),
    variables: nullableRecord(payload.variables),
    breakdown_colors: payload.breakdown_colors,
    data_color_theme_id: nullableNum(payload.data_color_theme_id),
    persisted_filters: nullableRecord(payload.persisted_filters),
    persisted_variables: nullableRecord(payload.persisted_variables),
    quick_filter_ids: Array.isArray(payload.quick_filter_ids) ? stringList(payload.quick_filter_ids) : undefined,
    tiles: Array.isArray(payload.tiles) ? payload.tiles.map(item => looseRecord(item)) : null,
    raw: payload,
  }
}

function mapDashboardCollaborator(value: unknown): Json {
  const payload = looseRecord(value)
  return {
    id: str(payload.id),
    dashboard_id: num(payload.dashboard_id),
    user: nullableRecord(payload.user) ?? {},
    level: num(payload.level),
    added_at: str(payload.added_at),
    updated_at: str(payload.updated_at),
    raw: payload,
  }
}

function mapFeatureFlag(value: unknown): Json {
  const payload = looseRecord(value)
  return {
    id: requireId(payload, 'feature flag'),
    key: str(payload.key),
    name: str(payload.name),
    active: bool(payload.active),
    filters: nullableRecord(payload.filters) ?? {},
    deleted: bool(payload.deleted),
    created_at: nullableStr(payload.created_at),
    updated_at: nullableStr(payload.updated_at),
    created_by: nullableRecord(payload.created_by),
    last_modified_by: nullableRecord(payload.last_modified_by),
    version: num(payload.version),
    ensure_experience_continuity: nullableBool(payload.ensure_experience_continuity),
    experiment_set: numberList(payload.experiment_set),
    experiment_set_metadata: list(payload.experiment_set_metadata).map(item => looseRecord(item)),
    surveys: nullableRecord(payload.surveys),
    features: nullableRecord(payload.features),
    rollback_conditions: payload.rollback_conditions,
    performed_rollback: nullableBool(payload.performed_rollback),
    can_edit: nullableBool(payload.can_edit),
    status: nullableStr(payload.status),
    evaluation_runtime: nullableStr(payload.evaluation_runtime),
    bucketing_identifier: nullableStr(payload.bucketing_identifier),
    last_called_at: nullableStr(payload.last_called_at),
    user_access_level: nullableStr(payload.user_access_level),
    rollout_percentage: nullableNum(payload.rollout_percentage),
    tags: list(payload.tags),
    evaluation_contexts: stringList(payload.evaluation_contexts),
    usage_dashboard: num(payload.usage_dashboard),
    analytics_dashboards: numberList(payload.analytics_dashboards),
    has_enriched_analytics: nullableBool(payload.has_enriched_analytics),
    is_remote_configuration: nullableBool(payload.is_remote_configuration),
    has_encrypted_payloads: nullableBool(payload.has_encrypted_payloads),
    is_used_in_replay_settings: nullableBool(payload.is_used_in_replay_settings),
    raw: payload,
  }
}

function mapFeatureFlagList(payload: Json): Json {
  const results = list(payload.results).map(item => mapFeatureFlag(item))
  return {
    count: num(payload.count) ?? results.length,
    next: nullableStr(payload.next),
    previous: nullableStr(payload.previous),
    results,
    raw: payload,
  }
}

function mapMinimalFeatureFlag(value: unknown): Json {
  const payload = looseRecord(value)
  return {
    id: requireId(payload, 'feature flag'),
    team_id: num(payload.team_id),
    name: str(payload.name),
    key: str(payload.key),
    filters: nullableRecord(payload.filters) ?? {},
    deleted: bool(payload.deleted),
    active: bool(payload.active),
    ensure_experience_continuity: nullableBool(payload.ensure_experience_continuity),
    version: num(payload.version),
    evaluation_runtime: nullableStr(payload.evaluation_runtime),
    bucketing_identifier: nullableStr(payload.bucketing_identifier),
    evaluation_contexts: stringList(payload.evaluation_contexts),
    raw: payload,
  }
}

function mapQueryStatus(payload: Json): Json {
  return {
    id: looseId(payload.id) ?? looseId(payload.query_id),
    query_status: nullableRecord(payload.query_status) ?? payload,
    complete: bool(payload.complete),
    results: Array.isArray(payload.results) ? payload.results : undefined,
    error: payload.error,
    raw: payload,
  }
}

// ---------- 用户与项目 ----------

export async function getCurrentUser(_input: z.infer<typeof getCurrentUserInput>, ctx: ProviderContext): Promise<Json> {
  return requestObject(ctx, { path: CURRENT_USER_PATH })
}

export async function listProjects(input: z.infer<typeof listProjectsInput>, ctx: ProviderContext): Promise<Json> {
  const organizationId = await resolveOrganizationId(ctx, input.organization_id)
  return requestObject(ctx, {
    path: `/api/organizations/${encodeURIComponent(organizationId)}/projects/`,
    query: { limit: input.limit, offset: input.offset, search: input.search },
  })
}

export async function getProject(input: z.infer<typeof getProjectInput>, ctx: ProviderContext): Promise<Json> {
  const organizationId = await resolveOrganizationId(ctx, input.organization_id)
  const id = segment(input.id, 'id')
  return requestObject(ctx, {
    path: `/api/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(id)}/`,
  })
}

// ---------- event definitions ----------

export async function listEventDefinitions(
  input: z.infer<typeof listEventDefinitionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  return requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/event_definitions/`,
    query: { limit: input.limit, offset: input.offset },
  })
}

export async function getEventDefinition(
  input: z.infer<typeof getEventDefinitionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/event_definitions/${encodeURIComponent(id)}/`,
  })
}

export async function createEventDefinition(
  input: z.infer<typeof createEventDefinitionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  return requestObject(ctx, {
    method: 'POST',
    path: `/api/projects/${encodeURIComponent(projectId)}/event_definitions/`,
    body: eventDefinitionBody(input),
  })
}

export async function updateEventDefinition(
  input: z.infer<typeof updateEventDefinitionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return requestObject(ctx, {
    method: 'PATCH',
    path: `/api/projects/${encodeURIComponent(projectId)}/event_definitions/${encodeURIComponent(id)}/`,
    body: eventDefinitionBody(input),
  })
}

export async function deleteEventDefinition(
  input: z.infer<typeof deleteEventDefinitionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  const payload = await requestObject(ctx, {
    method: 'DELETE',
    path: `/api/projects/${encodeURIComponent(projectId)}/event_definitions/${encodeURIComponent(id)}/`,
  })
  return { deleted: true, id, raw: payload }
}

export async function getEventDefinitionByName(
  input: z.infer<typeof getEventDefinitionByNameInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  return requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/event_definitions/by_name/`,
    query: { name: segment(input.name, 'name') },
  })
}

export async function getEventDefinitionPrimaryProperties(
  input: z.infer<typeof getEventDefinitionPrimaryPropertiesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const payload = await request(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/event_definitions/primary_properties/`,
    query: { names: joinStrings(input.names) },
  })
  return { results: nullableRecord(payload) ?? {}, raw: payload }
}

export async function bulkUpdateEventDefinitionTags(
  input: z.infer<typeof bulkUpdateEventDefinitionTagsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  return mapBulkUpdateTags(await requestObject(ctx, {
    method: 'POST',
    path: `/api/projects/${encodeURIComponent(projectId)}/event_definitions/bulk_update_tags/`,
    body: bulkUpdateTagsBody(input),
  }))
}

// ---------- property definitions ----------

export async function listPropertyDefinitions(
  input: z.infer<typeof listPropertyDefinitionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  return requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/property_definitions/`,
    query: {
      event_names: input.event_names,
      exclude_core_properties: input.exclude_core_properties,
      exclude_hidden: input.exclude_hidden,
      excluded_properties: input.excluded_properties,
      filter_by_event_names: input.filter_by_event_names,
      group_type_index: input.group_type_index,
      is_feature_flag: input.is_feature_flag,
      is_numerical: input.is_numerical,
      limit: input.limit,
      offset: input.offset,
      properties: input.properties,
      search: input.search,
      type: input.type,
      verified: input.verified,
    },
  })
}

export async function getPropertyDefinition(
  input: z.infer<typeof getPropertyDefinitionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/property_definitions/${encodeURIComponent(id)}/`,
  })
}

export async function updatePropertyDefinition(
  input: z.infer<typeof updatePropertyDefinitionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return requestObject(ctx, {
    method: 'PATCH',
    path: `/api/projects/${encodeURIComponent(projectId)}/property_definitions/${encodeURIComponent(id)}/`,
    body: propertyDefinitionBody(input),
  })
}

export async function deletePropertyDefinition(
  input: z.infer<typeof deletePropertyDefinitionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  const payload = await requestObject(ctx, {
    method: 'DELETE',
    path: `/api/projects/${encodeURIComponent(projectId)}/property_definitions/${encodeURIComponent(id)}/`,
  })
  return { deleted: true, id, raw: payload }
}

export async function bulkUpdatePropertyDefinitionTags(
  input: z.infer<typeof bulkUpdatePropertyDefinitionTagsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  return mapBulkUpdateTags(await requestObject(ctx, {
    method: 'POST',
    path: `/api/projects/${encodeURIComponent(projectId)}/property_definitions/bulk_update_tags/`,
    body: bulkUpdateTagsBody(input),
  }))
}

// ---------- annotations ----------

export async function listAnnotations(
  input: z.infer<typeof listAnnotationsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  return mapAnnotationList(await requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/annotations/`,
    query: { limit: input.limit, offset: input.offset, search: input.search },
  }))
}

export async function getAnnotation(input: z.infer<typeof getAnnotationInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return mapAnnotation(await requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/annotations/${encodeURIComponent(id)}/`,
  }))
}

export async function createAnnotation(
  input: z.infer<typeof createAnnotationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  return mapAnnotation(await requestObject(ctx, {
    method: 'POST',
    path: `/api/projects/${encodeURIComponent(projectId)}/annotations/`,
    body: annotationBody(input),
  }))
}

export async function updateAnnotation(
  input: z.infer<typeof updateAnnotationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return mapAnnotation(await requestObject(ctx, {
    method: 'PATCH',
    path: `/api/projects/${encodeURIComponent(projectId)}/annotations/${encodeURIComponent(id)}/`,
    body: annotationBody(input),
  }))
}

/** 软删除:PostHog 的官方契约是 `PATCH {deleted:true}`,没有 DELETE 端点。 */
export async function deleteAnnotation(
  input: z.infer<typeof deleteAnnotationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  const payload = await requestObject(ctx, {
    method: 'PATCH',
    path: `/api/projects/${encodeURIComponent(projectId)}/annotations/${encodeURIComponent(id)}/`,
    body: { deleted: true },
  })
  return { deleted: true, id, annotation: mapAnnotation(payload), raw: payload }
}

// ---------- cohorts ----------

export async function listCohorts(input: z.infer<typeof listCohortsInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  return requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/cohorts/`,
    query: { limit: input.limit, offset: input.offset },
  })
}

export async function getCohort(input: z.infer<typeof getCohortInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/cohorts/${encodeURIComponent(id)}/`,
  })
}

export async function createCohort(input: z.infer<typeof createCohortInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  return requestObject(ctx, {
    method: 'POST',
    path: `/api/projects/${encodeURIComponent(projectId)}/cohorts/`,
    body: cohortBody(input),
  })
}

export async function updateCohort(input: z.infer<typeof updateCohortInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return requestObject(ctx, {
    method: 'PATCH',
    path: `/api/projects/${encodeURIComponent(projectId)}/cohorts/${encodeURIComponent(id)}/`,
    body: cohortBody(input),
  })
}

/** 软删除,同 annotation。 */
export async function deleteCohort(input: z.infer<typeof deleteCohortInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  const payload = await requestObject(ctx, {
    method: 'PATCH',
    path: `/api/projects/${encodeURIComponent(projectId)}/cohorts/${encodeURIComponent(id)}/`,
    body: { deleted: true },
  })
  return { deleted: true, id, cohort: payload, raw: payload }
}

export async function addPersonsToStaticCohort(
  input: z.infer<typeof addPersonsToStaticCohortInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  const payload = await requestObject(ctx, {
    method: 'PATCH',
    path: `/api/projects/${encodeURIComponent(projectId)}/cohorts/${encodeURIComponent(id)}/add_persons_to_static_cohort/`,
    body: { person_ids: requireNonEmptyStrings(input.person_ids, 'person_ids') },
  })
  return { raw: payload }
}

export async function getCohortPersons(
  input: z.infer<typeof getCohortPersonsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  const payload = await requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/cohorts/${encodeURIComponent(id)}/persons/`,
    query: { format: input.format, limit: input.limit, offset: input.offset },
  })
  return {
    next: nullableStr(payload.next),
    previous: nullableStr(payload.previous),
    results: list(payload.results).map(item => looseRecord(item)),
    raw: payload,
  }
}

export async function getCohortCalculationHistory(
  input: z.infer<typeof getCohortCalculationHistoryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  const payload = await requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/cohorts/${encodeURIComponent(id)}/calculation_history/`,
  })
  return { raw: payload }
}

// ---------- insights 与 query ----------

export async function listInsights(input: z.infer<typeof listInsightsInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const payload = await requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/insights/`,
    query: {
      basic: input.basic,
      limit: input.limit,
      offset: input.offset,
      refresh: input.refresh,
      short_id: input.short_id,
    },
  })
  return {
    count: num(payload.count) ?? 0,
    next: nullableStr(payload.next),
    previous: nullableStr(payload.previous),
    results: list(payload.results).map(item => mapInsight(item)),
    raw: payload,
  }
}

export async function getInsight(input: z.infer<typeof getInsightInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return mapInsight(await requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/insights/${encodeURIComponent(id)}/`,
    query: { from_dashboard: input.from_dashboard, refresh: input.refresh },
  }))
}

export async function runQuery(input: z.infer<typeof runQueryInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const payload = await requestObject(ctx, {
    method: 'POST',
    path: `/api/projects/${encodeURIComponent(projectId)}/query/`,
    body: compact({
      query: input.query,
      async: input.async,
      client_query_id: input.client_query_id,
      filters_override: input.filters_override,
      limit_context: input.limit_context,
      name: input.name,
      refresh: input.refresh,
      variables_override: input.variables_override,
    }),
  })
  return {
    results: list(payload.results),
    columns: Array.isArray(payload.columns) ? stringList(payload.columns) : undefined,
    types: Array.isArray(payload.types) ? payload.types : undefined,
    hasMore: nullableBool(payload.hasMore),
    limit: num(payload.limit),
    offset: num(payload.offset),
    query: nullableRecord(payload.query),
    error: payload.error,
    is_cached: nullableBool(payload.is_cached),
    timings: list(payload.timings).map(item => looseRecord(item)),
    query_status: nullableRecord(payload.query_status),
    hogql: nullableStr(payload.hogql),
    cache_target_age: nullableStr(payload.cache_target_age),
    last_refresh: nullableStr(payload.last_refresh),
    next_allowed_client_refresh: nullableStr(payload.next_allowed_client_refresh),
    resolved_date_range: nullableRecord(payload.resolved_date_range),
    raw: payload,
  }
}

export async function getAsyncQueryStatus(
  input: z.infer<typeof getAsyncQueryStatusInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const queryId = segment(input.query_id, 'query_id')
  return mapQueryStatus(await requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/query/${encodeURIComponent(queryId)}/`,
  }))
}

export async function cancelQuery(input: z.infer<typeof cancelQueryInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const queryId = segment(input.query_id, 'query_id')
  const payload = await requestObject(ctx, {
    method: 'DELETE',
    path: `/api/projects/${encodeURIComponent(projectId)}/query/${encodeURIComponent(queryId)}/`,
  })
  return { cancelled: true, query_id: queryId, raw: payload }
}

export async function createInsight(input: z.infer<typeof createInsightInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  return mapInsight(await requestObject(ctx, {
    method: 'POST',
    path: `/api/projects/${encodeURIComponent(projectId)}/insights/`,
    body: insightBody(input),
  }))
}

export async function updateInsight(input: z.infer<typeof updateInsightInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return mapInsight(await requestObject(ctx, {
    method: 'PATCH',
    path: `/api/projects/${encodeURIComponent(projectId)}/insights/${encodeURIComponent(id)}/`,
    body: insightBody(input),
  }))
}

/** insight 是真删(DELETE),与 annotation/cohort/dashboard 的软删除不同。 */
export async function deleteInsight(input: z.infer<typeof deleteInsightInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  const payload = await requestObject(ctx, {
    method: 'DELETE',
    path: `/api/projects/${encodeURIComponent(projectId)}/insights/${encodeURIComponent(id)}/`,
  })
  return { deleted: true, id, raw: payload }
}

// ---------- dashboards(注意路径前缀是 /api/environments/) ----------

export async function listDashboards(input: z.infer<typeof listDashboardsInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const payload = await requestObject(ctx, {
    path: `/api/environments/${encodeURIComponent(projectId)}/dashboards/`,
    query: { limit: input.limit, offset: input.offset, search: input.search },
  })
  return {
    count: num(payload.count) ?? 0,
    next: nullableStr(payload.next),
    previous: nullableStr(payload.previous),
    results: list(payload.results).map(item => mapDashboardBasic(looseRecord(item))),
    raw: payload,
  }
}

export async function getDashboard(input: z.infer<typeof getDashboardInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return mapDashboard(await requestObject(ctx, {
    path: `/api/environments/${encodeURIComponent(projectId)}/dashboards/${encodeURIComponent(id)}/`,
    query: {
      filters_override: stringifyQuery(input.filters_override),
      variables_override: stringifyQuery(input.variables_override),
    },
  }))
}

export async function createDashboard(
  input: z.infer<typeof createDashboardInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  return mapDashboard(await requestObject(ctx, {
    method: 'POST',
    path: `/api/environments/${encodeURIComponent(projectId)}/dashboards/`,
    body: dashboardBody(input),
  }))
}

export async function updateDashboard(
  input: z.infer<typeof updateDashboardInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return mapDashboard(await requestObject(ctx, {
    method: 'PATCH',
    path: `/api/environments/${encodeURIComponent(projectId)}/dashboards/${encodeURIComponent(id)}/`,
    body: dashboardBody(input),
  }))
}

/** 软删除;`delete_insights` 决定是否连带删掉面板上的 insight。 */
export async function deleteDashboard(
  input: z.infer<typeof deleteDashboardInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  const payload = await requestObject(ctx, {
    method: 'PATCH',
    path: `/api/environments/${encodeURIComponent(projectId)}/dashboards/${encodeURIComponent(id)}/`,
    body: compact({ deleted: true, delete_insights: input.delete_insights }),
  })
  return { deleted: true, id, dashboard: mapDashboard(payload), raw: payload }
}

export async function runDashboardInsights(
  input: z.infer<typeof runDashboardInsightsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  const payload = await requestObject(ctx, {
    path: `/api/environments/${encodeURIComponent(projectId)}/dashboards/${encodeURIComponent(id)}/run_insights/`,
    query: {
      filters_override: stringifyQuery(input.filters_override),
      variables_override: stringifyQuery(input.variables_override),
      output_format: input.output_format,
      refresh: input.refresh,
    },
  })
  return { results: list(payload.results), raw: payload }
}

export async function copyDashboardTile(
  input: z.infer<typeof copyDashboardTileInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return mapDashboard(await requestObject(ctx, {
    method: 'POST',
    path: `/api/environments/${encodeURIComponent(projectId)}/dashboards/${encodeURIComponent(id)}/copy_tile/`,
    body: { fromDashboardId: input.fromDashboardId, tileId: input.tileId },
  }))
}

export async function moveDashboardTile(
  input: z.infer<typeof moveDashboardTileInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  const payload = await requestObject(ctx, {
    method: 'PATCH',
    path: `/api/environments/${encodeURIComponent(projectId)}/dashboards/${encodeURIComponent(id)}/move_tile/`,
    // tile 缺席时发 `{}` 而不是省略键:PostHog 的 move_tile 要求这个键存在。
    body: { tile: input.tile ?? {}, toDashboard: input.toDashboard },
  })
  return { raw: payload }
}

export async function reorderDashboardTiles(
  input: z.infer<typeof reorderDashboardTilesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return mapDashboard(await requestObject(ctx, {
    method: 'POST',
    path: `/api/environments/${encodeURIComponent(projectId)}/dashboards/${encodeURIComponent(id)}/reorder_tiles/`,
    body: { tile_order: numberList(input.tile_order) },
  }))
}

export async function listDashboardCollaborators(
  input: z.infer<typeof listDashboardCollaboratorsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const dashboardId = segment(input.dashboard_id, 'dashboard_id')
  // 这个接口回的是**裸数组**,不是分页信封。
  const payload = await request(ctx, {
    path: `/api/environments/${encodeURIComponent(projectId)}/dashboards/${encodeURIComponent(dashboardId)}/collaborators/`,
  })
  return { results: list(payload).map(item => mapDashboardCollaborator(item)), raw: payload }
}

export async function addDashboardCollaborator(
  input: z.infer<typeof addDashboardCollaboratorInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const dashboardId = segment(input.dashboard_id, 'dashboard_id')
  return mapDashboardCollaborator(await requestObject(ctx, {
    method: 'POST',
    path: `/api/environments/${encodeURIComponent(projectId)}/dashboards/${encodeURIComponent(dashboardId)}/collaborators/`,
    body: { user_uuid: segment(input.user_uuid, 'user_uuid'), level: input.level },
  }))
}

export async function removeDashboardCollaborator(
  input: z.infer<typeof removeDashboardCollaboratorInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const dashboardId = segment(input.dashboard_id, 'dashboard_id')
  const userUuid = segment(input.user_uuid, 'user_uuid')
  const payload = await requestObject(ctx, {
    method: 'DELETE',
    path: `/api/environments/${encodeURIComponent(projectId)}/dashboards/${encodeURIComponent(dashboardId)}`
      + `/collaborators/${encodeURIComponent(userUuid)}/`,
  })
  return { deleted: true, dashboard_id: dashboardId, user_uuid: userUuid, raw: payload }
}

// ---------- feature flags ----------

export async function listFeatureFlags(
  input: z.infer<typeof listFeatureFlagsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  return mapFeatureFlagList(await requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/feature_flags/`,
    query: {
      active: input.active,
      created_by_id: input.created_by_id,
      evaluation_runtime: input.evaluation_runtime,
      excluded_properties: input.excluded_properties,
      has_evaluation_contexts: input.has_evaluation_contexts,
      limit: input.limit,
      offset: input.offset,
      search: input.search,
      tags: input.tags,
      type: input.type,
    },
  }))
}

export async function getFeatureFlag(input: z.infer<typeof getFeatureFlagInput>, ctx: ProviderContext): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return mapFeatureFlag(await requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/feature_flags/${encodeURIComponent(id)}/`,
  }))
}

export async function createFeatureFlag(
  input: z.infer<typeof createFeatureFlagInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  return mapFeatureFlag(await requestObject(ctx, {
    method: 'POST',
    path: `/api/projects/${encodeURIComponent(projectId)}/feature_flags/`,
    body: featureFlagBody(input),
  }))
}

export async function updateFeatureFlag(
  input: z.infer<typeof updateFeatureFlagInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  return mapFeatureFlag(await requestObject(ctx, {
    method: 'PATCH',
    path: `/api/projects/${encodeURIComponent(projectId)}/feature_flags/${encodeURIComponent(id)}/`,
    body: featureFlagBody(input),
  }))
}

/** 软删除,同 annotation/cohort/dashboard。 */
export async function deleteFeatureFlag(
  input: z.infer<typeof deleteFeatureFlagInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  const payload = await requestObject(ctx, {
    method: 'PATCH',
    path: `/api/projects/${encodeURIComponent(projectId)}/feature_flags/${encodeURIComponent(id)}/`,
    body: { deleted: true },
  })
  return { deleted: true, id, feature_flag: mapFeatureFlag(payload), raw: payload }
}

export async function getFeatureFlagStatus(
  input: z.infer<typeof getFeatureFlagStatusInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  const payload = await requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/feature_flags/${encodeURIComponent(id)}/status/`,
  })
  return {
    status: str(payload.status),
    reason: str(payload.reason),
    active: nullableBool(payload.active),
    deleted: nullableBool(payload.deleted),
    last_called_at: nullableStr(payload.last_called_at),
    status_code: nullableNum(payload.status_code),
    raw: payload,
  }
}

export async function getFeatureFlagDependentFlags(
  input: z.infer<typeof getFeatureFlagDependentFlagsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const id = segment(input.id, 'id')
  // 同 collaborators:回的是裸数组。
  const payload = await request(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/feature_flags/${encodeURIComponent(id)}/dependent_flags/`,
  })
  return {
    results: list(payload).map((item) => {
      const flag = looseRecord(item)
      return { id: requireId(flag, 'feature flag'), key: str(flag.key), name: str(flag.name) }
    }),
    raw: Array.isArray(payload) ? payload : {},
  }
}

export async function getFeatureFlagsLocalEvaluation(
  input: z.infer<typeof getFeatureFlagsLocalEvaluationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const projectId = segment(input.project_id, 'project_id')
  const payload = await requestObject(ctx, {
    path: `/api/projects/${encodeURIComponent(projectId)}/feature_flags/local_evaluation/`,
    query: { send_cohorts: input.send_cohorts },
  })
  return {
    flags: list(payload.flags).map(item => mapMinimalFeatureFlag(item)),
    group_type_mapping: nullableRecord(payload.group_type_mapping) ?? {},
    cohorts: nullableRecord(payload.cohorts) ?? {},
    raw: payload,
  }
}
