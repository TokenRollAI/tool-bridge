/**
 * FireHydrant 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/firehydrant/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * FireHydrant 的响应有两种形状:list 是 `{data:[], pagination:{}}` 的信封,单条则是
 * 对象本身(没有 `data` 包裹)。归一后统一挂在 `incidents`/`incident` 之类的键上,
 * 原始响应始终留在 `raw`。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createIncidentInput,
  getEnvironmentInput,
  getIncidentInput,
  getServiceInput,
  listEnvironmentsInput,
  listIncidentsInput,
  listServicesInput,
} from './schema'
import { compactDefined as compact, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'firehydrant'
const API_BASE = 'https://api.firehydrant.io/v1'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>

interface RequestInput {
  body?: Json
  method?: 'GET' | 'POST'
  path: string
  query?: Record<string, string | undefined>
}

/** 契约说好这一层是对象;不是就是上游出问题,不是调用方的错。 */
function responseObject(value: unknown, what: string): Json {
  const object = record(value)
  if (object === undefined) {
    throw new TBError('unavailable', `${what} 不是对象`, { retryable: true })
  }
  return object
}

/** FireHydrant 的错误体形状不固定:`error`、`message`、`errors` 数组都出现过。 */
function errorMessage(payload: unknown, status: number): string {
  const object = record(payload)
  if (object !== undefined) {
    const direct = text(object.error) ?? text(object.message)
    if (direct !== undefined) return direct
    const errors = object.errors
    if (Array.isArray(errors) && errors.length > 0) return errors.map(String).join(', ')
  }
  return `FireHydrant request failed with status ${status}`
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const { data } = await http.request({
    path: input.path,
    method: input.method ?? 'GET',
    query: Object.entries(input.query ?? {}),
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
      'content-type': 'application/json',
    },
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJsonMessage: 'FireHydrant 返回了非法 JSON',
    mapError: ({ bodyKind, data: payload, status }) => bodyKind === 'invalid-json'
      ? new TBError('unavailable', 'FireHydrant 返回了非法 JSON', { retryable: true })
      : upstreamError(status, errorMessage(payload, status)),
  })
  return data ?? {}
}

// —— 出参归一 ——

function nullableText(value: unknown): string | null {
  return text(value) ?? null
}

function nullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function normalizeEntityRef(input: Json): Json {
  return {
    id: nullableText(input.id),
    name: nullableText(input.name),
    slug: nullableText(input.slug),
    raw: input,
  }
}

function nullableEntityRef(value: unknown): Json | null {
  const object = record(value)
  return object === undefined ? null : normalizeEntityRef(object)
}

function normalizeIncident(input: Json): Json {
  return {
    id: nullableText(input.id),
    name: nullableText(input.name),
    number: nullableInteger(input.number),
    summary: nullableText(input.summary),
    description: nullableText(input.description),
    customerImpactSummary: nullableText(input.customer_impact_summary),
    currentMilestone: nullableText(input.current_milestone),
    severity: nullableText(input.severity),
    priority: nullableText(input.priority),
    createdAt: nullableText(input.created_at),
    startedAt: nullableText(input.started_at),
    updatedAt: nullableText(input.updated_at),
    incidentUrl: nullableText(input.incident_url),
    active: nullableBoolean(input.active),
    restricted: nullableBoolean(input.restricted),
    services: readArray(input.services)
      .map(item => normalizeEntityRef(responseObject(item, 'FireHydrant incident service'))),
    environments: readArray(input.environments)
      .map(item => normalizeEntityRef(responseObject(item, 'FireHydrant incident environment'))),
    tags: readArray(input.tag_list).map(String),
    labels: record(input.labels) ?? null,
    raw: input,
  }
}

function normalizeCatalogEntry(input: Json): Json {
  return {
    id: nullableText(input.id),
    name: nullableText(input.name),
    slug: nullableText(input.slug),
    description: nullableText(input.description),
    serviceTier: nullableInteger(input.service_tier),
    createdAt: nullableText(input.created_at),
    updatedAt: nullableText(input.updated_at),
    activeIncidents: readArray(input.active_incidents).map(String),
    labels: record(input.labels) ?? null,
    owner: nullableEntityRef(input.owner),
    raw: input,
  }
}

function normalizePagination(value: unknown): Json | null {
  const object = record(value)
  if (object === undefined) return null
  return {
    count: nullableInteger(object.count),
    page: nullableInteger(object.page),
    items: nullableInteger(object.items),
    pages: nullableInteger(object.pages),
    last: nullableInteger(object.last),
    prev: nullableInteger(object.prev),
    next: nullableInteger(object.next),
    raw: object,
  }
}

