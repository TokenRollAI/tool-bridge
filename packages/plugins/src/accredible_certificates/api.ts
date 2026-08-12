/**
 * Accredible Certificates 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/accredible_certificates/executors.ts`,语义等价、
 * 写法本地化:凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走
 * `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Accredible 的三个特点决定了这里的形状:
 * - 认证头是 `Token token=<key>`,既不是 Bearer 也不是裸 key。
 * - **POST 的 body 键名带点**(`recipient.name`、`recipient.meta_data`)—— 这是 Accredible
 *   自己的扁平化约定,不是嵌套对象,故整个 input 原样进 body,不做任何展开。
 * - 响应整形把 snake_case 拍成 camelCase,并**同时保留 `raw`**:归一字段只覆盖常用的
 *   那些,调用方需要别的字段时从 raw 里取。
 *
 * 与上游的两处偏离:
 * - 上游有一层 30 秒超时(`createProviderTimeout`)。当前 ProviderContext 不透传 signal,
 *   超时交给平台侧,这里不再自建。
 * - 上游 validate 模式把 401/403 压成 400。这里没有 validate 模式(凭证探针走平台的
 *   credentialProbe),状态码原样交给 `upstreamError`。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createCredentialInput,
  deleteCredentialInput,
  getCredentialInput,
  getGroupInput,
  listCredentialsInput,
  listGroupsInput,
  searchCredentialsInput,
  searchGroupsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'accredible_certificates'
const API_BASE = 'https://api.accredible.com/'

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** 出参把这些字段声明成 nullable 而非 optional:取不到时必须显式回 null,不能省略键。 */
function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** Accredible 的错误体有四种形状,逐个试。 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  const body = record(payload)
  if (body === undefined) return undefined

  const flat = text(body.error)
  if (flat !== undefined) return flat
  const nested = text(record(body.error)?.message)
  if (nested !== undefined) return nested
  const message = text(body.message)
  if (message !== undefined) return message
  if (Array.isArray(body.errors)) {
    return body.errors.find((item): item is string => typeof item === 'string' && item.trim() !== '')
  }
  return undefined
}

/** 剥掉值为 undefined 的键;上游 `jsonObject` 的等价物(只剥顶层)。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

interface RequestInput {
  body?: Json
  method?: 'DELETE' | 'GET' | 'POST'
  query?: Json
}

async function request(ctx: ProviderContext, path: string, input: RequestInput = {}): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(path.startsWith('/') ? path.slice(1) : path, API_BASE)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === undefined || value === null) continue
    url.searchParams.set(key, String(value))
  }

  const method = input.method ?? 'GET'
  const headers: Record<string, string> = {
    accept: 'application/json',
    // 方案名是 `Token`,参数写成 `token=<key>` —— 迁移最容易改错的地方。
    authorization: `Token token=${apiKey}`,
  }
  if (method === 'POST') headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method,
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障。
    throw upstreamError(502, error instanceof Error ? `accredible 请求失败: ${error.message}` : 'accredible 请求失败')
  }

  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      throw upstreamError(502, 'Accredible 返回了非法 JSON')
    }
  }

  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? `Accredible 请求失败,状态 ${response.status}`)
  }
  return payload
}

function requireObject(value: unknown, label: string): Json {
  const body = record(value)
  if (body === undefined) throw upstreamError(502, `Accredible ${label} 返回了非对象响应`)
  return body
}

/** id 上游有时回数字、有时回字符串,出参统一成字符串。 */
function requireIdLike(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw upstreamError(502, `Accredible 响应缺少 ${field}`)
}

function normalizeGroup(value: unknown): Json {
  const body = requireObject(value, 'group')
  const id = body.id
  if (typeof id !== 'number' || !Number.isFinite(id)) throw upstreamError(502, 'Accredible group 缺少 id')
  return {
    id,
    name: nullableString(body.name),
    courseName: nullableString(body.course_name),
    courseDescription: nullableString(body.course_description),
    language: nullableString(body.language),
    designName: nullableString(body.design_name),
    departmentId: nullableNumber(body.department_id),
    raw: body,
  }
}

function normalizeRecipient(value: unknown): Json {
  const body = requireObject(value, 'recipient')
  return {
    id: body.id === undefined || body.id === null ? null : requireIdLike(body.id, 'recipient.id'),
    name: nullableString(body.name),
    email: nullableString(body.email),
    metaData: record(body.meta_data) ?? null,
  }
}

