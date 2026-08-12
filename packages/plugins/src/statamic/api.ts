/**
 * Statamic 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/statamic/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Statamic 的特点决定了这里的形状:
 * - 响应统一裹在 `{data: ...}` 里;站点对象再归一成固定五键(name/key/domains/createdAt/raw),
 *   `raw` 保留原始对象是因为归一形状只覆盖了 statamic.com 现在稳定的那几个字段。
 * - `domain`(单个)与 `domains`(列表)是**两条互斥的写法**,schema 表达不了,在这里挡。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { createSiteInput, deleteSiteInput, updateSiteInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'statamic'
const API_BASE = 'https://statamic.com/api/v1/'
const REQUEST_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/** Statamic 的错误体:字符串、`{message}`、`{error}`,或 Laravel 风格的 `{errors:{field:[...]}}`。 */
function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Json
    for (const key of ['message', 'error']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
    const errors = record.errors
    if (errors !== null && typeof errors === 'object' && !Array.isArray(errors)) {
      for (const value of Object.values(errors as Json)) {
        if (typeof value === 'string' && value.trim() !== '') return value.trim()
        if (Array.isArray(value)) {
          const first = value.find(item => typeof item === 'string' && item.trim() !== '')
          if (typeof first === 'string') return first.trim()
        }
      }
    }
  }
  return `Statamic 请求失败,HTTP ${status}`
}

async function request(
  ctx: ProviderContext,
  input: { body?: Json, method: 'DELETE' | 'GET' | 'PATCH' | 'POST', path: string },
): Promise<Json> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const url = new URL(input.path.startsWith('/') ? input.path.slice(1) : input.path, API_BASE)

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  let text: string
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    text = await response.text()
  } catch (error) {
    if (error instanceof TBError) throw error
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, `Statamic ${REQUEST_TIMEOUT_MS / 1000}s 内没有返回`)
    }
    throw new TBError(
      'unavailable',
      error instanceof Error ? `Statamic 请求失败: ${error.message}` : 'Statamic 请求失败',
      { retryable: true },
    )
  }

  let payload: unknown = {}
  if (text.trim() !== '') {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      throw new TBError('unavailable', 'Statamic 返回了非法 JSON', { retryable: true })
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TBError('unavailable', 'Statamic 返回的不是 JSON 对象', { retryable: true })
  }
  return payload as Json
}

/** 归一到固定五键;`raw` 保留原始对象,因为这五键只覆盖了当前稳定的那部分字段。 */
function normalizeSite(value: unknown): Json {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TBError('unavailable', 'Statamic 响应里没有站点数据', { retryable: true })
  }
  const site = value as Json
  const domains = site.domains
  if (domains !== undefined && !Array.isArray(domains)) {
    throw new TBError('unavailable', 'Statamic 响应的 domains 字段不是数组', { retryable: true })
  }
  return {
    name: nonEmpty(typeof site.name === 'string' ? site.name : undefined) ?? '',
    key: nonEmpty(typeof site.key === 'string' ? site.key : undefined) ?? '',
    domains: domains === undefined ? [] : domains.filter(item => typeof item === 'string'),
    createdAt: nonEmpty(typeof site.created_at === 'string' ? site.created_at : undefined) ?? null,
    raw: site,
  }
}

/** `domain` 与 `domains` 是两条互斥写法;两个都给时 Statamic 的行为不确定,故在本地挡下。 */
function assertDomainChoice(input: { domain?: string, domains?: string[] }): void {
  if (input.domain !== undefined && input.domains !== undefined) {
    throw new TBError('invalid_argument', 'domain 与 domains 只能给一个')
  }
}

function siteBody(input: { domain?: string, domains?: string[], name?: string }): Json {
  const body: Json = {}
  if (nonEmpty(input.name) !== undefined) body.name = nonEmpty(input.name)
  if (nonEmpty(input.domain) !== undefined) body.domain = nonEmpty(input.domain)
  if (input.domains !== undefined) body.domains = input.domains
  return body
}

export async function listSites(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { path: '/sites', method: 'GET' })
  const data = payload.data
  return { sites: Array.isArray(data) ? data.map(normalizeSite) : [] }
}

export async function createSite(
  input: z.infer<typeof createSiteInput>,
  ctx: ProviderContext,
): Promise<Json> {
  assertDomainChoice(input)
  const payload = await request(ctx, { path: '/sites', method: 'POST', body: siteBody(input) })
  return { site: normalizeSite(payload.data) }
}

export async function updateSite(
  input: z.infer<typeof updateSiteInput>,
  ctx: ProviderContext,
): Promise<Json> {
  assertDomainChoice(input)
  // 更新至少要改点什么,否则打上游只是白费一次调用。
  if (input.name === undefined && input.domain === undefined && input.domains === undefined) {
    throw new TBError('invalid_argument', 'name、domain、domains 至少要给一个')
  }
  const payload = await request(ctx, {
    path: `/sites/${encodeURIComponent(input.key)}`,
    method: 'PATCH',
    body: siteBody(input),
  })
  return { site: normalizeSite(payload.data) }
}

export async function deleteSite(
  input: z.infer<typeof deleteSiteInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // schema 里 key 被生成成 optional(上游 action 定义如此),但没它拼不出路径。
  const key = nonEmpty(input.key)
  if (key === undefined) throw new TBError('invalid_argument', 'key 不能为空')
  const payload = await request(ctx, {
    path: `/sites/${encodeURIComponent(key)}`,
    method: 'DELETE',
  })
  return {
    message: nonEmpty(typeof payload.message === 'string' ? payload.message : undefined)
      ?? 'Site deleted.',
  }
}
