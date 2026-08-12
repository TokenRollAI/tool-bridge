/**
 * Userflow 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/userflow/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Userflow 的两个特点决定了这里的形状:
 * - 版本走 `userflow-version` 头(不是 URL 前缀),值钉死在上游用的 `2020-01-03`。
 * - `expand` 是**重复的 `expand[]` 键**,不是逗号分隔串。
 *
 * 与上游的一处偏离:上游 `assertUserflowResponse` 在"校验凭证"模式下把 401/403 压成 400。
 * 这里没有 validate 模式(凭证探针走平台的 credentialProbe),状态码原样交给 `upstreamError`。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  deleteGroupInput,
  deleteUserInput,
  getGroupInput,
  getUserInput,
  listUsersInput,
  trackEventInput,
  upsertGroupInput,
  upsertUserInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'userflow'
const API_BASE = 'https://api.userflow.com'
const API_VERSION = '2020-01-03'

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Userflow 的错误体是 `{error:{message}}`,也见过扁平的 `{message}` / `{error:"..."}`。 */
function errorMessage(payload: unknown): string | undefined {
  const body = record(payload)
  if (body === undefined) return undefined
  return text(record(body.error)?.message) ?? text(body.message) ?? text(body.error)
}

interface RequestInput {
  body?: Json
  method?: 'DELETE' | 'GET' | 'POST'
}

async function request(ctx: ProviderContext, url: URL, input: RequestInput = {}): Promise<Json> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const headers: Record<string, string> = {
    'accept': 'application/json',
    'authorization': `Bearer ${apiKey}`,
    'userflow-version': API_VERSION,
  }
  // 上游序列化前先过 compactObject 剥掉值为 undefined 的键;JSON.stringify 本来就会丢弃
  // 它们,产出字节一致,故不再实现。
  const body = input.body === undefined ? undefined : JSON.stringify(input.body)
  if (body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method ?? 'GET',
      headers,
      ...(body === undefined ? {} : { body }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障。
    throw upstreamError(502, error instanceof Error ? `userflow 请求失败: ${error.message}` : 'userflow 请求失败')
  }

  const raw = await response.text().catch(() => '')
  let payload: unknown
  try {
    payload = raw === '' ? {} : (JSON.parse(raw) as unknown)
  } catch {
    payload = undefined
  }

  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload)
      ?? `Userflow 请求失败,状态 ${response.status}`)
  }
  // DELETE 回 204 空体。
  if (response.status === 204) return {}
  const body_ = record(payload)
  if (body_ === undefined) throw upstreamError(502, 'Userflow 返回了非对象响应')
  return body_
}

/** `expand` 走重复的 `expand[]` 键 —— Userflow 不接受逗号分隔串。 */
function appendExpand(url: URL, expand: string[] | undefined): void {
  for (const field of expand ?? []) url.searchParams.append('expand[]', field)
}

function objectUrl(resource: 'groups' | 'users', id: string, expand?: string[]): URL {
  const url = new URL(`/${resource}/${encodeURIComponent(id)}`, API_BASE)
  appendExpand(url, expand)
  return url
}

/**
 * `delete_user` / `delete_group` 的 schema 把 id 标成 optional,但上游 executor 对它做
 * `requiredString` 断言。schema 是生成的、不动,故在这里补上必填校验。
 */
function requireId(value: string | undefined, field: string): string {
  if (value === undefined || value === '') throw new TBError('invalid_argument', `${field} 是必填项`)
  return value
}

export async function listUsers(
  input: z.infer<typeof listUsersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const url = new URL('/users', API_BASE)
  for (const field of ['limit', 'starting_after', 'ending_before', 'email', 'user_id', 'order_by'] as const) {
    const value = input[field]
    if (value !== undefined) url.searchParams.set(field, String(value))
  }
  appendExpand(url, input.expand)
  return request(ctx, url)
}

export async function getUser(
  input: z.infer<typeof getUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { user: await request(ctx, objectUrl('users', input.user_id, input.expand)) }
}

export async function upsertUser(
  input: z.infer<typeof upsertUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { user: await request(ctx, new URL('/users', API_BASE), { method: 'POST', body: input }) }
}

export async function deleteUser(
  input: z.infer<typeof deleteUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const id = requireId(input.user_id, 'user_id')
  const raw = await request(ctx, objectUrl('users', id), { method: 'DELETE' })
  return { deleted: true, user_id: id, raw }
}

export async function upsertGroup(
  input: z.infer<typeof upsertGroupInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { group: await request(ctx, new URL('/groups', API_BASE), { method: 'POST', body: input }) }
}

export async function getGroup(
  input: z.infer<typeof getGroupInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { group: await request(ctx, objectUrl('groups', input.group_id, input.expand)) }
}

export async function deleteGroup(
  input: z.infer<typeof deleteGroupInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const id = requireId(input.group_id, 'group_id')
  const raw = await request(ctx, objectUrl('groups', id), { method: 'DELETE' })
  return { deleted: true, group_id: id, raw }
}

export async function trackEvent(
  input: z.infer<typeof trackEventInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { event: await request(ctx, new URL('/events', API_BASE), { method: 'POST', body: input }) }
}
