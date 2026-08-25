/**
 * WorkOS 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/workos/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * WorkOS 的两个特点决定了这里的形状:
 * - 列表响应是 `{data:[...], list_metadata:{before,after}}` 的**游标分页**;
 *   单对象响应有时裹一层同名键(`{user:{...}}`),有时就是对象本身,故 `unwrap` 两种都吃。
 * - 每个 action 都把 `raw` 原样透出:WorkOS 的对象字段会随产品迭代增加,归一形状会丢东西。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createOrganizationInput,
  createOrganizationMembershipInput,
  createUserInput,
  getUserInput,
  listOrganizationMembershipsInput,
  listOrganizationsInput,
  listUsersInput,
  updateOrganizationInput,
  updateOrganizationMembershipInput,
  updateUserInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { compactDefined as compact } from '../_runtime/jsonValue'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'workos'
const API_BASE = 'https://api.workos.com'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | string[] | undefined

/** WorkOS 的错误体有 `{error:{message}}`、`{message}`、`{error_description}`、`{error}` 四种。 */
function errorMessage(payload: Json, status: number): string {
  const error = payload.error
  if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
    const nested = (error as Json).message
    if (typeof nested === 'string' && nested.trim() !== '') return nested.trim()
  }
  for (const value of [payload.message, payload.error_description, payload.error]) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return `WorkOS 返回 HTTP ${status}`
}

async function request(
  ctx: ProviderContext,
  input: { body?: Json, method: 'GET' | 'POST' | 'PUT', path: string, query?: Record<string, QueryValue> },
): Promise<Json> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
  const response = await http.request({
    method: input.method,
    path: input.path,
    // 多值过滤是重复同名键(与 Render 的逗号拼接不同)。
    query: Object.entries(input.query ?? {}),
    headers,
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJsonMessage: 'WorkOS 返回了非法 JSON',
    mapError: ({ bodyKind, data, status }) => {
      if (bodyKind === 'invalid-json') {
        return new TBError('unavailable', 'WorkOS 返回了非法 JSON', { retryable: true })
      }
      const payload = bodyKind === 'empty'
        ? {}
        : data !== null && typeof data === 'object' && !Array.isArray(data)
          ? data as Json
          : undefined
      return payload === undefined
        ? new TBError('unavailable', 'WorkOS 返回的不是 JSON 对象', { retryable: true })
        : upstreamError(status, errorMessage(payload, status))
    },
    mapTransportError: ({ message }) => new TBError(
      'unavailable',
      message === undefined ? 'WorkOS 请求失败' : `WorkOS 请求失败: ${message}`,
      { retryable: true },
    ),
  })
  const payload = response.bodyKind === 'empty'
    ? {}
    : response.data !== null && typeof response.data === 'object' && !Array.isArray(response.data)
      ? response.data as Json
      : undefined
  if (payload === undefined) {
    throw new TBError('unavailable', 'WorkOS 返回的不是 JSON 对象', { retryable: true })
  }
  return payload
}

/** 单对象响应可能裹一层同名键,也可能就是对象本身。 */
function unwrap(payload: Json, key: string): Json {
  const value = payload[key]
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Json
  return payload
}

function toRecord(value: unknown): Json {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Json
}

async function listAction(
  ctx: ProviderContext,
  path: string,
  query: Record<string, QueryValue>,
  listKey: string,
): Promise<Json> {
  const payload = await request(ctx, { method: 'GET', path, query })
  return {
    [listKey]: Array.isArray(payload.data) ? payload.data : [],
    list_metadata: toRecord(payload.list_metadata),
    raw: payload,
  }
}

async function wrappedAction(
  ctx: ProviderContext,
  input: { body?: Json, method: 'GET' | 'POST' | 'PUT', path: string },
  wrapperKey: string,
): Promise<Json> {
  const payload = await request(ctx, input)
  return { [wrapperKey]: unwrap(payload, wrapperKey), raw: payload }
}

function userBody(input: Partial<z.infer<typeof createUserInput>>): Json {
  return compact({
    email: input.email,
    first_name: input.first_name,
    last_name: input.last_name,
    name: input.name,
    email_verified: input.email_verified,
    metadata: input.metadata,
    external_id: input.external_id,
    password: input.password,
  })
}

