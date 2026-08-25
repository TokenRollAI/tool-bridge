/**
 * Dub 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/dub/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Dub 的几个特点决定了这里的形状:
 * - 列表接口回的是**裸数组**(不是 `{data:[...]}` 信封),故 `asArray` 直接判顶层。
 * - query 里的数组值按 **逗号连接**成一个参数(`tagIds=a,b`),不是重复同名键。
 * - `retrieve_link` 与三个 update 有 schema 表达不了的跨字段约束,见各自处的说明。
 *
 * 上游 `createDubError` 按"校验期/执行期"把 401/403/404 压成别的状态(401 在执行期变 409、
 * 404 变 400),这里不保留:状态码归一由共用的 `upstreamError` 统一口径,每个 provider
 * 各压一套正是它要消灭的东西。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  countLinksInput,
  createFolderInput,
  createLinkInput,
  createTagInput,
  deleteFolderInput,
  deleteLinkInput,
  deleteTagInput,
  listFoldersInput,
  listLinksInput,
  listTagsInput,
  retrieveAnalyticsInput,
  retrieveLinkInput,
  updateFolderInput,
  updateLinkInput,
  updateTagInput,
} from './schema'
import {
  asJsonObject as asRecord,
  compactDefined as compact,
  finiteNumber as optionalNumber,
  trimmedText as optionalText,
} from '../_runtime/jsonValue'
import { createProviderHttpClient, type ProviderQuery } from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'dub'
const API_BASE = 'https://api.dub.co'
const http = createProviderHttpClient({ baseUrl: API_BASE, service: SERVICE })
const LINKS_PATH = '/links'
const LINKS_INFO_PATH = '/links/info'
const LINKS_COUNT_PATH = '/links/count'
const TAGS_PATH = '/tags'
const FOLDERS_PATH = '/folders'
const ANALYTICS_PATH = '/analytics'

type Json = Record<string, unknown>

interface NormalizedLink {
  archived: boolean | null
  clicks: number | null
  createdAt: string | null | undefined
  domain: string
  id: string
  key: string
  leads: number | null
  qrCode: string | null | undefined
  raw: Json
  saleAmount: number | null
  sales: number | null
  shortLink: string | null | undefined
  title: string | null | undefined
  updatedAt: string | null | undefined
  url: string
}

interface NormalizedTag {
  color: string | null | undefined
  id: string
  name: string
  raw: Json
}

interface NormalizedFolder {
  accessLevel: string | null | undefined
  id: string
  name: string
  raw: Json
}

function nullableText(value: unknown): string | null | undefined {
  return value === null ? null : optionalText(value)
}

/** `undefined`/`null`/空串省略;数组按逗号连接(Dub 的 query 约定,不是重复键)。 */
function providerQuery(query: Json): ProviderQuery {
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, Array.isArray(value) ? value.map(String).join(',') : String(value)] as const)
}

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return payload
  const object = asRecord(payload)
  if (object === undefined) return undefined
  return optionalText(asRecord(object.error)?.message)
    ?? optionalText(object.message)
    ?? optionalText(object.error)
}

interface RequestInput {
  body?: Json
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST'
  query?: Json
}

async function request(ctx: ProviderContext, path: string, input: RequestInput): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const { bodyKind, data } = await http.request({
    path,
    method: input.method,
    query: providerQuery(input.query ?? {}),
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJson: 'text',
    mapError: ({ data: payload, status, statusText }) => upstreamError(
      status,
      errorMessage(payload) ?? (statusText || `dub 返回 HTTP ${status}`),
    ),
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined ? 'dub 请求失败' : `dub 请求失败: ${message}`,
    ),
  })
  return bodyKind === 'empty' ? null : data
}

/** 响应里契约要求的字段;取不到是**上游**破了契约,不是调用方的错。 */
function responseText(value: unknown, field: string): string {
  const text = optionalText(value)
  if (text === undefined) throw upstreamError(502, `dub 响应缺少 ${field}`)
  return text
}

function responseRecord(value: unknown, field: string): Json {
  const object = asRecord(value)
  if (object === undefined) throw upstreamError(502, `dub 返回的 ${field} 不是对象`)
  return object
}

function asArray(payload: unknown, field: string): unknown[] {
  if (!Array.isArray(payload)) throw upstreamError(502, `dub ${field} 响应不是数组`)
  return payload
}

