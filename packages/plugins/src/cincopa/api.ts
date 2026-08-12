/**
 * Cincopa 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/cincopa/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * **凭证进 URL**:Cincopa 只认 `?api_token=<key>` 这一种传法,没有 header 形式。
 * 这意味着 token 会出现在 URL 里(日志/代理都可能记到),但换成 header 上游直接 403,
 * 只能照搬。
 *
 * 另一处照搬的是"上游响应缺字段即 unavailable":Cincopa 的出参 schema 把 workspace、
 * fid、pagination 等标成必填,拿不到就是上游破损,不该悄悄补 null 让下游误判。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { listAssetsInput, listGalleriesInput, listGalleryItemsInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'cincopa'
const API_BASE = 'https://api.cincopa.com/v2'

type Json = Record<string, unknown>

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : undefined
}

/** 上游破损归 unavailable:不是调用方能修的问题。 */
function upstreamBroken(what: string): TBError {
  return new TBError('unavailable', `Cincopa 返回的 ${what} 非法`, { retryable: true })
}

function requireObject(value: unknown, field: string): Json {
  const object = record(value)
  if (object === undefined) throw upstreamBroken(field)
  return object
}

function requireText(value: unknown, field: string): string {
  const parsed = text(value)
  if (parsed === undefined) throw upstreamBroken(field)
  return parsed
}

/** workspace 允许是空串(Cincopa 的默认工作区就没名字),故只查类型不查非空。 */
function requireRawText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw upstreamBroken(field)
  return value
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw upstreamBroken(field)
  return value
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, string | undefined> = {},
): Promise<Json> {
  const url = new URL(`${API_BASE}${path}`)
  url.searchParams.set('api_token', requireApiKey(ctx, SERVICE))
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  const response = await guardedFetch(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  })

  const body = await response.text()
  let payload: unknown = {}
  if (body.trim() !== '') {
    try {
      payload = JSON.parse(body)
    } catch {
      throw new TBError('unavailable', 'Cincopa 返回了非法 JSON', { retryable: true })
    }
  }

  if (!response.ok) {
    const object = record(payload)
    const message = text(object?.message) ?? text(object?.error)
      ?? `Cincopa request failed with status ${response.status}`
    throw upstreamError(response.status, message)
  }
  return requireObject(payload, 'response')
}

/** `{page, items_per_page, items_count, <pageCountField>}` → 归一的分页对象。 */
function readPagination(value: unknown, pageCountField: 'page_count' | 'pages_count'): Json {
  const object = requireObject(value, 'pagination')
  return {
    page: requireInteger(object.page, 'page'),
    itemsPerPage: requireInteger(object.items_per_page, 'items_per_page'),
    itemsCount: requireInteger(object.items_count, 'items_count'),
    // gallery.list 用 page_count,其余端点用 pages_count —— 上游 API 拼法不统一。
    pageCount: requireInteger(object[pageCountField], pageCountField),
  }
}

function readTagCloud(value: unknown): Record<string, number> {
  const object = requireObject(value, 'tag_cloud')
  return Object.fromEntries(
    Object.entries(object).map(([key, child]) => [key, requireInteger(child, `tag_cloud.${key}`)]),
  )
}

function readRows(value: unknown, field: string): Json[] {
  if (!Array.isArray(value)) throw upstreamBroken(field)
  return value.map(item => requireObject(item, `${field} row`))
}

/** 只把有值的项转成字符串进 query。 */
function query(input: Record<string, number | string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, value === undefined ? undefined : String(value)]),
  )
}

// —— handlers ——

export async function listGalleries(
  input: z.infer<typeof listGalleriesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = await request(ctx, '/gallery.list.json', query({
    search: input.search,
    page: input.page,
    items_per_page: input.itemsPerPage,
    filter_tags: input.filterTags?.join(','),
  }))
  return {
    workspace: requireRawText(body.workspace, 'workspace'),
    galleries: readRows(body.galleries, 'galleries'),
    tagCloud: readTagCloud(body.tag_cloud),
    pagination: readPagination(body.items_data, 'page_count'),
  }
}

export async function listGalleryItems(
  input: z.infer<typeof listGalleryItemsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = await request(ctx, '/gallery.get_items.json', query({
    fid: input.fid,
    details: input.details?.join(','),
    page: input.page,
    items_per_page: input.itemsPerPage,
  }))
  const folder = requireObject(body.folder, 'folder')
  return {
    fid: requireText(body.fid, 'fid'),
    uploadUrl: requireText(body.upload_url, 'upload_url'),
    claimed: requireText(body.claimed, 'claimed'),
    spfid: requireText(body.spfid, 'spfid'),
    items: readRows(folder.items, 'folder.items'),
    pagination: readPagination(folder.items_data, 'pages_count'),
  }
}

export async function listAssets(
  input: z.infer<typeof listAssetsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = await request(ctx, '/asset.list.json', query({
    search: input.search,
    type: input.types?.join(','),
    rid: input.rid,
    reference_id: input.referenceId,
    tag: input.tag,
    details: input.details?.join(','),
    page: input.page,
    items_per_page: input.itemsPerPage,
  }))
  return {
    items: readRows(body.items, 'items'),
    pagination: readPagination(body.items_data, 'pages_count'),
  }
}

export async function listAssetTags(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const body = await request(ctx, '/asset.get_tags.json')
  return { tagCloud: readTagCloud(body.tag_cloud) }
}
