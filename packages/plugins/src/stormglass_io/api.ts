/**
 * Stormglass 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/stormglass_io/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Stormglass 的两个特点决定了这里的形状:
 * - 凭证是**裸 authorization 头**(没有 `Bearer ` 前缀)。
 * - 多值参数是**逗号连接的单个 query**(`params=windSpeed,waveHeight`),不是重复键。
 *
 * 上游的 `phase === 'validate'` 分支没有搬:那只服务于 credentialValidators,
 * 本仓库由平台的 credentialProbe 承担。402(额度耗尽)→ 429 这条保留了。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { getTideExtremesInput, getTideSeaLevelInput, getWeatherPointInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'stormglass_io'
const API_BASE = 'https://api.stormglass.io'

type Json = Record<string, unknown>
type TimeValue = number | string

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new TBError('unavailable', 'Stormglass 返回了非 JSON 响应', { retryable: true })
  }
}

/** Stormglass 的错误文案散在三个字段上,按上游的顺序取第一个非空的。 */
function errorMessage(payload: unknown, status: number): string {
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Json
    for (const key of ['message', 'error', 'detail'] as const) {
      const value = record[key]
      if (typeof value === 'string' && value !== '') return value
    }
  }
  return `Stormglass request failed with ${status}`
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, TimeValue | undefined>,
): Promise<Json> {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      // Stormglass 要的是裸 key,加 `Bearer ` 前缀会被拒。
      headers: { accept: 'application/json', authorization: requireApiKey(ctx, SERVICE) },
    })
    payload = await readPayload(response)
  } catch (error) {
    if (error instanceof TBError) throw error
    throw new TBError(
      'unavailable',
      error instanceof Error ? `Stormglass 请求失败: ${error.message}` : 'Stormglass 请求失败',
      { retryable: true },
    )
  }

  if (!response.ok) {
    // 402 是「今日额度用完」,对调用方而言等价于限流:归成 429 才带上 retryable。
    const status = response.status === 402 ? 429 : response.status
    throw upstreamError(status, errorMessage(payload, response.status))
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TBError('unavailable', 'Stormglass 返回了非对象响应', { retryable: true })
  }
  return payload as Json
}

/** 上游对数据数组的要求:必须是数组,且每一项都是对象;不满足即上游契约破了。 */
function objectArray(value: unknown, field: string): Json[] {
  if (!Array.isArray(value)) {
    throw new TBError('unavailable', `Stormglass 的 ${field} 不是数组`, { retryable: true })
  }
  return value.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TBError('unavailable', `Stormglass 的 ${field} 含非对象条目`, { retryable: true })
    }
    return item as Json
  })
}

function metaOf(payload: Json): Json {
  const meta = payload.meta
  return meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Json) : {}
}

/** 三个 action 共有的坐标 + 时间窗参数。 */
function pointQuery(input: {
  end?: TimeValue
  lat: number
  lng: number
  start?: TimeValue
}): Record<string, TimeValue | undefined> {
  return { lat: input.lat, lng: input.lng, start: input.start, end: input.end }
}

export async function getWeatherPoint(
  input: z.infer<typeof getWeatherPointInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/v2/weather/point', {
    ...pointQuery(input),
    params: input.params.join(','),
    source: input.source?.join(','),
  })
  return { hours: objectArray(payload.hours, 'hours'), meta: metaOf(payload) }
}

export async function getTideExtremes(
  input: z.infer<typeof getTideExtremesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/v2/tide/extremes/point', {
    ...pointQuery(input),
    datum: input.datum,
  })
  return { extremes: objectArray(payload.data, 'data'), meta: metaOf(payload) }
}

export async function getTideSeaLevel(
  input: z.infer<typeof getTideSeaLevelInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/v2/tide/sea-level/point', {
    ...pointQuery(input),
    datum: input.datum,
  })
  return { seaLevels: objectArray(payload.data, 'data'), meta: metaOf(payload) }
}
