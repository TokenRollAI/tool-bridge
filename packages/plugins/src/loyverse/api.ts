/**
 * Loyverse 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/loyverse/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Loyverse 有两个必须照搬的怪异:
 * - 错误可能藏在 **HTTP 200** 的响应体里(`{errors:[{code,field,details}]}`),
 *   所以每次响应都先看 `errors` 再看状态码;
 * - 各资源的 id 过滤参数名不统一(`store_ids` / `items_ids` / `categories_ids` /
 *   `customer_ids`),不能用一个通用名。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getCategoryInput,
  getCustomerInput,
  getItemInput,
  getReceiptInput,
  getStoreInput,
  listCategoriesInput,
  listCustomersInput,
  listItemsInput,
  listReceiptsInput,
  listStoresInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'loyverse'
const API_BASE = 'https://api.loyverse.com/v1.0'

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | undefined

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : undefined
}

/** 契约说好这一层是对象;不是就是上游出问题,不是调用方的错。 */
function requireObject(value: unknown, label: string): Json {
  const object = record(value)
  if (object === undefined) throw new TBError('unavailable', `${label} 不是对象`, { retryable: true })
  return object
}

/** 路径参数必须非空:schema 把这些 id 标成了 optional,拼进 URL 前得自己挡一道。 */
function pathSegment(value: string | undefined, field: string): string {
  const segment = value?.trim()
  if (segment === undefined || segment === '') {
    throw new TBError('invalid_argument', `${field} 不能为空`)
  }
  return encodeURIComponent(segment)
}

/** Loyverse 的错误对象是 `{code, field, details}`,拼成一行给调用方。 */
function errorMessage(errors: Json[]): string {
  const first = errors[0] ?? {}
  const parts = [text(first.code), text(first.field), text(first.details)].filter(part => part !== undefined)
  return parts.length > 0 ? parts.join(': ') : 'Loyverse request failed'
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, QueryValue> = {},
): Promise<unknown> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  const response = await guardedFetch(url.toString(), {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
    },
  })

  const body = await response.text()
  let payload: unknown = {}
  if (body !== '') {
    try {
      payload = JSON.parse(body)
    } catch {
      throw new TBError('unavailable', 'Loyverse 返回了非 JSON 响应', { retryable: true })
    }
  }

  // errors 先于状态码判断:Loyverse 会用 200 回带 errors 的体。
  const errors = record(payload)?.errors
  if (Array.isArray(errors) && errors.length > 0) {
    throw upstreamError(
      response.status,
      errorMessage(errors.map(error => requireObject(error, 'Loyverse error object'))),
    )
  }
  if (!response.ok) {
    throw upstreamError(response.status, body || `Loyverse request failed with status ${response.status}`)
  }
  return payload
}

async function requestList(
  ctx: ProviderContext,
  path: string,
  property: string,
  query: Record<string, QueryValue>,
): Promise<Json> {
  const payload = requireObject(await request(ctx, path, query), `Loyverse ${property} response`)
  const records = payload[property]
  if (!Array.isArray(records)) {
    throw new TBError('unavailable', `Loyverse 响应缺少 ${property} 数组`, { retryable: true })
  }
  return {
    [property]: records.map(item => requireObject(item, `Loyverse ${property} record`)),
    cursor: text(payload.cursor) ?? null,
    raw: payload,
  }
}

async function requestItem(ctx: ProviderContext, path: string, property: string): Promise<Json> {
  return { [property]: requireObject(await request(ctx, path), `Loyverse ${property} response`) }
}

type CommonListInput
  = | z.infer<typeof listCategoriesInput>
    | z.infer<typeof listItemsInput>
    | z.infer<typeof listStoresInput>

/** stores/items/categories 共用一组筛选,只有 id 参数名不同。 */
function commonListQuery(input: CommonListInput, idsQueryName: string): Record<string, QueryValue> {
  return {
    [idsQueryName]: input.ids?.join(','),
    created_at_min: input.createdAtMin,
    created_at_max: input.createdAtMax,
    updated_at_min: input.updatedAtMin,
    updated_at_max: input.updatedAtMax,
    limit: input.limit,
    cursor: input.cursor,
    show_deleted: input.showDeleted === undefined ? undefined : String(input.showDeleted),
  }
}

// —— handlers ——

export function getMerchant(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return requestItem(ctx, '/merchant/', 'merchant')
}

export function listStores(
  input: z.infer<typeof listStoresInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestList(ctx, '/stores', 'stores', commonListQuery(input, 'store_ids'))
}

export function getStore(
  input: z.infer<typeof getStoreInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestItem(ctx, `/stores/${pathSegment(input.id, 'id')}`, 'store')
}

export function listItems(
  input: z.infer<typeof listItemsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestList(ctx, '/items', 'items', commonListQuery(input, 'items_ids'))
}

export function getItem(
  input: z.infer<typeof getItemInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestItem(ctx, `/items/${pathSegment(input.id, 'id')}`, 'item')
}

export function listCategories(
  input: z.infer<typeof listCategoriesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestList(ctx, '/categories', 'categories', commonListQuery(input, 'categories_ids'))
}

export function getCategory(
  input: z.infer<typeof getCategoryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestItem(ctx, `/categories/${pathSegment(input.id, 'id')}`, 'category')
}

export function listCustomers(
  input: z.infer<typeof listCustomersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // customers 没有 show_deleted,多一个 email 过滤,故不走 commonListQuery。
  return requestList(ctx, '/customers', 'customers', {
    customer_ids: input.ids?.join(','),
    email: input.email,
    created_at_min: input.createdAtMin,
    created_at_max: input.createdAtMax,
    updated_at_min: input.updatedAtMin,
    updated_at_max: input.updatedAtMax,
    limit: input.limit,
    cursor: input.cursor,
  })
}

export function getCustomer(
  input: z.infer<typeof getCustomerInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestItem(ctx, `/customers/${pathSegment(input.id, 'id')}`, 'customer')
}

export function listReceipts(
  input: z.infer<typeof listReceiptsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestList(ctx, '/receipts', 'receipts', {
    receipt_numbers: input.receiptNumbers?.join(','),
    since_receipt_number: input.sinceReceiptNumber,
    before_receipt_number: input.beforeReceiptNumber,
    store_id: input.storeId,
    order: input.order,
    source: input.source,
    created_at_min: input.createdAtMin,
    created_at_max: input.createdAtMax,
    updated_at_min: input.updatedAtMin,
    updated_at_max: input.updatedAtMax,
    limit: input.limit,
    cursor: input.cursor,
  })
}

export function getReceipt(
  input: z.infer<typeof getReceiptInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestItem(ctx, `/receipts/${pathSegment(input.receiptNumber, 'receiptNumber')}`, 'receipt')
}
