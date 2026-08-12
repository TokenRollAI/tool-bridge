/**
 * Productboard 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/productboard/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Productboard v2 的形状很统一:**全部 13 个 action 都是 GET**,过滤器走 query,
 * 嵌套字段用方括号键(`owner[id]`、`metadata[source][system]`),数组用重复的 `type[]`。
 * 响应是 `{data, links}` 信封,`links.next` 是完整 URL —— 这里额外从中抽出 `pageCursor`,
 * 让调用方不必自己解析 URL 就能续页。
 *
 * 与上游的一处偏离:上游 `createProductboardError` 把 403 压成 401、把 404/422 压成 400。
 * 这里把原始状态原样交给 `upstreamError`,收敛各 provider 互不相同的错误口径。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getEntityConfigurationInput,
  getEntityInput,
  getMemberInput,
  getNoteConfigurationInput,
  getNoteInput,
  getTeamInput,
  listEntitiesInput,
  listEntityConfigurationsInput,
  listMembersInput,
  listNoteConfigurationsInput,
  listNotesInput,
  listTeamMembersInput,
  listTeamsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'productboard'
const API_BASE = 'https://api.productboard.com/v2'

type Json = Record<string, unknown>
type QueryValue = boolean | readonly string[] | string | undefined

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Productboard 的错误体有三种形状:JSON:API 风格的 `errors[]`、`{error:{...}}` 信封、
 * 以及扁平的 `{message|detail|title}`。逐个试,取不到就回落到状态码描述。
 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string' && payload.trim() !== '') return payload.trim()
  const body = record(payload)
  if (body === undefined) return undefined

  if (Array.isArray(body.errors)) {
    for (const item of body.errors) {
      const flat = text(item)
      if (flat !== undefined) return flat
      const entry = record(item)
      if (entry === undefined) continue
      // title 与 detail 都有时拼起来:前者是分类,后者才说清具体哪里错了。
      const parts = [text(entry.title), text(entry.detail), text(entry.message)].filter(part => part !== undefined)
      if (parts.length > 0) return parts.join(': ')
    }
  }

  const error = record(body.error)
  return text(error?.message) ?? text(error?.detail) ?? text(error?.title)
    ?? text(body.message) ?? text(body.detail) ?? text(body.title) ?? text(body.error)
}

/** 剥掉值为 undefined 的键;上游 `compactObject` 的等价物。 */
function compact(input: Record<string, QueryValue>): Record<string, QueryValue> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/**
 * 一批 action 的路径参数在生成的 schema 里标成 optional,但上游 executor 对它做
 * `requiredString` 断言。schema 是生成的、不动,故在这里补上必填校验。
 */
function requirePathParam(value: string | undefined, field: string): string {
  if (value === undefined || value === '') throw new TBError('invalid_argument', `${field} 是必填项`)
  return value
}

async function request(ctx: ProviderContext, path: string, query: Record<string, QueryValue> = {}): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      // 数组走重复的同名键(`type[]=a&type[]=b`),不是逗号分隔串。
      for (const item of value) url.searchParams.append(key, item)
      continue
    }
    url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障。
    throw upstreamError(502, error instanceof Error
      ? `productboard 请求失败: ${error.message}`
      : 'productboard 请求失败')
  }

  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  if (raw !== '') {
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      throw upstreamError(502, 'Productboard 返回了非法 JSON')
    }
  }

  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? `Productboard 请求失败,状态 ${response.status}`)
  }
  return payload
}

function requireItem(value: unknown): Json {
  const item = record(value)
  if (item === undefined) throw upstreamError(502, 'Productboard 响应项必须是对象')
  return item
}

/** `{data, links}` 信封 → `{<key>, nextPageCursor, nextPageUrl, links}`。 */
async function listPayload(
  ctx: ProviderContext,
  path: string,
  query: Record<string, QueryValue>,
  key: string,
): Promise<Json> {
  const payload = await request(ctx, path, query)
  const body = record(payload)
  if (body === undefined) throw upstreamError(502, 'Productboard 返回了非对象响应')
  if (!Array.isArray(body.data)) throw upstreamError(502, 'Productboard 列表响应的 data 必须是数组')

  const links = record(body.links) ?? {}
  const nextPageUrl = text(links.next) ?? null
  let nextPageCursor: string | null = null
  if (nextPageUrl !== null) {
    try {
      nextPageCursor = new URL(nextPageUrl).searchParams.get('pageCursor')
    } catch {
      // links.next 拼错不该让整页数据作废:调用方仍可拿 nextPageUrl 自己续页。
      nextPageCursor = null
    }
  }
  return { [key]: body.data.map(requireItem), nextPageCursor, nextPageUrl, links }
}

