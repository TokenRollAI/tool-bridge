/**
 * Stripe 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/stripe/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Stripe 的两个特点决定了这里的形状:
 * - 请求体是 **form-encoded 的方括号嵌套**(`address[city]=SF`、`items[0][price]=x`),
 *   不是 JSON。`appendParams` 是这套编码的唯一实现。
 * - 分页是 **cursor 式**(`starting_after`/`ending_before` 传对象 ID),不是页码;
 *   list 结果原样透出 `has_more`,由调用方续页。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createCustomerInput,
  createPriceInput,
  createProductInput,
  deleteCustomerInput,
  getCustomerInput,
  listCustomersInput,
  searchCustomersInput,
  updateCustomerInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'stripe'
const API_BASE = 'https://api.stripe.com'
const API_VERSION = '2024-06-20'
const ACCOUNT_PATH = '/v1/account'

type Json = Record<string, unknown>

/**
 * Stripe 的 form 编码:嵌套对象展开成 `a[b][c]`,数组重复同名键。
 * `undefined`/`null`/空串一律跳过 —— Stripe 把空串当作"清空该字段"的显式指令,
 * 而调用方省略某个可选参数时不该触发清空。
 */
function appendParams(params: URLSearchParams, value: unknown, prefix?: string): void {
  if (value === undefined || value === null || value === '') return
  if (Array.isArray(value)) {
    for (const item of value) appendParams(params, item, prefix)
    return
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      appendParams(params, child, prefix === undefined ? key : `${prefix}[${key}]`)
    }
    return
  }
  if (prefix === undefined) return
  params.append(prefix, String(value))
}

/** 路径参数必须非空:拼进 URL 前先挡住,免得打出 `/v1/customers/undefined`。 */
function pathSegment(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new TBError('invalid_argument', `${field} 不能为空`)
  }
  return encodeURIComponent(value)
}

/** Stripe 的错误体是 `{error:{message}}`;拿不到就退回状态码描述。 */
async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.clone().json()) as { error?: { message?: unknown } }
    const message = payload.error?.message
    if (typeof message === 'string' && message !== '') return message
  } catch {
    // Stripe 在边缘错误上会回 HTML 或空体。
  }
  const text = await response.text().catch(() => '')
  return text.trim() || `Stripe 返回 HTTP ${response.status}`
}

interface RequestInput {
  body?: Json
  method: 'DELETE' | 'GET' | 'POST'
  query?: Json
}

async function request(ctx: ProviderContext, path: string, input: RequestInput): Promise<Json> {
  const url = new URL(`${API_BASE}${path}`)
  appendParams(url.searchParams, input.query)

  const headers: Record<string, string> = {
    'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
    'stripe-version': API_VERSION,
  }
  let body: string | undefined
  if (input.body !== undefined) {
    const params = new URLSearchParams()
    appendParams(params, input.body)
    body = params.toString()
    headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
  }

  const response = await guardedFetch(url.toString(), {
    method: input.method,
    headers,
    ...(body === undefined ? {} : { body }),
  })
  if (!response.ok) throw upstreamError(response.status, await errorMessage(response))
  if (response.status === 204) return {}

  const payload: unknown = await response.json()
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    // 契约说好是对象;不是就是上游出问题,不是调用方的错。
    throw new TBError('unavailable', 'Stripe 返回了非对象响应', { retryable: true })
  }
  return payload as Json
}

/** 去掉路径参数,剩下的才是请求体。 */
function withoutKeys(input: Json, keys: readonly string[]): Json {
  const drop = new Set(keys)
  return Object.fromEntries(Object.entries(input).filter(([key]) => !drop.has(key)))
}

/** delete 三个动作的共同返回形状(raw 保留完整响应,不吞信息)。 */
function deletionResult(payload: Json): Json {
  return {
    deleted: payload.deleted === true,
    object: typeof payload.object === 'string' ? payload.object : 'unknown',
    id: typeof payload.id === 'string' ? payload.id : 'unknown',
    raw: payload,
  }
}

export async function identifyAccount(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const account = await request(ctx, ACCOUNT_PATH, { method: 'GET' })
  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
  return {
    account,
    accountId: text(account.id),
    email: text(account.email),
    country: text(account.country),
    defaultCurrency: text(account.default_currency),
  }
}

// —— customers ——

export async function createCustomer(
  input: z.infer<typeof createCustomerInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { customer: await request(ctx, '/v1/customers', { method: 'POST', body: input }) }
}

