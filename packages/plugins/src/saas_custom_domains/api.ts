/**
 * SaaS Custom Domains 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/saas_custom_domains/executors.ts`,语义等价、
 * 写法本地化:凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走
 * `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 与上游有意偏离的两处:
 * - **响应形状不符一律归到 502**。上游用 `readRequiredString` 检查响应字段,那个 helper
 *   固定抛 400 —— 于是"上游少回一个 message 字段"会表现成"调用方参数错",归错了责任方。
 * - **不迁 validate 阶段**(凭证校验是平台的事),只留 execute 口径。
 *
 * 另外:生成的 schema 把 `*_uuid` 这几个路径参数标成 optional(上游 action 定义里没标必填),
 * 但上游 executor 实际是必填的。schema 不能改,故这里保留显式的必填检查。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createCustomDomainInput,
  createUpstreamInput,
  deleteCustomDomainInput,
  deleteUpstreamInput,
  getCustomDomainInput,
  getUpstreamInput,
  listCustomDomainsInput,
  listUpstreamsInput,
  purgeCustomDomainHttpCacheInput,
  verifyCustomDomainDnsRecordsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'saas_custom_domains'
const API_BASE = 'https://app.saascustomdomains.com/api/v1'

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

/** schema 把路径参数标成 optional,但上游要求必填;拼进 URL 前挡住。 */
function pathSegment(value: string | undefined, field: string): string {
  if (value === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return encodeURIComponent(value)
}

function requireRecord(value: unknown, label: string): Json {
  const record = toRecord(value)
  if (record === undefined) throw upstreamError(502, `SaaS Custom Domains ${label} 响应不是对象`)
  return record
}

function requireText(value: unknown, field: string): string {
  const parsed = text(value)
  if (parsed === undefined) throw upstreamError(502, `SaaS Custom Domains 响应缺少 ${field}`)
  return parsed
}

async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw upstreamError(502, 'SaaS Custom Domains returned invalid JSON')
  }
}

function errorMessage(payload: unknown, status: number): string {
  const record = toRecord(payload)
  const message = record === undefined ? undefined : text(record.error) ?? text(record.message)
  return message ?? `SaaS Custom Domains request failed with status ${status || 500}`
}

interface RequestInput {
  form?: Record<string, boolean | number | string | undefined>
  method: 'DELETE' | 'GET' | 'POST'
  path: string
  query?: Record<string, number | string | undefined>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const url = new URL(`${API_BASE}${input.path}`)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  let body: string | undefined
  if (input.form !== undefined) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(input.form)) {
      if (value !== undefined) params.set(key, String(value))
    }
    body = params.toString()
    headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
  }

  const response = await guardedFetch(url.toString(), {
    method: input.method,
    headers,
    ...(body === undefined ? {} : { body }),
  })
  const payload = await readPayload(response)
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return payload
}

function upstreamPath(input: { account_uuid?: string, upstream_uuid?: string }): string {
  return `/accounts/${pathSegment(input.account_uuid, 'account_uuid')}`
    + `/upstreams/${pathSegment(input.upstream_uuid, 'upstream_uuid')}`
}

function customDomainPath(
  input: { account_uuid?: string, domain_uuid?: string, upstream_uuid?: string },
): string {
  return `${upstreamPath(input)}/custom_domains/${pathSegment(input.domain_uuid, 'domain_uuid')}`
}

function paginationQuery(
  input: { host?: string, page?: number, per_page?: number },
): Record<string, number | string | undefined> {
  return { host: text(input.host), page: input.page, per_page: input.per_page }
}

/** list 响应统一是 `{data:[...], pagination:{...}}`;两者缺一都说明上游变了形状。 */
function readListPage(payload: unknown, label: string): { data: Json[], pagination: Json } {
  const record = requireRecord(payload, label)
  if (!Array.isArray(record.data)) {
    throw upstreamError(502, `SaaS Custom Domains ${label} response did not include data`)
  }
  return {
    data: record.data.map(item => requireRecord(item, label)),
    pagination: requireRecord(record.pagination, `${label} pagination`),
  }
}

function readMessage(payload: unknown): string {
  return requireText(requireRecord(payload, 'message').message, 'message')
}

export async function listAccounts(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { method: 'GET', path: '/accounts' })
  if (!Array.isArray(payload)) {
    throw upstreamError(502, 'SaaS Custom Domains accounts response was not an array')
  }
  return { accounts: payload.map(item => requireRecord(item, 'account')) }
}

export async function listUpstreams(
  input: z.infer<typeof listUpstreamsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const page = readListPage(
    await request(ctx, {
      method: 'GET',
      path: `/accounts/${pathSegment(input.account_uuid, 'account_uuid')}/upstreams`,
      query: paginationQuery(input),
    }),
    'upstreams',
  )
  return { upstreams: page.data, pagination: page.pagination }
}

export async function createUpstream(
  input: z.infer<typeof createUpstreamInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: `/accounts/${pathSegment(input.account_uuid, 'account_uuid')}/upstreams`,
    form: {
      host: input.host,
      tls: input.tls,
      port: input.port,
      bubble_io: input.bubble_io,
      compression_enabled: input.compression_enabled,
      geocoding_enabled: input.geocoding_enabled,
      auth_token: text(input.auth_token),
    },
  })
  return { upstream: requireRecord(payload, 'upstream') }
}

export async function getUpstream(
  input: z.infer<typeof getUpstreamInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'GET', path: upstreamPath(input) })
  return { upstream: requireRecord(payload, 'upstream') }
}

export async function deleteUpstream(
  input: z.infer<typeof deleteUpstreamInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'DELETE', path: upstreamPath(input) })
  return { message: readMessage(payload) }
}

export async function listCustomDomains(
  input: z.infer<typeof listCustomDomainsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const page = readListPage(
    await request(ctx, {
      method: 'GET',
      path: `${upstreamPath(input)}/custom_domains`,
      query: paginationQuery(input),
    }),
    'custom domains',
  )
  return { custom_domains: page.data, pagination: page.pagination }
}

export async function createCustomDomain(
  input: z.infer<typeof createCustomDomainInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: `${upstreamPath(input)}/custom_domains`,
    form: {
      host: input.host,
      instructions_recipient: text(input.instructions_recipient),
      prepend_path: text(input.prepend_path),
      challenge_type: input.challenge_type,
      redirect_to_www: input.redirect_to_www,
    },
  })
  return { custom_domain: requireRecord(payload, 'custom_domain') }
}

export async function getCustomDomain(
  input: z.infer<typeof getCustomDomainInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'GET', path: customDomainPath(input) })
  return { custom_domain: requireRecord(payload, 'custom_domain') }
}

export async function deleteCustomDomain(
  input: z.infer<typeof deleteCustomDomainInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'DELETE', path: customDomainPath(input) })
  return { message: readMessage(payload) }
}

export async function verifyCustomDomainDnsRecords(
  input: z.infer<typeof verifyCustomDomainDnsRecordsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const record = requireRecord(
    await request(ctx, { method: 'POST', path: `${customDomainPath(input)}/verify_dns_records` }),
    'dns records response',
  )
  return {
    message: requireText(record.message, 'message'),
    dns_status: requireText(record.dns_status, 'dns_status'),
    host: requireText(record.host, 'host'),
  }
}

export async function purgeCustomDomainHttpCache(
  input: z.infer<typeof purgeCustomDomainHttpCacheInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'POST', path: `${customDomainPath(input)}/purge_http_cache` })
  return { message: readMessage(payload) }
}
