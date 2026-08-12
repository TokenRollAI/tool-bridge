/**
 * Laravel Cloud 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/laravel_cloud/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 上游是 JSON:API:资源体是 `{id,type,attributes,relationships}`,过滤器写成
 * `filter[name]=x`,关联展开走 `include=a,b` 并回在顶层 `included` 里。归一函数把
 * `attributes` 里的 snake_case 提到 camelCase 顶层,`raw` 保留原始资源不吞信息。
 *
 * 与上游的一处有意偏离:上游 `mapLaravelCloudError` 把 403 压成 401、把所有 4xx 压成 400。
 * 这里把原始状态交给 `upstreamError`,404 仍是 not_found、403 仍是 permission_denied。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getApplicationInput,
  getDeploymentInput,
  getEnvironmentInput,
  listApplicationsInput,
  listDeploymentsInput,
  listEnvironmentsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'laravel_cloud'
const API_BASE = 'https://cloud.laravel.com/api'

type Json = Record<string, unknown>

/** 上游 `optionalString`:非字符串、或去空白后为空,都算缺失。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function requireObject(value: unknown): Json {
  const object = record(value)
  if (object === undefined) {
    throw new TBError('unavailable', 'Laravel Cloud 的响应 data 必须是对象', { retryable: true })
  }
  return object
}

async function readJsonObject(response: Response): Promise<Json> {
  const body = await response.text().catch(() => '')
  if (body === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(body) as unknown
  } catch {
    throw new TBError('unavailable', 'Laravel Cloud 返回了非法 JSON', { retryable: true })
  }
  return requireObject(parsed)
}

async function request(ctx: ProviderContext, path: string, search: URLSearchParams): Promise<Json> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(`${API_BASE}${path}`)
  // append 而非 set:JSON:API 允许同名过滤器重复出现。
  for (const [key, value] of search) url.searchParams.append(key, value)

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 500。
    throw upstreamError(
      502,
      error instanceof Error ? `Laravel Cloud 请求失败: ${error.message}` : 'Laravel Cloud 请求失败',
    )
  }

  const payload = await readJsonObject(response)
  if (!response.ok) {
    const message = text(payload.message) ?? text(payload.error)
      ?? `Laravel Cloud 请求失败,HTTP ${response.status}`
    throw upstreamError(response.status, message)
  }
  return payload
}

function requireArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  throw new TBError('unavailable', 'Laravel Cloud 的响应 data 必须是数组', { retryable: true })
}

/** 响应里缺了这个字段说明上游违约,不是调用方的错。 */
function requireResponseText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) {
    throw new TBError('unavailable', `Laravel Cloud 响应缺少 ${field}`, { retryable: true })
  }
  return result
}

/** 把入参键映射成 JSON:API 的 `filter[...]` 形式;空值不进 query。 */
function buildSearch(input: Json, mapping: Record<string, string>): URLSearchParams {
  const search = new URLSearchParams()
  for (const [inputKey, queryKey] of Object.entries(mapping)) {
    const value = text(input[inputKey])
    if (value !== undefined) search.set(queryKey, value)
  }
  return search
}

function addInclude(search: URLSearchParams, include: readonly string[] | undefined): URLSearchParams {
  if (include !== undefined && include.length > 0) search.set('include', include.join(','))
  return search
}

/** 列表端点共有的分页/关联字段;上游对缺失一律回 null 而非省略。 */
function listEnvelope(payload: Json): Json {
  return {
    links: record(payload.links) ?? null,
    meta: record(payload.meta) ?? null,
    included: Array.isArray(payload.included) ? payload.included : null,
  }
}

function normalizeOrganization(value: unknown): Json {
  const resource = requireObject(value)
  const attributes = record(resource.attributes) ?? {}
  return {
    id: requireResponseText(resource.id, 'organization.id'),
    type: text(resource.type) ?? 'organizations',
    name: text(attributes.name) ?? null,
    slug: text(attributes.slug) ?? null,
    raw: resource,
  }
}

/** regions 是唯一不走 JSON:API 资源形状的端点:元素本身就是扁平对象。 */
function normalizeRegion(value: unknown): Json {
  const region = requireObject(value)
  return {
    region: requireResponseText(region.region, 'region.region'),
    label: requireResponseText(region.label, 'region.label'),
    flag: requireResponseText(region.flag, 'region.flag'),
    raw: region,
  }
}

function normalizeApplication(value: unknown): Json {
  const resource = requireObject(value)
  const attributes = record(resource.attributes) ?? {}
  return {
    id: requireResponseText(resource.id, 'application.id'),
    type: text(resource.type) ?? 'applications',
    name: text(attributes.name) ?? null,
    slug: text(attributes.slug) ?? null,
    region: text(attributes.region) ?? null,
    slackChannel: text(attributes.slack_channel) ?? null,
    avatarUrl: text(attributes.avatar_url) ?? null,
    createdAt: text(attributes.created_at) ?? null,
    repository: record(attributes.repository) ?? null,
    relationships: record(resource.relationships) ?? null,
    raw: resource,
  }
}

