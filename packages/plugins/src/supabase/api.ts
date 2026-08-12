/**
 * Supabase(Management API)的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/supabase/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。凭证走 `Authorization: Bearer` 请求头,不进 URL。
 *
 * 打的是 **Management API**(`https://api.supabase.com/v1`),不是项目自己的
 * `<ref>.supabase.co` 数据面。两者的凭证完全不同:这里要的是**账号级** personal access
 * token(`sbp_...`)或 OAuth access token,而 `projectRef` 只是路径上的一段业务参数 ——
 * 一个 token 能操作它所属账号下的**所有** project,project 之间没有凭证隔离。故挂载时的
 * 最小权限只能靠 SK 的 scope 与工具白名单收,不能靠"这个凭证只属于某个 project"。
 *
 * 只迁 api_key(PAT)这条凭证路径。上游 `definition.ts` 还声明了 OAuth2(authorize/token
 * 端点 + 一串 scope),那条路径要平台的 providerOAuth 支撑;两者拿到的都是 Bearer token,
 * handler 一行都不用改(补 OAuth 时要去掉 index.ts 的 credentialProbe —— SDK 侧互斥)。
 *
 * 六处上游细节决定了这里的形状:
 * - **数组参数有两种编码**:`services`(health)是**重复的同名参数**,而 `statuses` 与
 *   `included_schemas` 是**逗号串**。写反一个上游就静默忽略掉筛选条件。
 * - **`reveal` 只在为 true 时发**:发 `reveal=false` 与不发在上游是两回事(前者会被某些
 *   端点当成显式请求),照上游只发 true。
 * - **API key 列表有两种形状**:裸数组,或 `{details: [...]}` 的信封。两种都要认。
 * - **三个端点允许空响应体**(`upsert_project_secrets` / `delete_project_secrets` /
 *   `run_read_only_query`),其余端点空体即契约破了 —— 这条区分是 `allowEmpty` 的全部意义。
 * - **删除类操作带请求体**:`delete_project_secrets` 是 `DELETE` + JSON 数组的名字表。
 * - **出参做了大量重命名与必填校验**(snake_case → camelCase、project status 归一到已知枚举、
 *   缺字段即 malformed)。这些断言留着:它们把"上游改了契约"变成一条明确的 unavailable,
 *   而不是让 agent 拿到一个缺字段的对象继续往下算。
 *
 * 与上游的三处有意偏离(都在错误归一上,理由是 tool-bridge 的七码语义):
 * - 上游把 403 与 401 都报成 401、把 404/409/422 统统压成 400。这里走公共 `upstreamError`
 *   按状态归一:404 → not_found、409 → conflict、403 → permission_denied,调用方要能区分
 *   "参数不对"、"不存在"与"没权限"。
 * - 上游对**任何**非 JSON 响应体都报 502 malformed。这里只在 2xx 上这么判;错误响应回
 *   HTML 错误页时把正文当消息、按状态归一(否则 401 的 HTML 页会变成可重试的 unavailable,
 *   而那个结果重试一万次也不会变)。
 * - `invalid_grant` 这个**稳定错误码**的特殊文案保留(它比状态更准),其余按状态走。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createProjectApiKeyInput,
  deleteProjectApiKeyInput,
  deleteProjectSecretsInput,
  generateTypescriptTypesInput,
  getEdgeFunctionInput,
  getOrganizationInput,
  getProjectApiKeyInput,
  getProjectHealthInput,
  getProjectInput,
  listAvailableRegionsInput,
  listEdgeFunctionsInput,
  listOrganizationMembersInput,
  listOrganizationProjectsInput,
  listProjectApiKeysInput,
  listProjectSecretsInput,
  listStorageBucketsInput,
  runReadOnlyQueryInput,
  updateProjectApiKeyInput,
  upsertProjectSecretsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'supabase'
const API_BASE = 'https://api.supabase.com/v1'

/** project 状态的已知取值;上游出现新状态时归一成 UNKNOWN 而不是原样透出。 */
const PROJECT_STATUSES = new Set([
  'ACTIVE_HEALTHY',
  'ACTIVE_UNHEALTHY',
  'COMING_UP',
  'GOING_DOWN',
  'INACTIVE',
  'INIT_FAILED',
  'REMOVED',
  'RESTARTING',
  'UNKNOWN',
  'UPGRADING',
  'PAUSING',
  'RESTORING',
  'RESTORE_FAILED',
  'PAUSE_FAILED',
  'RESIZING',
])
const API_KEY_TYPES = new Set(['legacy', 'publishable', 'secret', 'unknown'])

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | string[] | undefined

