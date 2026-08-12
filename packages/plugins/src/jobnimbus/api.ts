/**
 * JobNimbus 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/jobnimbus/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 与上游有意偏离的两处:
 * - **错误映射交给共用的 `upstreamError`**。上游手写的映射把 415/422 原样透出、把 401/403
 *   在 validate 阶段压成 400;本仓不迁 validate 阶段(凭证校验是平台的事),execute 口径
 *   与共用映射一致。
 * - **不迁 `credentialValidators`**:它只是打 `/account/settings` 试凭证,在本仓的对应物是
 *   index.ts 里的 `credentialProbe`。
 */

import type { z } from 'zod/v4'
import type {
  createContactInput,
  createJobInput,
  getContactInput,
  getJobInput,
  listContactsInput,
  listJobsInput,
  updateContactInput,
  updateJobInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'jobnimbus'
const API_BASE = 'https://app.jobnimbus.com/api1'

type Json = Record<string, unknown>

function toRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString` 的语义:非空白字符串才算数,且取 trim 后的值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * 字符串数组拼成逗号分隔的一个查询参数(JobNimbus 的 `fields`/`skip` 约定)。
 * schema 只保证元素非空串,纯空白仍会到这里,故照上游逐个 trim 后丢空;全丢光就当没传。
 */
function joinList(value: readonly string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  const parts = value.map(item => item.trim()).filter(item => item !== '')
  return parts.length > 0 ? parts.join(',') : undefined
}

interface ListQueryInput {
  actor?: string
  fields?: string[]
  filter?: Json
  from?: number
  size?: number
  sortDirection?: string
  sortField?: string
}

function buildListQuery(input: ListQueryInput): Record<string, string | undefined> {
  return {
    actor: text(input.actor),
    size: input.size === undefined ? undefined : String(input.size),
    from: input.from === undefined ? undefined : String(input.from),
    sort_field: text(input.sortField),
    sort_direction: input.sortDirection,
    fields: joinList(input.fields),
    // JobNimbus 的 filter 是 Elasticsearch 风格的对象,整个 JSON 编码进一个查询参数。
    filter: input.filter === undefined ? undefined : JSON.stringify(input.filter),
  }
}

function buildDetailQuery(input: { actor?: string, fields?: string[] }): Record<string, string | undefined> {
  return {
    actor: text(input.actor),
    fields: joinList(input.fields),
  }
}

function buildWriteQuery(
  input: { actor?: string, bulk?: boolean, skip?: string[] },
): Record<string, string | undefined> {
  return {
    actor: text(input.actor),
    bulk: input.bulk === undefined ? undefined : String(input.bulk),
    skip: joinList(input.skip),
  }
}

/** 响应体尽力解析:空体当 null,非 JSON 保留原文(错误消息常是纯文本)。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

function errorMessage(payload: unknown, response: Response): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload

  const record = toRecord(payload)
  const message = record === undefined
    ? undefined
    : text(record.message) ?? text(record.error) ?? text(record.errorMessage) ?? text(record.detail)

  // 上游退回 `response.statusText`,而 statusText 允许是空串 —— `??` 接不住它。
  return message ?? (response.statusText || `JobNimbus 返回 HTTP ${response.status}`)
}

function requireObject(value: unknown, label: string): Json {
  const record = toRecord(value)
  // 契约说好是对象;不是就是上游出问题,不是调用方的错。
  if (record === undefined) throw upstreamError(502, `${label} returned invalid object`)
  return record
}

interface JobnimbusPayload {
  body: unknown
  count: number
  results: Json[]
}

interface RequestInput {
  body?: Json
  method: 'GET' | 'POST' | 'PUT'
  path: string
  query?: Record<string, string | undefined>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<JobnimbusPayload> {
  const url = new URL(input.path.replace(/^\//, ''), `${API_BASE}/`)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  const response = await guardedFetch(url.toString(), {
    method: input.method,
    headers,
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  })
  const payload = await readPayload(response)
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response))

  if (response.status === 204 || payload === null) return { body: {}, count: 0, results: [] }
  if (Array.isArray(payload)) {
    return {
      body: payload,
      count: payload.length,
      results: payload.map((item, index) => requireObject(item, `JobNimbus array response item ${index}`)),
    }
  }

  const record = requireObject(payload, 'JobNimbus response')
  const results = Array.isArray(record.results)
    ? record.results.map((item, index) => requireObject(item, `JobNimbus results[${index}] response item`))
    : []

  return {
    body: record,
    // JobNimbus 的 count 是全量匹配数(可大于本页 results 长度),没给才退回本页条数。
    count: typeof record.count === 'number' && Number.isInteger(record.count) ? record.count : results.length,
    results,
  }
}

export async function listContacts(
  input: z.infer<typeof listContactsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { path: '/contacts', method: 'GET', query: buildListQuery(input) })
  return { count: payload.count, contacts: payload.results }
}

export async function getContact(
  input: z.infer<typeof getContactInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/contacts/${encodeURIComponent(input.contactId)}`,
    method: 'GET',
    query: buildDetailQuery(input),
  })
  return { contact: requireObject(payload.body, 'JobNimbus contact response') }
}

export async function createContact(
  input: z.infer<typeof createContactInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/contacts',
    method: 'POST',
    query: buildWriteQuery(input),
    body: input.data,
  })
  return { contact: requireObject(payload.body, 'JobNimbus create contact response') }
}

export async function updateContact(
  input: z.infer<typeof updateContactInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/contacts/${encodeURIComponent(input.contactId)}`,
    method: 'PUT',
    query: buildWriteQuery(input),
    body: input.data,
  })
  return { contact: requireObject(payload.body, 'JobNimbus update contact response') }
}

export async function listJobs(
  input: z.infer<typeof listJobsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { path: '/jobs', method: 'GET', query: buildListQuery(input) })
  return { count: payload.count, jobs: payload.results }
}

export async function getJob(
  input: z.infer<typeof getJobInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/jobs/${encodeURIComponent(input.jobId)}`,
    method: 'GET',
    query: buildDetailQuery(input),
  })
  return { job: requireObject(payload.body, 'JobNimbus job response') }
}

export async function createJob(
  input: z.infer<typeof createJobInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/jobs',
    method: 'POST',
    query: buildWriteQuery(input),
    body: input.data,
  })
  return { job: requireObject(payload.body, 'JobNimbus create job response') }
}

export async function updateJob(
  input: z.infer<typeof updateJobInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/jobs/${encodeURIComponent(input.jobId)}`,
    method: 'PUT',
    query: buildWriteQuery(input),
    body: input.data,
  })
  return { job: requireObject(payload.body, 'JobNimbus update job response') }
}