// —— 请求构造 ——

type ListInput
  = | z.infer<typeof listEnvironmentsInput>
    | z.infer<typeof listIncidentsInput>
    | z.infer<typeof listServicesInput>

/**
 * 三个 list action 共用一张筛选表;某个 action 的 schema 里没有的键取不到值,
 * 自然落成 undefined 被丢掉 —— 上游也是这么一张表打天下。
 */
function listQuery(input: ListInput): Record<string, string | undefined> {
  const incident = input as z.infer<typeof listIncidentsInput>
  return {
    page: input.page === undefined ? undefined : String(input.page),
    per_page: input.perPage === undefined ? undefined : String(input.perPage),
    query: text(input.query),
    name: text(input.name),
    status: text(incident.status),
    services: text(incident.services),
    environments: text(incident.environments),
    tags: text(incident.tags),
    tag_match_strategy: text(incident.tagMatchStrategy),
    archived: incident.archived === undefined ? undefined : String(incident.archived),
    created_at_or_after: text(incident.createdAtOrAfter),
    created_at_or_before: text(incident.createdAtOrBefore),
    updated_after: text(incident.updatedAfter),
    updated_before: text(incident.updatedBefore),
  }
}

async function listCollection(
  ctx: ProviderContext,
  outputKey: string,
  path: string,
  input: ListInput,
  normalizeItem: (item: Json) => Json,
): Promise<Json> {
  const raw = responseObject(
    await request(ctx, { path, query: listQuery(input) }),
    `FireHydrant ${outputKey} list response`,
  )
  const items = readArray(raw.data)
    .map(item => normalizeItem(responseObject(item, `FireHydrant ${outputKey} list item`)))
  return { [outputKey]: items, pagination: normalizePagination(raw.pagination), raw }
}

async function getSingle(
  ctx: ProviderContext,
  outputKey: string,
  input: RequestInput,
  normalizeItem: (item: Json) => Json,
): Promise<Json> {
  const raw = responseObject(await request(ctx, input), `FireHydrant ${outputKey} response`)
  return { [outputKey]: normalizeItem(raw), raw }
}

/** 路径参数必须非空:拼进 URL 前先挡住,免得打出 `/incidents/undefined`。 */
function pathSegment(value: string, field: string): string {
  const segment = value.trim()
  if (segment === '') throw new TBError('invalid_argument', `${field} 不能为空`)
  return encodeURIComponent(segment)
}

// —— handlers ——

export function listIncidents(
  input: z.infer<typeof listIncidentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listCollection(ctx, 'incidents', '/incidents', input, normalizeIncident)
}

export function getIncident(
  input: z.infer<typeof getIncidentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/incidents/${pathSegment(input.incidentId, 'incidentId')}`
  return getSingle(ctx, 'incident', { path }, normalizeIncident)
}

export function createIncident(
  input: z.infer<typeof createIncidentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = compact({
    name: input.name,
    summary: input.summary,
    customer_impact_summary: input.customerImpactSummary,
    description: input.description,
    priority: input.priority,
    severity: input.severity,
    severity_condition_id: input.severityConditionId,
    severity_impact_id: input.severityImpactId,
    labels: input.labels,
    tag_list: input.tagList,
    impacts: input.impacts?.map(impact => ({
      type: impact.type,
      id: impact.id,
      condition_id: impact.conditionId,
    })),
    team_ids: input.teamIds,
    restricted: input.restricted,
    incident_type_id: input.incidentTypeId,
    skip_incident_type_values: input.skipIncidentTypeValues,
  })
  return getSingle(ctx, 'incident', { path: '/incidents', method: 'POST', body }, normalizeIncident)
}

export function listServices(
  input: z.infer<typeof listServicesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listCollection(ctx, 'services', '/services', input, normalizeCatalogEntry)
}

export function getService(
  input: z.infer<typeof getServiceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/services/${pathSegment(input.serviceId, 'serviceId')}`
  return getSingle(ctx, 'service', { path }, normalizeCatalogEntry)
}

export function listEnvironments(
  input: z.infer<typeof listEnvironmentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listCollection(ctx, 'environments', '/environments', input, normalizeCatalogEntry)
}

export function getEnvironment(
  input: z.infer<typeof getEnvironmentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/environments/${pathSegment(input.environmentId, 'environmentId')}`
  return getSingle(ctx, 'environment', { path }, normalizeCatalogEntry)
}
