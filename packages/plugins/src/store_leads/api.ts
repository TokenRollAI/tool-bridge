/**
 * Store Leads 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/store_leads/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 与上游有意偏离的一处:**不迁 validate 阶段**(凭证校验是平台的事),只留 execute 口径 ——
 * 上游用 phase 把 validate 时的 401/403 降成 400,好让"key 不对"表现为用户填错。
 *
 * 上游给每次请求挂了 30 秒超时,这里保留 —— 没有它,一次挂死的上游会把网关这一路请求
 * 拖到底层连接自己断开为止。
 */

import type { z } from 'zod/v4'
import type {
  getAppInput,
  getDomainInput,
  getTechnologyInput,
  listAppsInput,
  listDomainsInput,
  listTechnologiesInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'store_leads'
const API_BASE = 'https://storeleads.app/json/api/v1/all'
const REQUEST_TIMEOUT_MS = 30_000

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

function requireObject(value: unknown, label: string): Json {
  const object = toRecord(value)
  if (object === undefined) throw upstreamError(502, `${label} is missing an object`)
  return object
}

function requireObjectArray(value: unknown, label: string): Json[] {
  if (!Array.isArray(value)) throw upstreamError(502, `${label} is not an array`)
  return value.map(item => requireObject(item, label))
}

/**
 * 上游 `buildQueryParams` 的语义:只有 `undefined`/`null`/空串被跳过。
 * **数字 0 要发出去** —— list_apps/list_technologies 的 page 是零基的,第一页就是 0。
 */
function query(entries: Array<[string, unknown]>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  return params
}

async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    // 错误体常是纯文本,留着当错误消息;成功体解不开就是上游故障。
    if (!response.ok) return body
    throw upstreamError(502, 'invalid Store Leads JSON response')
  }
}

function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  const record = toRecord(payload)
  const message = record === undefined
    ? undefined
    : text(record.message) ?? text(record.error) ?? text(record.detail)
  return message ?? `Store Leads request failed with status ${status}`
}

async function request(ctx: ProviderContext, path: string, params: URLSearchParams): Promise<Json> {
  const url = new URL(path.replace(/^\//, ''), `${API_BASE}/`)
  if (params.size > 0) url.search = params.toString()

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
      },
      signal: timeoutSignal,
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 500,
    // 把"上游不通/出网被拦"说成插件自身故障。
    if (timeoutSignal.aborted) throw upstreamError(504, 'Store Leads request timed out')
    throw upstreamError(
      502,
      error instanceof Error ? `Store Leads request failed: ${error.message}` : 'Store Leads request failed',
    )
  }

  const payload = await readPayload(response)
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return requireObject(payload, 'Store Leads response')
}

export async function getDomain(
  input: z.infer<typeof getDomainInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = await request(
    ctx,
    `/domain/${encodeURIComponent(input.domain)}`,
    query([['follow_redirects', input.follow_redirects], ['fields', input.fields]]),
  )
  return { domain: requireObject(body.domain, 'Store Leads domain response domain') }
}

export async function listDomains(
  input: z.infer<typeof listDomainsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = await request(ctx, '/domain', query([
    ['cursor', input.cursor],
    ['aq', input.aq],
    ['fields', input.fields],
    ['page_size', input.page_size],
  ]))
  return {
    domains: requireObjectArray(body.domains, 'Store Leads domains list response'),
    next_cursor: text(body.next_cursor) ?? null,
  }
}

export async function getApp(
  input: z.infer<typeof getAppInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = await request(
    ctx,
    `/app/${encodeURIComponent(input.app_id)}`,
    query([['fields', input.fields]]),
  )
  return { app: requireObject(body.app, 'Store Leads app response app') }
}

export async function listApps(
  input: z.infer<typeof listAppsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = await request(ctx, '/app', query([
    ['page', input.page],
    ['page_size', input.page_size],
    ['sort', input.sort],
    ['q', input.q],
    ['fields', input.fields],
    // Store Leads 的过滤器参数名带 `f:` 前缀,与入参名不同。
    ['f:p', input.platform],
    ['f:categories', input.categories],
  ]))
  return { apps: requireObjectArray(body.apps, 'Store Leads apps list response') }
}

export async function getTechnology(
  input: z.infer<typeof getTechnologyInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = await request(
    ctx,
    `/technology/${encodeURIComponent(input.technology)}`,
    query([['fields', input.fields]]),
  )
  return { technology: requireObject(body.technology, 'Store Leads technology response technology') }
}

export async function listTechnologies(
  input: z.infer<typeof listTechnologiesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = await request(ctx, '/technology', query([
    ['page', input.page],
    ['page_size', input.page_size],
    ['sort', input.sort],
    ['q', input.q],
    ['fields', input.fields],
  ]))
  return { technologies: requireObjectArray(body.technologies, 'Store Leads technologies list response') }
}
