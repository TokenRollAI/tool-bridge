/**
 * Geocodio 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/geocodio/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 一处有意偏离上游:上游 `createGeocodioError` 把 403 压成 401、422 压成 400、5xx 压成 502。
 * 这里把原始状态交给 `upstreamError`,归一后的七码与上游一致,但少一次状态改写。
 *
 * 响应**原样透出**,不做归一:Geocodio 的形状随 `format=simple` 与 `fields` 变化,
 * 上游也是原样返回,套一层就改了调用方看到的形状。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  batchReverseGeocodeInput,
  geocodeBatchInput,
  singleGeocodeInput,
  singleReverseGeocodeInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'geocodio'
const API_BASE = 'https://api.geocod.io'
const API_VERSION = 'v1.12'

type Json = Record<string, unknown>
type Query = Record<string, number | string | undefined>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  const body = record(payload)
  return text(body?.error) ?? text(body?.message)
}

/** 解析不出 JSON 就把原文本身当 payload,留给消息提取。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

async function request(ctx: ProviderContext, path: string, query: Query, body?: unknown): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(`/${API_VERSION}${path}`, API_BASE)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  // Geocodio 的凭证走 query 参数,没有请求头形式。
  url.searchParams.set('api_key', apiKey)

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), body === undefined
      ? { method: 'GET' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    payload = await readPayload(response)
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error" 500。
    throw upstreamError(
      502,
      error instanceof Error ? `Geocodio request failed: ${error.message}` : 'Geocodio request failed',
    )
  }

  if (!response.ok) {
    throw upstreamError(
      // 上游对状态为 0 的响应兜底成 502;这里保持同样的兜底。
      response.status === 0 ? 502 : response.status,
      errorMessage(payload) ?? (response.statusText || 'Geocodio request failed'),
    )
  }
  return payload
}

export async function singleGeocode(
  input: z.infer<typeof singleGeocodeInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  // 全部地址字段都是可选的,但至少得给一个 —— 这是 schema 表达不了的跨字段约束。
  // 不挡下的话上游会拿一个只有 api_key 的请求回一句含糊的 4xx。
  const hasAny = [
    input.q,
    input.street,
    input.street2,
    input.city,
    input.state,
    input.postal_code,
    input.country,
    input.county,
  ].some(value => value !== undefined && value.trim() !== '')
  if (!hasAny) throw new TBError('invalid_argument', 'q or at least one address component is required')

  return request(ctx, '/geocode', {
    q: input.q,
    street: input.street,
    street2: input.street2,
    city: input.city,
    state: input.state,
    postal_code: input.postal_code,
    country: input.country,
    county: input.county,
    fields: input.fields,
    limit: input.limit,
    format: input.format,
  })
}

export async function geocodeBatch(
  input: z.infer<typeof geocodeBatchInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  // 批量端点的地址数组走 POST body,过滤器仍走 query。
  return request(ctx, '/geocode', { fields: input.fields, limit: input.limit }, input.addresses)
}

export async function singleReverseGeocode(
  input: z.infer<typeof singleReverseGeocodeInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/reverse', {
    // 反向查询的坐标拼成一个 `lat,lng` 字符串塞进 q,没有独立的 lat/lng 参数。
    q: `${input.lat},${input.lng}`,
    fields: input.fields,
    limit: input.limit,
    format: input.format,
  })
}

export async function batchReverseGeocode(
  input: z.infer<typeof batchReverseGeocodeInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/reverse', { fields: input.fields, limit: input.limit }, input.coordinates)
}
