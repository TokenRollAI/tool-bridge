/**
 * Shodan 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/shodan/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Shodan 的两个特点决定了这里的形状:
 * - **API key 走 `key` query 参数**,不走 header。
 * - 上游对每个响应做了**结构收窄**(只透出声明过的字段,并校验类型),outputSchema 就是
 *   按收窄后的形状生成的,故这些 `normalizeXxx` 必须照搬 —— 直接透传原始 payload 会与
 *   声明的 outputSchema 对不上。
 *
 * 与上游有一处有意偏离:上游把"响应缺 plan / total 之类必填字段"抛成 **400**
 * (`readRequiredString` 的默认口径),那是把上游的契约破损报成了调用方的入参错误。
 * 这里一律归 502 —— 调用方改不了自己的入参来修复它。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  countSearchResultsInput,
  getDomainInfoInput,
  getHostInput,
  resolveHostnamesInput,
  reverseDnsLookupInput,
  searchHostsInput,
} from './schema'
import {
  compactDefined as compact,
  booleanValue as optionalFlag,
  asJsonObject as record,
} from '../_runtime/jsonValue'
import { createProviderHttpClient, type ProviderQuery } from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'shodan'
const API_BASE = 'https://api.shodan.io'
const API_INFO_PATH = '/api-info'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>

/** 响应字段不符合上游文档的形状 —— 上游契约破了,调用方无从修复。 */
function invalidResponse(field: string): TBError {
  return upstreamError(502, `Shodan ${field} response is invalid`)
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalidResponse(field)
  return value.trim()
}

function requiredCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw invalidResponse(field)
  return value
}

function optionalCount(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : requiredCount(value, field)
}

function objectArray(value: unknown, field: string): Json[] {
  if (!Array.isArray(value) || value.some(item => record(item) === undefined)) throw invalidResponse(field)
  return value as Json[]
}

function textArray(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw invalidResponse(field)
  }
  return (value as string[]).map(item => item.trim())
}

function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload.trim()
  const body = record(payload)
  for (const key of ['error', 'message']) {
    const value = body?.[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return `Shodan request failed with ${status || 500}`
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, boolean | number | string | undefined> = {},
): Promise<Json> {
  const requestQuery: ProviderQuery = [
    ...Object.entries(query),
    ['key', requireApiKey(ctx, SERVICE)],
  ]
  const response = await http.request({
    path,
    query: requestQuery,
    headers: { accept: 'application/json' },
    invalidJson: 'text',
    mapError: ({ data, status }) => upstreamError(status, errorMessage(data, status)),
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined ? 'Shodan request failed' : `Shodan request failed: ${message}`,
    ),
  })
  if (response.bodyKind === 'invalid-json') throw upstreamError(502, 'Shodan returned invalid JSON')
  const body = record(response.bodyKind === 'empty' ? null : response.data)
  if (body === undefined) throw upstreamError(502, 'Shodan returned an invalid JSON response')
  return body
}

/** `hostnames` / `ips` 走逗号分隔串;含逗号的成员会把一项拆成两项,故本地挡掉。 */
function joinCommaList(values: string[] | undefined, field: string): string {
  if (values === undefined || values.length === 0) {
    throw new TBError('invalid_argument', `${field} is required`)
  }
  return values.map((item, index) => {
    const trimmed = item.trim()
    if (trimmed === '') throw new TBError('invalid_argument', `${field}[${index}] is required`)
    if (trimmed.includes(',')) throw new TBError('invalid_argument', `${field}[${index}] must not contain commas`)
    return trimmed
  }).join(',')
}

export async function getApiInfo(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, API_INFO_PATH)
  return compact({
    plan: requiredText(payload.plan, 'plan'),
    https: optionalFlag(payload.https),
    monitored_ips: requiredCount(payload.monitored_ips, 'monitored_ips'),
    query_credits: requiredCount(payload.query_credits, 'query_credits'),
    scan_credits: requiredCount(payload.scan_credits, 'scan_credits'),
    telnet: optionalFlag(payload.telnet),
    unlocked: optionalFlag(payload.unlocked),
    unlocked_left: optionalCount(payload.unlocked_left, 'unlocked_left'),
    usage_limits: record(payload.usage_limits),
  })
}

export async function searchHosts(
  input: z.infer<typeof searchHostsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/shodan/host/search', {
    query: input.query,
    facets: input.facets,
    page: input.page,
    minify: input.minify,
  })
  return compact({
    matches: objectArray(payload.matches, 'matches'),
    total: requiredCount(payload.total, 'total'),
    facets: record(payload.facets),
  })
}

export async function countSearchResults(
  input: z.infer<typeof countSearchResultsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/shodan/host/count', { query: input.query, facets: input.facets })
  return compact({
    total: requiredCount(payload.total, 'total'),
    facets: record(payload.facets),
  })
}

export async function getHost(
  input: z.infer<typeof getHostInput>,
  ctx: ProviderContext,
): Promise<{ host: Json }> {
  const path = `/shodan/host/${encodeURIComponent(input.ip)}`
  return { host: await request(ctx, path, { history: input.history, minify: input.minify }) }
}

export async function getDomainInfo(
  input: z.infer<typeof getDomainInfoInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // schema 把 domain 标成可选(上游靠 executor 里的 requiredString 兜底),这道检查不能省。
  if (input.domain === undefined || input.domain.trim() === '') {
    throw new TBError('invalid_argument', 'domain is required')
  }
  const payload = await request(ctx, `/dns/domain/${encodeURIComponent(input.domain.trim())}`)
  return {
    domain: requiredText(payload.domain, 'domain'),
    tags: textArray(payload.tags, 'tags'),
    data: payload.data === undefined ? [] : objectArray(payload.data, 'data'),
    subdomains: textArray(payload.subdomains, 'subdomains'),
    more: optionalFlag(payload.more) ?? false,
  }
}

export async function resolveHostnames(
  input: z.infer<typeof resolveHostnamesInput>,
  ctx: ProviderContext,
): Promise<{ results: Record<string, string> }> {
  const payload = await request(ctx, '/dns/resolve', {
    hostnames: joinCommaList(input.hostnames, 'hostnames'),
  })
  // 解析不出的主机名 Shodan 回 null;上游把这些键**剔除**而不是留成 null。
  const entries = Object.entries(payload).flatMap(([key, value]) => {
    if (value === null) return []
    if (typeof value !== 'string' || value.trim() === '') throw invalidResponse('results')
    return [[key, value.trim()] as const]
  })
  return { results: Object.fromEntries(entries) }
}

export async function reverseDnsLookup(
  input: z.infer<typeof reverseDnsLookupInput>,
  ctx: ProviderContext,
): Promise<{ results: Record<string, string[]> }> {
  const payload = await request(ctx, '/dns/reverse', { ips: joinCommaList(input.ips, 'ips') })
  const entries = Object.entries(payload).map(([key, value]) => {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
      throw invalidResponse('results')
    }
    return [key, (value as string[]).map(item => item.trim())] as const
  })
  return { results: Object.fromEntries(entries) }
}
