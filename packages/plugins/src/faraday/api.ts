/**
 * Faraday 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/faraday/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 12 个 action 全是"GET 一个 REST 资源、原样透出"的同一形状,只差路径和出参键名,
 * 故收成 `resource` / `collection` 两个工厂,handler 只剩路径与键名的声明。
 *
 * 与上游的一处有意偏离:上游 `mapFaradayError` 把 403 压成 401、把 409 压成 400。
 * 这里把原始状态交给 `upstreamError`,403 仍是 permission_denied、409 仍是 conflict。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getAccountInput,
  getDatasetInput,
  getScopeInput,
  getTargetInput,
  getTraitInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'faraday'
const API_BASE = 'https://api.faraday.ai/v1'

type Json = Record<string, unknown>

/** 上游 `optionalString`:非字符串、或去空白后为空,都算缺失。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** Faraday 的错误体首选 `note`(它才是面向人的那句),再退回 message/error。 */
function errorMessage(payload: unknown): string | undefined {
  const body = record(payload)
  if (body === undefined) return undefined
  return text(body.note) ?? text(body.message) ?? text(body.error)
}

async function request(ctx: ProviderContext, path: string): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  // base 末尾补 `/`、path 去掉首 `/`:否则 URL 相对解析会吃掉 `/v1` 这一段。
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, `${API_BASE}/`)

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 500。
    throw upstreamError(
      502,
      error instanceof Error ? `faraday 请求失败: ${error.message}` : 'faraday 请求失败',
    )
  }

  const body = await response.text().catch(() => '')
  let payload: unknown = null
  if (body !== '') {
    try {
      payload = JSON.parse(body) as unknown
    } catch {
      throw new TBError('unavailable', 'faraday 返回了非法 JSON', { retryable: true })
    }
  }

  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? `faraday 请求失败,HTTP ${response.status}`)
  }
  return payload
}

async function requestObject(ctx: ProviderContext, path: string): Promise<Json> {
  const object = record(await request(ctx, path))
  if (object === undefined) {
    throw new TBError('unavailable', 'faraday 返回的 JSON 响应不是对象', { retryable: true })
  }
  return object
}

async function requestArray(ctx: ProviderContext, path: string): Promise<Json[]> {
  const payload = await request(ctx, path)
  if (!Array.isArray(payload)) {
    throw new TBError('unavailable', 'faraday 返回的 JSON 响应不是数组', { retryable: true })
  }
  return payload.map((item) => {
    const object = record(item)
    if (object === undefined) {
      throw new TBError('unavailable', 'faraday 返回的 JSON 数组里有非对象元素', { retryable: true })
    }
    return object
  })
}

/** 单资源 action 的工厂:GET 一个资源,同时以 `<key>` 和 `raw` 两个键透出。 */
function resource(key: string, path: (id: string) => string) {
  return async (id: string, ctx: ProviderContext): Promise<Json> => {
    const value = await requestObject(ctx, path(id))
    return { [key]: value, raw: value }
  }
}

/** 集合 action 的工厂;与单资源同理。 */
function collection(key: string, path: string) {
  return async (_input: unknown, ctx: ProviderContext): Promise<Json> => {
    const value = await requestArray(ctx, path)
    return { [key]: value, raw: value }
  }
}

const fetchAccount = resource('account', id => `/accounts/${encodeURIComponent(id)}`)
const fetchScope = resource('scope', id => `/scopes/${encodeURIComponent(id)}`)
const fetchDataset = resource('dataset', id => `/datasets/${encodeURIComponent(id)}`)
const fetchTrait = resource('trait', id => `/traits/${encodeURIComponent(id)}`)
const fetchTarget = resource('target', id => `/targets/${encodeURIComponent(id)}`)

export async function getCurrentAccount(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const account = await requestObject(ctx, '/accounts/current')
  return { account, raw: account }
}

export const listAccounts = collection('accounts', '/accounts')
export const listScopes = collection('scopes', '/scopes')
export const listDatasets = collection('datasets', '/datasets')
export const listTraits = collection('traits', '/traits')
export const listTargets = collection('targets', '/targets')
export const listUsages = collection('usages', '/usages')

export function getAccount(input: z.infer<typeof getAccountInput>, ctx: ProviderContext): Promise<Json> {
  return fetchAccount(input.account_id, ctx)
}

export function getScope(input: z.infer<typeof getScopeInput>, ctx: ProviderContext): Promise<Json> {
  return fetchScope(input.scope_id, ctx)
}

export function getDataset(input: z.infer<typeof getDatasetInput>, ctx: ProviderContext): Promise<Json> {
  return fetchDataset(input.dataset_id, ctx)
}

export function getTrait(input: z.infer<typeof getTraitInput>, ctx: ProviderContext): Promise<Json> {
  return fetchTrait(input.trait_id, ctx)
}

export function getTarget(input: z.infer<typeof getTargetInput>, ctx: ProviderContext): Promise<Json> {
  return fetchTarget(input.target_id, ctx)
}
