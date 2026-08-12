/**
 * Whop 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/whop/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Whop 的形状很规整:全部 8 个 action 都是 GET,凭证走 Bearer,版本固定在
 * `api-version-date` 头。唯一要留意的是**数组过滤器重复同名键**(`statuses=active&statuses=trialing`),
 * 不是逗号分隔串。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getAuthorizedUserInput,
  getCompanyInput,
  getMembershipInput,
  getProductInput,
  listAuthorizedUsersInput,
  listCompaniesInput,
  listMembershipsInput,
  listProductsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'whop'
const API_BASE = 'https://api.whop.com/api/v1'
const API_VERSION = '2026-07-01'

type Json = Record<string, unknown>
type QueryValue = boolean | number | readonly string[] | string | undefined

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalRawString`:不 trim、不把空串当缺失,只判类型。 */
function raw(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Whop 的错误体是 `{error:{message}}`,少数端点把消息平铺在顶层。 */
function errorMessage(payload: unknown, status: number): string {
  const body = record(payload)
  if (body === undefined) return `Whop request failed with ${status}`
  const nested = record(body.error)
  return raw(nested?.message) ?? raw(body.message) ?? raw(body.detail) ?? raw(body.error)
    ?? `Whop request failed with ${status}`
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, QueryValue> = {},
): Promise<Json> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    // 数组过滤器重复同名键,不压成逗号串 —— Whop 的列表参数就是这个约定。
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item)
      continue
    }
    url.searchParams.set(key, String(value))
  }

  let response: Response
  let rawBody: string
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'api-version-date': API_VERSION,
        'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
      },
    })
    rawBody = await response.text()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw upstreamError(502, `Whop request failed for GET ${url.toString()}: ${message}`)
  }

  let payload: unknown = {}
  if (rawBody.trim() !== '') {
    try {
      payload = JSON.parse(rawBody)
    } catch {
      throw upstreamError(502, 'Whop returned invalid JSON')
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  const output = record(payload)
  if (output === undefined) throw upstreamError(502, 'Whop returned a non-object JSON payload')
  // 空体在这条路径上算契约破损:成功响应必须带资源本体。
  if (rawBody.trim() === '') throw upstreamError(502, 'Whop returned an empty response body')
  return output
}

/** schema 把这些路径参数标成可选(上游靠 executor 里的必填检查兜底),这道检查不能省。 */
function resourcePath(family: string, id: string | undefined): string {
  if (id === undefined || id === '') throw new TBError('invalid_argument', 'id is required')
  return `/${family}/${encodeURIComponent(id)}`
}

export async function listCompanies(
  input: z.infer<typeof listCompaniesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, '/companies', {
    after: input.after,
    before: input.before,
    first: input.first,
    last: input.last,
    parent_company_id: input.parent_company_id,
    direction: input.direction,
    created_before: input.created_before,
    created_after: input.created_after,
  })
}

export async function getCompany(
  input: z.infer<typeof getCompanyInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, resourcePath('companies', input.id))
}

export async function listProducts(
  input: z.infer<typeof listProductsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, '/products', {
    company_id: input.company_id,
    visibilities: input.visibilities,
    access_pass_types: input.access_pass_types,
    direction: input.direction,
    order: input.order,
    first: input.first,
    after: input.after,
    last: input.last,
    before: input.before,
  })
}

export async function getProduct(
  input: z.infer<typeof getProductInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, resourcePath('products', input.id))
}

export async function listMemberships(
  input: z.infer<typeof listMembershipsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, '/memberships', {
    after: input.after,
    before: input.before,
    first: input.first,
    last: input.last,
    company_id: input.company_id,
    direction: input.direction,
    order: input.order,
    product_ids: input.product_ids,
    statuses: input.statuses,
    cancel_options: input.cancel_options,
    plan_ids: input.plan_ids,
    user_ids: input.user_ids,
    promo_code_ids: input.promo_code_ids,
    created_before: input.created_before,
    created_after: input.created_after,
  })
}

export async function getMembership(
  input: z.infer<typeof getMembershipInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, resourcePath('memberships', input.id))
}

export async function listAuthorizedUsers(
  input: z.infer<typeof listAuthorizedUsersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, '/authorized_users', {
    after: input.after,
    before: input.before,
    first: input.first,
    last: input.last,
    company_id: input.company_id,
    user_id: input.user_id,
    role: input.role,
    created_before: input.created_before,
    created_after: input.created_after,
  })
}

export async function getAuthorizedUser(
  input: z.infer<typeof getAuthorizedUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, resourcePath('authorized_users', input.id))
}
