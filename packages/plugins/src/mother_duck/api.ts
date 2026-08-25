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
import { compactDefined as compact, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'mother_duck'
const API_BASE = 'https://api.motherduck.com'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>

function errorMessage(payload: unknown): string | undefined {
  const body = record(payload)
  if (body === undefined) return undefined
  return text(body.message) ?? text(body.error) ?? text(body.code)
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
  const apiKey = requireApiKey(ctx, SERVICE)
  const result = await http.request({
    path,
    method: input.method ?? 'GET',
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJson: 'text',
    mapError: ({ bodyKind, data, status }) => upstreamError(
      status,
      bodyKind === 'invalid-json' && typeof data === 'string'
        ? data
        : (errorMessage(data) ?? `MotherDuck 请求失败,HTTP ${status}`),
    ),
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined ? 'MotherDuck 请求失败' : `MotherDuck 请求失败: ${message}`,
    ),
  })
  const payload = result.bodyKind === 'empty'
    ? {}
    : result.bodyKind === 'invalid-json' && typeof result.data === 'string'
      ? { message: result.data }
      : result.data
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
