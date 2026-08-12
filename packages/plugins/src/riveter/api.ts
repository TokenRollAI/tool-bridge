/**
 * Riveter 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/riveter/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * `scrape` 是**同步抓取**:一次调用要等目标页面被真正抓完。上游为此设了 30s 超时,
 * 这里保留 —— 没有它,一次挂死的抓取会把网关这一路请求一起拖到底层连接自己断开为止。
 *
 * 上游 `createRiveterError` 在校验期把 4xx 压成 400 的分支不保留:状态码归一由共用的
 * `upstreamError` 统一口径。
 */

import type { z } from 'zod/v4'
import type { getAccountInput, scrapeInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'riveter'
const API_BASE = 'https://api.riveterhq.com/v1'
const REQUEST_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>

interface ScrapeData {
  base_url_for_links: string
  credit_used: number
  possibly_blocked?: boolean
  raw: Json
  riveter_app_link: string
  status_code?: number
  text: string
  url: string
}

function asRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

/** 上游 `optionalString` 的语义:先 trim,空则视为缺失。 */
function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 响应里契约要求的字段;取不到是**上游**破了契约,不是调用方的错。 */
function responseText(value: unknown, field: string): string {
  const text = optionalText(value)
  if (text === undefined) throw upstreamError(502, `Riveter 返回的 ${field} 无效`)
  return text
}

function responseNumber(value: unknown, field: string): number {
  const parsed = optionalNumber(value)
  if (parsed === undefined) throw upstreamError(502, `Riveter 返回的 ${field} 无效`)
  return parsed
}

function errorMessage(payload: unknown): string | undefined {
  const direct = optionalText(payload)
  if (direct !== undefined) return direct
  const record = asRecord(payload)
  if (record === undefined) return undefined
  return optionalText(record.message) ?? optionalText(record.error) ?? optionalText(record.detail)
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw upstreamError(502, 'Riveter 返回了非法 JSON')
  }
}

interface RequestInput {
  body?: Json
  method: 'GET' | 'POST'
  path: string
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<Json> {
  const apiKey = requireApiKey(ctx, SERVICE)
  // 上游按 `new URL(path, base + '/')` 拼,故去掉前导斜杠,否则会丢掉 /v1 前缀。
  const url = new URL(input.path.replace(/^\//, ''), `${API_BASE}/`)

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method,
      headers,
      signal: timeoutSignal,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    if (timeoutSignal.aborted) throw upstreamError(504, `Riveter ${REQUEST_TIMEOUT_MS / 1000}s 内没有返回`)
    throw upstreamError(
      502,
      error instanceof Error ? `Riveter 请求失败: ${error.message}` : 'Riveter 请求失败',
    )
  }

  const payload = await readPayload(response)
  if (!response.ok) {
    throw upstreamError(
      response.status,
      errorMessage(payload) ?? `Riveter 请求失败(HTTP ${response.status})`,
    )
  }

  const record = asRecord(payload)
  if (record === undefined) throw upstreamError(502, 'Riveter 返回的 payload 不是对象')
  return record
}

export async function getAccount(
  _input: z.infer<typeof getAccountInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, { method: 'GET', path: '/account' })
}

export async function scrape(
  input: z.infer<typeof scrapeInput>,
  ctx: ProviderContext,
): Promise<{ data: ScrapeData, message: string, request_status: string, run_key: string }> {
  const payload = await request(ctx, {
    method: 'POST',
    path: '/scrape',
    body: {
      url: input.url,
      ...(input.proxy_country_code === undefined
        ? {}
        : { proxy_country_code: input.proxy_country_code }),
      ...(input.skip_cache === undefined ? {} : { skip_cache: input.skip_cache }),
    },
  })

  const data = asRecord(payload.data)
  if (data === undefined) throw upstreamError(502, 'Riveter 返回的 data 不是对象')

  return {
    request_status: responseText(payload.request_status, 'request_status'),
    message: responseText(payload.message, 'message'),
    run_key: responseText(payload.run_key, 'run_key'),
    data: {
      url: responseText(data.url, 'data.url'),
      text: responseText(data.text, 'data.text'),
      base_url_for_links: responseText(data.base_url_for_links, 'data.base_url_for_links'),
      // 这两个是可选的:取不到就整个键省掉,不补 null。
      ...(optionalNumber(data.status_code) === undefined
        ? {}
        : { status_code: optionalNumber(data.status_code) }),
      ...(typeof data.possibly_blocked === 'boolean'
        ? { possibly_blocked: data.possibly_blocked }
        : {}),
      credit_used: responseNumber(data.credit_used, 'data.credit_used'),
      riveter_app_link: responseText(data.riveter_app_link, 'data.riveter_app_link'),
      raw: data,
    },
  }
}
