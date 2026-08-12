/**
 * Lob 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/lob/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Lob 的凭证是 **HTTP Basic**:API key 当用户名、密码留空(`base64(key + ':')`)。
 * 换成 Bearer 会直接 401,迁移没有选择余地。
 *
 * 与上游的两处有意偏离:
 * - 上游 `createLobError` 的 validate 分支把 401/403 压成 400,execute 分支原样透传;
 *   这里统一交给 `upstreamError` 归一。
 * - 上游序列化前先过 `compactJson` 剥掉值为 `undefined` 的键;`JSON.stringify` 本来就会
 *   丢弃它们,产出字节完全一致,故不再实现。
 * - `node:buffer` 换成 `btoa`:插件要能在 Workers 里跑,不依赖 Node 内建模块。
 */

import type { z } from 'zod/v4'
import type {
  autocompleteUsAddressesInput,
  bulkVerifyInternationalAddressesInput,
  bulkVerifyUsAddressesInput,
  verifyInternationalAddressInput,
  verifyUsAddressInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'lob'
const API_BASE = 'https://api.lob.com/v1'
const REQUEST_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>

/** 上游 `optionalString` 的等价物:非字符串、或去空白后为空,都算缺失。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 契约说好是对象;不是就是上游破了契约,不是调用方的错。 */
function requireObject(value: unknown, label: string): Json {
  const body = record(value)
  if (body === undefined) throw upstreamError(502, `invalid ${label}`)
  return body
}

/** 缺失或不是数组时回空数组(与上游一致):批量接口部分失败时 `addresses` 可能整个缺席。 */
function objectArray(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(item => requireObject(item, 'lob array item')) : []
}

/** 错误体三种形状:纯文本、`{error:'...'}`、以及 `{error:{message}}`;再退回顶层 message。 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  const body = record(payload)
  if (body === undefined) return undefined
  const direct = text(body.error)
  if (direct !== undefined) return direct
  return text(record(body.error)?.message) ?? text(body.message)
}

/** Lob 在部分错误上回纯文本;解析不出 JSON 就把原文本身当 payload,留给消息提取。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

interface RequestInput {
  body?: unknown
  method: 'GET' | 'POST'
  path: string
  query?: Record<string, boolean | string | undefined>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(`.${input.path}`, `${API_BASE}/`)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    // 空串按"没填"处理,与上游 `queryParams` 一致 —— 填了空的 city 不该变成 `city=` 过滤器。
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Basic ${btoa(`${apiKey}:`)}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method,
      headers,
      // 上游给了 30s 的独立预算;不设上限会让一次挂死的调用永远占着连接。
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw upstreamError(504, 'lob request timed out')
    }
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    throw upstreamError(502, error instanceof Error ? `lob request failed: ${error.message}` : 'lob request failed')
  }

  const payload = await readPayload(response)
  if (!response.ok) {
    throw upstreamError(response.status, `lob request failed: ${errorMessage(payload) ?? 'lob request failed'}`)
  }
  return payload
}

export async function verifyUsAddress(
  input: z.infer<typeof verifyUsAddressInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'POST', path: '/us_verifications', body: input })
  return { verification: requireObject(payload, 'lob US verification response') }
}

export async function bulkVerifyUsAddresses(
  input: z.infer<typeof bulkVerifyUsAddressesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'POST', path: '/us_verifications/bulk', body: input })
  const response = requireObject(payload, 'lob bulk US verification response')
  // `raw` 保留完整响应:批量接口的 errors / 计费信息都在 addresses 之外。
  return { verifications: objectArray(response.addresses), raw: response }
}

export async function autocompleteUsAddresses(
  input: z.infer<typeof autocompleteUsAddressesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'GET',
    path: '/us_autocompletions',
    query: {
      address_prefix: input.address_prefix,
      city: input.city,
      state: input.state,
      zip_code: input.zip_code,
      geo_ip_sort: input.geo_ip_sort,
    },
  })
  const response = requireObject(payload, 'lob US autocomplete response')
  return { suggestions: objectArray(response.suggestions), raw: response }
}

export async function verifyInternationalAddress(
  input: z.infer<typeof verifyInternationalAddressInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'POST', path: '/intl_verifications', body: input })
  return { verification: requireObject(payload, 'lob international verification response') }
}

export async function bulkVerifyInternationalAddresses(
  input: z.infer<typeof bulkVerifyInternationalAddressesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'POST', path: '/intl_verifications/bulk', body: input })
  const response = requireObject(payload, 'lob bulk international verification response')
  return { verifications: objectArray(response.addresses), raw: response }
}
