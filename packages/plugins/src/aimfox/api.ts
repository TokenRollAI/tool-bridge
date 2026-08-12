/**
 * Aimfox 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/aimfox/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Aimfox 的形状特点:
 * - 每个响应都带一个顶层 `status`,取不到就补 null(出参 schema 是 nullable)。
 * - 上游对响应里的关键字段**严格校验**:`campaigns` 不是对象数组、`total_leads` 不是数字
 *   都当上游故障(502)而非静默补空。保留 —— 出参 schema 依赖这些字段的类型。
 * - 两个 lead 检索端点(`/leads:search` 与 `/leads:search/total`)共用同一组 facet 过滤,
 *   只是前者多两个分页 query,故 body 构造收成 `leadSearchBody()` 一处。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  addProfileToCampaignInput,
  getCampaignInput,
  getCampaignMetricsInput,
  getLeadInput,
  getTotalLeadsCountInput,
  listCampaignsInput,
  listInteractionsInput,
  removeProfileFromCampaignInput,
  searchLeadsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'aimfox'
const API_BASE = 'https://api.aimfox.com/api/v2'
const REQUEST_TIMEOUT_MS = 30_000

/** 两个 lead 检索端点共用的 facet 字段;顺序即上游 body 里的顺序。 */
const LEAD_SEARCH_KEYS = [
  'keywords',
  'current_companies',
  'past_companies',
  'education',
  'interests',
  'labels',
  'languages',
  'locations',
  'origins',
  'skills',
  'lead_of',
  'optimize',
] as const

type Json = Record<string, unknown>

function toRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

function requireObject(value: unknown, field: string): Json {
  const record = toRecord(value)
  if (record === undefined) throw upstreamError(502, `Aimfox response missing ${field}`)
  return record
}

function requireObjectArray(value: unknown, field: string): Json[] {
  if (!Array.isArray(value)) throw upstreamError(502, `Aimfox response missing ${field}`)
  return value.map(item => requireObject(item, field))
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') throw upstreamError(502, `Aimfox response missing ${field}`)
  return value
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw upstreamError(502, `Aimfox response missing ${field}`)
  return value
}

/** 顶层 status 取不到就是 null,不省略。 */
function status(payload: Json): string | null {
  const value = payload.status
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Aimfox 的错误文案先看 `error.message`,再看顶层 `message`。 */
function errorMessage(payload: unknown, httpStatus: number): string {
  const record = toRecord(payload)
  const nested = toRecord(record?.error)?.message
  if (typeof nested === 'string' && nested.trim() !== '') return nested
  const top = record?.message
  if (typeof top === 'string' && top.trim() !== '') return top
  return `Aimfox API request failed with status ${httpStatus}`
}

interface RequestInput {
  body?: Json
  method?: 'DELETE' | 'GET' | 'POST'
  path: string
  query?: Record<string, boolean | number | string | undefined>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<Json> {
  const url = new URL(`${API_BASE}${input.path}`)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  let body: string | undefined
  if (input.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(input.body)
  }

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method ?? 'GET',
      headers,
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof TBError) throw error
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, 'Aimfox API request timed out')
    }
    throw error
  }

  // 空体读成 `{}`:Aimfox 的写操作(加/删 audience)成功时常回 204 空体。
  const text = await response.text()
  let payload: unknown = {}
  if (text.trim() !== '') {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      throw upstreamError(502, 'Aimfox API returned a non-JSON response')
    }
  }

  if (!response.ok) {
    throw upstreamError(response.status || 502, errorMessage(payload, response.status))
  }
  return requireObject(payload, 'Aimfox response')
}

function leadSearchBody(input: Json): Json {
  const body: Json = {}
  for (const key of LEAD_SEARCH_KEYS) {
    const value = input[key]
    if (value !== undefined) body[key] = value
  }
  return body
}

export async function listCampaigns(
  input: z.infer<typeof listCampaignsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/campaigns',
    query: { outreach_type: input.outreach_type, accepts_profiles: input.accepts_profiles },
  })
  return { status: status(payload), campaigns: requireObjectArray(payload.campaigns, 'campaigns') }
}

export async function getCampaign(
  input: z.infer<typeof getCampaignInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { path: `/campaigns/${encodeURIComponent(input.campaign_id)}` })
  return { status: status(payload), campaign: requireObject(payload.campaign, 'campaign') }
}

export async function getCampaignMetrics(
  input: z.infer<typeof getCampaignMetricsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/campaigns/${encodeURIComponent(input.campaign_id)}/metrics`,
  })
  return { status: status(payload), metrics: requireObject(payload.metrics, 'metrics') }
}

export async function addProfileToCampaign(
  input: z.infer<typeof addProfileToCampaignInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/campaigns/${encodeURIComponent(input.campaign_id)}/audience`,
    method: 'POST',
    body: { profile_url: input.profile_url },
  })
  return { status: status(payload) }
}

export async function removeProfileFromCampaign(
  input: z.infer<typeof removeProfileFromCampaignInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/campaigns/${encodeURIComponent(input.campaign_id)}/audience/${encodeURIComponent(input.urn)}`
  const payload = await request(ctx, { path, method: 'DELETE' })
  return { status: status(payload) }
}

export async function getLead(
  input: z.infer<typeof getLeadInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { path: `/leads/${encodeURIComponent(input.lead_id)}` })
  return { status: status(payload), lead: requireObject(payload.lead, 'lead') }
}

export async function searchLeads(
  input: z.infer<typeof searchLeadsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/leads:search',
    method: 'POST',
    body: leadSearchBody(input),
    // start/count 是 query 而非 body,与 facet 过滤分属两层。
    query: { start: input.start, count: input.count },
  })
  return { status: status(payload), leads: requireObjectArray(payload.leads, 'leads') }
}

export async function getTotalLeadsCount(
  input: z.infer<typeof getTotalLeadsCountInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/leads:search/total',
    method: 'POST',
    body: leadSearchBody(input),
  })
  return {
    status: status(payload),
    total_leads: requireNumber(payload.total_leads, 'total_leads'),
    sync: requireBoolean(payload.sync, 'sync'),
    accounts_sync: toRecord(payload.accounts_sync) ?? {},
  }
}

export async function listRecentLeads(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { path: '/analytics/recent-leads' })
  return { status: status(payload), leads: requireObjectArray(payload.leads, 'leads') }
}

export async function listInteractions(
  input: z.infer<typeof listInteractionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 区间方向 schema 表达不了,本地挡住:上游对倒置区间回的是空桶而非报错,静默的错更难查。
  if (input.from > input.to) {
    throw new TBError('invalid_argument', 'from must be earlier than or equal to to')
  }

  const payload = await request(ctx, {
    path: '/analytics/interactions',
    query: {
      bucket: input.bucket,
      from: input.from,
      to: input.to,
      // account_ids 是**JSON 数组字符串**进 query,不是重复键也不是逗号分隔。
      account_ids: input.account_ids === undefined ? undefined : JSON.stringify(input.account_ids),
      campaign_id: input.campaign_id,
    },
  })
  return {
    status: status(payload),
    count: requireNumber(payload.count, 'count'),
    buckets: requireObjectArray(payload.buckets, 'buckets'),
  }
}

export async function listWorkspaceLabels(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { path: '/labels' })
  return { status: status(payload), labels: requireObjectArray(payload.labels, 'labels') }
}
