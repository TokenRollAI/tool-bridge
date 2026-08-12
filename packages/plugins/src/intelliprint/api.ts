/**
 * Intelliprint 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/intelliprint/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 全部 8 个 action 都是 GET + query 过滤器,差别只在路径与可用过滤器,故这里只有两个
 * 形状:list(带分页归一)与 get(把对象套进一个具名键)。
 *
 * 一处有意偏离上游:上游 `createIntelliprintError` 把 403 压成 401、把 404/422 压成 400。
 * 这里把原始状态交给 `upstreamError`,404 仍是 not_found —— 收敛各 provider 互不相同的
 * 错误口径正是 `_runtime/upstreamError.ts` 存在的理由。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getBackgroundInput,
  getMailingListInput,
  getMailingListRecipientInput,
  getPrintInput,
  listBackgroundsInput,
  listMailingListRecipientsInput,
  listMailingListsInput,
  listPrintsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'intelliprint'
const API_BASE = 'https://api.intelliprint.net/v1'

type Json = Record<string, unknown>

/**
 * 四个 list action 共有的分页/排序/字段选择入参。
 *
 * 不能直接拿某一个 action 的 `z.infer` 当这个类型:`sortField` 的**可选值各 action 不同**
 * (prints 能按 pages/cost 排,mailing list 只能按 name/recipients),钉死一个就把其余三个
 * 的合法取值排除在外了。这里只声明这四个字段的共同形状,枚举收窄留在各 action 自己的 schema。
 */
interface BaseListInput {
  fields?: string[]
  limit?: number
  skip?: number
  sortField?: string
  sortOrder?: 'asc' | 'desc'
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  const body = record(payload)
  const error = record(body?.error)
  return text(error?.message) ?? text(body?.message) ?? text(body?.error)
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

async function get(ctx: ProviderContext, path: string, query: URLSearchParams): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of query.entries()) url.searchParams.append(key, value)

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      // Intelliprint 的凭证是**裸 key**,没有 Bearer 前缀。
      headers: { accept: 'application/json', authorization: apiKey },
    })
    payload = await readPayload(response)
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error" 500。
    throw upstreamError(
      502,
      error instanceof Error ? `intelliprint request failed: ${error.message}` : 'intelliprint request failed',
    )
  }

  if (!response.ok) {
    throw upstreamError(
      response.status,
      errorMessage(payload) ?? (response.statusText || 'intelliprint request failed'),
    )
  }
  return payload
}

function requireObject(value: unknown, message = 'object response is required'): Json {
  const body = record(value)
  // 上游破了契约,不是调用方的错。
  if (body === undefined) throw upstreamError(502, message)
  return body
}

async function listObjects(ctx: ProviderContext, path: string, query: URLSearchParams): Promise<Json> {
  const body = requireObject(await get(ctx, path, query), 'Intelliprint list response must be an object')
  if (!Array.isArray(body.data)) throw upstreamError(502, 'Intelliprint data must be an array')

  const totalAvailable = body.total_available
  if (!Number.isInteger(totalAvailable)) throw upstreamError(502, 'Intelliprint total_available must be an integer')
  if (typeof body.has_more !== 'boolean') throw upstreamError(502, 'Intelliprint has_more must be a boolean')

  return {
    data: body.data.map(item => requireObject(item)),
    totalAvailable,
    hasMore: body.has_more,
    raw: body,
  }
}

async function getObject(
  ctx: ProviderContext,
  path: string,
  outputKey: 'background' | 'mailingList' | 'print' | 'recipient',
): Promise<Json> {
  const body = requireObject(
    await get(ctx, path, new URLSearchParams()),
    `Intelliprint ${outputKey} response must be an object`,
  )
  return { [outputKey]: body, raw: body }
}

/**
 * schema 把几个 get action 的路径 id 标成了可选(上游 action 定义如此),但上游 executor
 * 无条件要求它们。以上游行为为准在本地挡下,而不是去请求 `/prints/undefined`。
 */
function requirePathId(value: string | undefined, fieldName: string): string {
  if (value === undefined) throw new TBError('invalid_argument', `${fieldName} is required`)
  return encodeURIComponent(value)
}

function appendText(query: URLSearchParams, key: string, value: string | undefined): void {
  if (value !== undefined && value.trim() !== '') query.append(key, value.trim())
}

function appendBoolean(query: URLSearchParams, key: string, value: boolean | undefined): void {
  if (value !== undefined) query.append(key, String(value))
}

function baseListQuery(input: BaseListInput): URLSearchParams {
  const query = new URLSearchParams()
  if (input.limit !== undefined) query.append('limit', String(input.limit))
  if (input.skip !== undefined) query.append('skip', String(input.skip))
  appendText(query, 'sort_order', input.sortOrder)
  // fields 是重复同名键,不是逗号拼接。
  for (const field of input.fields ?? []) appendText(query, 'fields', field)
  appendText(query, 'sort_field', input.sortField)
  return query
}

export async function listPrints(
  input: z.infer<typeof listPrintsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const query = baseListQuery(input)
  appendBoolean(query, 'testmode', input.testmode)
  appendBoolean(query, 'confirmed', input.confirmed)
  appendText(query, 'type', input.type)
  appendText(query, 'reference', input.reference)
  appendText(query, 'letters.status', input.letterStatus)
  appendBoolean(query, 'letters.returned.acknowledged', input.returnedAcknowledged)
  return listObjects(ctx, '/prints', query)
}

export async function getPrint(
  input: z.infer<typeof getPrintInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getObject(ctx, `/prints/${requirePathId(input.id, 'id')}`, 'print')
}

export async function listBackgrounds(
  input: z.infer<typeof listBackgroundsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const query = baseListQuery(input)
  appendText(query, 'team', input.team)
  return listObjects(ctx, '/backgrounds', query)
}

export async function getBackground(
  input: z.infer<typeof getBackgroundInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getObject(ctx, `/backgrounds/${requirePathId(input.id, 'id')}`, 'background')
}

export async function listMailingLists(
  input: z.infer<typeof listMailingListsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listObjects(ctx, '/mailing_lists', baseListQuery(input))
}

export async function getMailingList(
  input: z.infer<typeof getMailingListInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getObject(ctx, `/mailing_lists/${requirePathId(input.id, 'id')}`, 'mailingList')
}

export async function listMailingListRecipients(
  input: z.infer<typeof listMailingListRecipientsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const mailingListId = encodeURIComponent(input.mailingListId)
  return listObjects(ctx, `/mailing_lists/${mailingListId}/recipients`, baseListQuery(input))
}

export async function getMailingListRecipient(
  input: z.infer<typeof getMailingListRecipientInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const mailingListId = requirePathId(input.mailingListId, 'mailingListId')
  const recipientId = requirePathId(input.id, 'id')
  return getObject(ctx, `/mailing_lists/${mailingListId}/recipients/${recipientId}`, 'recipient')
}
