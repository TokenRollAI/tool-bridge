/**
 * Recruit CRM 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/recruitcrm/executors.ts`(它走共用的
 * `http-json-runtime`),语义等价、写法本地化:凭证从 `ctx.upstreamAuth` 取,
 * 出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Recruit CRM 的特点决定了这里的形状:
 * - 响应的载荷键**不稳定**:有时叫资源名(`candidates` / `candidate`),有时统一叫 `data`,
 *   所以每处都要 `raw[key] ?? raw.data` 兜一下。
 * - 八个 action 是同一套 list/get 打在四种资源上,故这里只有两个函数 + 一张资源表。
 * - 详情接口的路径参数不叫 `id`,而是各自的资源名(`candidate` / `job` …)。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { getCandidateInput, listCandidatesInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'recruitcrm'
const API_BASE = 'https://api.recruitcrm.io/v1/'

type Json = Record<string, unknown>

interface ResourceSpec {
  /** 列表载荷键,同时也是路径段。 */
  collectionKey: string
  /** 详情的入参名与载荷键(单数)。 */
  itemKey: string
  path: string
}

const CANDIDATE: ResourceSpec = { collectionKey: 'candidates', itemKey: 'candidate', path: '/candidates' }
const CONTACT: ResourceSpec = { collectionKey: 'contacts', itemKey: 'contact', path: '/contacts' }
const COMPANY: ResourceSpec = { collectionKey: 'companies', itemKey: 'company', path: '/companies' }
const JOB: ResourceSpec = { collectionKey: 'jobs', itemKey: 'job', path: '/jobs' }

/** Recruit CRM 的错误体键名大小写不统一,message/error/detail/title 都出现过。 */
function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Json
    for (const key of ['message', 'Message', 'error', 'Error', 'detail', 'Detail', 'title', 'Title']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
  }
  return `Recruit CRM 请求失败,HTTP ${status}`
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, number | undefined> = {},
): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, API_BASE)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let response: Response
  let text: string
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    })
    text = await response.text()
  } catch (error) {
    if (error instanceof TBError) throw error
    throw new TBError(
      'unavailable',
      error instanceof Error ? `Recruit CRM 请求失败: ${error.message}` : 'Recruit CRM 请求失败',
      { retryable: true },
    )
  }

  let payload: unknown = null
  if (text.trim() !== '') {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      throw new TBError('unavailable', 'Recruit CRM 返回了非法 JSON', { retryable: true })
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return payload
}

function requireObject(payload: unknown, label: string): Json {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TBError('unavailable', `Recruit CRM 的 ${label} 不是对象`, { retryable: true })
  }
  return payload as Json
}

function requireArray(payload: unknown, label: string): unknown[] {
  if (!Array.isArray(payload)) {
    throw new TBError('unavailable', `Recruit CRM 的 ${label} 不是数组`, { retryable: true })
  }
  return payload
}

async function listResource(
  spec: ResourceSpec,
  input: z.infer<typeof listCandidatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = requireObject(
    await request(ctx, spec.path, { page: input.page, limit: input.limit }),
    spec.collectionKey,
  )
  return {
    // 载荷键有时是资源名,有时是 data。
    [spec.collectionKey]: requireArray(raw[spec.collectionKey] ?? raw.data, spec.collectionKey),
    pagination: raw.pagination !== null && typeof raw.pagination === 'object' && !Array.isArray(raw.pagination)
      ? raw.pagination
      : {},
    raw,
  }
}

async function getResource(spec: ResourceSpec, id: string | undefined, ctx: ProviderContext): Promise<Json> {
  // schema 里这个字段是 optional(上游 action 定义如此),但没它拼不出路径。
  const trimmed = id?.trim()
  if (trimmed === undefined || trimmed === '') {
    throw new TBError('invalid_argument', `${spec.itemKey} 不能为空`)
  }
  const raw = requireObject(
    await request(ctx, `${spec.path}/${encodeURIComponent(trimmed)}`),
    spec.itemKey,
  )
  return { [spec.itemKey]: requireObject(raw[spec.itemKey] ?? raw.data, spec.itemKey), raw }
}

export async function listCandidates(
  input: z.infer<typeof listCandidatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await listResource(CANDIDATE, input, ctx)
}

export async function getCandidate(
  input: z.infer<typeof getCandidateInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await getResource(CANDIDATE, input.candidate, ctx)
}

export async function listContacts(
  input: z.infer<typeof listCandidatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await listResource(CONTACT, input, ctx)
}

export async function getContact(
  input: { contact?: string },
  ctx: ProviderContext,
): Promise<Json> {
  return await getResource(CONTACT, input.contact, ctx)
}

export async function listCompanies(
  input: z.infer<typeof listCandidatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await listResource(COMPANY, input, ctx)
}

export async function getCompany(
  input: { company?: string },
  ctx: ProviderContext,
): Promise<Json> {
  return await getResource(COMPANY, input.company, ctx)
}

export async function listJobs(
  input: z.infer<typeof listCandidatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return await listResource(JOB, input, ctx)
}

export async function getJob(input: { job?: string }, ctx: ProviderContext): Promise<Json> {
  return await getResource(JOB, input.job, ctx)
}
