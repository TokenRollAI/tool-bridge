/**
 * Coresignal 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/coresignal/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Coresignal 的凭证走 `apikey` 头(不是 Bearer),search / preview 都是 **POST + JSON 过滤器**,
 * 唯独 preview 的 `page` 走 query —— 它与过滤器同在一个入参对象里,拆分只能在这里做。
 */

import type { z } from 'zod/v4'
import type {
  collectBaseCompanyInput,
  previewBaseCompaniesInput,
  searchBaseCompaniesInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'coresignal'
const API_BASE = 'https://api.coresignal.com/cdapi/v2'

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function errorMessage(payload: unknown): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  const body = record(payload)
  if (body === undefined) return 'coresignal request failed'
  const errors = Array.isArray(body.errors) ? body.errors : []
  return text(body.message) ?? text(body.error) ?? text(body.detail) ?? text(errors[0]) ?? 'coresignal request failed'
}

/** 错误体解析不出 JSON 时,把原文包成 `{message}` 交给消息提取(与上游一致)。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body === '') return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    if (response.ok) throw upstreamError(502, 'coresignal returned malformed JSON')
    return { message: body }
  }
}

async function request(ctx: ProviderContext, url: URL, method: 'GET' | 'POST', body?: Json): Promise<unknown> {
  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method,
      // 上游对 GET 也发 content-type;照搬以免改动请求指纹。
      headers: {
        'accept': 'application/json',
        'apikey': requireApiKey(ctx, SERVICE),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown transport error'
    throw upstreamError(502, `coresignal request failed: ${message}`)
  }

  const payload = await readPayload(response)
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload))
  return payload
}

/** 搜索只回 ID 数组;出现非正整数说明上游契约破了,不是调用方的错。 */
function companyId(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  throw upstreamError(502, 'coresignal search returned an invalid company ID')
}

export async function searchBaseCompanies(
  input: z.infer<typeof searchBaseCompaniesInput>,
  ctx: ProviderContext,
): Promise<{ ids: number[] }> {
  const url = new URL(`${API_BASE}/company_base/search/filter`)
  const payload = await request(ctx, url, 'POST', input)
  if (!Array.isArray(payload)) throw upstreamError(502, 'coresignal search returned an invalid payload')
  return { ids: payload.map(item => companyId(item)) }
}

export async function previewBaseCompanies(
  input: z.infer<typeof previewBaseCompaniesInput>,
  ctx: ProviderContext,
): Promise<{ records: unknown[] }> {
  const url = new URL(`${API_BASE}/company_base/search/filter/preview`)
  const { page, ...filters } = input
  if (page !== undefined) url.searchParams.set('page', String(page))

  const payload = await request(ctx, url, 'POST', filters)
  if (!Array.isArray(payload)) throw upstreamError(502, 'coresignal preview returned an invalid payload')
  return { records: payload }
}

export async function collectBaseCompany(
  input: z.infer<typeof collectBaseCompanyInput>,
  ctx: ProviderContext,
): Promise<{ company: Json }> {
  const identifier = encodeURIComponent(String(input.companyIdentifier))
  const url = new URL(`${API_BASE}/company_base/collect/${identifier}`)
  // fields 重复同名键,不压成逗号串 —— Coresignal 的字段选择就是这个约定。
  for (const field of input.fields ?? []) url.searchParams.append('fields', field)

  const payload = await request(ctx, url, 'GET')
  const company = record(payload)
  if (company === undefined) throw upstreamError(502, 'coresignal collect returned an invalid payload')
  return { company }
}
