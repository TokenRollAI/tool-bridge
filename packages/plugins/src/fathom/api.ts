/**
 * Fathom Analytics 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/fathom/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Fathom 的几个特点决定了这里的形状:
 * - 写操作是 **form-encoded**(不是 JSON),且更新也走 POST —— 整个 API 只有 GET/POST。
 * - 分页是 **cursor 式**(`starting_after`/`ending_before` 传对象 ID),且两者互斥;
 *   这条互斥 schema 表达不了,只能在这里挡。
 * - 聚合报表把数组参数压成**逗号分隔串**(`aggregates=visits,uniques`),唯独 `filters`
 *   要 JSON 字符串;`entity` 的取值还决定了哪些字段变成必填。
 *
 * 所有 handler 都显式返回 `{ content: payload }` 而不是裸 payload:平台的 `toToolResult`
 * 见到返回值带 `content` 键就当作已包装的结果原样透传,而 `get_current_visitors` 在
 * detailed 模式下**恰好**回一个带 `content` 字段的对象(热门内容行)。裸返会让它比其他
 * action 少包一层,且这层差异只在 detailed=true 时出现。显式包装让 wire 形状与响应内容无关。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createEventInput,
  createMilestoneInput,
  createSiteInput,
  getAccountInput,
  getCurrentVisitorsInput,
  getEventInput,
  getMilestoneInput,
  getSiteInput,
  listEventsInput,
  listMilestonesInput,
  listSitesInput,
  runAggregationInput,
  updateEventInput,
  updateMilestoneInput,
  updateSiteInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'fathom'
const API_BASE = 'https://api.usefathom.com'
const API_V1 = '/v1'

/** Fathom 的响应既有对象(单个资源、list 信封)也有数组(聚合报表)。 */
type FathomJson = Record<string, unknown> | unknown[]

interface Result {
  content: FathomJson
}

function result(payload: FathomJson): Result {
  return { content: payload }
}

/**
 * query 与 form 共用的编码:数组压成逗号分隔串,缺省值跳过(不发空键)。
 *
 * 与上游有一处**刻意**的差异:上游每个字段都过 `optionalString`,顺带 trim 且把纯空白
 * 串当作缺失。这里不 trim —— 空白处理属于入参校验,已由 schema 的 `min(1)` 承担一半,
 * 剩下"纯空白串"这个缝隙极窄(谁会拿 `' '` 当 site_id),而为它在每个字段上重做一遍
 * 转换,等于把上游 cast helper 的顺带行为固化成本插件的契约。取舍见回报,待人工复核。
 */
function appendValue(target: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  target.set(key, Array.isArray(value) ? value.join(',') : String(value))
}

function formBody(form: Record<string, unknown>): string {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(form)) appendValue(body, key, value)
  return body.toString()
}

/** Fathom 的错误体是 `{error: "..."}` —— `error` 是字符串而非对象。 */
function errorMessage(payload: FathomJson | undefined, response: Response): string {
  const upstream = payload !== undefined && !Array.isArray(payload) && typeof payload.error === 'string'
    ? payload.error.trim()
    : ''
  return upstream || response.statusText || `Fathom 返回 HTTP ${response.status}`
}

/** 空体 → undefined;非法 JSON 或标量 JSON → 502(契约破了,不是调用方的错)。 */
async function parseJson(response: Response): Promise<FathomJson | undefined> {
  const text = await response.text()
  if (text === '') return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw upstreamError(502, 'Fathom 返回了非法 JSON')
  }
  if (Array.isArray(parsed)) return parsed
  if (parsed !== null && typeof parsed === 'object') return parsed as Record<string, unknown>
  throw upstreamError(502, 'Fathom 返回了意料之外的 JSON 载荷')
}

/**
 * 错误响应体尽力解析,解析不出就当没有。
 *
 * 与上游有意不同:上游在错误分支也走会抛的解析器,于是 Fathom 回 HTML 错误页时,原始的
 * 401/429 会被"非法 JSON"的 502 顶掉,状态码归一失真。这里让状态码优先,消息退回 statusText。
 */
