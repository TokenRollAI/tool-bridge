/**
 * Polar 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/polar/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。凭证是 Organization Access Token,走 `Authorization: Bearer` 头,
 * 不进 URL。
 *
 * 13 个 action 全是只读 GET,分两类形状:
 * - **list 类**:入参**整份**变成 query —— 上游 `buildListPath` 直接遍历入参,没有白名单。
 *   于是三处取值口径必须照抄:数组展开成**重复的同名**参数(Polar 的多值筛选是这么表达的)、
 *   布尔编成 `'true'`/`'false'` 字面量、`metadata` 展成 `metadata[key]=value`(Polar 的
 *   deepObject query style)。出参是 `{items, pagination}` 原样透出。
 * - **get 类**:id 进路径(`encodeURIComponent`),出参包一层 `{payload: ...}`。
 *   这些 id 在生成的 schema 里是 `optional`(上游没有 required 声明),必填断言留在本层。
 *
 * 一处上游细节:list 的路径带**尾斜杠**(`/organizations/`),get 的不带。Polar 对这两者
 * 是区分的,去掉尾斜杠会吃到一次 307 重定向。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getCustomerByExternalIdInput,
  getCustomerInput,
  getCustomerStateByExternalIdInput,
  getCustomerStateInput,
  getOrderInput,
  getOrganizationInput,
  getProductInput,
  getSubscriptionInput,
  listCustomersInput,
  listOrdersInput,
  listOrganizationsInput,
  listProductsInput,
  listSubscriptionsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'polar'
const API_BASE = 'https://api.polar.sh/v1'

type Json = Record<string, unknown>

/** 上游 `optionalString`:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错。 */
function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw new TBError('unavailable', `Polar 的${label}不是对象`, { retryable: true })
  return result
}

/**
 * 路径上的 id。schema 里它是 optional(忠实反映上游没有 required 声明),但没有它就拼不出
 * URL —— 上游 `requiredString` 的断言留在这一层。
 */
function requireId(value: unknown, field: string): string {
  const id = text(value)
  if (id === undefined) throw new TBError('invalid_argument', `${field} 是必填的`)
  return encodeURIComponent(id)
}

/** 上游 `appendQueryValue`:null/undefined 跳过,数组逐项展开,布尔与数字显式转串。 */
function appendQueryValue(url: URL, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    // Polar 的多值筛选靠重复同名参数表达,不能拼成逗号串。
    for (const child of value) appendQueryValue(url, key, child)
    return
  }
  if (typeof value === 'boolean') {
    url.searchParams.append(key, value ? 'true' : 'false')
    return
  }
  if (typeof value === 'number') {
    url.searchParams.append(key, String(value))
    return
  }
  const stringValue = text(value)
  if (stringValue !== undefined) url.searchParams.append(key, stringValue)
}

/** 上游 `buildListPath`:入参整份变成 query,`metadata` 走 deepObject 展开。 */
function listUrl(path: string, input: object): string {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(input)) {
    if (key === 'metadata') {
      const metadata = record(value)
      if (metadata !== undefined) {
        for (const [name, child] of Object.entries(metadata)) appendQueryValue(url, `metadata[${name}]`, child)
      }
      continue
    }
    appendQueryValue(url, key, value)
  }
  return url.toString()
}

/** 上游 `extractPolarErrorMessage`:detail 可能是串、也可能是 FastAPI 的校验错误数组。 */
function errorDetail(payload: unknown): string | undefined {
  const body = record(payload)
  if (body === undefined) return undefined

  const detail = body.detail
  const detailText = text(detail)
  if (detailText !== undefined) return detailText
  if (Array.isArray(detail)) {
    const message = text(record(detail[0])?.msg)
    if (message !== undefined) return message
  }
  return text(body.message) ?? text(body.error) ?? text(body.title)
}

async function request(ctx: ProviderContext, url: string): Promise<unknown> {
  const response = await guardedFetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
    },
  })

  const body = await response.text()
  let payload: unknown = null
  if (body.trim() !== '') {
    try {
      payload = JSON.parse(body)
    } catch {
      // 2xx 上回非 JSON 只能是上游坏了;错误响应回 HTML(网关的 502 页面)很常见,那时按
      // HTTP 状态归一比报"响应不是 JSON"准,也不用把上游正文回显给调用方。
      if (response.ok) {
        throw new TBError('unavailable', 'Polar 返回了非 JSON 响应', { retryable: true })
      }
    }
  }
  if (!response.ok) {
    throw upstreamError(response.status, errorDetail(payload) ?? `Polar 返回 HTTP ${response.status}`)
  }
  return payload
}

/** list 类:出参就是上游那一页(`{items, pagination}`)。 */
async function listResources(path: string, input: object, ctx: ProviderContext): Promise<Json> {
  return requireRecord(await request(ctx, listUrl(path, input)), '列表响应')
}

/** get 类:出参包一层 `{payload}` —— 上游 `wrapPayload`,让资源对象与将来可能的元数据分层。 */
async function getResource(path: string, ctx: ProviderContext): Promise<Json> {
  return { payload: requireRecord(await request(ctx, `${API_BASE}${path}`), '资源响应') }
}

export function listOrganizations(
  input: z.infer<typeof listOrganizationsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listResources('/organizations/', input, ctx)
}

export function getOrganization(input: z.infer<typeof getOrganizationInput>, ctx: ProviderContext): Promise<Json> {
  return getResource(`/organizations/${requireId(input.id, 'id')}`, ctx)
}

export function listProducts(input: z.infer<typeof listProductsInput>, ctx: ProviderContext): Promise<Json> {
  return listResources('/products/', input, ctx)
}

export function getProduct(input: z.infer<typeof getProductInput>, ctx: ProviderContext): Promise<Json> {
  return getResource(`/products/${requireId(input.id, 'id')}`, ctx)
}

export function listCustomers(input: z.infer<typeof listCustomersInput>, ctx: ProviderContext): Promise<Json> {
  return listResources('/customers/', input, ctx)
}

export function getCustomer(input: z.infer<typeof getCustomerInput>, ctx: ProviderContext): Promise<Json> {
  return getResource(`/customers/${requireId(input.id, 'id')}`, ctx)
}

export function getCustomerByExternalId(
  input: z.infer<typeof getCustomerByExternalIdInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getResource(`/customers/external/${requireId(input.external_id, 'external_id')}`, ctx)
}

export function getCustomerState(input: z.infer<typeof getCustomerStateInput>, ctx: ProviderContext): Promise<Json> {
  return getResource(`/customers/${requireId(input.id, 'id')}/state`, ctx)
}

export function getCustomerStateByExternalId(
  input: z.infer<typeof getCustomerStateByExternalIdInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getResource(`/customers/external/${requireId(input.external_id, 'external_id')}/state`, ctx)
}

export function listOrders(input: z.infer<typeof listOrdersInput>, ctx: ProviderContext): Promise<Json> {
  return listResources('/orders/', input, ctx)
}

export function getOrder(input: z.infer<typeof getOrderInput>, ctx: ProviderContext): Promise<Json> {
  return getResource(`/orders/${requireId(input.id, 'id')}`, ctx)
}

export function listSubscriptions(
  input: z.infer<typeof listSubscriptionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listResources('/subscriptions/', input, ctx)
}

export function getSubscription(input: z.infer<typeof getSubscriptionInput>, ctx: ProviderContext): Promise<Json> {
  return getResource(`/subscriptions/${requireId(input.id, 'id')}`, ctx)
}
