/**
 * Bookingmood 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/bookingmood/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Bookingmood 的 API 是 PostgREST 直出:`select`/`order`/`limit`/`offset` 与 `id=eq.x`
 * 之类的过滤器都原样进 query,列表返回的是**裸数组**而非信封。
 *
 * 与上游的一处有意偏离:上游 `buildBookingmoodError` 在"校验凭证"模式下把 401/403 压成
 * 400。这里没有 validate 模式(凭证探针走平台的 credentialProbe,拿到的仍是 401),
 * 状态码原样交给 `upstreamError`。
 */

import type { z } from 'zod/v4'
import type { listBookingsInput, listProductsInput, queryAvailabilityInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'bookingmood'
const API_BASE = 'https://api.bookingmood.com/v1'

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString` 的等价物:非字符串或空串都算缺失。 */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function buildUrl(path: string, query: Json): URL {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url
}

/** Bookingmood 在部分错误上回空体;空体按 `{}` 处理,而不是当成解析失败。 */
async function readJson(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body === '') return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw upstreamError(502, 'Bookingmood 返回了非法 JSON')
  }
}

async function request(ctx: ProviderContext, url: URL): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障。
    throw upstreamError(502, error instanceof Error ? `bookingmood 请求失败: ${error.message}` : 'bookingmood 请求失败')
  }

  if (!response.ok) {
    const payload = await readJson(response)
    const body = record(payload)
    const message = text(body?.message) ?? text(body?.error) ?? text(body?.details)
      ?? (response.statusText || `Bookingmood 返回 HTTP ${response.status}`)
    throw upstreamError(response.status, message)
  }
  return readJson(response)
}

/** 列表端点回的是裸数组,元素必须是对象;不是就是上游破了契约,不是调用方的错。 */
function readArray(value: unknown, what: string): Json[] {
  if (!Array.isArray(value)) throw upstreamError(502, `Bookingmood ${what} 返回了非数组响应`)
  return value.map((item) => {
    const row = record(item)
    if (row === undefined) throw upstreamError(502, `Bookingmood ${what} 返回了非对象元素`)
    return row
  })
}

/** `select` 缺省取 `*`:PostgREST 不传 select 时只回默认列,行为与上游保持一致。 */
function listQuery(input: Json): Json {
  return {
    select: text(input.select) ?? '*',
    limit: input.limit,
    offset: input.offset,
    order: input.order,
    id: input.id,
    organization_id: input.organization_id,
    product_id: input.product_id,
  }
}

export async function listProducts(
  input: z.infer<typeof listProductsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, buildUrl('/products', listQuery(input)))
  return { products: readArray(payload, 'products') }
}

export async function listBookings(
  input: z.infer<typeof listBookingsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, buildUrl('/bookings', listQuery(input)))
  return { bookings: readArray(payload, 'bookings') }
}

/**
 * availability 端点的形状不稳定:有时是裸数组,有时是把数组裹在某个键下的对象
 * (键名随版本变),有时干脆是单条记录。三种都收,统一成数组。
 */
function normalizeAvailability(payload: unknown): Json[] {
  if (Array.isArray(payload)) return readArray(payload, 'availability')
  const body = record(payload)
  if (body === undefined) throw upstreamError(502, 'Bookingmood availability 返回了非预期形状')
  for (const value of Object.values(body)) {
    if (Array.isArray(value)) return readArray(value, 'availability')
  }
  return [body]
}

export async function queryAvailability(
  input: z.infer<typeof queryAvailabilityInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, buildUrl('/availability', {
    product_id: input.product_id,
    start: input.start,
    end: input.end,
  }))
  return { availability: normalizeAvailability(payload), raw: payload }
}
