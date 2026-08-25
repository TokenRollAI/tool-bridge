/**
 * Readwise 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/readwise/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 两处 Readwise 特有的怪异,归一里都保留了:
 * - 认证头是 `Token <key>`,不是 Bearer;
 * - 同一个字段在 v2(snake_case)与 v3(camelCase)两套 API 里拼法不同,故归一时
 *   两种拼法都读一遍,谁先有值用谁。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createHighlightsInput,
  exportHighlightsInput,
  listBooksInput,
  listDocumentsInput,
  saveDocumentInput,
  updateDocumentInput,
} from './schema'
import {
  compactDefined as compact,
  integerValue as integer,
  asJsonObject as record,
  trimmedText as text,
} from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'readwise'
const API_BASE = 'https://readwise.io/api'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * Readwise 的错误体没有统一形状:`detail`、`message`、`error`,
 * 以及 DRF 的字段级错误(`{url: ["This field is required."]}`)都可能出现。
 */
function errorMessage(payload: unknown, status: number): string {
  const object = record(payload)
  if (object !== undefined) {
    const direct = text(object.detail) ?? text(object.message) ?? text(object.error)
    if (direct !== undefined) return direct
    for (const value of Object.values(object)) {
      if (Array.isArray(value)) {
        const first = value.find(item => typeof item === 'string' && item.trim() !== '')
        if (typeof first === 'string') return first.trim()
      }
    }
  }
  return `Readwise request failed with status ${status}`
}

interface RequestInput {
  body?: unknown
  method?: 'GET' | 'PATCH' | 'POST'
  path: string
  query?: Record<string, string>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const response = await http.request({
    method: input.method ?? 'GET',
    path: input.path,
    query: Object.entries(input.query ?? {}),
    headers: {
      accept: 'application/json',
      // Readwise 用的是 `Token <key>`,不是 Bearer —— 写成 Bearer 会一直 401。
      authorization: `Token ${requireApiKey(ctx, SERVICE)}`,
    },
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJsonMessage: 'Readwise 返回了非法 JSON',
    mapError: ({ bodyKind, data, status }) => bodyKind === 'invalid-json'
      ? new TBError('unavailable', 'Readwise 返回了非法 JSON', { retryable: true })
      : upstreamError(status, errorMessage(data, status)),
  })
  return response.bodyKind === 'empty' ? {} : response.data
}

/** 顶层响应必须是对象;不是就是上游出问题,不是调用方的错。 */
function requireRecord(value: unknown, message: string): Json {
  const object = record(value)
  if (object === undefined) throw new TBError('unavailable', message, { retryable: true })
  return object
}

/** 只带有值的项进 query;空串按"没给"处理(上游 `queryParams` 的语义)。 */
function query(input: Record<string, number | string | undefined>): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === '') continue
    output[key] = String(value)
  }
  return output
}

// —— 出参归一 ——

function normalizeHighlight(value: unknown): Json {
  const item = record(value) ?? {}
  return {
    id: integer(item.id) ?? null,
    text: text(item.text) ?? '',
    title: text(item.title) ?? null,
    author: text(item.author) ?? null,
    // note 保留空串:上游用 typeof 判断而非 optionalString,清空备注要能表达出来。
    note: typeof item.note === 'string' ? item.note : null,
    url: text(item.url) ?? null,
    highlightedAt: text(item.highlighted_at) ?? text(item.highlightedAt) ?? null,
    updatedAt: text(item.updated_at) ?? text(item.updatedAt) ?? null,
    raw: item,
  }
}

function normalizeBook(value: unknown): Json {
  const item = record(value) ?? {}
  return {
    // export 接口回的是 user_book_id,books 接口回的是 id。
    id: integer(item.user_book_id) ?? integer(item.id) ?? null,
    title: text(item.title) ?? null,
    author: text(item.author) ?? null,
    category: text(item.category) ?? null,
    source: text(item.source) ?? null,
    numHighlights: integer(item.num_highlights) ?? integer(item.numHighlights) ?? null,
    updatedAt: text(item.updated) ?? text(item.updated_at) ?? null,
    highlights: readArray(item.highlights).map(normalizeHighlight),
    raw: item,
  }
}

