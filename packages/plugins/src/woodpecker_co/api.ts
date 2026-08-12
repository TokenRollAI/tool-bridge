/**
 * Woodpecker.co 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/woodpecker_co/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Woodpecker 同时挂着两代 API,这决定了本文件大部分的形状:
 * - v2(`/v2/users`、`/v2/mailboxes`)是常规 REST,错误靠 HTTP 状态表达。
 * - v1(`/v1/campaign_list`、`/v1/prospects`)**用 HTTP 200 回错误**,把失败塞进
 *   `status.status === 'ERROR'`。故成功判定不能只看 `response.ok`。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getCampaignInput,
  getCampaignStatisticsInput,
  getMailboxInput,
  listCampaignsInput,
  listProspectsInput,
  listUsersInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'woodpecker_co'
const API_BASE = 'https://api.woodpecker.co/rest'

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

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function nullableInteger(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** v1 端点用 200 + `status.status === 'ERROR'` 表达失败。 */
function isV1Error(payload: unknown): boolean {
  return text(record(record(payload)?.status)?.status) === 'ERROR'
}

function v1ErrorCode(payload: unknown): string | undefined {
  return text(record(record(payload)?.status)?.code)
}

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  const body = record(payload)
  if (body === undefined) return undefined
  const direct = text(body.detail) ?? text(body.message) ?? text(body.error)
  if (direct !== undefined) return direct
  return text(record(body.status)?.msg)
}

/** 空体按 `{}` 处理;非 200 的坏 JSON 把原文当消息,免得丢掉唯一的诊断线索。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    if (response.ok) throw new TBError('unavailable', 'Woodpecker.co 返回了非法 JSON', { retryable: true })
    return { message: body }
  }
}

async function request(
  ctx: ProviderContext,
  path: string,
  params: Record<string, string | undefined> = {},
): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  // base 末尾补 `/`、path 去掉首 `/`:否则 URL 相对解析会吃掉 `/rest` 这一段。
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, `${API_BASE}/`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
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
    throw upstreamError(
      502,
      error instanceof Error ? `Woodpecker.co 请求失败: ${error.message}` : 'Woodpecker.co 请求失败',
    )
  }

  const payload = await readPayload(response)
  if (!response.ok || isV1Error(payload)) {
    const message = errorMessage(payload) ?? `Woodpecker.co 请求失败,HTTP ${response.status}`
    const code = v1ErrorCode(payload)
    // v1 的限流/会话失效走 200,只能靠 code 认;不翻译就会被当成 200 → invalid_argument。
    if (code === 'E_TOO_MANY_REQUESTS') throw upstreamError(429, message)
    if (code === 'E_SESSION') throw upstreamError(401, message)
    throw upstreamError(response.status, message)
  }

  return payload
}

function requireRecord(payload: unknown): Json {
  const object = record(payload)
  if (object === undefined) {
    throw new TBError('unavailable', 'Woodpecker.co 返回了非对象响应', { retryable: true })
  }
  return object
}

function isV1EmptyList(payload: Json): boolean {
  return text(record(payload.status)?.status) === 'OK' && text(payload.message) !== undefined
}

/**
 * v1 列表端点的响应有两种形状:成功是裸数组,"空结果"却回一个对象
 * (`{status:{status:'OK'},message:'...'}`)。两者都要归一成数组。
 */
function readV1List(payload: unknown): { items: unknown[], raw: Json | Json[] } {
  if (Array.isArray(payload)) {
    return { items: payload, raw: payload.map(item => record(item) ?? {}) }
  }
  const object = record(payload)
  if (object !== undefined && (Object.keys(object).length === 0 || isV1EmptyList(object))) {
    return { items: [], raw: object }
  }
  throw new TBError('unavailable', 'Woodpecker.co 返回了非法 JSON 数组', { retryable: true })
}