interface RequestInput {
  /** 允许空响应体(上游 `responseMode: 'optional_json'`);其余端点空体即契约破了。 */
  allowEmpty?: boolean
  body?: unknown
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST'
  path: string
  query?: Record<string, QueryValue>
}

/** 上游 `optionalString`:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `nullableString`:`null` 与"没有值"是两回事,前者要留住。 */
function nullableText(value: unknown): string | null | undefined {
  return value === null ? null : text(value)
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 丢掉值为 undefined 的键(上游 `compactObject` / `jsonObject`);`null` 要留住。 */
function compact(input: Record<string, unknown>): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/** 上游 `providerInputError`:调用方给的参数不对。 */
function inputError(message: string): TBError {
  return new TBError('invalid_argument', message)
}

/**
 * 上游 `providerMalformedError`:响应不符契约。归 unavailable + retryable ——
 * 这是上游的问题,不是调用方的错,且下一次调用可能就正常了。
 */
function malformed(message: string): TBError {
  return new TBError('unavailable', `malformed supabase response: ${message}`, { retryable: true })
}

function requireInputText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw inputError(`${field} is required.`)
  return result
}

function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw malformed(`missing ${label}`)
  return result
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw malformed(`malformed supabase ${label} response`)
  return value
}

function requireField(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw malformed(`missing ${field}`)
  return result
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw malformed(`missing ${field}`)
  return value
}

/** 上游 `readNumber`:数字串也认(上游的 pagination 偶尔回字符串)。 */
function requireNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) throw malformed(`missing ${field}`)
  return parsed
}

/** Supabase 的错误文案:message / msg / error_description;`invalid_grant` 有专门的文案。 */
function errorMessage(status: number, payload: unknown): string {
  const detail = record(payload)
  if (detail === undefined) return `supabase request failed with ${status}`
  const code = text(detail.code) ?? text(detail.error)
  if (code === 'invalid_grant') return 'supabase grant is invalid or expired'
  return text(detail.message)
    ?? text(detail.msg)
    ?? text(detail.error_description)
    ?? `supabase request failed with ${status}`
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const url = new URL(`${API_BASE}${input.path}`)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      // health 的 services 靠**重复同名参数**表达;statuses 那种逗号串在调用处就拼好了。
      for (const item of value) url.searchParams.append(key, item)
      continue
    }
    url.searchParams.set(key, String(value))
  }

  const hasBody = input.body !== undefined
  const response = await guardedFetch(url.toString(), {
    method: input.method ?? 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(input.body) : undefined,
  })

  const raw = await response.text()
  let payload: unknown
  if (raw.trim() === '') {
    payload = null
  } else {
    try {
      payload = JSON.parse(raw)
    } catch {
      // 2xx 上回非 JSON 只能是上游坏了;错误响应回 HTML 错误页很常见,那时把正文当消息、
      // 按 HTTP 状态归一 —— 否则 401 的错误页会变成可重试的 unavailable。
      if (response.ok) throw malformed('malformed supabase json response')
      payload = { message: raw }
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(response.status, payload))
  if (payload === null && input.allowEmpty !== true) throw malformed('empty body')
  return payload
}

function normalizeProjectStatus(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return PROJECT_STATUSES.has(value) ? value : 'UNKNOWN'
}

function normalizeApiKeyType(value: string): string {
  return API_KEY_TYPES.has(value) ? value : 'unknown'
}

