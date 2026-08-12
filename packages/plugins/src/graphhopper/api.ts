/**
 * GraphHopper 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/graphhopper/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * GraphHopper 的三个特点决定了这里的形状:
 * - **API key 走 `key` query 参数**,不走 header。
 * - 全部 5 个 action 都是 GET,参数一律进 query;**数组参数重复同名键**
 *   (`point=52.5,13.4&point=52.6,13.5`),顺序即语义,不能压成逗号串。
 * - 入参名是 camelCase,发出去的 query 名是 snake_case 或**带点的层级名**
 *   (`ch.disable`、`round_trip.distance`),这层映射必须逐字段照搬。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  calculateRouteInput,
  computeIsochroneInput,
  computeMatrixInput,
  geocodeInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'graphhopper'
const API_BASE = 'https://graphhopper.com'
const API_PREFIX = '/api/1'

type Json = Record<string, unknown>
type Query = Record<string, boolean | number | readonly number[] | readonly string[] | string | undefined>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** GraphHopper 的错误文案分散在 message/error/details,还有 `hints[].message`。 */
function errorMessage(payload: unknown, response: Response): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  const body = record(payload)
  if (body !== undefined) {
    const direct = text(body.message) ?? text(body.error) ?? text(body.details)
    if (direct !== undefined) return direct
    if (Array.isArray(body.hints)) {
      for (const hint of body.hints) {
        const message = text(record(hint)?.message)
        if (message !== undefined) return message
      }
    }
  }
  return text(response.statusText) ?? 'GraphHopper request failed'
}

async function request(ctx: ProviderContext, path: string, query: Query): Promise<unknown> {
  const url = new URL(`${API_PREFIX}${path}`, API_BASE)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item))
      continue
    }
    url.searchParams.set(key, String(value))
  }
  url.searchParams.set('key', requireApiKey(ctx, SERVICE))

  let response: Response
  let payload: unknown = null
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    const raw = await response.text()
    if (raw.trim() !== '') {
      try {
        payload = JSON.parse(raw)
      } catch {
        // 错误体常是纯文本;留给消息提取,免得"非法 JSON"顶掉真实状态码。
        payload = raw
      }
    }
  } catch (error) {
    const message = error instanceof Error
      ? `GraphHopper request failed: ${error.message}`
      : 'GraphHopper request failed'
    throw upstreamError(502, message)
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response))
  return payload
}

export async function calculateRoute(
  input: z.infer<typeof calculateRouteInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/route', {
    'point': input.point,
    'profile': input.profile,
    'locale': input.locale,
    'point_hint': input.pointHint,
    'snap_prevention': input.snapPrevention,
    'curbside': input.curbside,
    'details': input.details,
    'optimize': input.optimize,
    'instructions': input.instructions,
    'calc_points': input.calcPoints,
    'points_encoded': input.pointsEncoded,
    'elevation': input.elevation,
    'debug': input.debug,
    'ch.disable': input.chDisable,
    'heading': input.heading,
    'heading_penalty': input.headingPenalty,
    'pass_through': input.passThrough,
    'algorithm': input.algorithm,
    'round_trip.distance': input.roundTripDistance,
    'round_trip.seed': input.roundTripSeed,
    'alternative_route.max_paths': input.alternativeRouteMaxPaths,
    'alternative_route.max_weight_factor': input.alternativeRouteMaxWeightFactor,
    'alternative_route.max_share_factor': input.alternativeRouteMaxShareFactor,
  })
}

export async function geocode(
  input: z.infer<typeof geocodeInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  // 正向/反向地理编码的必填项互斥,schema 表达不了这条条件必填。
  if (input.reverse === true) {
    if (input.point === undefined) {
      throw new TBError('invalid_argument', 'point is required when reverse is true')
    }
    if (input.q !== undefined) {
      throw new TBError('invalid_argument', 'q must be omitted when reverse is true')
    }
  } else if (input.q === undefined) {
    throw new TBError('invalid_argument', 'q is required for forward geocoding')
  }

  return request(ctx, '/geocode', {
    q: input.q,
    point: input.point,
    reverse: input.reverse,
    locale: input.locale,
    limit: input.limit,
    provider: input.provider,
    debug: input.debug,
  })
}

export async function computeMatrix(
  input: z.infer<typeof computeMatrixInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  // 对称矩阵(point)与非对称矩阵(fromPoint + toPoint)二选一,schema 表达不了。
  const symmetric = input.point !== undefined
  if (symmetric && (input.fromPoint !== undefined || input.toPoint !== undefined)) {
    throw new TBError('invalid_argument', 'point cannot be combined with fromPoint or toPoint')
  }
  if (!symmetric && (input.fromPoint === undefined || input.toPoint === undefined)) {
    throw new TBError('invalid_argument', 'provide either point or both fromPoint and toPoint')
  }

  return request(ctx, '/matrix', {
    point: input.point,
    from_point: input.fromPoint,
    to_point: input.toPoint,
    profile: input.profile,
    point_hint: input.pointHint,
    from_point_hint: input.fromPointHint,
    to_point_hint: input.toPointHint,
    snap_prevention: input.snapPrevention,
    curbside: input.curbside,
    from_curbside: input.fromCurbside,
    to_curbside: input.toCurbside,
    out_array: input.outArray,
    fail_fast: input.failFast,
  })
}

export async function computeIsochrone(
  input: z.infer<typeof computeIsochroneInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  if (input.timeLimit !== undefined && input.distanceLimit !== undefined) {
    throw new TBError('invalid_argument', 'timeLimit and distanceLimit cannot be provided together')
  }

  return request(ctx, '/isochrone', {
    point: input.point,
    profile: input.profile,
    time_limit: input.timeLimit,
    distance_limit: input.distanceLimit,
    buckets: input.buckets,
    reverse_flow: input.reverseFlow,
  })
}

export async function listProfiles(
  _input: unknown,
  ctx: ProviderContext,
): Promise<{ profiles: unknown[] }> {
  // /profiles 有时回裸数组、有时回 `{profiles:[...]}`;两种都归一到后者。
  const payload = await request(ctx, '/profiles', {})
  if (Array.isArray(payload)) return { profiles: payload }
  const profiles = record(payload)?.profiles
  return { profiles: Array.isArray(profiles) ? profiles : [] }
}