function organizationBody(input: Partial<z.infer<typeof createOrganizationInput>>): Json {
  return compact({
    name: input.name,
    allow_profiles_outside_organization: input.allow_profiles_outside_organization,
    domain_data: input.domain_data,
    metadata: input.metadata,
    external_id: input.external_id,
  })
}

export async function listUsers(
  input: z.infer<typeof listUsersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await listAction(ctx, '/user_management/users', {
    before: input.before,
    after: input.after,
    limit: input.limit,
    order: input.order,
    organization_id: input.organization_id,
    email: input.email,
  }, 'users')
}

export async function getUser(
  input: z.infer<typeof getUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await wrappedAction(
    ctx,
    { method: 'GET', path: `/user_management/users/${encodeURIComponent(input.id)}` },
    'user',
  )
}

export async function createUser(
  input: z.infer<typeof createUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await wrappedAction(
    ctx,
    { method: 'POST', path: '/user_management/users', body: userBody(input) },
    'user',
  )
}

export async function updateUser(
  input: z.infer<typeof updateUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await wrappedAction(
    ctx,
    {
      method: 'PUT',
      path: `/user_management/users/${encodeURIComponent(input.id)}`,
      body: userBody(input),
    },
    'user',
  )
}

export async function listOrganizations(
  input: z.infer<typeof listOrganizationsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await listAction(ctx, '/organizations', {
    before: input.before,
    after: input.after,
    limit: input.limit,
    order: input.order,
    domains: input.domains,
    search: input.search,
  }, 'organizations')
}

export async function getOrganization(
  input: z.infer<typeof getUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await wrappedAction(
    ctx,
    { method: 'GET', path: `/organizations/${encodeURIComponent(input.id)}` },
    'organization',
  )
}

export async function createOrganization(
  input: z.infer<typeof createOrganizationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await wrappedAction(
    ctx,
    { method: 'POST', path: '/organizations', body: organizationBody(input) },
    'organization',
  )
}

export async function updateOrganization(
  input: z.infer<typeof updateOrganizationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await wrappedAction(
    ctx,
    {
      method: 'PUT',
      path: `/organizations/${encodeURIComponent(input.id)}`,
      body: organizationBody(input),
    },
    'organization',
  )
}

export async function listOrganizationMemberships(
  input: z.infer<typeof listOrganizationMembershipsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await listAction(ctx, '/user_management/organization_memberships', {
    before: input.before,
    after: input.after,
    limit: input.limit,
    order: input.order,
    organization_id: input.organization_id,
    user_id: input.user_id,
    statuses: input.statuses,
  }, 'organization_memberships')
}

export async function getOrganizationMembership(
  input: z.infer<typeof getUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await wrappedAction(
    ctx,
    {
      method: 'GET',
      path: `/user_management/organization_memberships/${encodeURIComponent(input.id)}`,
    },
    'organization_membership',
  )
}

export async function createOrganizationMembership(
  input: z.infer<typeof createOrganizationMembershipInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await wrappedAction(
    ctx,
    {
      method: 'POST',
      path: '/user_management/organization_memberships',
      body: compact({
        user_id: input.user_id,
        organization_id: input.organization_id,
        role_slug: input.role_slug,
        role_slugs: input.role_slugs,
      }),
    },
    'organization_membership',
  )
}

export async function updateOrganizationMembership(
  input: z.infer<typeof updateOrganizationMembershipInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await wrappedAction(
    ctx,
    {
      method: 'PUT',
      path: `/user_management/organization_memberships/${encodeURIComponent(input.id)}`,
      body: compact({ role_slug: input.role_slug, role_slugs: input.role_slugs }),
    },
    'organization_membership',
  )
}

export async function deactivateOrganizationMembership(
  input: z.infer<typeof getUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 上游这两个 action 发的是**不带 body** 的 PUT,故这里也不给 body(会连带去掉 content-type)。
  return await wrappedAction(
    ctx,
    {
      method: 'PUT',
      path: `/user_management/organization_memberships/${encodeURIComponent(input.id)}/deactivate`,
    },
    'organization_membership',
  )
}

export async function reactivateOrganizationMembership(
  input: z.infer<typeof getUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await wrappedAction(
    ctx,
    {
      method: 'PUT',
      path: `/user_management/organization_memberships/${encodeURIComponent(input.id)}/reactivate`,
    },
    'organization_membership',
  )
}