export async function updateCustomer(
  input: z.infer<typeof updateCustomerInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/v1/customers/${pathSegment(input.customerId, 'customerId')}`
  return { customer: await request(ctx, path, { method: 'POST', body: withoutKeys(input, ['customerId']) }) }
}

export async function getCustomer(
  input: z.infer<typeof getCustomerInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/v1/customers/${pathSegment(input.customerId, 'customerId')}`
  return { customer: await request(ctx, path, { method: 'GET' }) }
}

export async function listCustomers(
  input: z.infer<typeof listCustomersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { customers: await request(ctx, '/v1/customers', { method: 'GET', query: input }) }
}

export async function searchCustomers(
  input: z.infer<typeof searchCustomersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { customers: await request(ctx, '/v1/customers/search', { method: 'GET', query: input }) }
}

export async function deleteCustomer(
  input: z.infer<typeof deleteCustomerInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/v1/customers/${pathSegment(input.customerId, 'customerId')}`
  return deletionResult(await request(ctx, path, { method: 'DELETE' }))
}

// —— products ——

export async function createProduct(
  input: z.infer<typeof createProductInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { product: await request(ctx, '/v1/products', { method: 'POST', body: input }) }
}

export async function updateProduct(input: Json, ctx: ProviderContext): Promise<Json> {
  const path = `/v1/products/${pathSegment(input.productId, 'productId')}`
  return { product: await request(ctx, path, { method: 'POST', body: withoutKeys(input, ['productId']) }) }
}

export async function getProduct(input: Json, ctx: ProviderContext): Promise<Json> {
  const path = `/v1/products/${pathSegment(input.productId, 'productId')}`
  return { product: await request(ctx, path, { method: 'GET' }) }
}

export async function listProducts(input: Json, ctx: ProviderContext): Promise<Json> {
  return { products: await request(ctx, '/v1/products', { method: 'GET', query: input }) }
}

export async function searchProducts(input: Json, ctx: ProviderContext): Promise<Json> {
  return { products: await request(ctx, '/v1/products/search', { method: 'GET', query: input }) }
}

export async function deleteProduct(input: Json, ctx: ProviderContext): Promise<Json> {
  const path = `/v1/products/${pathSegment(input.productId, 'productId')}`
  return deletionResult(await request(ctx, path, { method: 'DELETE' }))
}

// —— prices ——

export async function createPrice(
  input: z.infer<typeof createPriceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // Stripe 会在服务端拒掉这些组合,但错误信息含糊。本地先挡一道,消息说清缺什么。
  if (input.product === undefined && input.product_data === undefined) {
    throw new TBError('invalid_argument', 'create_price 需要 product 或 product_data')
  }
  if (
    input.unit_amount === undefined
    && input.unit_amount_decimal === undefined
    && input.custom_unit_amount === undefined
  ) {
    throw new TBError(
      'invalid_argument',
      'create_price 需要 unit_amount、unit_amount_decimal 或 custom_unit_amount 之一',
    )
  }
  if (
    input.custom_unit_amount !== undefined
    && (input.unit_amount !== undefined || input.unit_amount_decimal !== undefined)
  ) {
    throw new TBError(
      'invalid_argument',
      'create_price 的 custom_unit_amount 不能与 unit_amount / unit_amount_decimal 同时给出',
    )
  }
  return { price: await request(ctx, '/v1/prices', { method: 'POST', body: input }) }
}

export async function updatePrice(input: Json, ctx: ProviderContext): Promise<Json> {
  const path = `/v1/prices/${pathSegment(input.priceId, 'priceId')}`
  return { price: await request(ctx, path, { method: 'POST', body: withoutKeys(input, ['priceId']) }) }
}

export async function getPrice(input: Json, ctx: ProviderContext): Promise<Json> {
  const path = `/v1/prices/${pathSegment(input.priceId, 'priceId')}`
  return { price: await request(ctx, path, { method: 'GET' }) }
}

export async function listPrices(input: Json, ctx: ProviderContext): Promise<Json> {
  return { prices: await request(ctx, '/v1/prices', { method: 'GET', query: input }) }
}

export async function searchPrices(input: Json, ctx: ProviderContext): Promise<Json> {
  return { prices: await request(ctx, '/v1/prices/search', { method: 'GET', query: input }) }
}
