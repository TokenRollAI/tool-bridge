/**
 * StoreCensus 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/storecensus/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * StoreCensus 的形状特点:
 * - base URL 自带 `/api/v1` 前缀,拼路径时按**相对路径**接(去掉前导斜杠),
 *   否则 `new URL('/website/x', base)` 会把 `/api/v1` 冲掉。
 * - 两种分页混用:`search_stores` 是 cursor,`list_apps` 是页码。
 * - 响应形状被上游**严格校验**(data 必须是对象数组、pagination 必须是对象),
 *   不符就当上游故障。这个严格度保留:出参 schema 依赖这些字段存在。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getWebsiteInput,
  listAppsInput,
  searchStoresInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'storecensus'
const API_BASE = 'https://www.storecensus.com/api/v1/'
const REQUEST_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>

function toRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游把"响应形状不对"一律当上游故障(502),不是调用方的错。 */
function requireObject(value: unknown, label: string): Json {
  const record = toRecord(value)
  if (record === undefined) throw upstreamError(502, `${label} is invalid`)
  return record
}

function requireObjectArray(value: unknown, label: string): Json[] {
  if (!Array.isArray(value)) throw upstreamError(502, `${label} is invalid`)
  return value.map(item => requireObject(item, `${label} item`))
}

function errorMessage(payload: unknown, status: number): string {
  const direct = text(payload)
  if (direct !== undefined) return direct
  const record = toRecord(payload)
  return text(record?.error) ?? text(record?.message) ?? text(record?.detail)
    ?? `StoreCensus request failed with status ${status}`
}

/**
 * 上游对成功响应里的坏 JSON 报 502、对失败响应里的坏 JSON 退回纯文本(好让错误消息
 * 至少能透出来)。两条分支的差别是有意的,照搬。
 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    if (!response.ok) return body
    throw upstreamError(502, 'invalid StoreCensus JSON response')
  }
}

interface RequestInput {
  body?: Json
  method: 'GET' | 'POST'
  /** 相对路径(不带前导斜杠),base 里的 /api/v1 前缀要保住。 */
  path: string
  query?: Array<[string, string]>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const url = new URL(input.path, API_BASE)
  for (const [key, value] of input.query ?? []) url.searchParams.set(key, value)

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  let body: string | undefined
  if (input.method === 'POST') {
    headers['content-type'] = 'application/json'
    // 上游即使没有任何字段也发 `{}`,不发空体。
    body = JSON.stringify(input.body ?? {})
  }

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof TBError) throw error
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, 'StoreCensus request timed out')
    }
    throw error
  }

  const payload = await readPayload(response)
  if (!response.ok) throw upstreamError(response.status || 500, errorMessage(payload, response.status))
  return payload
}

/** list_app_categories 与凭证校验共用的整形:total 缺失时用数组长度兜底。 */
function normalizeCategories(payload: unknown): Json {
  const body = requireObject(payload, 'StoreCensus app categories response')
  const categories = requireObjectArray(body.data, 'StoreCensus app categories response data')
  return {
    categories,
    total: Number.isInteger(body.total) ? body.total : categories.length,
  }
}

export async function getWebsite(
  input: z.infer<typeof getWebsiteInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const query: Array<[string, string]> = []
  // sections 是逗号分隔的单个参数,不是重复键;空数组按未提供处理。
  if (input.sections !== undefined && input.sections.length > 0) {
    query.push(['sections', input.sections.join(',')])
  }
  const payload = await request(ctx, {
    method: 'GET',
    path: `website/${encodeURIComponent(input.domain)}`,
    query,
  })
  return { website: requireObject(payload, 'StoreCensus website response') }
}

export async function searchStores(
  input: z.infer<typeof searchStoresInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body: Json = {}
  for (const key of ['filters', 'sort', 'pageSize', 'cursor', 'sections'] as const) {
    const value = input[key]
    if (value !== undefined && value !== null && value !== '') body[key] = value
  }

  const payload = await request(ctx, { method: 'POST', path: 'stores', body })
  const record = requireObject(payload, 'StoreCensus stores search response')
  return {
    stores: requireObjectArray(record.data, 'StoreCensus stores search response data'),
    pagination: requireObject(record.pagination, 'StoreCensus stores search response pagination'),
    filters: toRecord(record.filters) ?? {},
    sort: toRecord(record.sort) ?? {},
    sections: Array.isArray(record.sections) ? record.sections : [],
  }
}

export async function listApps(
  input: z.infer<typeof listAppsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const query: Array<[string, string]> = []
  for (const key of ['page', 'pageSize', 'app_id', 'minRating', 'search', 'categoryId'] as const) {
    const value = input[key]
    if (value !== undefined && value !== null && value !== '') query.push([key, String(value)])
  }

  const payload = await request(ctx, { method: 'GET', path: 'apps', query })
  const record = requireObject(payload, 'StoreCensus apps list response')
  return {
    apps: requireObjectArray(record.data, 'StoreCensus apps list response data'),
    pagination: requireObject(record.pagination, 'StoreCensus apps list response pagination'),
    filters: toRecord(record.filters) ?? {},
  }
}

export async function listAppCategories(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return normalizeCategories(await request(ctx, { method: 'GET', path: 'app-categories' }))
}