/** Reader 的 tags 有时是数组、有时是以标签名为键的对象。 */
function readTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  const object = record(value)
  return object === undefined ? [] : Object.keys(object)
}

function normalizeDocument(value: unknown): Json {
  const item = record(value) ?? {}
  return {
    id: text(item.id) ?? text(item.document_id) ?? null,
    url: text(item.url) ?? null,
    sourceUrl: text(item.source_url) ?? text(item.sourceUrl) ?? null,
    title: text(item.title) ?? null,
    author: text(item.author) ?? null,
    category: text(item.category) ?? null,
    location: text(item.location) ?? null,
    tags: readTags(item.tags),
    createdAt: text(item.created_at) ?? text(item.createdAt) ?? null,
    updatedAt: text(item.updated_at) ?? text(item.updatedAt) ?? null,
    raw: item,
  }
}

/** save/update 的文档有时裹在 document/result/saved_document 里,有时就是顶层对象。 */
function readDocumentRecord(payload: Json): Json {
  return record(payload.document) ?? record(payload.result) ?? record(payload.saved_document) ?? payload
}

// —— handlers ——

export async function createHighlights(
  input: z.infer<typeof createHighlightsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/v2/highlights/',
    method: 'POST',
    body: { highlights: input.highlights },
  })
  const books = readArray(payload)
  return { books: books.map(normalizeBook), raw: books }
}

export async function exportHighlights(
  input: z.infer<typeof exportHighlightsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireRecord(
    await request(ctx, {
      path: '/v2/export/',
      query: query({ updatedAfter: input.updatedAfter, pageCursor: input.pageCursor }),
    }),
    'Readwise 返回了非法的 export 响应',
  )
  return {
    count: integer(payload.count) ?? null,
    nextPageCursor: text(payload.nextPageCursor) ?? null,
    books: readArray(payload.results).map(normalizeBook),
    raw: payload,
  }
}

export async function listBooks(
  input: z.infer<typeof listBooksInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireRecord(
    await request(ctx, {
      path: '/v2/books/',
      query: query({
        page: input.page,
        page_size: input.pageSize,
        category: input.category,
        updated__gt: input.updatedAfter,
        updated__lt: input.updatedBefore,
      }),
    }),
    'Readwise 返回了非法的 books 响应',
  )
  return {
    count: integer(payload.count) ?? null,
    next: text(payload.next) ?? null,
    previous: text(payload.previous) ?? null,
    books: readArray(payload.results).map(normalizeBook),
    raw: payload,
  }
}

export async function listDocuments(
  input: z.infer<typeof listDocumentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireRecord(
    await request(ctx, {
      path: '/v3/list/',
      query: query({
        pageCursor: input.pageCursor,
        updatedAfter: input.updatedAfter,
        location: input.location,
        category: input.category,
        tag: input.tag,
      }),
    }),
    'Readwise 返回了非法的文档列表',
  )
  return {
    count: integer(payload.count) ?? null,
    nextPageCursor: text(payload.nextPageCursor) ?? null,
    documents: readArray(payload.results).map(normalizeDocument),
    raw: payload,
  }
}

export async function saveDocument(
  input: z.infer<typeof saveDocumentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireRecord(
    await request(ctx, {
      path: '/v3/save/',
      method: 'POST',
      body: compact({
        url: input.url,
        title: input.title,
        author: input.author,
        summary: input.summary,
        should_clean_html: input.shouldCleanHtml,
        saved_using: input.savedUsing,
        tags: input.tags,
      }),
    }),
    'Readwise 返回了非法的 save 响应',
  )
  return { document: normalizeDocument(readDocumentRecord(payload)), raw: payload }
}

export async function updateDocument(
  input: z.infer<typeof updateDocumentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireRecord(
    await request(ctx, {
      path: `/v3/update/${encodeURIComponent(input.documentId)}/`,
      method: 'PATCH',
      body: compact({
        location: input.location,
        title: input.title,
        author: input.author,
        summary: input.summary,
        tags: input.tags,
      }),
    }),
    'Readwise 返回了非法的 update 响应',
  )
  return { document: normalizeDocument(readDocumentRecord(payload)), raw: payload }
}
