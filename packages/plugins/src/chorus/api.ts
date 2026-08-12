/**
 * Chorus 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/chorus/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Chorus 的三个特点决定了这里的形状:
 * - 凭证是 **raw Authorization 头**,不带 `Bearer ` 前缀 —— 上游 API 就这么设计的。
 * - 两套 API 并存:`/api/v1/*` 是 **JSON:API**(响应包在 `data` 里、Accept 必须是
 *   `application/vnd.api+json`),`/v3/engagements` 是普通 JSON。两者的 Accept 头不同,
 *   发错了上游会拒。
 * - 入参是 camelCase,query 参数是 snake_case 或方括号形式(`filter[recipients]`、
 *   `page[size]`),每个 action 有自己的一张映射表,数组一律折成逗号分隔的单个参数。
 *
 * 上游错误映射带一个 `phase` 轴(校验凭证阶段把 401 压成 400),tool-bridge 没有
 * "校验凭证"这一相(探针就是一次真实调用),故不保留;状态交给 `upstreamError` 归一。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getConversationInput,
  getCurrentUserInput,
  getTeamInput,
  listEngagementsInput,
  listScorecardsInput,
  listTeamsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'chorus'
const API_BASE = 'https://chorus.ai/'
const JSON_API_ACCEPT = 'application/vnd.api+json'
const PLAIN_ACCEPT = 'application/json'
const CURRENT_USER_PATH = 'api/v1/users/me'

type Json = Record<string, unknown>

/** 上游 `optionalString`:非字符串、或去空白后为空,一律当作"没给"。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `formatScalarQueryParam`:空串当没给,其余一律 `String()`(`false` 与 `0` 都要发)。 */
function scalar(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return String(value)
}

/** 上游 `formatCommaSeparatedArray`:数组折成一个逗号分隔的参数,空数组当没给。 */
function commaList(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  return value.map(item => String(item)).join(',')
}

/** Chorus 的错误体有 JSON:API(`errors[0].detail`)与普通两套形状,都要能读。 */
function errorMessage(payload: unknown, status: number): string {
  const direct = text(payload)
  if (direct !== undefined) return direct

  const body = record(payload)
  const first = record(Array.isArray(body?.errors) ? body.errors[0] : undefined)
  return text(body?.message)
    ?? text(body?.detail)
    ?? text(body?.error)
    ?? text(first?.detail)
    ?? text(first?.title)
    ?? `Chorus request failed with status ${status}`
}

interface RequestInput {
  accept: string
  query?: Record<string, string | undefined>
}