function normalizeLink(payload: unknown): NormalizedLink {
  const object = responseRecord(payload, 'link')
  return {
    id: responseText(object.id, 'link.id'),
    domain: responseText(object.domain, 'link.domain'),
    key: responseText(object.key, 'link.key'),
    url: responseText(object.url, 'link.url'),
    shortLink: nullableText(object.shortLink),
    qrCode: nullableText(object.qrCode),
    title: nullableText(object.title),
    archived: typeof object.archived === 'boolean' ? object.archived : null,
    clicks: optionalNumber(object.clicks) ?? null,
    leads: optionalNumber(object.leads) ?? null,
    sales: optionalNumber(object.sales) ?? null,
    saleAmount: optionalNumber(object.saleAmount) ?? null,
    createdAt: nullableText(object.createdAt),
    updatedAt: nullableText(object.updatedAt),
    raw: object,
  }
}

function normalizeTag(payload: unknown): NormalizedTag {
  const object = responseRecord(payload, 'tag')
  return {
    id: responseText(object.id, 'tag.id'),
    name: responseText(object.name, 'tag.name'),
    color: nullableText(object.color),
    raw: object,
  }
}

function normalizeFolder(payload: unknown): NormalizedFolder {
  const object = responseRecord(payload, 'folder')
  return {
    id: responseText(object.id, 'folder.id'),
    name: responseText(object.name, 'folder.name'),
    accessLevel: nullableText(object.accessLevel),
    raw: object,
  }
}

/** Dub 的 count 接口回过裸数字,也回过 `{count}` / `{links}`,三种都收。 */
function extractCount(payload: unknown): number {
  if (typeof payload === 'number') return payload
  const object = asRecord(payload)
  const count = optionalNumber(object?.count) ?? optionalNumber(object?.links)
  if (count === undefined) throw upstreamError(502, 'dub count 响应里没有 count')
  return count
}

/**
 * PATCH 至少要带一个字段。Dub 对空 body 回的是含糊的 400,本地挡下更好定位。
 */
function assertNonEmptyPatch(patch: Json, action: string): void {
  if (Object.keys(patch).length === 0) {
    throw new TBError('invalid_argument', `${action} 至少需要一个待更新字段`)
  }
}

/**
 * 路径参数在 schema 里是 optional(生成器照搬了上游 action 定义),但拼 URL 前必须非空,
 * 否则会打出 `/links/undefined`。上游这里抛的是 502,那是错的 —— 缺入参是调用方的问题。
 */