function normalizeOrganization(payload: unknown): Json {
  const item = requireRecord(payload, 'organization')
  return {
    id: requireField(item.id, 'organization.id'),
    name: requireField(item.name, 'organization.name'),
    slug: nullableText(item.slug),
  }
}

function normalizeOrganizationDetail(payload: unknown): Json {
  const item = requireRecord(payload, 'organization')
  return compact({
    ...item,
    id: requireField(item.id, 'organization.id'),
    name: requireField(item.name, 'organization.name'),
    plan: text(item.plan),
  })
}

function normalizeOrganizationMember(payload: unknown): Json {
  const item = requireRecord(payload, 'member')
  return compact({
    ...item,
    userId: requireField(item.user_id, 'member.user_id'),
    userName: requireField(item.user_name, 'member.user_name'),
    email: text(item.email),
    roleName: requireField(item.role_name, 'member.role_name'),
    mfaEnabled: requireBoolean(item.mfa_enabled, 'member.mfa_enabled'),
  })
}

function normalizeOrganizationProject(payload: unknown): Json {
  const item = requireRecord(payload, 'organization project')
  return compact({
    ...item,
    ref: requireField(item.ref, 'organizationProject.ref'),
    name: requireField(item.name, 'organizationProject.name'),
    cloudProvider: text(item.cloud_provider),
    region: requireField(item.region, 'organizationProject.region'),
    isBranch: typeof item.is_branch === 'boolean' ? item.is_branch : undefined,
    status: normalizeProjectStatus(requireField(item.status, 'organizationProject.status')) ?? 'UNKNOWN',
    insertedAt: text(item.inserted_at),
    databases: Array.isArray(item.databases)
      ? item.databases.map(entry => requireRecord(entry, 'database'))
      : undefined,
  })
}

function normalizePagination(payload: unknown): Json {
  const item = requireRecord(payload, 'pagination')
  return {
    count: requireNumber(item.count, 'pagination.count'),
    limit: requireNumber(item.limit, 'pagination.limit'),
    offset: requireNumber(item.offset, 'pagination.offset'),
  }
}

/** list 类出参的 database 是"有就裁剪、没有就整块不给";detail 的则是必填。 */
function normalizeProjectDatabaseSummary(payload: unknown): Json | undefined {
  if (payload === undefined || payload === null) return undefined
  const item = requireRecord(payload, 'project.database')
  return compact({
    host: text(item.host),
    version: text(item.version),
    postgresEngine: nullableText(item.postgres_engine),
    releaseChannel: nullableText(item.release_channel),
  })
}

function normalizeProjectDatabaseDetail(payload: unknown): Json {
  const item = requireRecord(payload, 'project.database')
  return {
    host: requireField(item.host, 'project.database.host'),
    version: requireField(item.version, 'project.database.version'),
    postgresEngine: nullableText(item.postgres_engine),
    releaseChannel: nullableText(item.release_channel),
  }
}

function normalizeProjectSummary(payload: unknown): Json {
  const item = requireRecord(payload, 'project')
  return {
    id: requireField(item.id, 'project.id'),
    organizationId: requireField(item.organization_id, 'project.organization_id'),
    name: requireField(item.name, 'project.name'),
    region: requireField(item.region, 'project.region'),
    status: normalizeProjectStatus(text(item.status)),
    createdAt: requireField(item.created_at, 'project.created_at'),
    database: normalizeProjectDatabaseSummary(item.database),
  }
}

function normalizeProjectDetail(payload: unknown): Json {
  const item = requireRecord(payload, 'project')
  return {
    id: requireField(item.id, 'project.id'),
    ref: requireField(item.ref, 'project.ref'),
    organizationId: requireField(item.organization_id, 'project.organization_id'),
    organizationSlug: requireField(item.organization_slug, 'project.organization_slug'),
    name: requireField(item.name, 'project.name'),
    region: requireField(item.region, 'project.region'),
    status: normalizeProjectStatus(requireField(item.status, 'project.status')) ?? 'UNKNOWN',
    createdAt: requireField(item.created_at, 'project.created_at'),
    database: normalizeProjectDatabaseDetail(item.database),
  }
}

