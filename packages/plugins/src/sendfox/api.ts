/**
 * SendFox 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/sendfox/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * SendFox 的两个特点决定了这里的形状:
 * - 列表端点回的是 Laravel 风格的**扁平分页信封**(`{data,current_page,total,per_page}`),
 *   整形成 `{contacts|lists, meta}`;上游在拿不到 `data` 数组时**不报错**,而是回一个空页
 *   —— 照搬这个行为,免得把"这一页没有数据"变成一次失败。
 * - 一批 action 的 id 在生成的 schema 里是 optional,但上游 executor 对它做必填断言。
 *   schema 不动,由 `requireId` 在这里补上。
 *
 * 与上游的一处偏离:上游 `createSendfoxError` 把 404/409/422 压成 400。这里把原始状态
 * 原样交给 `upstreamError`,收敛各 provider 互不相同的错误口径。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  addContactToListInput,
  createContactInput,
  createContactListInput,
  deleteContactInput,
  deleteContactListInput,
  getContactInput,
  getContactListInput,
  listContactListsInput,
  listContactsInListInput,
  listContactsInput,
  removeContactFromListInput,
  unsubscribeContactInput,
  updateContactInput,
  updateContactListInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'sendfox'
const API_BASE = 'https://api.sendfox.com'

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * SendFox 的错误体是 `{message}`,校验失败时是 Laravel 的
 * `{errors:{field:["..."]}}`;两种都取,取不到就回落到状态行。
 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  const body = record(payload)
  if (body === undefined) return undefined
  const message = text(body.message)
  if (message !== undefined) return message
  const errors = record(body.errors)
  const first = errors === undefined ? undefined : Object.values(errors)[0]
  return Array.isArray(first) ? first.find((item): item is string => typeof item === 'string') : undefined
}

/** 剥掉值为 undefined 的键;上游 `compactObject` 的等价物。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/**
 * 一批 action 的 id 在生成的 schema 里标成 optional,但上游 executor 对它做
 * `readPositiveInteger` 断言。schema 是生成的、不动,故在这里补上必填校验。
 */
function requireId(value: number | undefined, field: string): number {
  if (value === undefined) throw new TBError('invalid_argument', `${field} 是必填项`)
  return value
}

interface RequestInput {
  body?: Json
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST'
  query?: Record<string, boolean | number | string | undefined>
}

async function request(ctx: ProviderContext, path: string, input: RequestInput = {}): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === undefined) continue
    url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method ?? 'GET',
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障。
    throw upstreamError(502, error instanceof Error ? `sendfox 请求失败: ${error.message}` : 'sendfox 请求失败')
  }

  // SendFox 在部分错误上回纯文本;解析不出 JSON 就把原文当 payload,留给消息提取。
  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      payload = raw
    }
  }

  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload)
      ?? (response.statusText || 'sendfox 请求失败'))
  }
  return payload
}

/** 数值型分页字段缺失或非有限数时用兜底值,不让一个脏字段毁掉整页数据。 */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Laravel 分页信封 → `{<dataKey>, meta}`;拿不到 data 数组就回空页(照搬上游)。 */
function paginate(payload: unknown, dataKey: 'contacts' | 'lists'): Json {
  const body = record(payload)
  if (body === undefined || !Array.isArray(body.data)) {
    return { [dataKey]: [], meta: { current_page: 1, total: 0, per_page: 0 } }
  }
  return {
    [dataKey]: body.data,
    meta: {
      current_page: numberOr(body.current_page, 1),
      total: numberOr(body.total, body.data.length),
      per_page: numberOr(body.per_page, body.data.length),
    },
  }
}

export async function listContacts(
  input: z.infer<typeof listContactsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/contacts', {
    query: { query: input.query, page: input.page, unsubscribed: input.unsubscribed, email: input.email },
  })
  return paginate(payload, 'contacts')
}

export function createContact(
  input: z.infer<typeof createContactInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/contacts', {
    method: 'POST',
    body: compact({
      email: input.email,
      first_name: input.first_name,
      last_name: input.last_name,
      ip_address: input.ip_address,
      lists: input.lists,
      contact_fields: input.contact_fields,
    }),
  })
}

export function getContact(
  input: z.infer<typeof getContactInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, `/contacts/${requireId(input.contact_id, 'contact_id')}`)
}

export function updateContact(
  input: z.infer<typeof updateContactInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, `/contacts/${requireId(input.contact_id, 'contact_id')}`, {
    method: 'PATCH',
    body: compact({
      first_name: input.first_name,
      last_name: input.last_name,
      lists: input.lists,
      contact_fields: input.contact_fields,
    }),
  })
}

export function deleteContact(
  input: z.infer<typeof deleteContactInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, `/contacts/${requireId(input.contact_id, 'contact_id')}`, { method: 'DELETE' })
}

export function unsubscribeContact(
  input: z.infer<typeof unsubscribeContactInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  if (input.email === undefined) throw new TBError('invalid_argument', 'email 是必填项')
  return request(ctx, '/unsubscribe', { method: 'PATCH', body: { email: input.email } })
}

export async function listContactLists(
  input: z.infer<typeof listContactListsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/lists', { query: { query: input.query, page: input.page } })
  return paginate(payload, 'lists')
}

export function createContactList(
  input: z.infer<typeof createContactListInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  if (input.name === undefined) throw new TBError('invalid_argument', 'name 是必填项')
  return request(ctx, '/lists', { method: 'POST', body: { name: input.name } })
}

export function getContactList(
  input: z.infer<typeof getContactListInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, `/lists/${requireId(input.list_id, 'list_id')}`)
}

export function updateContactList(
  input: z.infer<typeof updateContactListInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const listId = requireId(input.list_id, 'list_id')
  if (input.name === undefined) throw new TBError('invalid_argument', 'name 是必填项')
  return request(ctx, `/lists/${listId}`, { method: 'PATCH', body: { name: input.name } })
}

export function deleteContactList(
  input: z.infer<typeof deleteContactListInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, `/lists/${requireId(input.list_id, 'list_id')}`, { method: 'DELETE' })
}

export async function listContactsInList(
  input: z.infer<typeof listContactsInListInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/lists/${input.list_id}/contacts`, {
    query: { query: input.query, page: input.page },
  })
  return paginate(payload, 'contacts')
}

export function addContactToList(
  input: z.infer<typeof addContactToListInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const listId = requireId(input.list_id, 'list_id')
  const contactId = requireId(input.contact_id, 'contact_id')
  return request(ctx, `/lists/${listId}/contacts`, { method: 'POST', body: { contact_id: contactId } })
}

export function removeContactFromList(
  input: z.infer<typeof removeContactFromListInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const listId = requireId(input.list_id, 'list_id')
  const contactId = requireId(input.contact_id, 'contact_id')
  return request(ctx, `/lists/${listId}/contacts/${contactId}`, { method: 'DELETE' })
}
