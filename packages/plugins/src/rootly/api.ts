/**
 * Rootly 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/rootly/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 与上游有意偏离的一处:**错误映射交给共用的 `upstreamError`**。上游把 404 压成 400、
 * 把 403 压成 401,抹平了"资源不存在"与"参数不合法"、"未认证"与"已认证但无权"之别。
 *
 * Rootly 是 **JSON:API**:响应形如 `{data, included, links, meta}`,资源统一带 id/type,
 * 过滤器是 `filter[xxx]` 这种方括号参数名。`readResource` 是剥壳的唯一入口。
 */

import type { z } from 'zod/v4'
import type {
  getIncidentInput,
  listIncidentsInput,
  listServicesInput,
  listTeamsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'rootly'
const API_BASE = 'https://api.rootly.com/v1'
const JSON_API_CONTENT_TYPE = 'application/vnd.api+json'

type Json = Record<string, unknown>

function toRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString` 的语义:非空白字符串才算数,且取 trim 后的值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function requireRecord(value: unknown, label: string): Json {
  const record = toRecord(value)
  if (record === undefined) throw upstreamError(502, `${label} was not an object`)
  return record
}

/**
 * 空体当空对象(Rootly 某些 204 场景),错误响应解不开就把原文塞进 JSON:API 的错误形状,
 * 让下游 `errorMessage` 有统一的一条路径可走。
 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body.trim() === '') return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    if (!response.ok) return { errors: [{ detail: body }] }
    throw upstreamError(502, 'Rootly returned invalid JSON')
  }
}

function errorMessage(payload: unknown, status: number): string {
  const object = toRecord(payload)
  const errors = Array.isArray(object?.errors) ? object.errors : []
  const first = toRecord(errors[0])
  return text(first?.detail) ?? text(first?.title) ?? `Rootly request failed with ${status}`
}

async function requestJson(
  ctx: ProviderContext,
  path: string,
  query: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)

  const response = await guardedFetch(url.toString(), {
    headers: {
      'accept': JSON_API_CONTENT_TYPE,
      'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
      'content-type': JSON_API_CONTENT_TYPE,
    },
  })
  const payload = await readPayload(response)
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return payload
}

/**
 * JSON:API 资源剥壳:单资源响应外面包一层 `data`,列表里的元素已经是资源本体,
 * 两者都要能进这个函数,故按有无 `data` 键分流。
 */
function readResource(value: unknown, label: string): Json {
  const object = requireRecord(value, label)
  const data = object.data === undefined ? object : requireRecord(object.data, `${label} data`)
  const id = text(data.id)
  const type = text(data.type)
  if (id === undefined || type === undefined) {
    throw upstreamError(502, `${label} did not include JSON:API id and type`)
  }
  return {
    ...data,
    id,
    type,
    attributes: toRecord(data.attributes) ?? {},
    relationships: toRecord(data.relationships) ?? {},
  }
}

/** `included`/`links`/`meta` 有才带出来 —— 缺字段与"空对象"在 JSON:API 里语义不同。 */
function readSidecars(payload: unknown): Json {
  const object = requireRecord(payload, 'Rootly response')
  const included = Array.isArray(object.included) ? object.included : undefined
  const links = toRecord(object.links)
  const meta = toRecord(object.meta)
  return {
    ...(included === undefined ? {} : { included }),
    ...(links === undefined ? {} : { links }),
    ...(meta === undefined ? {} : { meta }),
  }
}

async function getSingleResource(
  ctx: ProviderContext,
  path: string,
  query: Record<string, string>,
): Promise<Json> {
  const payload = await requestJson(ctx, path, query)
  return { resource: readResource(payload, 'Rootly resource'), ...readSidecars(payload), raw: payload }
}

async function getList(
  ctx: ProviderContext,
  path: string,
  query: Record<string, string>,
): Promise<Json> {
  const payload = await requestJson(ctx, path, query)
  const object = requireRecord(payload, 'Rootly list response')
  if (!Array.isArray(object.data)) {
    throw upstreamError(502, 'Rootly list response did not include data array')
  }
  return {
    resources: object.data.map(item => readResource(item, 'Rootly list resource')),
    ...readSidecars(payload),
    raw: payload,
  }
}

/** 丢掉未提供的过滤器;Rootly 把空串当作真实的过滤条件,不能误发。 */
function compact(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

function includeQuery(include: readonly string[] | undefined): Record<string, string | undefined> {
  // Rootly 的 include 是逗号拼接的单个参数,不是重复键。
  return { include: include === undefined || include.length === 0 ? undefined : include.join(',') }
}

function pageQuery(
  input: { pageAfter?: string, pageNumber?: number, pageSize?: number },
  options: { cursor?: boolean } = {},
): Record<string, string | undefined> {
  return {
    ...(options.cursor === true ? { 'page[after]': text(input.pageAfter) } : {}),
    'page[number]': input.pageNumber === undefined ? undefined : String(input.pageNumber),
    'page[size]': input.pageSize === undefined ? undefined : String(input.pageSize),
  }
}

type ConfigurationInput = z.infer<typeof listServicesInput> & { color?: string }

function configurationQuery(
  input: ConfigurationInput,
  options: { includeColor?: boolean } = {},
): Record<string, string> {
  return compact({
    ...includeQuery(input.include),
    ...pageQuery(input),
    'filter[search]': text(input.search),
    'filter[name]': text(input.name),
    'filter[slug]': text(input.slug),
    'filter[external_id]': text(input.externalId),
    ...(options.includeColor === true ? { 'filter[color]': text(input.color) } : {}),
    'filter[alert_broadcast_enabled]': input.alertBroadcastEnabled === undefined
      ? undefined
      : String(input.alertBroadcastEnabled),
    'filter[incident_broadcast_enabled]': input.incidentBroadcastEnabled === undefined
      ? undefined
      : String(input.incidentBroadcastEnabled),
    'filter[created_at][gt]': text(input.createdAtGt),
    'filter[created_at][gte]': text(input.createdAtGte),
    'filter[created_at][lt]': text(input.createdAtLt),
    'filter[created_at][lte]': text(input.createdAtLte),
    'sort': text(input.sort),
  })
}

export function getCurrentUser(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return getSingleResource(ctx, '/users/me', {})
}

export function listIncidents(
  input: z.infer<typeof listIncidentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getList(ctx, '/incidents', compact({
    ...pageQuery(input, { cursor: true }),
    'filter[search]': text(input.search),
    'filter[kind]': text(input.kind),
    'filter[status]': text(input.status),
    'filter[private]': input.private === undefined ? undefined : String(input.private),
    'filter[user_id]': input.userId === undefined ? undefined : String(input.userId),
    'filter[severity]': text(input.severity),
    'filter[severity_id]': text(input.severityId),
    'filter[labels]': text(input.labels),
    'filter[service_ids]': text(input.serviceIds),
    'filter[service_names]': text(input.serviceNames),
    'filter[team_ids]': text(input.teamIds),
    'filter[team_names]': text(input.teamNames),
    'filter[created_at][gt]': text(input.createdAtGt),
    'filter[created_at][gte]': text(input.createdAtGte),
    'filter[created_at][lt]': text(input.createdAtLt),
    'filter[created_at][lte]': text(input.createdAtLte),
    'sort': text(input.sort),
  }))
}

export function getIncident(
  input: z.infer<typeof getIncidentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getSingleResource(
    ctx,
    `/incidents/${encodeURIComponent(input.id)}`,
    compact(includeQuery(input.include)),
  )
}

export function listServices(
  input: z.infer<typeof listServicesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getList(ctx, '/services', configurationQuery(input))
}

export function listTeams(
  input: z.infer<typeof listTeamsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getList(ctx, '/teams', configurationQuery(input, { includeColor: true }))
}
