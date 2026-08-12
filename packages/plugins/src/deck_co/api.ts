/**
 * Deck.co 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/deck_co/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 上游那套「把 404 之类压成 502、validate 阶段把 401 压成 400」的自有映射没有搬过来:
 * 阶段区分只服务于 credentialValidators(本仓库由平台的 credentialProbe 承担),
 * 而状态码归一现在统一走 `upstreamError`。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createSourceInput,
  getAgentInput,
  getSourceInput,
  listAgentsInput,
  listSourcesInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'deck_co'
const API_BASE = 'https://api.deck.co/v2'

type Json = Record<string, unknown>

interface RequestInput {
  body?: Json
  /** 上游允许调用方自带 Idempotency-Key,用于安全重试写操作。 */
  idempotencyKey?: string
  method: 'GET' | 'POST'
  query?: Record<string, number | string | undefined>
}

/**
 * 生成的 schema 把 `agent_id` / `source_id` 标成了 optional(上游 action 定义如此),
 * 但上游 handler 直接 `String(input.agent_id)`,缺失时会打出 `/agents/undefined`。
 * 在本地挡住,免得把一次必然失败的往返丢给上游。
 */
function requiredId(value: string | undefined, field: string): string {
  if (value === undefined || value === '') {
    throw new TBError('invalid_argument', `${field} 不能为空`)
  }
  return encodeURIComponent(value)
}

/** Deck.co 的错误文案在 `message`,批量校验错误则在 `errors[0].message`。 */
function errorMessage(payload: unknown, response: Response): string {
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Json
    if (typeof record.message === 'string' && record.message !== '') return record.message
    if (Array.isArray(record.errors)) {
      const first = record.errors[0]
      if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
        const message = (first as Json).message
        if (typeof message === 'string' && message !== '') return message
      }
    }
  }
  return response.statusText || `Deck.co request failed with ${response.status}`
}

/** 空体按空对象处理(上游 204 / 空 body 的写路径依赖这条)。 */
async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new TBError('unavailable', 'Deck.co 返回了非 JSON 响应', { retryable: true })
  }
}

async function request(ctx: ProviderContext, path: string, init: RequestInput): Promise<unknown> {
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, `${API_BASE}/`)
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
    accept: 'application/json',
  }
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  if (init.idempotencyKey !== undefined) headers['idempotency-key'] = init.idempotencyKey

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })
    payload = await readPayload(response)
  } catch (error) {
    if (error instanceof TBError) throw error
    throw new TBError(
      'unavailable',
      error instanceof Error ? `Deck.co 请求失败: ${error.message}` : 'Deck.co 请求失败',
      { retryable: true },
    )
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response))
  return payload
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错。 */
function readObject(value: unknown, label: string): Json {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TBError('unavailable', `Deck.co 的${label}不是 JSON 对象`, { retryable: true })
  }
  return value as Json
}

/** 三个 list 端点共用的分页信封整形(上游用 snake_case,出参用 camelCase)。 */
function page(record: Json, key: string): Json {
  return {
    [key]: Array.isArray(record.data) ? record.data : [],
    hasMore: record.has_more === true,
    nextCursor: typeof record.next_cursor === 'string' && record.next_cursor !== ''
      ? record.next_cursor
      : null,
    requestId: typeof record.request_id === 'string' && record.request_id !== ''
      ? record.request_id
      : null,
  }
}

export async function testApiKey(_input: unknown, ctx: ProviderContext): Promise<unknown> {
  return await request(ctx, '/test', { method: 'GET' })
}

export async function listAgents(
  input: z.infer<typeof listAgentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/agents', {
    method: 'GET',
    query: { limit: input.limit, cursor: input.cursor },
  })
  return page(readObject(payload, 'agents 响应'), 'agents')
}

export async function getAgent(
  input: z.infer<typeof getAgentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/agents/${requiredId(input.agent_id, 'agent_id')}`, { method: 'GET' })
  return { agent: readObject(payload, 'agent 响应') }
}

export async function listSources(
  input: z.infer<typeof listSourcesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/sources', {
    method: 'GET',
    query: { limit: input.limit, cursor: input.cursor },
  })
  return page(readObject(payload, 'sources 响应'), 'sources')
}

export async function getSource(
  input: z.infer<typeof getSourceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/sources/${requiredId(input.source_id, 'source_id')}`, { method: 'GET' })
  return { source: readObject(payload, 'source 响应') }
}

export async function createSource(
  input: z.infer<typeof createSourceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/sources', {
    method: 'POST',
    // type 写死 website:上游目前只支持这一种 source。
    body: {
      type: 'website',
      website: { url: input.website_url },
      ...(input.name === undefined ? {} : { name: input.name }),
    },
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  })
  return { source: readObject(payload, 'source 响应') }
}