function normalizeCredential(value: unknown): Json {
  const body = requireObject(value, 'credential')
  return {
    id: requireIdLike(body.id, 'credential.id'),
    name: nullableString(body.name),
    description: nullableString(body.description),
    complete: nullableBoolean(body.complete),
    issuedOn: nullableString(body.issued_on),
    expiredOn: nullableString(body.expired_on),
    groupId: nullableNumber(body.group_id),
    groupName: nullableString(body.group_name),
    url: nullableString(body.url),
    encodedId: nullableString(body.encoded_id),
    private: nullableBoolean(body.private),
    recipient: body.recipient === undefined || body.recipient === null ? null : normalizeRecipient(body.recipient),
    raw: body,
  }
}

/** 列表键缺失或不是数组时回空数组,而不是报错 —— 照搬上游,免得把"空结果"变成一次失败。 */
function normalizeList(value: unknown, normalize: (item: unknown) => Json): Json[] {
  return Array.isArray(value) ? value.map(normalize) : []
}

function normalizeMeta(value: unknown): Json {
  const body = record(value) ?? {}
  return {
    currentPage: nullableNumber(body.current_page),
    nextPage: nullableNumber(body.next_page),
    prevPage: nullableNumber(body.prev_page),
    totalPages: nullableNumber(body.total_pages),
    totalCount: nullableNumber(body.total_count),
    raw: body,
  }
}

/**
 * 一批 action 的 id 在生成的 schema 里标成 optional,但上游 executor 对它做
 * `requireStringLike` 断言。schema 是生成的、不动,故在这里补上必填校验。
 */
function requireId(value: number | string | undefined, field: string): string {
  if (value === undefined || value === '') throw new TBError('invalid_argument', `${field} 是必填项`)
  return String(value)
}

export async function listGroups(
  _input: z.infer<typeof listGroupsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = requireObject(await request(ctx, '/v1/issuer/all_groups'), 'list groups')
  return { groups: normalizeList(body.groups, normalizeGroup), meta: normalizeMeta(body.meta) }
}

export async function getGroup(
  input: z.infer<typeof getGroupInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const groupId = requireId(input.group_id, 'group_id')
  const body = requireObject(
    await request(ctx, `/v1/issuer/groups/${encodeURIComponent(groupId)}`),
    'get group',
  )
  return { group: normalizeGroup(body.group) }
}

export async function searchGroups(
  input: z.infer<typeof searchGroupsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = requireObject(
    await request(ctx, '/v1/issuer/groups/search', { method: 'POST', body: compact(input) }),
    'search groups',
  )
  return { groups: normalizeList(body.groups, normalizeGroup), meta: normalizeMeta(body.meta) }
}

export async function listCredentials(
  input: z.infer<typeof listCredentialsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = requireObject(
    await request(ctx, '/v1/all_credentials', { query: compact(input) }),
    'list credentials',
  )
  return { credentials: normalizeList(body.credentials, normalizeCredential), meta: normalizeMeta(body.meta) }
}

export async function getCredential(
  input: z.infer<typeof getCredentialInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const id = requireId(input.id, 'id')
  const body = requireObject(await request(ctx, `/v1/credentials/${encodeURIComponent(id)}`), 'get credential')
  return { credential: normalizeCredential(body.credential) }
}

export async function searchCredentials(
  input: z.infer<typeof searchCredentialsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = requireObject(
    await request(ctx, '/v1/credentials/search', { method: 'POST', body: compact(input) }),
    'search credentials',
  )
  return { credentials: normalizeList(body.credentials, normalizeCredential), meta: normalizeMeta(body.meta) }
}

export async function createCredential(
  input: z.infer<typeof createCredentialInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = requireObject(
    await request(ctx, '/v1/credentials', { method: 'POST', body: compact(input) }),
    'create credential',
  )
  return { credential: normalizeCredential(body.credential) }
}

export async function deleteCredential(
  input: z.infer<typeof deleteCredentialInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const id = requireId(input.id, 'id')
  const payload = await request(ctx, `/v1/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' })
  // DELETE 常回空体;此时 credential 回 null 而不是编一个空对象出来。
  const body = record(payload)
  return {
    deleted: true,
    credential: body?.credential === undefined ? null : normalizeCredential(body.credential),
  }
}
