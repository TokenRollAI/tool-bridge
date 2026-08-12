/**
 * Feathery 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/feathery/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Feathery 的两个特点决定了这里的形状:
 * - 凭证头是 **`Authorization: Token <key>`**,不是 Bearer。
 * - 列表接口的返回**形状不稳定**:有时是裸数组,有时包在 `data`/`results`/`forms`/
 *   `users`/`fields`/`hidden_fields` 里,所以 `normalizeArray` 要逐个键试。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createHiddenFieldInput,
  createOrFetchUserInput,
  createOrUpdateFormSubmissionsInput,
  deleteHiddenFieldInput,
  deleteUserInput,
  editHiddenFieldInput,
  getFormSchemaInput,
  getUserDataInput,
  getUserSessionInput,
  listFormsInput,
  listUsersInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'feathery'
const API_BASE = 'https://api.feathery.io'

type Json = Record<string, unknown>

interface RequestInput {
  body?: unknown
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST'
  path: string
  query?: Record<string, string | string[] | undefined>
}

/** 上游 `optionalString`:trim 后为空视同没给,不进 query。 */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/** Feathery 的错误体形状不统一:字符串、`{error|detail|message}`、`{errors:[...]}` 都出现过。 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string' && payload.trim() !== '') return payload.trim()
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const object = payload as Json
  for (const key of ['error', 'detail', 'message']) {
    const value = object[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  const errors = object.errors
  if (Array.isArray(errors)) {
    const first = errors.find(item => typeof item === 'string' && item.trim() !== '')
    return typeof first === 'string' ? first.trim() : undefined
  }
  return undefined
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const url = new URL(input.path, API_BASE)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item)
      continue
    }
    url.searchParams.set(key, value)
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Token ${apiKey}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  let text: string
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
    text = await response.text()
  } catch (error) {
    if (error instanceof TBError) throw error
    // 上游主机是写死的常量,这里只可能是网络/传输问题 —— 重试有意义。
    throw new TBError(
      'unavailable',
      error instanceof Error ? `Feathery 请求失败: ${error.message}` : 'Feathery 请求失败',
      { retryable: true },
    )
  }

  // 空体是合法响应(DELETE 常返回 204),上游把它当成 `{}`。
  let payload: unknown = {}
  if (text !== '') {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      throw new TBError('unavailable', 'Feathery 返回了非 JSON 响应', { retryable: true })
    }
  }

  if (!response.ok) {
    throw upstreamError(
      response.status,
      errorMessage(payload) ?? response.statusText ?? `Feathery 返回 HTTP ${response.status}`,
    )
  }
  return payload
}

function normalizeObject(payload: unknown): Json {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return {}
  return payload as Json
}

/** 列表接口有时裸返回数组,有时包一层信封;逐个已知键试,都不中就当空列表。 */
function normalizeArray(payload: unknown): Json[] {
  if (Array.isArray(payload)) return payload.map(normalizeObject)
  const object = payload === null || typeof payload !== 'object' ? undefined : (payload as Json)
  if (object === undefined) return []
  for (const key of ['data', 'results', 'forms', 'users', 'fields', 'hidden_fields']) {
    const value = object[key]
    if (Array.isArray(value)) return value.map(normalizeObject)
  }
  return []
}

export async function getAccountInfo(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { account: normalizeObject(await request(ctx, { path: '/api/account/', method: 'GET' })) }
}

export async function listForms(
  input: z.infer<typeof listFormsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 空串标签对 Feathery 无意义,过滤后没剩就整个不带 tags 参数(上游同此)。
  const tags = input.tags?.map(tag => tag.trim()).filter(tag => tag !== '')
  return {
    forms: normalizeArray(await request(ctx, {
      path: '/api/form/',
      method: 'GET',
      query: tags !== undefined && tags.length > 0 ? { tags } : undefined,
    })),
  }
}

export async function getFormSchema(
  input: z.infer<typeof getFormSchemaInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return {
    schema: normalizeObject(await request(ctx, {
      path: `/api/form/${encodeURIComponent(input.form_id)}/schema/`,
      method: 'GET',
    })),
  }
}

export async function createOrUpdateFormSubmissions(
  input: z.infer<typeof createOrUpdateFormSubmissionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return {
    result: normalizeObject(await request(ctx, {
      path: `/api/form/${encodeURIComponent(input.form_id)}/submission/`,
      method: 'POST',
      body: { submissions: input.submissions },
    })),
  }
}

export async function listHiddenFields(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return {
    hiddenFields: normalizeArray(await request(ctx, { path: '/api/field/hidden/', method: 'GET' })),
  }
}

export async function createHiddenField(
  input: z.infer<typeof createHiddenFieldInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return {
    hiddenField: normalizeObject(await request(ctx, {
      path: '/api/field/hidden/',
      method: 'POST',
      body: { field_id: input.field_id },
    })),
  }
}

export async function editHiddenField(
  input: z.infer<typeof editHiddenFieldInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return {
    // 改名走 PATCH,新旧 ID 一个在路径一个在 body,body 的键仍叫 field_id。
    hiddenField: normalizeObject(await request(ctx, {
      path: `/api/field/hidden/${encodeURIComponent(input.field_id)}/`,
      method: 'PATCH',
      body: { field_id: input.new_field_id },
    })),
  }
}

export async function deleteHiddenField(
  input: z.infer<typeof deleteHiddenFieldInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = await request(ctx, {
    path: `/api/field/hidden/${encodeURIComponent(input.field_id)}/`,
    method: 'DELETE',
  })
  return { deleted: true, field_id: input.field_id, raw }
}

export async function listUsers(
  input: z.infer<typeof listUsersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 只给 filter_field_id 不给值,Feathery 会静默返回全量;在本地挡下比让调用方误读结果好。
  if (nonEmpty(input.filter_field_id) !== undefined && nonEmpty(input.filter_field_value) === undefined) {
    throw new TBError('invalid_argument', '给了 filter_field_id 就必须给 filter_field_value')
  }
  return {
    users: normalizeArray(await request(ctx, {
      path: '/api/user/',
      method: 'GET',
      query: {
        created_after: nonEmpty(input.created_after),
        created_before: nonEmpty(input.created_before),
        filter_field_id: nonEmpty(input.filter_field_id),
        filter_field_value: nonEmpty(input.filter_field_value),
      },
    })),
  }
}

export async function getUserData(
  input: z.infer<typeof getUserDataInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return {
    fields: normalizeArray(await request(ctx, {
      path: '/api/user/field/',
      method: 'GET',
      query: { id: nonEmpty(input.id) },
    })),
  }
}

export async function getUserSession(
  input: z.infer<typeof getUserSessionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return {
    session: normalizeObject(await request(ctx, {
      path: `/api/user/${encodeURIComponent(input.user_id)}/session/`,
      method: 'GET',
    })),
  }
}

export async function createOrFetchUser(
  input: z.infer<typeof createOrFetchUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return {
    user: normalizeObject(await request(ctx, {
      path: '/api/user/',
      method: 'POST',
      body: { id: input.id },
    })),
  }
}

export async function deleteUser(
  input: z.infer<typeof deleteUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = await request(ctx, {
    path: `/api/user/${encodeURIComponent(input.id)}/`,
    method: 'DELETE',
  })
  return { deleted: true, id: input.id, raw }
}