/** 单条端点有时裹 `{data}`、有时直接就是对象本身,两种都收。 */
async function singlePayload(
  ctx: ProviderContext,
  path: string,
  query: Record<string, QueryValue>,
  key: string,
): Promise<Json> {
  const payload = await request(ctx, path, query)
  const body = record(payload)
  if (body === undefined) throw upstreamError(502, 'Productboard 返回了非对象响应')
  return { [key]: requireItem(Object.hasOwn(body, 'data') ? body.data : payload) }
}

export function listEntityConfigurations(
  input: z.infer<typeof listEntityConfigurationsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listPayload(ctx, '/entities/configurations', { 'type[]': input.types }, 'configurations')
}

export function getEntityConfiguration(
  input: z.infer<typeof getEntityConfigurationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const type = requirePathParam(input.type, 'type')
  return singlePayload(ctx, `/entities/configurations/${encodeURIComponent(type)}`, {}, 'configuration')
}

export function listEntities(
  input: z.infer<typeof listEntitiesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listPayload(ctx, '/entities', compact({
    'pageCursor': input.pageCursor,
    'type[]': input.types,
    'fields[]': input.fields,
    'name': input.name,
    'owner[id]': input.ownerId,
    'owner[email]': input.ownerEmail,
    'status[id]': input.statusId,
    'status[name]': input.statusName,
    'archived': input.archived,
    'parent[id]': input.parentId,
    'metadata[source][system]': input.metadataSourceSystem,
    'metadata[source][recordId]': input.metadataSourceRecordId,
  }), 'entities')
}

export function getEntity(
  input: z.infer<typeof getEntityInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return singlePayload(ctx, `/entities/${encodeURIComponent(input.id)}`, { 'fields[]': input.fields }, 'entity')
}

export function listNoteConfigurations(
  input: z.infer<typeof listNoteConfigurationsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listPayload(ctx, '/notes/configurations', { 'type[]': input.types }, 'configurations')
}

export function getNoteConfiguration(
  input: z.infer<typeof getNoteConfigurationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const type = requirePathParam(input.type, 'type')
  return singlePayload(ctx, `/notes/configurations/${encodeURIComponent(type)}`, {}, 'configuration')
}

export function listNotes(
  input: z.infer<typeof listNotesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listPayload(ctx, '/notes', compact({
    'pageCursor': input.pageCursor,
    'archived': input.archived,
    'processed': input.processed,
    'type[]': input.types,
    'owner[id]': input.ownerId,
    'owner[email]': input.ownerEmail,
    'creator[id]': input.creatorId,
    'creator[email]': input.creatorEmail,
    'metadata[source][system]': input.metadataSourceSystem,
    'metadata[source][recordId]': input.metadataSourceRecordId,
    'createdFrom': input.createdFrom,
    'createdTo': input.createdTo,
    'updatedFrom': input.updatedFrom,
    'updatedTo': input.updatedTo,
    'fields[]': input.fields,
  }), 'notes')
}

export function getNote(
  input: z.infer<typeof getNoteInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return singlePayload(ctx, `/notes/${encodeURIComponent(input.id)}`, { 'fields[]': input.fields }, 'note')
}

export function listMembers(
  input: z.infer<typeof listMembersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listPayload(ctx, '/members', compact({
    'pageCursor': input.pageCursor,
    'query': input.query,
    'roles[]': input.roles,
    'includeDisabled': input.includeDisabled,
    'includeInvitationPending': input.includeInvitationPending,
  }), 'members')
}

export function getMember(
  input: z.infer<typeof getMemberInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const id = requirePathParam(input.id, 'id')
  return singlePayload(ctx, `/members/${encodeURIComponent(id)}`, {}, 'member')
}

export function listTeams(
  input: z.infer<typeof listTeamsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listPayload(ctx, '/teams', compact({
    pageCursor: input.pageCursor,
    name: input.name,
    handle: input.handle,
    query: input.query,
  }), 'teams')
}

export function getTeam(
  input: z.infer<typeof getTeamInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const id = requirePathParam(input.id, 'id')
  return singlePayload(ctx, `/teams/${encodeURIComponent(id)}`, {}, 'team')
}

export function listTeamMembers(
  input: z.infer<typeof listTeamMembersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listPayload(
    ctx,
    `/teams/${encodeURIComponent(input.teamId)}/members`,
    { pageCursor: input.pageCursor },
    'members',
  )
}