function normalizeApiKey(payload: unknown): Json {
  const item = requireRecord(payload, 'api key')
  return compact({
    id: requireField(item.id, 'apiKey.id'),
    name: requireField(item.name, 'apiKey.name'),
    type: normalizeApiKeyType(requireField(item.type, 'apiKey.type')),
    prefix: requireField(item.prefix, 'apiKey.prefix'),
    hash: requireField(item.hash, 'apiKey.hash'),
    description: nullableText(item.description),
    apiKey: text(item.api_key),
    insertedAt: text(item.inserted_at),
    updatedAt: text(item.updated_at),
    secretJwtTemplate: item.secret_jwt_template === null ? null : record(item.secret_jwt_template),
  })
}

/** API key 列表两种形状都认:裸数组,或 `{details: [...]}` 的信封。 */
function normalizeApiKeyList(payload: unknown): Json[] {
  if (Array.isArray(payload)) return payload.map(item => normalizeApiKey(item))
  const item = requireRecord(payload, 'api keys')
  if (!Array.isArray(item.details)) throw malformed('malformed supabase api key list response')
  return item.details.map(entry => normalizeApiKey(entry))
}

function normalizeSecret(payload: unknown): Json {
  const item = requireRecord(payload, 'secret')
  return compact({
    name: requireField(item.name, 'secret.name'),
    value: text(item.value),
    updatedAt: text(item.updated_at),
  })
}

function normalizeHealthService(payload: unknown): Json {
  const item = requireRecord(payload, 'health')
  return compact({
    ...item,
    name: requireField(item.name, 'health.name'),
    healthy: requireBoolean(item.healthy, 'health.healthy'),
    status: requireField(item.status, 'health.status'),
    error: text(item.error),
    info: item.info === null ? null : record(item.info),
  })
}

function normalizeRecordList(payload: unknown, label: string): Json[] {
  return requireArray(payload, label).map(entry => requireRecord(entry, label))
}

/** 上游 `normalizeSecretInputList`:入参校验(Zod 已挡住大半,断言留着兜底非串值)。 */
function secretInputList(payload: unknown): Array<{ name: string, value: string }> {
  if (!Array.isArray(payload)) throw inputError('supabase secrets input must be an array')
  return payload.map((entry) => {
    const item = record(entry)
    if (item === undefined) throw inputError('secret is required.')
    return {
      name: requireInputText(item.name, 'secret.name'),
      value: requireInputText(item.value, 'secret.value'),
    }
  })
}

/** `reveal` 只在为 true 时发 —— 发 `reveal=false` 与不发在上游不等价。 */
function revealFlag(value: unknown): true | undefined {
  return value === true ? true : undefined
}

export async function listOrganizations(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { path: '/organizations' })
  return {
    organizations: requireArray(payload, 'organizations').map(item => normalizeOrganization(item)),
  }
}

export async function getOrganization(
  input: z.infer<typeof getOrganizationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const slug = requireInputText(input.organizationSlug, 'organizationSlug')
  const payload = await request(ctx, { path: `/organizations/${encodeURIComponent(slug)}` })
  return { organization: normalizeOrganizationDetail(payload) }
}

export async function listOrganizationMembers(
  input: z.infer<typeof listOrganizationMembersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const slug = requireInputText(input.organizationSlug, 'organizationSlug')
  const payload = await request(ctx, { path: `/organizations/${encodeURIComponent(slug)}/members` })
  return {
    members: requireArray(payload, 'organization members').map(item => normalizeOrganizationMember(item)),
  }
}

export async function listOrganizationProjects(
  input: z.infer<typeof listOrganizationProjectsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const slug = requireInputText(input.organizationSlug, 'organizationSlug')
  const payload = await request(ctx, {
    path: `/organizations/${encodeURIComponent(slug)}/projects`,
    query: {
      offset: input.offset,
      limit: input.limit,
      search: text(input.search),
      sort: text(input.sort),
      // statuses 是**逗号串**(不像 services 那样重复同名参数)。
      statuses: input.statuses === undefined ? undefined : input.statuses.join(','),
    },
  })

  const body = requireRecord(payload, 'organization projects')
  return {
    projects: requireArray(body.projects, 'organization projects')
      .map(entry => normalizeOrganizationProject(entry)),
    pagination: normalizePagination(body.pagination),
  }
}

