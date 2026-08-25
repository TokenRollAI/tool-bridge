/**
 * Unsplash 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/unsplash/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 凭证在 **header**(`authorization: Client-ID <access key>`)—— 是 Unsplash 自有的方案名,
 * 不是 Bearer,写错前缀会 401。
 *
 * 六个 action 都是 GET,三处上游细节决定了这里的形状:
 * - `get_random_photo` 的响应**形状随入参而变**:带 `count` 回数组,不带回单个对象。
 *   上游用 `Array.isArray` 分叉后统一收成 `photos[]`,出参形状因此是稳定的 —— 这层必须保留,
 *   否则不传 count 的调用方会拿到 `photos: undefined`。
 * - `collections` / `topics` 是数组入参,但上游 API 收的是**逗号分隔串**,不是重复的同名参数。
 * - `query` 与 `collections`/`topics` **互斥**(上游 API 会静默忽略其一),上游在本地就拦下,
 *   保留:让调用方当场知道自己的过滤条件没生效,比拿到一张不符合预期的图强。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getPhotoInput,
  getRandomPhotoInput,
  getTopicPhotosInput,
  listPhotosInput,
  listTopicsInput,
  searchPhotosInput,
} from './schema'
import { finiteNumber as numeric, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'unsplash'
const API_BASE = 'https://api.unsplash.com'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>
type QueryValue = number | string | undefined

function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) {
    // 契约说好是对象;不是就是上游出问题,不是调用方的错。
    throw new TBError('unavailable', `${label}不是对象`, { retryable: true })
  }
  return result
}

/** 上游 `normalizeObjectArray`:响应必须是对象数组,否则算上游违约。 */
function objectArray(value: unknown): Json[] {
  if (!Array.isArray(value)) {
    throw new TBError('unavailable', 'Unsplash 响应不是数组', { retryable: true })
  }
  return value.map(item => requireRecord(item, 'Unsplash 数组元素'))
}

/**
 * Zod 的 `min(1)` 拦不住纯空白串,但打到上游就是一次必然失败的调用(或更糟:
 * 路径段变成空,打到别的端点上去),先挡下。
 */
function requireText(value: string, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} 不能是空白`)
  return result
}

/** 数组入参 → 逗号分隔串;逐项去空白后丢空,全空则整个参数不发。 */
function csv(value: string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  const items = value.map(item => text(item)).filter((item): item is string => item !== undefined)
  return items.length > 0 ? items.join(',') : undefined
}

/** Unsplash 的错误体有三种形态:`errors: string[]` / `error` / `message`。 */
function errorMessage(payload: unknown): string | undefined {
  const body = record(payload)
  if (body === undefined) return undefined
  if (Array.isArray(body.errors)) {
    for (const item of body.errors) {
      const message = text(item)
      if (message !== undefined) return message
    }
  }
  return text(body.error) ?? text(body.message)
}

async function request(ctx: ProviderContext, path: string, query: Record<string, QueryValue> = {}): Promise<unknown> {
  const response = await http.request({
    path,
    query: Object.entries(query),
    headers: {
      'accept': 'application/json',
      // Unsplash 自有的方案名,不是 Bearer。
      'authorization': `Client-ID ${requireApiKey(ctx, SERVICE)}`,
      'accept-version': 'v1',
    },
    invalidJson: 'text',
    mapError: ({ bodyKind, data, status }) => upstreamError(
      status,
      errorMessage(bodyKind === 'json' ? data : null) ?? `Unsplash 返回 HTTP ${status}`,
    ),
  })
  if (response.bodyKind === 'invalid-json') {
    throw new TBError('unavailable', 'Unsplash 返回了非 JSON 响应', { retryable: true })
  }
  return response.bodyKind === 'empty' ? null : response.data
}

export async function listPhotos(input: z.infer<typeof listPhotosInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/photos', {
    page: input.page,
    per_page: input.perPage,
    order_by: input.orderBy,
  })
  return { photos: objectArray(payload) }
}

export async function searchPhotos(input: z.infer<typeof searchPhotosInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/search/photos', {
    // 参数名是 `query`,不是各家搜索 API 常见的 `q`。
    query: requireText(input.query, 'query'),
    page: input.page,
    per_page: input.perPage,
    order_by: input.orderBy,
    color: input.color,
    orientation: input.orientation,
    content_filter: input.contentFilter,
    collections: csv(input.collections),
  })

  const result = requireRecord(payload, 'Unsplash 搜索响应')
  return {
    total: numeric(result.total) ?? 0,
    totalPages: numeric(result.total_pages) ?? 0,
    results: objectArray(result.results),
  }
}

export async function getPhoto(input: z.infer<typeof getPhotoInput>, ctx: ProviderContext): Promise<Json> {
  const id = requireText(input.id, 'id')
  const payload = await request(ctx, `/photos/${encodeURIComponent(id)}`)
  return { photo: requireRecord(payload, 'Unsplash 照片响应') }
}

export async function getRandomPhoto(
  input: z.infer<typeof getRandomPhotoInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const query = text(input.query)
  const collections = csv(input.collections)
  const topics = csv(input.topics)

  if (query !== undefined && (collections !== undefined || topics !== undefined)) {
    // 上游 API 收下两者但只认其一,不报错;在这里拦住,免得调用方以为过滤生效了。
    throw new TBError('invalid_argument', 'get_random_photo 的 query 不能与 collections 或 topics 同时使用')
  }

  const payload = await request(ctx, '/photos/random', {
    query,
    collections,
    topics,
    username: text(input.username),
    orientation: input.orientation,
    content_filter: input.contentFilter,
    count: input.count,
  })

  // 带 count 回数组、不带回单个对象;两条路都收成 photos[],出参形状才是稳定的。
  return {
    photos: Array.isArray(payload)
      ? objectArray(payload)
      : [requireRecord(payload, 'Unsplash 随机照片响应')],
  }
}

export async function listTopics(input: z.infer<typeof listTopicsInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/topics', {
    page: input.page,
    per_page: input.perPage,
    order_by: input.orderBy,
  })
  return { topics: objectArray(payload) }
}

export async function getTopicPhotos(
  input: z.infer<typeof getTopicPhotosInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const topic = requireText(input.topicIdOrSlug, 'topicIdOrSlug')
  const payload = await request(ctx, `/topics/${encodeURIComponent(topic)}/photos`, {
    page: input.page,
    per_page: input.perPage,
    orientation: input.orientation,
    order_by: input.orderBy,
  })
  return { photos: objectArray(payload) }
}
