/**
 * HackerRank Work 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/hackerrank_work/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * HackerRank Work 的形状特点:
 * - base URL 自带 `/x/api/v3` 前缀,拼路径按**相对路径**接,否则前缀会被冲掉。
 * - 列表响应是 `{data, page_total, offset, total, previous, next, first, last}`,
 *   分页元数据平铺在顶层而非嵌在 `pagination` 里,故这里重新收拢成一个对象。
 * - 详情响应有时包一层 `data`、有时不包,`resource()` 两种都认。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getTestCandidateInput,
  getTestInput,
  listTestCandidatesInput,
  listTestsInput,
  searchTestCandidatesInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'hackerrank_work'
const API_BASE = 'https://www.hackerrank.com/x/api/v3/'
const REQUEST_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>
type Query = Record<string, number | string | undefined>

function toRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * HackerRank 的错误文案有三种落点:顶层 `message`/`error`、或 `errors` 数组的首项
 * (首项本身可能是字符串,也可能是带 message/error 的对象)。顺序照搬上游。
 */
function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload

  const record = toRecord(payload)
  const direct = str(record?.message) ?? str(record?.error)
  if (direct !== undefined && direct !== '') return direct

  const errors = record?.errors
  if (Array.isArray(errors)) {
    const first = errors[0]
    if (typeof first === 'string' && first.trim() !== '') return first
    const firstRecord = toRecord(first)
    const nested = str(firstRecord?.message) ?? str(firstRecord?.error)
    if (nested !== undefined && nested !== '') return nested
  }
  return `hackerrank_work request failed with ${status}`
}

async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body.trim() === '') return undefined
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

async function request(ctx: ProviderContext, path: string, query: Query): Promise<Json> {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof TBError) throw error
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, 'hackerrank_work request timed out')
    }
    throw error
  }

  const payload = await readPayload(response)
  if (!response.ok) throw upstreamError(response.status || 502, errorMessage(payload, response.status))

  const record = toRecord(payload)
  if (record === undefined) throw upstreamError(502, 'hackerrank_work returned invalid JSON')
  return record
}

function listItems(payload: Json): unknown[] {
  if (!Array.isArray(payload.data)) {
    throw upstreamError(502, 'hackerrank_work returned invalid list data')
  }
  return payload.data
}

/** 上游把分页里的整数字段当**必答项**:缺了或不是整数就报上游故障,不静默补 0。 */
function integer(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw upstreamError(502, 'hackerrank_work returned an invalid integer')
  return parsed
}

/** 顶层平铺的分页字段收拢成一个对象;缺失的 URL 字段补空串(出参 schema 要的是 string)。 */
function pagination(payload: Json): Json {
  const numericTotal = typeof payload.total === 'number' ? integer(payload.total) : undefined
  return {
    page_total: integer(payload.page_total),
    offset: integer(payload.offset),
    previous: str(payload.previous) ?? '',
    next: str(payload.next) ?? '',
    first: str(payload.first) ?? '',
    last: str(payload.last) ?? '',
    // total 在出参里是**字符串**:HackerRank 有时回数字有时回字符串,统一成后者。
    total: str(payload.total)
      ?? String(numericTotal ?? (Array.isArray(payload.data) ? payload.data.length : 0)),
  }
}

/** 详情端点有时包一层 `data`,有时直接就是资源本体。 */
function resource(payload: Json): Json {
  return toRecord(payload.data) ?? payload
}

/** additional_fields 是逗号分隔的单个参数;空白项被剔掉,全空则整个参数不传。 */
function joinFields(value: string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  const fields = value.map(item => item.trim()).filter(item => item !== '')
  return fields.length === 0 ? undefined : fields.join(',')
}

export async function listTests(
  input: z.infer<typeof listTestsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, 'tests', { limit: input.limit, offset: input.offset })
  return { tests: listItems(payload), pagination: pagination(payload) }
}

export async function getTest(
  input: z.infer<typeof getTestInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `tests/${encodeURIComponent(input.id)}`, {
    additional_fields: joinFields(input.additional_fields),
  })
  return { test: resource(payload) }
}

export async function listTestCandidates(
  input: z.infer<typeof listTestCandidatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `tests/${encodeURIComponent(input.test_id)}/candidates`, {
    limit: input.limit,
    offset: input.offset,
  })
  return { candidates: listItems(payload), pagination: pagination(payload) }
}

export async function searchTestCandidates(
  input: z.infer<typeof searchTestCandidatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `tests/${encodeURIComponent(input.test_id)}/candidates/search`, {
    search: input.search,
    limit: input.limit,
    offset: input.offset,
  })
  return { candidates: listItems(payload), pagination: pagination(payload) }
}

export async function getTestCandidate(
  input: z.infer<typeof getTestCandidateInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `tests/${encodeURIComponent(input.test_id)}/candidates/${encodeURIComponent(input.candidate_id)}`
  const payload = await request(ctx, path, { additional_fields: joinFields(input.additional_fields) })
  return { candidate: resource(payload) }
}