export async function listProjects(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { path: '/projects' })
  return { projects: requireArray(payload, 'projects').map(item => normalizeProjectSummary(item)) }
}

export async function getProject(input: z.infer<typeof getProjectInput>, ctx: ProviderContext): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  return { project: normalizeProjectDetail(await request(ctx, { path: `/projects/${encodeURIComponent(ref)}` })) }
}

export async function listAvailableRegions(
  input: z.infer<typeof listAvailableRegionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/projects/available-regions',
    query: {
      organization_slug: text(input.organizationSlug),
      continent: text(input.continent),
      desired_instance_size: text(input.desiredInstanceSize),
    },
  })
  return { regions: requireRecord(payload, 'regions') }
}

export async function getProjectHealth(
  input: z.infer<typeof getProjectHealthInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  const payload = await request(ctx, {
    path: `/projects/${encodeURIComponent(ref)}/health`,
    query: {
      // services 是**重复的同名参数**,不是逗号串。
      services: input.services,
      timeout_ms: input.timeoutMs,
    },
  })
  return {
    services: requireArray(payload, 'project health').map(item => normalizeHealthService(item)),
  }
}

export async function listProjectApiKeys(
  input: z.infer<typeof listProjectApiKeysInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  const payload = await request(ctx, {
    path: `/projects/${encodeURIComponent(ref)}/api-keys`,
    query: { reveal: revealFlag(input.reveal) },
  })
  return { apiKeys: normalizeApiKeyList(payload) }
}

export async function getProjectApiKey(
  input: z.infer<typeof getProjectApiKeyInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  const apiKeyId = requireInputText(input.apiKeyId, 'apiKeyId')
  const payload = await request(ctx, {
    path: `/projects/${encodeURIComponent(ref)}/api-keys/${encodeURIComponent(apiKeyId)}`,
    query: { reveal: revealFlag(input.reveal) },
  })
  return { apiKey: normalizeApiKey(payload) }
}

export async function createProjectApiKey(
  input: z.infer<typeof createProjectApiKeyInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  const type = text(input.type)
  // 只有 secret 类型的 key 认 JWT 模板;别的类型带上它上游会静默忽略,先在本层拒。
  if (input.secretJwtTemplate !== undefined && type !== 'secret') {
    throw inputError('secretJwtTemplate is only supported for secret API keys')
  }

  const payload = await request(ctx, {
    method: 'POST',
    path: `/projects/${encodeURIComponent(ref)}/api-keys`,
    query: { reveal: revealFlag(input.reveal) },
    body: compact({
      name: text(input.name),
      type,
      // description 不去空白:上游用 optionalRawString 原样发(空串是合法的"没有描述")。
      description: typeof input.description === 'string' ? input.description : undefined,
      secret_jwt_template: record(input.secretJwtTemplate),
    }),
  })
  return { apiKey: normalizeApiKey(payload) }
}

export async function updateProjectApiKey(
  input: z.infer<typeof updateProjectApiKeyInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  const apiKeyId = requireInputText(input.apiKeyId, 'apiKeyId')
  if (input.name === undefined && input.description === undefined && input.secretJwtTemplate === undefined) {
    throw inputError('Provide at least one field to update: name, description, or secretJwtTemplate.')
  }

  const payload = await request(ctx, {
    method: 'PATCH',
    path: `/projects/${encodeURIComponent(ref)}/api-keys/${encodeURIComponent(apiKeyId)}`,
    query: { reveal: revealFlag(input.reveal) },
    // description 与 secret_jwt_template 是三态字段:未给不改、null 清空、有值改成它。
    body: compact({
      name: text(input.name),
      description: typeof input.description === 'string' || input.description === null
        ? input.description
        : undefined,
      secret_jwt_template: input.secretJwtTemplate === null ? null : record(input.secretJwtTemplate),
    }),
  })
  return { apiKey: normalizeApiKey(payload) }
}

