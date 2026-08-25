/**
 * Front 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/front/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 与上游的一处有意偏离:上游 `createFrontError` 把 403 压成 401、把 404/422 压成 400。
 * 这里把原始状态原样交给 `upstreamError`,由 `_runtime/upstreamError.ts` 统一口径。
 */

import type { z } from 'zod/v4'
import type {
  createContactInput,
  getContactInput,
  listContactsInput,
  updateContactInput,
} from './schema'
import { asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'front'
const API_BASE = 'https://api2.frontapp.com'
/** 上游对 Front 设的请求超时;超时与"上游不通"要分开归一(504 vs 502)。 */
const REQUEST_TIMEOUT_MS = 15_000
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>

interface FrontContactHandle {
  handle: string
  source: string
}

/** Front 的错误体形状不止一种,四个候选键按上游顺序取第一个有文本的。 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  const body = record(payload)
  if (body === undefined) return undefined
  const nested = record(body.error)
  return text(body.message) ?? text(body._error) ?? text(body.error) ?? text(nested?.message)
}

interface RequestInput {
  body?: Json
  method: 'GET' | 'PATCH' | 'POST'
  /** 有序 pair:URL 里 query 的出现顺序照抄上游,让打到上游的 URL 可预期。 */
  query?: Array<[string, unknown]>
}

async function request(ctx: ProviderContext, path: string, input: RequestInput): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const query: Array<[string, number | string]> = []
  for (const [key, value] of input.query ?? []) {
    // 上游 setOptionalSearchParam 只认非空字符串与数字,其余(含空串)静默跳过。
    if (typeof value === 'string' && value !== '') query.push([key, value])
    else if (typeof value === 'number') query.push([key, value])
  }
  const { data } = await http.request({
    path,
    method: input.method,
    query,
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    ...(input.body === undefined ? {} : { json: input.body }),
    timeoutMs: REQUEST_TIMEOUT_MS,
    invalidJson: 'text',
    mapError: ({ data: payload, status }) => upstreamError(
      status,
      errorMessage(payload) ?? `front 返回 HTTP ${status}`,
    ),
    mapTransportError: ({ kind, message }) => kind === 'timeout'
      ? upstreamError(504, 'front 请求超时')
      : upstreamError(502, message === undefined ? 'front 请求失败' : `front 请求失败: ${message}`),
  })
  return data ?? {}
}

/** 列表响应统一裹在 `_results` 里;拿不到就是上游破了契约,不是调用方的错。 */
function readResults(payload: unknown): unknown[] {
  const body = record(payload)
  if (body === undefined) throw upstreamError(502, 'front response must be an object')
  if (!Array.isArray(body._results)) throw upstreamError(502, 'front response is missing _results')
  return body._results
}

function requiredString(value: unknown, fieldName: string): string {
  const result = text(value)
  if (result === undefined) throw upstreamError(502, `${fieldName} is required`)
  return result
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return text(value) ?? null
}

function requiredBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') throw upstreamError(502, `${fieldName} must be a boolean`)
  return value
}

function readArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw upstreamError(502, 'front array field has invalid shape')
  return value
}

function readStringArray(value: unknown): string[] {
  return readArray(value).map(item => requiredString(item, 'array item'))
}

function readObject(value: unknown, name: string): Json {
  const body = record(value)
  if (body === undefined) throw upstreamError(502, `${name} must be an object`)
  return body
}

function normalizeContactHandle(value: unknown): FrontContactHandle {
  const body = readObject(value, 'front contact handle')
  return {
    handle: requiredString(body.handle, 'contactHandle.handle'),
    source: requiredString(body.source, 'contactHandle.source'),
  }
}

function normalizeContactList(value: unknown): Json {
  const body = readObject(value, 'front contact list')
  return {
    id: requiredString(body.id, 'contactList.id'),
    name: requiredString(body.name, 'contactList.name'),
    isPrivate: requiredBoolean(body.is_private, 'contactList.is_private'),
  }
}

