/**
 * lemlist 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/lemlist/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * lemlist 的凭证走 **HTTP Basic**,用户名留空、API key 当密码(`Basic base64(":" + key)`),
 * 不是 Bearer。上游用 `node:buffer` 做 base64,这里换成 `btoa` —— 插件要能在 Workers 里跑。
 *
 * 与上游的一处有意偏离:上游 `mapLemlistError` 把 403 压成 401、把 5xx 压成 502。
 * 这里把原始状态交给 `upstreamError`。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getCampaignInput,
  listCampaignLeadsInput,
  listCampaignsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'lemlist'
const API_BASE = 'https://api.lemlist.com/api'

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

/** 上游 `compactObject`:剥掉值为 undefined 的键。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

function objectArray(value: unknown): Json[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map(record).filter((item): item is Json => item !== undefined)
}

function basicAuthHeader(apiKey: string): string {
  // API key 是 ASCII,但走 TextEncoder 再逐字节转,免得非 ASCII 的 key 让 btoa 直接抛。
  const bytes = new TextEncoder().encode(`:${apiKey}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  const body = record(payload)
  if (body === undefined) return undefined
  return text(body.message) ?? text(body.error) ?? text(body.reason)
}

/** 空体回 null;JSON 解析不了就把原文当 payload,留给消息提取。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, unknown> = {},
): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: basicAuthHeader(apiKey) },
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 500。
    throw upstreamError(502, error instanceof Error ? `lemlist 请求失败: ${error.message}` : 'lemlist 请求失败')
  }

  const payload = await readPayload(response)
  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? `lemlist 请求失败,HTTP ${response.status}`)
  }
  return payload
}

function requireObject(value: unknown, message: string): Json {
  const object = record(value)
  if (object === undefined) throw new TBError('unavailable', message, { retryable: true })
  return object
}

function requireArray(value: unknown, message: string): unknown[] {
  if (Array.isArray(value)) return value
  throw new TBError('unavailable', message, { retryable: true })
}

function normalizeTeam(value: unknown): Json {
  const team = requireObject(value, 'lemlist team 响应必须是 JSON 对象')
  return compact({
    _id: text(team._id),
    name: text(team.name),
    userIds: stringArray(team.userIds),
    createdBy: text(team.createdBy),
    createdAt: text(team.createdAt),
    beta: stringArray(team.beta),
    pictureId: text(team.pictureId),
    customDomain: text(team.customDomain),
    raw: team,
  })
}

function normalizeCampaign(value: unknown): Json {
  const campaign = requireObject(value, 'lemlist campaign 响应必须是 JSON 对象')
  return compact({
    _id: text(campaign._id),
    name: text(campaign.name),
    labels: stringArray(campaign.labels),
    createdAt: text(campaign.createdAt),
    createdBy: text(campaign.createdBy),
    status: text(campaign.status),
    sequenceId: text(campaign.sequenceId),
    scheduleIds: stringArray(campaign.scheduleIds),
    teamId: text(campaign.teamId),
    hasError: typeof campaign.hasError === 'boolean' ? campaign.hasError : undefined,
    errors: stringArray(campaign.errors),
    creator: record(campaign.creator),
    senders: objectArray(campaign.senders),
    raw: campaign,
  })
}

function normalizeLead(value: unknown): Json {
  const lead = requireObject(value, 'lemlist lead 响应必须是 JSON 对象')
  return compact({
    _id: text(lead._id),
    contactId: text(lead.contactId),
    state: text(lead.state),
    raw: lead,
  })
}

export async function getTeam(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { team: normalizeTeam(await request(ctx, '/team')) }
}

export async function listCampaigns(
  input: z.infer<typeof listCampaignsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/campaigns', {
    // lemlist 的 /campaigns 默认还是 v1 形状,固定请求 v2 才拿得到归一函数期望的字段。
    version: 'v2',
    limit: input.limit,
    offset: input.offset,
    page: input.page,
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    status: input.status,
    createdBy: input.createdBy,
  })
  return {
    campaigns: requireArray(payload, 'lemlist campaign 列表必须是数组').map(normalizeCampaign),
  }
}

export async function getCampaign(
  input: z.infer<typeof getCampaignInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 生成的 schema 把 campaignId 标成了 optional(上游 action 定义如此),但上游 executor
  // 拿它拼路径、缺了就 400。schema 表达不了这条,就在这里挡住,免得打出 /campaigns/undefined。
  const campaignId = input.campaignId?.trim()
  if (campaignId === undefined || campaignId === '') {
    throw new TBError('invalid_argument', 'campaignId is required')
  }
  return { campaign: normalizeCampaign(await request(ctx, `/campaigns/${encodeURIComponent(campaignId)}`)) }
}

export async function listCampaignLeads(
  input: z.infer<typeof listCampaignLeadsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 末尾这个斜杠是上游原样保留的:lemlist 的 leads 端点少了它会 404。
  const path = `/campaigns/${encodeURIComponent(input.campaignId.trim())}/leads/`
  const payload = await request(ctx, path, { state: input.state, limit: input.limit })
  return {
    leads: requireArray(payload, 'lemlist lead 列表必须是数组').map(normalizeLead),
  }
}
