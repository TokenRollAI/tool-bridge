/**
 * Loomio 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/loomio/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 两处有意偏离上游:
 * - 上游 `mapLoomioError` 把 403 压成 401、422 压成 400、5xx 压成 502。这里把原始状态交给
 *   `upstreamError`,归一后的七码与上游完全一致(403/401 都是 permission_denied、422/400
 *   都是 invalid_argument、502/5xx 都是 unavailable),但少一次状态改写。
 * - 上游用同一个 `readRequiredPositiveInteger`(抛 400)既校验入参 `groupId` 又校验**响应里**
 *   的 poll id。入参那一路已由 Zod 挡在前面,剩下的全是响应形状问题,改抛 502 —— 上游回了
 *   没有数字 id 的 poll 是它破了契约,不该报成"你的入参不对"。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { getPollInput, listPollsInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'loomio'
const API_BASE = 'https://www.loomio.com/api/b2'

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString`:去空白后非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `optionalInteger`:**只**认真正的整数,数字字符串不算。 */
function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

/** Loomio 的错误体形状不定:纯文本、`{error:[...]}`、`{message}`、`{detail}` 都出现过。 */
function errorMessage(payload: unknown): string | undefined {
  // 纯文本错误体截断,避免把整页 HTML 当消息回给调用方。
  if (typeof payload === 'string') return text(payload)?.slice(0, 300)
  const body = record(payload)
  if (body === undefined) return undefined
  if (Array.isArray(body.error)) {
    const first = body.error.find(item => text(item) !== undefined)
    if (first !== undefined) return text(first)
  }
  return text(body.message) ?? text(body.error) ?? text(body.detail)
}

/** 解析不出 JSON 就把原文本身当 payload,留给消息提取。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

async function request(ctx: ProviderContext, path: string, query?: Json): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(`${API_BASE}${path}`)
  // Loomio b2 的凭证走 query 参数,没有请求头形式。
  url.searchParams.set('api_key', apiKey)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    payload = await readPayload(response)
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error" 500。
    throw upstreamError(502, error instanceof Error ? `loomio request failed: ${error.message}` : 'loomio request failed')
  }

  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? `loomio request failed with status ${response.status}`)
  }
  return payload
}

function requireObjectPayload(payload: unknown, label: string): Json {
  const body = record(payload)
  if (body === undefined) throw upstreamError(502, `${label} response must be a JSON object`)
  return body
}

/**
 * 多个候选键里取第一个"取得出值"的:Loomio 同一字段在 snake_case 与 camelCase 之间飘。
 * 键存在但类型不对时**继续看下一个候选键**(而不是当场判负),照抄上游。
 */
function nullableString(body: Json, ...keys: string[]): string | null {
  for (const key of keys) {
    if (!(key in body)) continue
    const value = body[key]
    if (value === null) return null
    if (typeof value === 'string') return value
  }
  return null
}

function nullableInteger(body: Json, ...keys: string[]): number | null {
  for (const key of keys) {
    if (!(key in body)) continue
    const parsed = integer(body[key])
    if (parsed !== undefined) return parsed
    if (body[key] === null) return null
  }
  return null
}

function nullableObject(body: Json, ...keys: string[]): Json | null {
  for (const key of keys) {
    if (!(key in body)) continue
    if (body[key] === null) return null
    const value = record(body[key])
    if (value !== undefined) return value
  }
  return null
}

function requirePositiveInteger(value: unknown, label: string): number {
  const parsed = integer(value)
  if (parsed === undefined || parsed <= 0) throw upstreamError(502, `${label} must be a positive integer`)
  return parsed
}

/** list 与 detail 共有的字段;`raw` 始终保留完整原体,归一化丢掉的信息在那里找得到。 */
function normalizePollBase(body: Json): Json {
  return {
    id: requirePositiveInteger(body.id, 'id'),
    key: nullableString(body, 'key'),
    title: nullableString(body, 'title'),
    pollType: nullableString(body, 'poll_type', 'pollType'),
    groupId: nullableInteger(body, 'group_id', 'groupId'),
    authorId: nullableInteger(body, 'author_id', 'authorId'),
    discussionId: nullableInteger(body, 'discussion_id', 'discussionId'),
    createdAt: nullableString(body, 'created_at', 'createdAt'),
    closingAt: nullableString(body, 'closing_at', 'closingAt'),
    closedAt: nullableString(body, 'closed_at', 'closedAt'),
    currentOutcome: nullableObject(body, 'current_outcome', 'currentOutcome'),
    raw: body,
  }
}

function normalizeOptions(value: unknown): Json[] {
  // options 缺失或不是数组时回空数组(而不是报错):它只在 detail 里出现,不是必备字段。
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const body = requireObjectPayload(item, 'loomio poll option')
    return {
      id: requirePositiveInteger(body.id, 'id'),
      name: nullableString(body, 'name'),
      priority: nullableInteger(body, 'priority'),
      icon: nullableString(body, 'icon'),
      color: nullableString(body, 'color'),
      prompt: nullableString(body, 'prompt'),
      meaning: nullableString(body, 'meaning'),
      raw: body,
    }
  })
}

export async function listPolls(
  input: z.infer<typeof listPollsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/polls', {
    group_id: input.groupId,
    status: input.status,
    limit: input.limit,
    offset: input.offset,
  })

  const body = requireObjectPayload(payload, 'loomio poll list')
  if (!Array.isArray(body.polls)) throw upstreamError(502, 'loomio poll list polls must be an array')
  const polls = body.polls.map(item => normalizePollBase(requireObjectPayload(item, 'loomio poll summary')))
  const rawMeta = record(body.meta) ?? null

  return {
    polls,
    // meta.total 读不出时按本页条数兜底,调用方拿到的 total 永远是数字。
    total: (rawMeta === null ? undefined : integer(rawMeta.total)) ?? polls.length,
    rawMeta,
  }
}

export async function getPoll(
  input: z.infer<typeof getPollInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // schema 把 pollIdOrKey 标成了可选(上游 action 定义如此),但上游 executor 无条件要求它。
  // 以上游行为为准在本地挡下,而不是去请求 /polls/undefined。
  if (input.pollIdOrKey === undefined) {
    throw new TBError('invalid_argument', 'pollIdOrKey is required.')
  }

  const payload = await request(ctx, `/polls/${encodeURIComponent(input.pollIdOrKey)}`)
  const body = requireObjectPayload(payload, 'loomio poll detail')
  return {
    poll: {
      ...normalizePollBase(body),
      status: nullableString(body, 'status'),
      details: nullableString(body, 'details'),
      options: normalizeOptions(body.options),
    },
  }
}