export async function deleteProjectApiKey(
  input: z.infer<typeof deleteProjectApiKeyInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  const apiKeyId = requireInputText(input.apiKeyId, 'apiKeyId')
  const payload = await request(ctx, {
    method: 'DELETE',
    path: `/projects/${encodeURIComponent(ref)}/api-keys/${encodeURIComponent(apiKeyId)}`,
    query: {
      reveal: revealFlag(input.reveal),
      was_compromised: input.wasCompromised,
      reason: text(input.reason),
    },
  })
  return { apiKey: normalizeApiKey(payload) }
}

export async function listProjectSecrets(
  input: z.infer<typeof listProjectSecretsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  const payload = await request(ctx, { path: `/projects/${encodeURIComponent(ref)}/secrets` })
  return { secrets: requireArray(payload, 'secrets').map(item => normalizeSecret(item)) }
}

export async function upsertProjectSecrets(
  input: z.infer<typeof upsertProjectSecretsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  await request(ctx, {
    method: 'POST',
    path: `/projects/${encodeURIComponent(ref)}/secrets`,
    // 请求体是**数组**(不是对象信封),且上游对这个端点允许空响应体。
    body: secretInputList(input.secrets),
    allowEmpty: true,
  })
  return { success: true }
}

export async function deleteProjectSecrets(
  input: z.infer<typeof deleteProjectSecretsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  if (!Array.isArray(input.names)) throw inputError('names must be an array')
  await request(ctx, {
    method: 'DELETE',
    path: `/projects/${encodeURIComponent(ref)}/secrets`,
    // DELETE **带请求体**:要删的名字表是一个 JSON 数组。
    body: input.names.map(name => String(name)),
    allowEmpty: true,
  })
  return { success: true }
}

export async function generateTypescriptTypes(
  input: z.infer<typeof generateTypescriptTypesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  const payload = await request(ctx, {
    path: `/projects/${encodeURIComponent(ref)}/types/typescript`,
    // included_schemas 是**逗号串**。
    query: {
      included_schemas: input.includedSchemas === undefined ? undefined : input.includedSchemas.join(','),
    },
  })
  return {
    typescript: requireField(requireRecord(payload, 'typescript').types, 'typescript.types'),
  }
}

export async function runReadOnlyQuery(
  input: z.infer<typeof runReadOnlyQueryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  const result = await request(ctx, {
    method: 'POST',
    path: `/projects/${encodeURIComponent(ref)}/database/query/read-only`,
    body: compact({
      // SQL 不去空白:缩进与换行是语义的一部分(上游 optionalRawString)。
      query: typeof input.query === 'string' ? input.query : undefined,
      parameters: Array.isArray(input.parameters) ? input.parameters : undefined,
    }),
    allowEmpty: true,
  })
  // 空响应体(没有结果集的语句)归一成 null,不是省略键。
  return { result: result ?? null }
}

export async function listStorageBuckets(
  input: z.infer<typeof listStorageBucketsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  const payload = await request(ctx, { path: `/projects/${encodeURIComponent(ref)}/storage/buckets` })
  return { buckets: normalizeRecordList(payload, 'storage buckets') }
}

export async function listEdgeFunctions(
  input: z.infer<typeof listEdgeFunctionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  const payload = await request(ctx, { path: `/projects/${encodeURIComponent(ref)}/functions` })
  return { functions: normalizeRecordList(payload, 'edge functions') }
}

export async function getEdgeFunction(
  input: z.infer<typeof getEdgeFunctionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireInputText(input.projectRef, 'projectRef')
  const slug = requireInputText(input.functionSlug, 'functionSlug')
  const payload = await request(ctx, {
    path: `/projects/${encodeURIComponent(ref)}/functions/${encodeURIComponent(slug)}`,
  })
  return { function: requireRecord(payload, 'edge function') }
}
