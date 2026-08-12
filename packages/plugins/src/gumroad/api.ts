/**
 * Gumroad 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/gumroad/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Gumroad 的三个特点决定了这里的形状:
 * - 凭证是 **`access_token` 参数**而非 header —— GET 时进 query,写入时进 form body。
 *   代价是 GET 的凭证会进 URL(进而可能进日志),但 Gumroad 不认 Authorization 头,没得选。
 * - 响应体带 `success` 布尔:HTTP 200 但 `success:false` 也是失败,必须单独判。
 * - 上游给每次请求挂了 30 秒超时,这里保留 —— 没有它,一次挂死的上游会把网关这一路
 *   请求拖到底层连接自己断开为止。
 *
 * 与上游有意偏离:**错误映射交给共用的 `upstreamError`**,且不迁 validate 阶段
 * (凭证校验是平台的事)。
 */

import type { z } from 'zod/v4'
import type {
  getProductInput,
  getSaleInput,
  listProductSubscribersInput,
  listSalesInput,
  markSaleAsShippedInput,
  refundSaleInput,
  resendSaleReceiptInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'gumroad'
const API_BASE = 'https://api.gumroad.com/v2'
const REQUEST_TIMEOUT_MS = 30_000

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

interface RequestInput {
  method: 'GET' | 'POST' | 'PUT'
  params?: Record<string, string | undefined>
  path: string
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<Json> {
  const url = new URL(`${API_BASE}${input.path}`)
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries({ access_token: requireApiKey(ctx, SERVICE), ...input.params })) {
    const trimmed = text(value)
    if (trimmed !== undefined) params.set(key, trimmed)
  }

  const headers: Record<string, string> = { accept: 'application/json' }
  let body: string | undefined
  if (input.method === 'GET') {
    for (const [key, value] of params) url.searchParams.set(key, value)
  } else {
    body = params.toString()
    headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
  }

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method,
      headers,
      signal: timeoutSignal,
      ...(body === undefined ? {} : { body }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 500,
    // 把"上游不通/出网被拦"说成插件自身故障。
    if (timeoutSignal.aborted) throw upstreamError(504, 'Gumroad 请求超时')
    throw upstreamError(502, error instanceof Error ? `Gumroad request failed: ${error.message}` : 'Gumroad request failed')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw upstreamError(502, 'Gumroad response was not valid JSON')
  }

  const record = toRecord(payload)
  const message = record === undefined ? undefined : text(record.message)
  if (!response.ok) {
    throw upstreamError(response.status, message ?? `Gumroad request failed with status ${response.status}`)
  }
  if (record === undefined) throw upstreamError(502, 'Gumroad response was not a JSON object')
  // HTTP 200 但 success:false —— Gumroad 用它表示业务失败,当上游故障归一。
  if (record.success === false) {
    throw upstreamError(502, message ?? 'Gumroad request was not successful')
  }
  return record
}

/** 两个分页接口的公共约定:没有下一页时把两个游标显式补成 null,而不是留缺字段。 */
function withNullablePagination(payload: Json): Json {
  return {
    ...payload,
    next_page_url: payload.next_page_url ?? null,
    next_page_key: payload.next_page_key ?? null,
  }
}

export function getCurrentUser(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { method: 'GET', path: '/user' })
}

export function listProducts(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { method: 'GET', path: '/products' })
}

export function getProduct(
  input: z.infer<typeof getProductInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, { method: 'GET', path: `/products/${encodeURIComponent(input.productId)}` })
}

export async function listSales(
  input: z.infer<typeof listSalesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'GET',
    path: '/sales',
    params: {
      after: input.after,
      before: input.before,
      product_id: input.productId,
      email: input.email,
      order_id: input.orderId,
      name: input.name,
      license_key: input.licenseKey,
      page_key: input.pageKey,
    },
  })
  return withNullablePagination(payload)
}

export function getSale(
  input: z.infer<typeof getSaleInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, { method: 'GET', path: `/sales/${encodeURIComponent(input.saleId)}` })
}

export async function listProductSubscribers(
  input: z.infer<typeof listProductSubscribersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'GET',
    path: `/products/${encodeURIComponent(input.productId)}/subscribers`,
    params: {
      email: input.email,
      paginated: input.paginated === undefined ? undefined : String(input.paginated),
      page_key: input.pageKey,
    },
  })
  return withNullablePagination(payload)
}

export function markSaleAsShipped(
  input: z.infer<typeof markSaleAsShippedInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    method: 'PUT',
    path: `/sales/${encodeURIComponent(input.saleId)}/mark_as_shipped`,
    params: { tracking_url: input.trackingUrl },
  })
}

export function refundSale(
  input: z.infer<typeof refundSaleInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    method: 'PUT',
    path: `/sales/${encodeURIComponent(input.saleId)}/refund`,
    params: { amount_cents: input.amountCents?.toString() },
  })
}

export function resendSaleReceipt(
  input: z.infer<typeof resendSaleReceiptInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, { method: 'POST', path: `/sales/${encodeURIComponent(input.saleId)}/resend_receipt` })
}
