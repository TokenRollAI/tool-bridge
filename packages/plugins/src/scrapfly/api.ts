/**
 * Scrapfly 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/scrapfly/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Scrapfly 的几个特点决定了这里的形状:
 * - **API key 是 `key` query 参数**,不走 header。
 * - 目标站点的请求头以 **`headers[Name]=value`** 的方括号形式进 query;`tags` 则是
 *   **`tags[]`** 重复键。这两套编码不一样,不能合并处理。
 * - 计费与拒绝信息只在**响应头**里(`x-scrapfly-api-cost` 等),故每个 action 都把
 *   `metadata` + 完整 `headers` 一起透出。
 * - scrape 是长任务,超时给到 160s(上游同值),远高于常规 provider。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { getMonitoringMetricsInput, scrapeInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'scrapfly'
const API_BASE = 'https://api.scrapfly.io'
const SCRAPE_URL = `${API_BASE}/scrape`
const METRICS_URL = `${API_BASE}/scrape/monitoring/metrics`
const REQUEST_TIMEOUT_MS = 160_000
/** 非 JSON 错误体(常是整页 HTML)截断后再回给调用方。 */
const MAX_ERROR_MESSAGE_LENGTH = 300

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | string[] | undefined

function looksLikeHtml(value: string): boolean {
  return /^<!doctype html/i.test(value) || /^<html[\s>]/i.test(value)
}

function errorMessage(body: string, headers: Headers, status: number): string {
  const trimmed = body.trim()
  if (trimmed !== '') {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Json
        for (const key of ['message', 'error', 'detail']) {
          const value = record[key]
          if (typeof value === 'string' && value.trim() !== '') return value.trim()
        }
      }
    } catch {
      // 落到下面的纯文本分支。
    }
    if (looksLikeHtml(trimmed)) return 'Scrapfly 返回了非 JSON 的错误响应'
    return trimmed.length <= MAX_ERROR_MESSAGE_LENGTH
      ? trimmed
      : `${trimmed.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...`
  }
  // 体是空的时候,拒绝原因只在这个头里。
  return headers.get('x-scrapfly-reject-code') ?? `Scrapfly 返回 HTTP ${status}`
}

function buildUrl(base: string, apiKey: string, query: Record<string, QueryValue>): URL {
  const url = new URL(base)
  url.searchParams.set('key', apiKey)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(`${key}[]`, item)
      continue
    }
    url.searchParams.set(key, String(value))
  }
  return url
}

async function request(
  ctx: ProviderContext,
  base: string,
  query: Record<string, QueryValue>,
  init: RequestInit,
): Promise<Response> {
  const url = buildUrl(base, requireApiKey(ctx, SERVICE), query)
  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      ...init,
      headers: { accept: 'application/json', ...init.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof TBError) throw error
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, `Scrapfly ${REQUEST_TIMEOUT_MS / 1000}s 内没有返回`)
    }
    throw new TBError(
      'unavailable',
      error instanceof Error ? `Scrapfly 请求失败: ${error.message}` : 'Scrapfly 请求失败',
      { retryable: true },
    )
  }
  if (!response.ok) {
    throw upstreamError(
      response.status,
      errorMessage(await response.text().catch(() => ''), response.headers, response.status),
    )
  }
  return response
}

async function readJson(response: Response, label: string): Promise<unknown> {
  const body = await response.text()
  if (body.trim() === '') {
    throw new TBError('unavailable', `${label}返回了空响应体`, { retryable: true })
  }
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new TBError('unavailable', `${label}返回了非法 JSON`, { retryable: true })
  }
}

function requireRecord(payload: unknown, label: string): Json {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TBError('unavailable', `${label}不是 JSON 对象`, { retryable: true })
  }
  return payload as Json
}

function toRecord(value: unknown): Json {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Json
}

function headerInt(headers: Headers, name: string): null | number {
  const value = headers.get(name)
  if (value === null || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

/** 计费与拒绝信息只在响应头里,是调用方判断"这次花了多少 / 为什么被拒"的唯一来源。 */
function responseMetadata(response: Response): Json {
  return {
    status_code: response.status,
    api_cost: headerInt(response.headers, 'x-scrapfly-api-cost'),
    remaining_api_credit: headerInt(response.headers, 'x-scrapfly-remaining-api-credit'),
    reject_code: response.headers.get('x-scrapfly-reject-code'),
    reject_description: response.headers.get('x-scrapfly-reject-description'),
    reject_retryable: response.headers.get('x-scrapfly-reject-retryable'),
  }
}

export async function scrape(
  input: z.infer<typeof scrapeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const method = input.method ?? 'GET'
  // Scrapfly 对这两种组合只回含糊的 400,在本地挡下能给出可操作的信息。
  if ((method === 'GET' || method === 'HEAD') && input.body !== undefined && input.body !== '') {
    throw new TBError('invalid_argument', `${method} 抓取请求不能带 body`)
  }
  if (input.body !== undefined && input.body !== '' && input.content_type === undefined) {
    throw new TBError('invalid_argument', '给了 body 就必须给 content_type')
  }

  // 目标站点的请求头走 `headers[Name]` 方括号编码,与 tags 的 `tags[]` 是两套写法。
  const targetHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (value.trim() !== '') targetHeaders[`headers[${key}]`] = value.trim()
  }
  const tags = input.tags?.map(tag => tag.trim()).filter(tag => tag !== '')

  const response = await request(
    ctx,
    SCRAPE_URL,
    {
      url: input.url,
      country: input.country,
      proxy_pool: input.proxy_pool,
      render_js: input.render_js,
      asp: input.asp,
      retry: input.retry,
      timeout: input.timeout,
      wait_for_selector: input.wait_for_selector,
      cache: input.cache,
      cache_ttl: input.cache_ttl,
      cache_clear: input.cache_clear,
      session: input.session,
      session_sticky_proxy: input.session_sticky_proxy,
      format: input.format,
      correlation_id: input.correlation_id,
      debug: input.debug,
      ...targetHeaders,
      tags: tags !== undefined && tags.length > 0 ? tags : undefined,
    },
    {
      method,
      body: input.body === undefined || input.body === '' ? undefined : input.body,
      headers: input.content_type === undefined ? undefined : { 'content-type': input.content_type },
    },
  )

  const payload = requireRecord(await readJson(response, 'Scrapfly 抓取响应'), 'Scrapfly 抓取响应')
  return {
    result: requireRecord(payload.result, 'Scrapfly 抓取结果'),
    config: toRecord(payload.config),
    context: toRecord(payload.context),
    metadata: responseMetadata(response),
    headers: Object.fromEntries(response.headers.entries()),
  }
}

export async function getMonitoringMetrics(
  input: z.infer<typeof getMonitoringMetricsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const response = await request(
    ctx,
    METRICS_URL,
    {
      aggregation: input.aggregation,
      period: input.period,
      start: input.start,
      end: input.end,
      group_subdomain: input.group_subdomain,
    },
    { method: 'GET' },
  )
  return {
    metrics: requireRecord(
      await readJson(response, 'Scrapfly 监控指标响应'),
      'Scrapfly 监控指标响应',
    ),
    metadata: responseMetadata(response),
    headers: Object.fromEntries(response.headers.entries()),
  }
}
