/**
 * Paddle 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/paddle/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 与上游有意偏离的两处:
 * - **错误映射交给共用的 `upstreamError`**。上游把 404/422 一律压成 400,抹平了
 *   "资源不存在"与"参数不合法"之别;共用映射把 404 归到 not_found。
 * - **不迁 validate 阶段**(凭证校验是平台的事),只留 execute 口径。
 *
 * Paddle 的三个形状特点决定了这里的写法:
 * - 响应统一是 `{data, meta}`,list 的 data 是数组、detail 的 data 是对象;
 * - 多值过滤器是**逗号拼接的单个查询参数**(`status=active,archived`),不是重复键;
 * - `skipCount` 不是查询参数而是 `Skip-Count` 请求头。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createCustomerInput,
  createPriceInput,
  createProductInput,
  getCustomerInput,
  getPriceInput,
  getProductInput,
  listCustomersInput,
  listPricesInput,
  listProductsInput,
  updateCustomerInput,
  updatePriceInput,
  updateProductInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'paddle'
const API_BASE = 'https://api.paddle.com'

type Json = Record<string, unknown>

function toRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString` 的语义:非空白字符串才算数,且取 trim 后的值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** get_* 的 id 在生成的 schema 里是 optional,但拼进 URL 前必须有值。 */
function pathSegment(value: string | undefined, field: string): string {
  if (value === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return encodeURIComponent(value)
}

/** 上游 `setOptional`:布尔与数字直接字符串化,字符串走 trim 后非空判定。 */
function setOptional(params: URLSearchParams, key: string, value: unknown): void {
  const stringValue = typeof value === 'boolean' || typeof value === 'number' ? String(value) : text(value)
  if (stringValue !== undefined) params.set(key, stringValue)
}

/** Paddle 的多值过滤器是逗号拼接的单个参数,不是重复键。空数组当没传。 */
function setJoined(params: URLSearchParams, key: string, value: readonly unknown[] | undefined): void {
  if (value === undefined || value.length === 0) return
  params.set(key, value.map(String).join(','))
}

async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    // 成功响应体解不开是上游故障;错误响应体常是纯文本,留着当错误消息用。
    if (response.ok) throw upstreamError(502, 'Paddle returned malformed JSON')
    return body
  }
}

function errorMessage(payload: unknown, response: Response): string {
  const data = toRecord(payload)
  if (data === undefined) {
    return typeof payload === 'string' && payload !== ''
      ? payload
      : (response.statusText || `Paddle 返回 HTTP ${response.status}`)
  }
  const error = toRecord(data.error)
  const message = text(error?.detail) ?? text(error?.message) ?? text(data.message) ?? text(data.error)
  // 上游退回 `response.statusText`,而 statusText 允许是空串 —— `??` 接不住它。
  return message ?? (response.statusText || `Paddle 返回 HTTP ${response.status}`)
}

interface RequestInput {
  body?: Json
  method: 'GET' | 'PATCH' | 'POST'
  path: string
  searchParams?: URLSearchParams
  skipCount?: boolean
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const url = new URL(input.path, API_BASE)
  for (const [key, value] of input.searchParams ?? []) url.searchParams.set(key, value)

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'
  if (input.skipCount === true) headers['skip-count'] = 'true'

  const response = await guardedFetch(url.toString(), {
    method: input.method,
    headers,
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  })
  const payload = await readPayload(response)
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response))
  return payload
}

function readMeta(payload: unknown): Json {
  return toRecord(toRecord(payload)?.meta) ?? {}
}

function listResult(payload: unknown): Json {
  const data = toRecord(payload)?.data
  return { data: Array.isArray(data) ? data : [], meta: readMeta(payload) }
}

function entityResult(key: string, payload: unknown): Json {
  return { [key]: toRecord(toRecord(payload)?.data) ?? null, meta: readMeta(payload) }
}