async function parseErrorJson(response: Response): Promise<FathomJson | undefined> {
  try {
    return await parseJson(response)
  } catch {
    return undefined
  }
}

interface RequestInput {
  form?: Record<string, unknown>
  method?: 'GET' | 'POST'
  query?: Record<string, unknown>
}

async function request(ctx: ProviderContext, path: string, init: RequestInput = {}): Promise<FathomJson> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(init.query ?? {})) appendValue(url.searchParams, key, value)

  const method = init.method ?? 'GET'
  // 空 form 也要发 body:上游按"给没给 form"而非"form 有没有内容"决定,
  // 于是只带路径参数的 update_* 会发出空 body + content-type。照搬,免得改动请求指纹。
  const body = init.form === undefined ? undefined : formBody(init.form)
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  if (body !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded'

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    })
  } catch (error) {
    // 传输层失败(含 guardedFetch 的出站拦截)按上游口径归为可重试的 502。
    const message = error instanceof Error ? error.message : String(error)
    throw upstreamError(502, `Fathom 请求失败(${method} ${url.toString()}): ${message}`)
  }

  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(await parseErrorJson(response), response))
  }

  const payload = await parseJson(response)
  if (payload === undefined) throw upstreamError(502, 'Fathom 返回了空响应体')
  return payload
}

interface Pagination {
  ending_before?: string
  limit?: number
  starting_after?: string
}

function paginationQuery(input: Pagination): Record<string, unknown> {
  if (input.starting_after !== undefined && input.ending_before !== undefined) {
    throw new TBError('invalid_argument', 'ending_before 不能与 starting_after 同时给出')
  }
  return {
    limit: input.limit,
    starting_after: input.starting_after,
    ending_before: input.ending_before,
  }
}

interface SiteFields {
  name?: string
  share_password?: string
  sharing?: string
  timezone?: string
}

function siteForm(input: SiteFields): Record<string, unknown> {
  return {
    name: input.name,
    sharing: input.sharing,
    share_password: input.share_password,
    timezone: input.timezone,
  }
}

interface MilestoneFields {
  milestone_date?: string
  name?: string
}

function milestoneForm(input: MilestoneFields): Record<string, unknown> {
  return {
    name: input.name,
    milestone_date: input.milestone_date,
  }
}

/** `entity` 决定哪些字段必填 —— 这是 schema 表达不了的条件必填,只能在这里挡。 */
function aggregationQuery(input: z.infer<typeof runAggregationInput>): Record<string, unknown> {
  if (input.entity === 'pageview' && input.entity_id === undefined) {
    throw new TBError('invalid_argument', 'pageview 报表需要 entity_id')
  }
  if (input.entity === 'event') {
    if (input.site_id === undefined) {
      throw new TBError('invalid_argument', 'event 报表需要 site_id')
    }
    if (input.entity_name === undefined) {
      throw new TBError('invalid_argument', 'event 报表需要 entity_name')
    }
  }

  return {
    entity: input.entity,
    entity_id: input.entity_id,
    site_id: input.site_id,
    entity_name: input.entity_name,
    aggregates: input.aggregates,
    date_grouping: input.date_grouping,
    field_grouping: input.field_grouping,
    sort_by: input.sort_by,
    timezone: input.timezone,
    date_from: input.date_from,
    date_to: input.date_to,
    limit: input.limit,
    // 唯一不走逗号分隔的数组参数:Fathom 要它是 JSON 字符串。
    filters: input.filters === undefined ? undefined : JSON.stringify(input.filters),
  }
}

export async function getAccount(
  _input: z.infer<typeof getAccountInput>,
  ctx: ProviderContext,
): Promise<Result> {
  return result(await request(ctx, `${API_V1}/account`))
}

// —— sites ——

export async function listSites(
  input: z.infer<typeof listSitesInput>,
  ctx: ProviderContext,
): Promise<Result> {
  return result(await request(ctx, `${API_V1}/sites`, { query: paginationQuery(input) }))
}