function normalizeContact(value: unknown): Json {
  const body = readObject(value, 'front contact')
  return {
    id: requiredString(body.id, 'contact.id'),
    name: nullableString(body.name),
    description: nullableString(body.description),
    avatarUrl: nullableString(body.avatar_url),
    links: readStringArray(body.links),
    lists: readArray(body.lists).map(item => normalizeContactList(item)),
    handles: readArray(body.handles).map(item => normalizeContactHandle(item)),
    customFields: record(body.custom_fields) ?? {},
    isPrivate: requiredBoolean(body.is_private, 'contact.is_private'),
  }
}

function normalizeTeammate(value: unknown): Json {
  const body = readObject(value, 'front teammate')
  return {
    id: requiredString(body.id, 'teammate.id'),
    email: requiredString(body.email, 'teammate.email'),
    username: requiredString(body.username, 'teammate.username'),
    firstName: requiredString(body.first_name, 'teammate.first_name'),
    lastName: requiredString(body.last_name, 'teammate.last_name'),
    isAdmin: requiredBoolean(body.is_admin, 'teammate.is_admin'),
    isAvailable: requiredBoolean(body.is_available, 'teammate.is_available'),
    isBlocked: requiredBoolean(body.is_blocked, 'teammate.is_blocked'),
    type: requiredString(body.type, 'teammate.type'),
    customFields: record(body.custom_fields) ?? {},
  }
}

/**
 * `next` 是一条完整 URL,调用方要的是能直接回传的 `page_token`,故顺手拆出来。
 * 拆不动(非法 URL / 没有该参数)就给 null,不让分页元信息把整次列表调用带崩。
 */
function extractPageToken(next: string | null): string | null {
  if (next === null) return null
  try {
    return new URL(next).searchParams.get('page_token')
  } catch {
    return null
  }
}

function normalizePagination(payload: unknown): Json {
  const body = readObject(payload, 'front list response')
  const next = text(record(body._pagination)?.next) ?? null
  return { next, nextPageToken: extractPageToken(next) }
}

/** create/update 共用的 body 组装;值为 undefined 的键不出现(上游 compactObject)。 */
function buildContactBody(
  contact: z.infer<typeof updateContactInput>['contact'],
  handles?: FrontContactHandle[],
): Json {
  const body: Json = {}
  const name = text(contact.name)
  if (name !== undefined) body.name = name
  const description = text(contact.description)
  if (description !== undefined) body.description = description
  if (contact.links !== undefined) body.links = readStringArray(contact.links)
  if (contact.listNames !== undefined) body.list_names = readStringArray(contact.listNames)
  if (contact.customFields !== undefined) body.custom_fields = contact.customFields
  if (handles !== undefined) body.handles = handles
  return body
}

export async function listContacts(
  input: z.infer<typeof listContactsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/contacts', {
    method: 'GET',
    query: [
      ['q', input.query],
      ['limit', input.limit],
      ['page_token', input.pageToken],
      ['sort_by', input.sortBy],
      ['sort_order', input.sortOrder],
    ],
  })
  return {
    contacts: readResults(payload).map(item => normalizeContact(item)),
    pagination: normalizePagination(payload),
  }
}

export async function getContact(
  input: z.infer<typeof getContactInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/contacts/${encodeURIComponent(input.contactId)}`
  return { contact: normalizeContact(await request(ctx, path, { method: 'GET' })) }
}

export async function createContact(
  input: z.infer<typeof createContactInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = buildContactBody(input.contact, input.handles)
  return { contact: normalizeContact(await request(ctx, '/contacts', { method: 'POST', body })) }
}

/**
 * Front 的 PATCH 回 204 空体,没有 contact 可归一化,故只回一个 `success`。
 * body 恒有(哪怕是 `{}`),content-type 也就恒被带上 —— 与上游一致。
 */
export async function updateContact(
  input: z.infer<typeof updateContactInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/contacts/${encodeURIComponent(input.contactId)}`
  await request(ctx, path, { method: 'PATCH', body: buildContactBody(input.contact) })
  return { success: true }
}

export async function listTeammates(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/teammates', { method: 'GET' })
  return { teammates: readResults(payload).map(item => normalizeTeammate(item)) }
}