function paginationParams(input: { after?: string, orderBy?: string, perPage?: number }): URLSearchParams {
  const params = new URLSearchParams()
  setOptional(params, 'after', input.after)
  setOptional(params, 'per_page', input.perPage)
  setOptional(params, 'order_by', input.orderBy)
  return params
}

/** 写入体就是入参去掉路径参数 id;`undefined` 丢掉,`null` 保留(Paddle 用 null 清空字段)。 */
function writeBody(input: Json): Json {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => key !== 'id' && value !== undefined),
  )
}

// —— products ——

export async function listProducts(
  input: z.infer<typeof listProductsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const searchParams = paginationParams(input)
  setJoined(searchParams, 'id', input.ids)
  setJoined(searchParams, 'include', input.include)
  setJoined(searchParams, 'status', input.status)
  setJoined(searchParams, 'tax_category', input.taxCategory)
  setOptional(searchParams, 'type', input.type)
  return listResult(await request(ctx, {
    method: 'GET',
    path: '/products',
    searchParams,
    skipCount: input.skipCount,
  }))
}

export async function getProduct(
  input: z.infer<typeof getProductInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/products/${pathSegment(input.id, 'id')}`
  return entityResult('product', await request(ctx, { method: 'GET', path }))
}

export async function createProduct(
  input: z.infer<typeof createProductInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'POST', path: '/products', body: writeBody(input) })
  return entityResult('product', payload)
}

export async function updateProduct(
  input: z.infer<typeof updateProductInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/products/${pathSegment(input.id, 'id')}`
  return entityResult('product', await request(ctx, { method: 'PATCH', path, body: writeBody(input) }))
}

// —— prices ——

export async function listPrices(
  input: z.infer<typeof listPricesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const searchParams = paginationParams(input)
  setJoined(searchParams, 'id', input.ids)
  setJoined(searchParams, 'include', input.include)
  setJoined(searchParams, 'product_id', input.productIds)
  setJoined(searchParams, 'status', input.status)
  setOptional(searchParams, 'recurring', input.recurring)
  setOptional(searchParams, 'billing_cycle.interval', input.billingCycleInterval)
  setOptional(searchParams, 'billing_cycle.frequency', input.billingCycleFrequency)
  setOptional(searchParams, 'type', input.type)
  return listResult(await request(ctx, {
    method: 'GET',
    path: '/prices',
    searchParams,
    skipCount: input.skipCount,
  }))
}

export async function getPrice(
  input: z.infer<typeof getPriceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/prices/${pathSegment(input.id, 'id')}`
  return entityResult('price', await request(ctx, { method: 'GET', path }))
}

export async function createPrice(
  input: z.infer<typeof createPriceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'POST', path: '/prices', body: writeBody(input) })
  return entityResult('price', payload)
}

export async function updatePrice(
  input: z.infer<typeof updatePriceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/prices/${pathSegment(input.id, 'id')}`
  return entityResult('price', await request(ctx, { method: 'PATCH', path, body: writeBody(input) }))
}

// —— customers ——

export async function listCustomers(
  input: z.infer<typeof listCustomersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const searchParams = paginationParams(input)
  setJoined(searchParams, 'id', input.ids)
  setJoined(searchParams, 'email', input.emails)
  setJoined(searchParams, 'status', input.status)
  setOptional(searchParams, 'search', input.search)
  return listResult(await request(ctx, {
    method: 'GET',
    path: '/customers',
    searchParams,
    skipCount: input.skipCount,
  }))
}

export async function getCustomer(
  input: z.infer<typeof getCustomerInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/customers/${pathSegment(input.id, 'id')}`
  return entityResult('customer', await request(ctx, { method: 'GET', path }))
}

export async function createCustomer(
  input: z.infer<typeof createCustomerInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'POST', path: '/customers', body: writeBody(input) })
  return entityResult('customer', payload)
}

export async function updateCustomer(
  input: z.infer<typeof updateCustomerInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/customers/${pathSegment(input.id, 'id')}`
  return entityResult('customer', await request(ctx, { method: 'PATCH', path, body: writeBody(input) }))
}