export async function getSite(
  input: z.infer<typeof getSiteInput>,
  ctx: ProviderContext,
): Promise<Result> {
  return result(await request(ctx, `${API_V1}/sites/${encodeURIComponent(input.site_id)}`))
}

export async function createSite(
  input: z.infer<typeof createSiteInput>,
  ctx: ProviderContext,
): Promise<Result> {
  return result(await request(ctx, `${API_V1}/sites`, { method: 'POST', form: siteForm(input) }))
}

export async function updateSite(
  input: z.infer<typeof updateSiteInput>,
  ctx: ProviderContext,
): Promise<Result> {
  const path = `${API_V1}/sites/${encodeURIComponent(input.site_id)}`
  return result(await request(ctx, path, { method: 'POST', form: siteForm(input) }))
}

// —— events ——

export async function listEvents(
  input: z.infer<typeof listEventsInput>,
  ctx: ProviderContext,
): Promise<Result> {
  const path = `${API_V1}/sites/${encodeURIComponent(input.site_id)}/events`
  return result(await request(ctx, path, { query: paginationQuery(input) }))
}

export async function getEvent(
  input: z.infer<typeof getEventInput>,
  ctx: ProviderContext,
): Promise<Result> {
  const path = `${API_V1}/sites/${encodeURIComponent(input.site_id)}/events/${encodeURIComponent(input.event_id)}`
  return result(await request(ctx, path))
}

export async function createEvent(
  input: z.infer<typeof createEventInput>,
  ctx: ProviderContext,
): Promise<Result> {
  const path = `${API_V1}/sites/${encodeURIComponent(input.site_id)}/events`
  return result(await request(ctx, path, { method: 'POST', form: { name: input.name } }))
}

export async function updateEvent(
  input: z.infer<typeof updateEventInput>,
  ctx: ProviderContext,
): Promise<Result> {
  const path = `${API_V1}/sites/${encodeURIComponent(input.site_id)}/events/${encodeURIComponent(input.event_id)}`
  return result(await request(ctx, path, { method: 'POST', form: { name: input.name } }))
}

// —— milestones ——

export async function listMilestones(
  input: z.infer<typeof listMilestonesInput>,
  ctx: ProviderContext,
): Promise<Result> {
  const path = `${API_V1}/sites/${encodeURIComponent(input.site_id)}/milestones`
  return result(await request(ctx, path, { query: paginationQuery(input) }))
}

export async function getMilestone(
  input: z.infer<typeof getMilestoneInput>,
  ctx: ProviderContext,
): Promise<Result> {
  const path
    = `${API_V1}/sites/${encodeURIComponent(input.site_id)}/milestones/${encodeURIComponent(input.milestone_id)}`
  return result(await request(ctx, path))
}

export async function createMilestone(
  input: z.infer<typeof createMilestoneInput>,
  ctx: ProviderContext,
): Promise<Result> {
  const path = `${API_V1}/sites/${encodeURIComponent(input.site_id)}/milestones`
  return result(await request(ctx, path, { method: 'POST', form: milestoneForm(input) }))
}

export async function updateMilestone(
  input: z.infer<typeof updateMilestoneInput>,
  ctx: ProviderContext,
): Promise<Result> {
  const path
    = `${API_V1}/sites/${encodeURIComponent(input.site_id)}/milestones/${encodeURIComponent(input.milestone_id)}`
  return result(await request(ctx, path, { method: 'POST', form: milestoneForm(input) }))
}

// —— reports ——

export async function runAggregation(
  input: z.infer<typeof runAggregationInput>,
  ctx: ProviderContext,
): Promise<Result> {
  return result(await request(ctx, `${API_V1}/aggregations`, { query: aggregationQuery(input) }))
}

export async function getCurrentVisitors(
  input: z.infer<typeof getCurrentVisitorsInput>,
  ctx: ProviderContext,
): Promise<Result> {
  return result(await request(ctx, `${API_V1}/current_visitors`, {
    query: { site_id: input.site_id, detailed: input.detailed },
  }))
}
