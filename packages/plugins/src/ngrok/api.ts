/**
 * ngrok Admin API 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/ngrok/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 六个 action 是同一形状的 GET,响应**原样透出**(ngrok 的字段名本就是出参契约里的名字,
 * 不做重映射)。两处上游细节:
 * - 必须带 `ngrok-version: 2` 头,否则 Admin API 拒绝请求。
 * - `filter`(CEL 表达式)只对 endpoints / tunnel_sessions / reserved_domains 生效,
 *   tunnels 那个端点不认它 —— 上游用 `includeFilter` 开关表达,这里靠各自的 schema:
 *   `listTunnelsInput` 根本没有 filter 字段,strictObject 会在 handler 之前挡掉。
 *
 * 上游错误映射带一个 `phase` 轴(校验凭证阶段把 401/403 压成 400),还把 404 压成 400 ——
 * 后者会让"资源不存在"看起来像"参数写错了"。两者都不保留,交给 `upstreamError` 归一。
 */

import type { z } from 'zod/v4'
import type {
  getEndpointInput,
  getReservedDomainInput,
  listEndpointsInput,
  listReservedDomainsInput,
  listTunnelSessionsInput,
  listTunnelsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'ngrok'
const API_BASE = 'https://api.ngrok.com'
const API_VERSION = '2'

type Json = Record<string, unknown>

/** 上游 `optionalString`:非字符串、或去空白后为空,一律当作"没给"。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** ngrok 的错误体首选字段是 `msg`(不是 `message`),这是它自己的约定。 */
function errorMessage(payload: unknown, status: number): string {
  const body = record(payload)
  return text(body?.msg) ?? text(body?.message) ?? text(body?.error) ?? `ngrok request failed with ${status}`
}

interface ListQuery {
  before_id?: string
  filter?: string
  limit?: number
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, string | undefined> = {},
): Promise<Json> {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  const response = await guardedFetch(url.toString(), {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
      'ngrok-version': API_VERSION,
    },
  })

  // 空体读成 null、非 JSON 读成原文:ngrok 的错误路径两种都出现过。
  const raw = await response.text()
  let payload: unknown = null
  if (raw !== '') {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = raw
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))

  const result = record(payload)
  // 契约说好是对象;不是就是上游出问题,不是调用方的错。上游只在校验凭证那条路上查这个,
  // 执行路径把非对象原样透出去,消费者会在下游拿到一个不符合 outputSchema 的值。
  if (result === undefined) throw upstreamError(502, 'ngrok response was not a JSON object')
  return result
}

/** 三个带 filter 的 list 与 tunnels 共用;`filter` 由各自的 schema 决定有没有。 */
function listQuery(input: ListQuery): Record<string, string | undefined> {
  return {
    limit: input.limit === undefined ? undefined : String(input.limit),
    before_id: text(input.before_id),
    filter: text(input.filter),
  }
}

export async function listEndpoints(
  input: z.infer<typeof listEndpointsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, '/endpoints', listQuery(input))
}

export async function getEndpoint(
  input: z.infer<typeof getEndpointInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, `/endpoints/${encodeURIComponent(input.endpoint_id)}`)
}

export async function listTunnels(
  input: z.infer<typeof listTunnelsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, '/tunnels', listQuery(input))
}

export async function listTunnelSessions(
  input: z.infer<typeof listTunnelSessionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, '/tunnel_sessions', listQuery(input))
}

export async function listReservedDomains(
  input: z.infer<typeof listReservedDomainsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, '/reserved_domains', listQuery(input))
}

export async function getReservedDomain(
  input: z.infer<typeof getReservedDomainInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, `/reserved_domains/${encodeURIComponent(input.reserved_domain_id)}`)
}