function normalizeUser(value: unknown): Json {
  const object = record(value) ?? {}
  return {
    id: nullableInteger(object.id),
    name: nullableString(object.name),
    email: nullableString(object.email),
    role: nullableString(object.role),
    raw: object,
  }
}

function normalizeUsersPayload(payload: unknown): Json {
  const object = requireRecord(payload)
  const pagination = record(object.pagination_data) ?? {}
  return {
    users: array(object.content).map(normalizeUser),
    pagination: {
      total_elements: nullableInteger(pagination.total_elements),
      total_pages: nullableInteger(pagination.total_pages),
      current_page_number: nullableInteger(pagination.current_page_number),
      page_size: nullableInteger(pagination.page_size),
    },
    raw: object,
  }
}

function normalizeCampaign(object: Json): Json {
  return {
    id: nullableInteger(object.id),
    name: nullableString(object.name),
    status: nullableString(object.status),
    raw: object,
  }
}

function normalizeProspect(value: unknown): Json {
  const object = record(value) ?? {}
  return {
    id: nullableInteger(object.id),
    email: nullableString(object.email),
    status: nullableString(object.status),
    first_name: nullableString(object.first_name),
    last_name: nullableString(object.last_name),
    raw: object,
  }
}

function normalizeMailbox(object: Json): Json {
  const details = record(object.details) ?? {}
  return {
    id: nullableInteger(object.id),
    type: nullableString(object.type),
    email: nullableString(details.email),
    provider: nullableString(details.provider),
    login: nullableString(details.login),
    details,
    raw: object,
  }
}

export async function listUsers(
  input: z.infer<typeof listUsersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return normalizeUsersPayload(await request(ctx, '/v2/users', {
    page: input.page === undefined ? undefined : String(input.page),
    sort: input.sort,
  }))
}

export async function listCampaigns(
  input: z.infer<typeof listCampaignsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const list = readV1List(await request(ctx, '/v1/campaign_list', { status: input.status }))
  return {
    campaigns: list.items.map(item => normalizeCampaign(record(item) ?? {})),
    raw: list.raw,
  }
}

export async function getCampaign(
  input: z.infer<typeof getCampaignInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/v2/campaigns/${encodeURIComponent(String(input.campaign_id))}`
  return { campaign: normalizeCampaign(requireRecord(await request(ctx, path))) }
}

export async function getCampaignStatistics(
  input: z.infer<typeof getCampaignStatisticsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // v2 没有单独的统计端点:统计藏在 v1 列表按 id 过滤后那一条的 `stats` 里。
  const list = readV1List(await request(ctx, '/v1/campaign_list', { id: String(input.campaign_id) }))
  const campaign = record(list.items[0]) ?? {}
  return {
    statistics: record(campaign.stats) ?? {},
    raw: campaign,
  }
}

export async function listProspects(
  input: z.infer<typeof listProspectsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const list = readV1List(await request(ctx, '/v1/prospects', {
    page: input.page === undefined ? undefined : String(input.page),
    per_page: input.per_page === undefined ? undefined : String(input.per_page),
    sort: input.sort,
    // 上游把 ID 数组序列化成逗号串,官方 id 过滤器就是这个形状。
    id: input.ids?.join(','),
    status: input.status,
    contacted: input.contacted === undefined ? undefined : String(input.contacted),
    interested: input.interested,
    activity: input.activity,
    diff: input.diff,
  }))
  return {
    prospects: list.items.map(normalizeProspect),
    raw: list.raw,
  }
}

export async function listMailboxes(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const mailboxes = array(await request(ctx, '/v2/mailboxes'))
  return {
    mailboxes: mailboxes.map(item => normalizeMailbox(record(item) ?? {})),
    raw: mailboxes.map(item => record(item) ?? {}),
  }
}

export async function getMailbox(
  input: z.infer<typeof getMailboxInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/v2/mailboxes/${encodeURIComponent(String(input.mailbox_id))}`
  return { mailbox: normalizeMailbox(requireRecord(await request(ctx, path))) }
}