function requirePathId(value: string | undefined, field: string): string {
  const text = optionalText(value)
  if (text === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return encodeURIComponent(text)
}

async function deleteResource(ctx: ProviderContext, path: string): Promise<Json> {
  const payload = await request(ctx, path, { method: 'DELETE' })
  return { deleted: true, raw: payload }
}

export async function createLink(
  input: z.infer<typeof createLinkInput>,
  ctx: ProviderContext,
): Promise<{ link: NormalizedLink }> {
  const payload = await request(ctx, LINKS_PATH, { method: 'POST', body: compact(input) })
  return { link: normalizeLink(payload) }
}

export async function listLinks(
  input: z.infer<typeof listLinksInput>,
  ctx: ProviderContext,
): Promise<{ links: NormalizedLink[] }> {
  const payload = await request(ctx, LINKS_PATH, { method: 'GET', query: compact(input) })
  return { links: asArray(payload, 'links').map(item => normalizeLink(item)) }
}

export async function retrieveLink(
  input: z.infer<typeof retrieveLinkInput>,
  ctx: ProviderContext,
): Promise<{ link: NormalizedLink }> {
  const query = compact({
    linkId: optionalText(input.linkId),
    domain: optionalText(input.domain),
    key: optionalText(input.key),
    externalId: optionalText(input.externalId),
  })
  // 三种查法互斥且不能全缺;domain 查法要 domain+key 成对。schema 表达不了,留在这里。
  if (Object.keys(query).length === 0) {
    throw new TBError('invalid_argument', 'retrieve_link 需要 linkId、externalId,或 domain 与 key 成对')
  }
  if (query.linkId === undefined && query.externalId === undefined
    && !(query.domain !== undefined && query.key !== undefined)) {
    throw new TBError('invalid_argument', 'retrieve_link 的 domain 查法需要同时给 domain 和 key')
  }

  const payload = await request(ctx, LINKS_INFO_PATH, { method: 'GET', query })
  return { link: normalizeLink(payload) }
}

export async function updateLink(
  input: z.infer<typeof updateLinkInput>,
  ctx: ProviderContext,
): Promise<{ link: NormalizedLink }> {
  const { linkId, ...body } = input
  const patch = compact(body)
  assertNonEmptyPatch(patch, 'update_link')
  const path = `${LINKS_PATH}/${requirePathId(linkId, 'linkId')}`
  const payload = await request(ctx, path, { method: 'PATCH', body: patch })
  return { link: normalizeLink(payload) }
}

export async function deleteLink(
  input: z.infer<typeof deleteLinkInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return deleteResource(ctx, `${LINKS_PATH}/${requirePathId(input.linkId, 'linkId')}`)
}

export async function countLinks(
  input: z.infer<typeof countLinksInput>,
  ctx: ProviderContext,
): Promise<{ count: number, raw: unknown }> {
  const payload = await request(ctx, LINKS_COUNT_PATH, { method: 'GET', query: compact(input) })
  return { count: extractCount(payload), raw: payload }
}

export async function listTags(
  input: z.infer<typeof listTagsInput>,
  ctx: ProviderContext,
): Promise<{ tags: NormalizedTag[] }> {
  const payload = await request(ctx, TAGS_PATH, { method: 'GET', query: compact(input) })
  return { tags: asArray(payload, 'tags').map(item => normalizeTag(item)) }
}

export async function createTag(
  input: z.infer<typeof createTagInput>,
  ctx: ProviderContext,
): Promise<{ tag: NormalizedTag }> {
  const payload = await request(ctx, TAGS_PATH, { method: 'POST', body: compact(input) })
  return { tag: normalizeTag(payload) }
}

export async function updateTag(
  input: z.infer<typeof updateTagInput>,
  ctx: ProviderContext,
): Promise<{ tag: NormalizedTag }> {
  const { id, ...body } = input
  const patch = compact(body)
  assertNonEmptyPatch(patch, 'update_tag')
  const payload = await request(ctx, `${TAGS_PATH}/${requirePathId(id, 'id')}`, {
    method: 'PATCH',
    body: patch,
  })
  return { tag: normalizeTag(payload) }
}

export async function deleteTag(
  input: z.infer<typeof deleteTagInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return deleteResource(ctx, `${TAGS_PATH}/${requirePathId(input.id, 'id')}`)
}

export async function listFolders(
  input: z.infer<typeof listFoldersInput>,
  ctx: ProviderContext,
): Promise<{ folders: NormalizedFolder[] }> {
  const payload = await request(ctx, FOLDERS_PATH, { method: 'GET', query: compact(input) })
  return { folders: asArray(payload, 'folders').map(item => normalizeFolder(item)) }
}

export async function createFolder(
  input: z.infer<typeof createFolderInput>,
  ctx: ProviderContext,
): Promise<{ folder: NormalizedFolder }> {
  const payload = await request(ctx, FOLDERS_PATH, { method: 'POST', body: compact(input) })
  return { folder: normalizeFolder(payload) }
}

export async function updateFolder(
  input: z.infer<typeof updateFolderInput>,
  ctx: ProviderContext,
): Promise<{ folder: NormalizedFolder }> {
  const { id, ...body } = input
  const patch = compact(body)
  assertNonEmptyPatch(patch, 'update_folder')
  const payload = await request(ctx, `${FOLDERS_PATH}/${requirePathId(id, 'id')}`, {
    method: 'PATCH',
    body: patch,
  })
  return { folder: normalizeFolder(payload) }
}

export async function deleteFolder(
  input: z.infer<typeof deleteFolderInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return deleteResource(ctx, `${FOLDERS_PATH}/${requirePathId(input.id, 'id')}`)
}

export async function retrieveAnalytics(
  input: z.infer<typeof retrieveAnalyticsInput>,
  ctx: ProviderContext,
): Promise<{ data: unknown }> {
  const payload = await request(ctx, ANALYTICS_PATH, { method: 'GET', query: compact(input) })
  return { data: payload }
}
