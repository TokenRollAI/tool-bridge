/**
 * Zipcodebase 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/zipcodebase/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Zipcodebase 的两个特点决定了这里的形状:
 * - 凭证走自定义头 **`apikey`**,不是 Authorization。
 * - **失败常以 HTTP 200 + `{success:false, error:{code,type,info}}` 返回**,所以状态码不足以
 *   归类错误,必须先看 body 里的错误码(101 无效 key / 104 超额度 / 102·103·105 用法错误)。
 * - 多个邮编是 **逗号拼接**成一个 query 值。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  calculateDistanceInput,
  listPostalCodesByCityInput,
  listPostalCodesByStateInput,
  listPostalCodesWithinRadiusInput,
  matchPostalCodesByDistanceInput,
  searchPostalCodesInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'zipcodebase'
const API_BASE = 'https://app.zipcodebase.com/api/v1/'

type Json = Record<string, unknown>
type QueryValue = number | string | undefined

interface ProviderError {
  code?: number
  info: string
  type?: string
}

/** 只有 `success:false` 或存在 `error` 字段才算失败,其余(包括空结果)都是成功。 */
function readProviderError(payload: unknown): null | ProviderError {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Json
  if (record.success !== false && record.error === undefined) return null

  const error = record.error
  if (typeof error === 'string') return { info: error }
  if (error === null || typeof error !== 'object' || Array.isArray(error)) {
    const message = record.message
    return { info: typeof message === 'string' && message !== '' ? message : 'zipcodebase 请求失败' }
  }
  const errorRecord = error as Json
  const info = [errorRecord.info, errorRecord.message]
    .find(value => typeof value === 'string' && value.trim() !== '')
  return {
    code: typeof errorRecord.code === 'number' ? errorRecord.code : undefined,
    type: typeof errorRecord.type === 'string' && errorRecord.type !== '' ? errorRecord.type : undefined,
    info: typeof info === 'string' ? info.trim() : 'zipcodebase 请求失败',
  }
}

/** body 里的错误码 → 状态码,再交给共用映射。口径照搬上游。 */
function toStatus(error: ProviderError): number {
  if (error.code === 104 || error.type === 'usage_limit_reached') return 429
  if (error.code === 101 || error.type === 'invalid_access_key') return 401
  if (
    error.code === 102 || error.code === 103 || error.code === 105
    || error.type === 'invalid_api_function'
    || error.type === 'invalid_api_function_access'
    || error.type === 'function_access_restricted'
  ) {
    return 400
  }
  return 502
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, QueryValue>,
): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, API_BASE)
  for (const [key, value] of Object.entries(query)) {
    // 空串对 Zipcodebase 与"没给"同义,不必占一个 query 位。
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  let response: Response
  let text: string
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', apikey: apiKey },
    })
    text = await response.text()
  } catch (error) {
    if (error instanceof TBError) throw error
    throw new TBError(
      'unavailable',
      error instanceof Error ? `zipcodebase 请求失败: ${error.message}` : 'zipcodebase 请求失败',
      { retryable: true },
    )
  }

  if (text === '') {
    // 限流时上游也会回空体,这里保留 429 的语义(否则会被当成协议破损)。
    throw upstreamError(response.status === 429 ? 429 : 502, 'zipcodebase 返回了空响应体')
  }
  let payload: unknown
  try {
    payload = JSON.parse(text) as unknown
  } catch {
    throw upstreamError(response.status === 429 ? 429 : 502, 'zipcodebase 返回了非法 JSON')
  }

  // 顺序不能调:body 里的错误码比 HTTP 状态更能说明失败原因,先判它。
  const providerError = readProviderError(payload)
  if (providerError !== null) throw upstreamError(toStatus(providerError), providerError.info)
  if (!response.ok) {
    throw upstreamError(response.status, `zipcodebase 请求失败,HTTP ${response.status}`)
  }
  return payload
}

/** 多个邮编逗号拼接成一个 query 值;空白条目丢掉。 */
function joinCodes(codes: string[]): string {
  return codes.map(code => code.trim()).filter(code => code !== '').join(',')
}

export async function getStatus(_input: unknown, ctx: ProviderContext): Promise<unknown> {
  return await request(ctx, '/status', {})
}

export async function searchPostalCodes(
  input: z.infer<typeof searchPostalCodesInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return await request(ctx, '/search', { codes: joinCodes(input.codes), country: input.country })
}

export async function calculateDistance(
  input: z.infer<typeof calculateDistanceInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return await request(ctx, '/distance', {
    code: input.code,
    compare: joinCodes(input.compare),
    country: input.country,
    unit: input.unit,
  })
}

export async function listPostalCodesWithinRadius(
  input: z.infer<typeof listPostalCodesWithinRadiusInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return await request(ctx, '/radius', {
    code: input.code,
    radius: input.radius,
    country: input.country,
    unit: input.unit,
  })
}

export async function matchPostalCodesByDistance(
  input: z.infer<typeof matchPostalCodesByDistanceInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return await request(ctx, '/match', {
    codes: joinCodes(input.codes),
    distance: input.distance,
    country: input.country,
    unit: input.unit,
  })
}

export async function listPostalCodesByCity(
  input: z.infer<typeof listPostalCodesByCityInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return await request(ctx, '/code/city', {
    city: input.city,
    country: input.country,
    state_name: input.state_name,
  })
}

export async function listPostalCodesByState(
  input: z.infer<typeof listPostalCodesByStateInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  // schema 里这两个是 optional(上游 action 定义如此),但上游 executor 把它们当必填。
  if (input.state_name === undefined || input.country === undefined) {
    throw new TBError('invalid_argument', 'state_name 与 country 都是必填')
  }
  return await request(ctx, '/code/state', {
    state_name: input.state_name,
    country: input.country,
  })
}
