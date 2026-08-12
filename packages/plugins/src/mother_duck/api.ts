/**
 * MotherDuck 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/mother_duck/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 与上游的一处有意偏离:上游 `createMotherDuckError` 把 404/409/422 一律压成 400、
 * 把 5xx 压成 502。这里把原始状态交给 `upstreamError`,404 仍是 not_found、409 仍是 conflict。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createTokenInput,
  createUserInput,
  deleteTokenInput,
  deleteUserInput,
  getUserDucklingConfigInput,
  listTokensInput,
  setUserDucklingConfigInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'mother_duck'
const API_BASE = 'https://api.motherduck.com'

type Json = Record<string, unknown>

/** 上游 `optionalString`:非字符串、或去空白后为空,都算缺失。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `jsonObject`:剥掉值为 undefined 的键。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function errorMessage(payload: unknown): string | undefined {
  const body = record(payload)
  if (body === undefined) return undefined
  return text(body.message) ?? text(body.error) ?? text(body.code)
}

/** 空体按 `{}` 处理;JSON 解析不了就把原文塞进 message,留给消息提取。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    return { message: body }
  }
}

function isEmpty(payload: unknown): boolean {
  const object = record(payload)
  return object !== undefined && Object.keys(object).length === 0
}

interface RequestInput {
  /** DELETE token 成功时回空体,不是错误;这里显式允许。 */
  allowEmpty?: boolean
  body?: Json
  method?: 'DELETE' | 'GET' | 'POST' | 'PUT'
}

async function request(ctx: ProviderContext, path: string, input: RequestInput = {}): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await guardedFetch(new URL(path, API_BASE).toString(), {
      method: input.method ?? 'GET',
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 500。
    throw upstreamError(
      502,
      error instanceof Error ? `MotherDuck 请求失败: ${error.message}` : 'MotherDuck 请求失败',
    )
  }

  const payload = await readPayload(response)
  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? `MotherDuck 请求失败,HTTP ${response.status}`)
  }
  if (input.allowEmpty === true && isEmpty(payload)) return {}
  return payload
}

function requireArrayProperty(payload: unknown, key: string): unknown[] {
  const value = record(payload)?.[key]
  if (!Array.isArray(value)) {
    throw new TBError('unavailable', `MotherDuck 的 ${key} 响应非法`, { retryable: true })
  }
  return value
}

function normalizeToken(value: unknown): Json {
  const token = record(value)
  if (token === undefined) {
    throw new TBError('unavailable', 'MotherDuck 返回的 token 不是对象', { retryable: true })
  }
  return compact({
    id: text(token.id),
    name: text(token.name),
    token: text(token.token),
    expire_at: text(token.expire_at),
    created_ts: text(token.created_ts),
    read_only: typeof token.read_only === 'boolean' ? token.read_only : undefined,
    token_type: text(token.token_type),
    raw: token,
  })
}

/** 创建/删除用户后上游不一定回 username,回落到入参,保证出参形状稳定。 */
function responseUsername(payload: unknown, fallback: string): string {
  return text(record(payload)?.username) ?? fallback
}

export async function listActiveAccounts(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/v1/active_accounts')
  return { accounts: requireArrayProperty(payload, 'accounts') }
}

export async function createUser(
  input: z.infer<typeof createUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const username = input.username.trim()
  const payload = await request(ctx, '/v1/users', { method: 'POST', body: { username } })
  return { username: responseUsername(payload, username) }
}

export async function deleteUser(
  input: z.infer<typeof deleteUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const username = input.username.trim()
  const payload = await request(ctx, `/v1/users/${encodeURIComponent(username)}`, { method: 'DELETE' })
  return { username: responseUsername(payload, username) }
}

export async function listTokens(
  input: z.infer<typeof listTokensInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/v1/users/${encodeURIComponent(input.username.trim())}/tokens`
  return { tokens: requireArrayProperty(await request(ctx, path), 'tokens').map(normalizeToken) }
}

export async function createToken(
  input: z.infer<typeof createTokenInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/v1/users/${encodeURIComponent(input.username.trim())}/tokens`
  const payload = await request(ctx, path, {
    method: 'POST',
    body: compact({ name: input.name.trim(), ttl: input.ttl, token_type: input.token_type }),
  })
  return { token: normalizeToken(payload) }
}

export async function deleteToken(
  input: z.infer<typeof deleteTokenInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const username = encodeURIComponent(input.username.trim())
  const tokenId = encodeURIComponent(input.token_id.trim())
  await request(ctx, `/v1/users/${username}/tokens/${tokenId}`, { method: 'DELETE', allowEmpty: true })
  return { success: true }
}

export async function getUserDucklingConfig(
  input: z.infer<typeof getUserDucklingConfigInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // Duckling 配置端点叫 /instances,不叫 /ducklings —— 上游如此,不是笔误。
  const path = `/v1/users/${encodeURIComponent(input.username.trim())}/instances`
  return { config: await request(ctx, path) }
}

export async function setUserDucklingConfig(
  input: z.infer<typeof setUserDucklingConfigInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/v1/users/${encodeURIComponent(input.username.trim())}/instances`
  const payload = await request(ctx, path, { method: 'PUT', body: { config: input.config } })
  return { config: payload }
}