async function request(ctx: ProviderContext, path: string, input: RequestInput): Promise<unknown> {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  const response = await guardedFetch(url.toString(), {
    method: 'GET',
    headers: {
      accept: input.accept,
      authorization: requireApiKey(ctx, SERVICE),
    },
  })

  const raw = await response.text()
  let payload: unknown = null
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw)
    } catch {
      // 2xx 上回非 JSON 只能是上游坏了;错误响应上回 HTML 错误页却很常见,
      // 那时把原文当消息比报"响应不是 JSON"准。
      if (response.ok) throw upstreamError(502, 'invalid Chorus JSON response')
      payload = raw
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return payload
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错(502 → unavailable)。 */
function requireObject(value: unknown, label: string): Json {
  const object = record(value)
  if (object === undefined) throw upstreamError(502, `${label} is invalid`)
  return object
}

function requireObjectArray(value: unknown, label: string): Json[] {
  if (!Array.isArray(value)) throw upstreamError(502, `${label} is invalid`)
  return value.map(item => requireObject(item, `${label} item`))
}

/** JSON:API 的单资源:真正的内容在 `data` 里。 */
function jsonApiResource(payload: unknown, label: string): Json {
  return requireObject(requireObject(payload, label).data, `${label} data`)
}

function jsonApiResourceArray(payload: unknown, label: string): Json[] {
  return requireObjectArray(requireObject(payload, label).data, `${label} data`)
}

export async function getCurrentUser(
  _input: z.infer<typeof getCurrentUserInput>,
  ctx: ProviderContext,
): Promise<{ user: Json }> {
  const payload = await request(ctx, CURRENT_USER_PATH, { accept: JSON_API_ACCEPT })
  return { user: jsonApiResource(payload, 'Chorus current user response') }
}

export async function listTeams(
  _input: z.infer<typeof listTeamsInput>,
  ctx: ProviderContext,
): Promise<{ teams: Json[] }> {
  const payload = await request(ctx, 'api/v1/teams', { accept: JSON_API_ACCEPT })
  return { teams: jsonApiResourceArray(payload, 'Chorus teams response') }
}

export async function getTeam(
  input: z.infer<typeof getTeamInput>,
  ctx: ProviderContext,
): Promise<{ team: Json }> {
  // id 在生成的 schema 里是 optional —— 上游 `s.object` 只在有显式 optional 字段时才产
  // required 列表,单必填字段的对象就漏了 required,这个洞被等价地搬了过来。
  const id = text(input.id)
  if (id === undefined) throw new TBError('invalid_argument', 'get_team 需要 id')

  const payload = await request(ctx, `api/v1/teams/${encodeURIComponent(id)}`, { accept: JSON_API_ACCEPT })
  return { team: jsonApiResource(payload, 'Chorus team response') }
}

export async function listEngagements(
  input: z.infer<typeof listEngagementsInput>,
  ctx: ProviderContext,
): Promise<{ continuationKey: string | null, engagements: Json[] }> {
  const payload = await request(ctx, 'v3/engagements', {
    accept: PLAIN_ACCEPT,
    query: {
      compliance: scalar(input.compliance),
      continuation_key: scalar(input.continuationKey),
      disposition_connected: scalar(input.dispositionConnected),
      disposition_gatekeeper: scalar(input.dispositionGatekeeper),
      disposition_tree: scalar(input.dispositionTree),
      disposition_voicemail: scalar(input.dispositionVoicemail),
      engagement_id: commaList(input.engagementIds),
      engagement_type: scalar(input.engagementType),
      content_type: scalar(input.contentType),
      max_date: scalar(input.maxDate),
      max_duration: scalar(input.maxDuration),
      min_date: scalar(input.minDate),
      min_duration: scalar(input.minDuration),
      participants_email: scalar(input.participantsEmail),
      team_id: commaList(input.teamIds),
      user_id: commaList(input.userIds),
      with_trackers: scalar(input.withTrackers),
    },
  })

  const body = requireObject(payload, 'Chorus engagements response')
  return {
    engagements: requireObjectArray(body.engagements, 'Chorus engagements'),
    // 没有下一页时明确回 null(而非省略键):调用方靠它判断分页是否到头。
    continuationKey: text(body.continuation_key) ?? null,
  }
}

export async function getConversation(
  input: z.infer<typeof getConversationInput>,
  ctx: ProviderContext,
): Promise<{ conversation: Json }> {
  const payload = await request(ctx, `api/v1/conversations/${encodeURIComponent(input.id)}`, {
    accept: JSON_API_ACCEPT,
    query: {
      fields: commaList(input.fields),
      force_regeneration: scalar(input.forceRegeneration),
      skip_summary_generation: scalar(input.skipSummaryGeneration),
      include_meeting_metadata: scalar(input.includeMeetingMetadata),
    },
  })
  return { conversation: jsonApiResource(payload, 'Chorus conversation response') }
}

export async function listScorecards(
  input: z.infer<typeof listScorecardsInput>,
  ctx: ProviderContext,
): Promise<{ scorecards: Json[] }> {
  const payload = await request(ctx, 'api/v1/scorecards', {
    accept: JSON_API_ACCEPT,
    // JSON:API 的方括号参数名原样发出,不做 URL 转义之外的处理。
    query: {
      'filter[recipients]': commaList(input.recipientIds),
      'filter[reviewers]': commaList(input.reviewerIds),
      'filter[initiative]': scalar(input.initiativeId),
      'filter[submitted]': scalar(input.submittedRange),
      'page[size]': scalar(input.pageSize),
      'page[number]': scalar(input.pageNumber),
    },
  })
  return { scorecards: jsonApiResourceArray(payload, 'Chorus scorecards response') }
}