function normalizeEnvironment(value: unknown): Json {
  const resource = requireObject(value)
  const attributes = record(resource.attributes) ?? {}
  return {
    id: requireResponseText(resource.id, 'environment.id'),
    type: text(resource.type) ?? 'environments',
    name: text(attributes.name) ?? null,
    slug: text(attributes.slug) ?? null,
    status: text(attributes.status) ?? null,
    vanityDomain: text(attributes.vanity_domain) ?? null,
    phpMajorVersion: text(attributes.php_major_version) ?? null,
    nodeVersion: text(attributes.node_version) ?? null,
    buildCommand: text(attributes.build_command) ?? null,
    deployCommand: text(attributes.deploy_command) ?? null,
    usesOctane: bool(attributes.uses_octane) ?? null,
    usesPushToDeploy: bool(attributes.uses_push_to_deploy) ?? null,
    usesDeployHook: bool(attributes.uses_deploy_hook) ?? null,
    createdAt: text(attributes.created_at) ?? null,
    relationships: record(resource.relationships) ?? null,
    links: record(resource.links) ?? null,
    raw: resource,
  }
}

function normalizeDeployment(value: unknown): Json {
  const resource = requireObject(value)
  const attributes = record(resource.attributes) ?? {}
  return {
    id: requireResponseText(resource.id, 'deployment.id'),
    type: text(resource.type) ?? 'deployments',
    status: text(attributes.status) ?? null,
    branchName: text(attributes.branch_name) ?? null,
    commitHash: text(attributes.commit_hash) ?? null,
    commitMessage: text(attributes.commit_message) ?? null,
    commitAuthor: text(attributes.commit_author) ?? null,
    failureReason: text(attributes.failure_reason) ?? null,
    phpMajorVersion: text(attributes.php_major_version) ?? null,
    buildCommand: text(attributes.build_command) ?? null,
    nodeVersion: text(attributes.node_version) ?? null,
    usesOctane: bool(attributes.uses_octane) ?? null,
    startedAt: text(attributes.started_at) ?? null,
    finishedAt: text(attributes.finished_at) ?? null,
    relationships: record(resource.relationships) ?? null,
    links: record(resource.links) ?? null,
    raw: resource,
  }
}

export async function getOrganization(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/meta/organization', new URLSearchParams())
  return { organization: normalizeOrganization(payload.data) }
}

export async function listRegions(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/meta/regions', new URLSearchParams())
  return { regions: requireArray(payload.data).map(normalizeRegion) }
}

export async function listApplications(
  input: z.infer<typeof listApplicationsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const search = addInclude(
    buildSearch(input, { name: 'filter[name]', region: 'filter[region]', slug: 'filter[slug]' }),
    input.include,
  )
  const payload = await request(ctx, '/applications', search)
  return {
    applications: requireArray(payload.data).map(normalizeApplication),
    ...listEnvelope(payload),
  }
}

export async function getApplication(
  input: z.infer<typeof getApplicationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const search = addInclude(new URLSearchParams(), input.include)
  const payload = await request(ctx, `/applications/${encodeURIComponent(input.applicationId)}`, search)
  return {
    application: normalizeApplication(payload.data),
    included: Array.isArray(payload.included) ? payload.included : null,
  }
}

export async function listEnvironments(
  input: z.infer<typeof listEnvironmentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const search = addInclude(
    buildSearch(input, { name: 'filter[name]', status: 'filter[status]', slug: 'filter[slug]' }),
    input.include,
  )
  const path = `/applications/${encodeURIComponent(input.applicationId)}/environments`
  const payload = await request(ctx, path, search)
  return {
    environments: requireArray(payload.data).map(normalizeEnvironment),
    ...listEnvelope(payload),
  }
}

export async function getEnvironment(
  input: z.infer<typeof getEnvironmentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const search = addInclude(new URLSearchParams(), input.include)
  const payload = await request(ctx, `/environments/${encodeURIComponent(input.environmentId)}`, search)
  return {
    environment: normalizeEnvironment(payload.data),
    included: Array.isArray(payload.included) ? payload.included : null,
  }
}

export async function listDeployments(
  input: z.infer<typeof listDeploymentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const search = addInclude(
    buildSearch(input, {
      status: 'filter[status]',
      branchName: 'filter[branch_name]',
      commitHash: 'filter[commit_hash]',
    }),
    input.include,
  )
  const path = `/environments/${encodeURIComponent(input.environmentId)}/deployments`
  const payload = await request(ctx, path, search)
  return {
    deployments: requireArray(payload.data).map(normalizeDeployment),
    ...listEnvelope(payload),
  }
}

export async function getDeployment(
  input: z.infer<typeof getDeploymentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const search = addInclude(new URLSearchParams(), input.include)
  const payload = await request(ctx, `/deployments/${encodeURIComponent(input.deploymentId)}`, search)
  return {
    deployment: normalizeDeployment(payload.data),
    included: Array.isArray(payload.included) ? payload.included : null,
  }
}
