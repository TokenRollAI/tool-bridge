/**
 * Fixer 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/fixer/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Fixer 的两个特点决定了这里的形状:
 * - **凭证进 query**(`?access_key=`)。这是 Fixer API 本身的设计,换成 header 会直接被
 *   当成缺 key,迁移没有选择余地;部署侧需知凭证会出现在出站 URL 里(详见 MIGRATION.md)。
 * - 错误常常带着 **HTTP 200** 回来,靠 body 里的 `success:false` / `error.type` 表达。
 *   故成功路径也必须查 body,不能只看状态码。
 *
 * 与上游的有意偏离:上游把 `invalid_access_key` / `missing_access_key` 归成 400。这里归成
 * permission_denied —— 这两个 type 说的正是"配的 key 不可用",而平台的 credentialProbe
 * 按 401/403 判定挂载失败,压成 400 会让配错的 key 看起来像调用方传错了参数。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { getHistoricalRatesInput, getLatestRatesInput, getSupportedSymbolsInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'fixer'
const API_BASE = 'https://data.fixer.io/api'

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

/** 错误信息优先取人类可读的 `error.info`,退回 `error.type`,再退回顶层 `message`。 */
function errorMessage(payload: unknown): string | undefined {
  const body = record(payload)
  if (body === undefined) return undefined
  const error = record(body.error)
  return text(error?.info) ?? text(error?.type) ?? text(body.message)
}

function errorType(payload: unknown): string | undefined {
  return text(record(record(payload)?.error)?.type)
}

/** `success:false` 或带 `error` 键都算失败 —— Fixer 两种都用过。 */
function isErrorPayload(payload: unknown): boolean {
  const body = record(payload)
  return body === undefined ? false : body.success === false || body.error !== undefined
}

/** 凭证问题:交给 permission_denied,让 credentialProbe 能把它认成"这次挂载配错了"。 */
const CREDENTIAL_ERROR_TYPES = new Set(['invalid_access_key', 'missing_access_key'])
/** 入参问题:上游已经按 type 明确分好类,照搬。 */
const ARGUMENT_ERROR_TYPES = new Set([
  'base_currency_access_restricted',
  'invalid_base_currency',
  'invalid_date',
  'invalid_symbols',
])

function toError(status: number, payload: unknown): TBError {
  const message = errorMessage(payload) ?? `Fixer request failed with ${status || 500}`
  const type = errorType(payload)
  // 配额耗尽在 Fixer 侧是 200 + monthly_limit_reached,不是 429;不认它就会被当成成功之外
  // 的普通错误,调用方拿不到"可重试"的信号。
  if (status === 429 || type === 'monthly_limit_reached') {
    return new TBError('rate_limited', message, { retryable: true })
  }
  if (type !== undefined && CREDENTIAL_ERROR_TYPES.has(type)) {
    return new TBError('permission_denied', message, { httpStatus: 401 })
  }
  if (type !== undefined && ARGUMENT_ERROR_TYPES.has(type)) {
    return new TBError('invalid_argument', message)
  }
  return upstreamError(status, message)
}

async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw upstreamError(502, 'Fixer returned an invalid JSON response')
  }
}

async function request(ctx: ProviderContext, path: string, query: Record<string, string | undefined> = {}): Promise<Json> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(path.replace(/^\//, ''), `${API_BASE}/`)
  url.searchParams.set('access_key', apiKey)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  let response: Response
  try {
    response = await guardedFetch(url.toString(), { method: 'GET' })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    throw upstreamError(502, error instanceof Error ? `Fixer request failed: ${error.message}` : 'Fixer request failed')
  }

  const payload = await readPayload(response)
  if (!response.ok || isErrorPayload(payload)) throw toError(response.status, payload)

  const body = record(payload)
  if (body === undefined) throw upstreamError(502, 'Fixer returned an invalid JSON response')
  return body
}

/** Fixer 只接受逗号拼接的一串代码,不认重复同名键。 */
function symbolsQuery(symbols: readonly string[] | undefined): string | undefined {
  return symbols === undefined || symbols.length === 0 ? undefined : symbols.join(',')
}

export async function getSupportedSymbols(
  _input: z.infer<typeof getSupportedSymbolsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, '/symbols')
}

export async function getLatestRates(
  input: z.infer<typeof getLatestRatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, '/latest', { base: input.base, symbols: symbolsQuery(input.symbols) })
}

export async function getHistoricalRates(
  input: z.infer<typeof getHistoricalRatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 日期格式由 schema 的 `z.iso.date()` 保证;"不得晚于今天"是它表达不了的,留在这里。
  const today = new Date().toISOString().slice(0, 10)
  if (input.date > today) throw new TBError('invalid_argument', 'date must not be in the future')

  // 历史汇率的日期就是**路径**,不是 query 参数。
  return request(ctx, `/${input.date}`, { base: input.base, symbols: symbolsQuery(input.symbols) })
}
