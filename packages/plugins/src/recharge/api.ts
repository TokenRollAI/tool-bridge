/**
 * Recharge 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/recharge/executors.ts`(它走共用的
 * `http-json-runtime`),语义等价、写法本地化:凭证从 `ctx.upstreamAuth` 取,
 * 出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Recharge 的特点决定了这里的形状:
 * - 凭证走 **`x-recharge-access-token`** 头,并**必须**带 `x-recharge-version` 指定 API 版本。
 * - 十个 action 是同一套 CRUD 打在五种资源上,所以这里也只有 `listResource`/`getResource`
 *   两个函数 + 一张资源表,而不是十份复制。
 * - 列表是 cursor 分页(`next_cursor`/`previous_cursor`),多值参数逗号拼接。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getCustomerInput,
  listChargesInput,
  listCustomersInput,
  listOrdersInput,
  listProductsInput,
  listSubscriptionsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'recharge'
const API_BASE = 'https://api.rechargeapps.com/'
const API_VERSION = '2021-11'

type Json = Record<string, unknown>
type QueryValue = number | string | undefined

interface ResourceSpec {
  path: string
  plural: string
  singular: string
}

const CUSTOMER: ResourceSpec = { singular: 'customer', plural: 'customers', path: '/customers' }
const SUBSCRIPTION: ResourceSpec = { singular: 'subscription', plural: 'subscriptions', path: '/subscriptions' }
const ORDER: ResourceSpec = { singular: 'order', plural: 'orders', path: '/orders' }
const CHARGE: ResourceSpec = { singular: 'charge', plural: 'charges', path: '/charges' }
const PRODUCT: ResourceSpec = { singular: 'product', plural: 'products', path: '/products' }

/** Recharge 的错误体键名大小写不统一,message/error/detail/title 都出现过。 */
function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Json
    for (const key of ['message', 'Message', 'error', 'Error', 'detail', 'Detail', 'title', 'Title']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
  }
  return `Recharge 请求失败,HTTP ${status}`
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, QueryValue>,
): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, API_BASE)
  for (const [key, value] of Object.entries(query)) {
    // 空串对 Recharge 的列表过滤与"没给"同义。
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  let response: Response
  let text: string
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'x-recharge-access-token': apiKey,
        'x-recharge-version': API_VERSION,
      },
    })
    text = await response.text()
  } catch (error) {
    if (error instanceof TBError) throw error
    throw new TBError(
      'unavailable',
      error instanceof Error ? `Recharge 请求失败: ${error.message}` : 'Recharge 请求失败',
      { retryable: true },
    )
  }

  let payload: unknown = null
  if (text.trim() !== '') {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      throw new TBError('unavailable', 'Recharge 返回了非法 JSON', { retryable: true })
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return payload
}

function requireObject(payload: unknown, label: string): Json {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TBError('unavailable', `Recharge 的 ${label} 不是对象`, { retryable: true })
  }
  return payload as Json
}

function requireArray(payload: unknown, label: string): unknown[] {
  if (!Array.isArray(payload)) {
    throw new TBError('unavailable', `Recharge 的 ${label} 不是数组`, { retryable: true })
  }
  return payload
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 数组参数逗号拼接成一个 query 值。 */
function join(values: string[] | undefined): string | undefined {
  return values === undefined ? undefined : values.join(',')
}

/** 列表过滤项的驼峰入参 → Recharge 的下划线 query 名。各资源共用一张表,给谁不给谁由入参决定。 */
function listQuery(input: Json): Record<string, QueryValue> {
  return {
    include: join(input.include as string[] | undefined),
    limit: input.limit as number | undefined,
    cursor: input.cursor as string | undefined,
    ids: join(input.ids as string[] | undefined),
    sort_by: input.sortBy as string | undefined,
    created_at_min: input.createdAtMin as string | undefined,
    created_at_max: input.createdAtMax as string | undefined,
    updated_at_min: input.updatedAtMin as string | undefined,
    updated_at_max: input.updatedAtMax as string | undefined,
    address_id: input.addressId as string | undefined,
    charge_id: input.chargeId as string | undefined,
    collection_id: input.collectionId as string | undefined,
    customer_id: input.customerId as string | undefined,
    discount_code: input.discountCode as string | undefined,
    discount_id: input.discountId as string | undefined,
    email: input.email as string | undefined,
    external_order_id: input.externalOrderId as string | undefined,
    external_product_id: input.externalProductId as string | undefined,
    processed_at_min: input.processedAtMin as string | undefined,
    processed_at_max: input.processedAtMax as string | undefined,
    product_title: input.productTitle as string | undefined,
    purchase_item_id: input.purchaseItemId as string | undefined,
    scheduled_at: input.scheduledAt as string | undefined,
    scheduled_at_min: input.scheduledAtMin as string | undefined,
    scheduled_at_max: input.scheduledAtMax as string | undefined,
    status: input.status as string | undefined,
    title: input.title as string | undefined,
  }
}

async function listResource(spec: ResourceSpec, input: Json, ctx: ProviderContext): Promise<Json> {
  const raw = requireObject(await request(ctx, spec.path, listQuery(input)), spec.plural)
  return {
    [spec.plural]: requireArray(raw[spec.plural], spec.plural),
    nextCursor: nonEmpty(raw.next_cursor) ?? null,
    previousCursor: nonEmpty(raw.previous_cursor) ?? null,
    raw,
  }
}

async function getResource(
  spec: ResourceSpec,
  input: z.infer<typeof getCustomerInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = requireObject(
    await request(ctx, `${spec.path}/${encodeURIComponent(input.id)}`, {
      include: join(input.include),
    }),
    spec.singular,
  )
  return { [spec.singular]: requireObject(raw[spec.singular], spec.singular), raw }
}

export async function listCustomers(
  input: z.infer<typeof listCustomersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await listResource(CUSTOMER, input, ctx)
}

export async function getCustomer(
  input: z.infer<typeof getCustomerInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await getResource(CUSTOMER, input, ctx)
}

export async function listSubscriptions(
  input: z.infer<typeof listSubscriptionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await listResource(SUBSCRIPTION, input, ctx)
}

export async function getSubscription(
  input: z.infer<typeof getCustomerInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await getResource(SUBSCRIPTION, input, ctx)
}

export async function listOrders(
  input: z.infer<typeof listOrdersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await listResource(ORDER, input, ctx)
}

export async function getOrder(
  input: z.infer<typeof getCustomerInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await getResource(ORDER, input, ctx)
}

export async function listCharges(
  input: z.infer<typeof listChargesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await listResource(CHARGE, input, ctx)
}

export async function getCharge(
  input: z.infer<typeof getCustomerInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await getResource(CHARGE, input, ctx)
}

export async function listProducts(
  input: z.infer<typeof listProductsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await listResource(PRODUCT, input, ctx)
}

export async function getProduct(
  input: z.infer<typeof getCustomerInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await getResource(PRODUCT, input, ctx)
}
