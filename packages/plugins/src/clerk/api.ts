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
import {
  asJsonObject,
  createProviderHttpClient,
  type JsonObject,
  nonEmptyText,
  type ProviderQuery,
} from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'clerk'
const http = createProviderHttpClient({ baseUrl: 'https://api.clerk.com/v1/', service: SERVICE })

interface RequestInput {
  body?: JsonObject
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST'
  query?: ProviderQuery
}

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return nonEmptyText(payload)?.slice(0, 200)
  const body = asJsonObject(payload)
  if (body === undefined) return undefined
  if (Array.isArray(body.errors)) {
    const first = asJsonObject(body.errors[0])
    return nonEmptyText(first?.long_message) ?? nonEmptyText(first?.message) ?? nonEmptyText(first?.code)
  }
  return nonEmptyText(body.message) ?? nonEmptyText(body.error)
}

async function request(ctx: ProviderContext, path: string, input: RequestInput): Promise<unknown> {
  const { data } = await http.request({
    path,
    method: input.method,
    query: input.query,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
    },
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJson: 'text',
    mapError: ({ data: payload, status }) => upstreamError(
      status,
      errorMessage(payload) ?? `clerk 返回 HTTP ${status}`,
    ),
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined ? 'clerk 请求失败' : `clerk 请求失败: ${message}`,
    ),
  })
  return data ?? {}
}

function normalizeListUsers(payload: unknown): JsonObject {
  if (Array.isArray(payload)) return { users: payload, total_count: payload.length }
  const body = asJsonObject(payload)
  if (body !== undefined && Array.isArray(body.data)) {
    return {
      users: body.data,
      total_count: typeof body.total_count === 'number' ? body.total_count : body.data.length,
    }
  }
  throw upstreamError(502, 'clerk list_users 返回了非预期形状')
}

function userFilterQuery(input: z.infer<typeof countUsersInput>): ProviderQuery {
  return [
    ['email_address', input.email_address],
    ['phone_number', input.phone_number],
    ['username', input.username],
    ['user_id', input.user_id],
    ['external_id', input.external_id],
    ['query', input.query],
  ]
}

async function runUserStateAction(
  action: 'ban' | 'lock' | 'unban' | 'unlock',
  userId: string,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return { user: await request(ctx, `users/${encodeURIComponent(userId)}/${action}`, { method: 'POST' }) }
}

export async function listUsers(
  input: z.infer<typeof listUsersInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return normalizeListUsers(await request(ctx, 'users', {
    method: 'GET',
    query: [
      ...userFilterQuery(input),
      ['order_by', input.order_by],
      ['limit', input.limit],
      ['offset', input.offset],
    ],
  }))
}

export function countUsers(
  input: z.infer<typeof countUsersInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, 'users/count', { method: 'GET', query: userFilterQuery(input) })
}

export async function getUser(
  input: z.infer<typeof getUserInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return { user: await request(ctx, `users/${encodeURIComponent(input.user_id)}`, { method: 'GET' }) }
}

export async function createUser(
  input: z.infer<typeof createUserInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return { user: await request(ctx, 'users', { method: 'POST', body: input }) }
}

export async function updateUser(
  input: z.infer<typeof updateUserInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  const { user_id, ...body } = input
  return { user: await request(ctx, `users/${encodeURIComponent(user_id)}`, { method: 'PATCH', body }) }
}

export async function updateUserMetadata(
  input: z.infer<typeof updateUserMetadataInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  const { user_id, ...body } = input
  return {
    user: await request(ctx, `users/${encodeURIComponent(user_id)}/metadata`, { method: 'PATCH', body }),
  }
}

export async function deleteUser(
  input: z.infer<typeof deleteUserInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return {
    deleted_object: await request(ctx, `users/${encodeURIComponent(input.user_id)}`, { method: 'DELETE' }),
  }
}

export function banUser(input: z.infer<typeof banUserInput>, ctx: ProviderContext): Promise<JsonObject> {
  return runUserStateAction('ban', input.user_id, ctx)
}

export function unbanUser(input: z.infer<typeof unbanUserInput>, ctx: ProviderContext): Promise<JsonObject> {
  return runUserStateAction('unban', input.user_id, ctx)
}

export function lockUser(input: z.infer<typeof lockUserInput>, ctx: ProviderContext): Promise<JsonObject> {
  return runUserStateAction('lock', input.user_id, ctx)
}

export function unlockUser(
  input: z.infer<typeof unlockUserInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return runUserStateAction('unlock', input.user_id, ctx)
}
