/**
 * Clerk 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/clerk/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 与上游的两处有意偏离:
 * - 上游 `createClerkError` 把 403 压成 401、把 404 压成 400。这里把原始状态原样交给
 *   `upstreamError`,403 仍是 permission_denied、404 仍是 not_found —— 收敛各 provider
 *   互不相同的错误口径正是 `_runtime/upstreamError.ts` 存在的理由。
 * - 上游序列化前先过 `compactJson` 剥掉值为 `undefined` 的键;`JSON.stringify` 本来就会
 *   丢弃它们(数组里的 `undefined` 两条路径都变 `null`),产出字节完全一致,故不再实现。
 */

import type { z } from 'zod/v4'
import type {
  banUserInput,
  countUsersInput,
  createUserInput,
  deleteUserInput,
  getUserInput,
  listUsersInput,
  lockUserInput,
  unbanUserInput,
  unlockUserInput,
  updateUserInput,
  updateUserMetadataInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'clerk'
const API_BASE = 'https://api.clerk.com/v1'

type Json = Record<string, unknown>

/** 上游 `optionalString` 的等价物:非字符串、或去空白后为空,都算缺失。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/**
 * Clerk 的错误体是 `{errors:[{code,long_message,message}]}`,`long_message` 面向人、可操作性最好。
 * `errors` 在但三个字段都取不出文本时**不回落**到顶层 `message`/`error`(与上游一致):
 * 这两组键分属不同的错误体形状,混用会拿到与本次失败不相干的字符串。
 */
function errorMessage(payload: unknown): string | undefined {
  // 上游对纯文本错误体截断到 200 字符,避免把整页 HTML 当消息回给调用方。
  if (typeof payload === 'string') return text(payload)?.slice(0, 200)
  const body = record(payload)
  if (body === undefined) return undefined
  if (Array.isArray(body.errors)) {
    const first = record(body.errors[0])
    return text(first?.long_message) ?? text(first?.message) ?? text(first?.code)
  }
  return text(body.message) ?? text(body.error)
}

/** Clerk 在部分错误上回空体或纯文本;解析不出 JSON 就把原文本身当 payload,留给消息提取。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

interface RequestInput {
  body?: Json
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST'
  /** 有序 pair 而非对象:同名键要能重复出现(Clerk 的数组过滤器就是这么传的)。 */
  query?: Array<[string, unknown]>
}

async function request(ctx: ProviderContext, path: string, input: RequestInput): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of input.query ?? []) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item))
      continue
    }
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
      method: input.method,
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    throw upstreamError(502, error instanceof Error ? `clerk 请求失败: ${error.message}` : 'clerk 请求失败')
  }

  const payload = await readPayload(response)
  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? (response.statusText || `clerk 返回 HTTP ${response.status}`))
  }
  return payload
}

/**
 * Clerk 的 `/users` 回过两种形状:裸数组,与 `{data,total_count}` 信封。两种都收,
 * 统一成 `{users,total_count}`;信封里 `total_count` 不是数字时按本页条数兜底。
 */
function normalizeListUsers(payload: unknown): Json {
  if (Array.isArray(payload)) return { users: payload, total_count: payload.length }
  const body = record(payload)
  if (body !== undefined && Array.isArray(body.data)) {
    const total = body.total_count
    return { users: body.data, total_count: typeof total === 'number' ? total : body.data.length }
  }
  // 两种形状都不是,就是上游破了契约,不是调用方的错。
  throw upstreamError(502, 'clerk list_users 返回了非预期形状')
}

/** list_users 与 count_users 共用的过滤器;顺序照抄上游,让 URL 可预期。 */
function userFilterQuery(input: z.infer<typeof countUsersInput>): Array<[string, unknown]> {
  return [
    ['email_address', input.email_address],
    ['phone_number', input.phone_number],
    ['username', input.username],
    ['user_id', input.user_id],
    ['external_id', input.external_id],
    ['query', input.query],
  ]
}

/** ban/unban/lock/unlock 只差路径末段,响应形状相同。 */
async function runUserStateAction(
  action: 'ban' | 'lock' | 'unban' | 'unlock',
  userId: string,
  ctx: ProviderContext,
): Promise<Json> {
  return { user: await request(ctx, `/users/${encodeURIComponent(userId)}/${action}`, { method: 'POST' }) }
}

export async function listUsers(
  input: z.infer<typeof listUsersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/users', {
    method: 'GET',
    query: [
      ...userFilterQuery(input),
      ['order_by', input.order_by],
      ['limit', input.limit],
      ['offset', input.offset],
    ],
  })
  return normalizeListUsers(payload)
}

/**
 * 唯一不给响应套一层键的 action:上游把 `/users/count` 的 payload **原样**当结果返回,
 * 不是 `{total_count: ...}`。这里照旧 —— 套一层就改了调用方看到的形状。
 * 因此上游多回的顶层键会一并透出;出参 schema 不在运行时校验,不会因此报错。
 */
export async function countUsers(
  input: z.infer<typeof countUsersInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/users/count', { method: 'GET', query: userFilterQuery(input) })
}

export async function getUser(
  input: z.infer<typeof getUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { user: await request(ctx, `/users/${encodeURIComponent(input.user_id)}`, { method: 'GET' }) }
}

export async function createUser(
  input: z.infer<typeof createUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { user: await request(ctx, '/users', { method: 'POST', body: input }) }
}

export async function updateUser(
  input: z.infer<typeof updateUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { user_id, ...body } = input
  return { user: await request(ctx, `/users/${encodeURIComponent(user_id)}`, { method: 'PATCH', body }) }
}

export async function updateUserMetadata(
  input: z.infer<typeof updateUserMetadataInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { user_id, ...body } = input
  const path = `/users/${encodeURIComponent(user_id)}/metadata`
  return { user: await request(ctx, path, { method: 'PATCH', body }) }
}

export async function deleteUser(
  input: z.infer<typeof deleteUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/users/${encodeURIComponent(input.user_id)}`
  return { deleted_object: await request(ctx, path, { method: 'DELETE' }) }
}

export async function banUser(
  input: z.infer<typeof banUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return runUserStateAction('ban', input.user_id, ctx)
}

export async function unbanUser(
  input: z.infer<typeof unbanUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return runUserStateAction('unban', input.user_id, ctx)
}

export async function lockUser(
  input: z.infer<typeof lockUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return runUserStateAction('lock', input.user_id, ctx)
}

export async function unlockUser(
  input: z.infer<typeof unlockUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return runUserStateAction('unlock', input.user_id, ctx)
}
