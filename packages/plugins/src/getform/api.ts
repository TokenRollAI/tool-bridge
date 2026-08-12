/**
 * Getform(Forminit protected-mode API)的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/getform/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 三个上游特点决定了这里的形状:
 * - **两个不同的 host**:提交走 `forminit.com/f/<formId>`,读取走 `api.forminit.com/v1/...`。
 * - 凭证走 `x-api-key` 头。
 * - Forminit 会在 **HTTP 200 上回 `{success:false}`** 表示失败,故成功路径也要检查这个字段;
 *   同时错误体里的 `code`/`statusCode` 可能与 HTTP 状态不一致,以体内的为准(上游
 *   `normalizeGetformErrorStatus` 的语义)。
 *
 * 上游错误映射带一个 `phase` 轴,并把 401 在非 execute 相压成 400 —— 迁移后不保留,
 * 状态交给 `upstreamError` 统一归一。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { listSubmissionsInput, submitFormInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'getform'
const SUBMIT_BASE = 'https://forminit.com'
const API_BASE = 'https://api.forminit.com'
const API_PATH = '/v1'

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

/**
 * Forminit 的错误状态以**响应体里的 `code`/`statusCode`** 为准:它的边缘层会用 200 或 502
 * 包住一个体内标着 401 的错误,只看 HTTP 状态会把凭证问题归错类。
 */
function errorStatus(status: number, body: Json | undefined): number {
  for (const candidate of [body?.code, body?.statusCode]) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 400) return candidate
  }
  return status >= 400 ? status : 502
}

function errorMessage(body: Json | undefined, status: number): string {
  const message = text(body?.message) ?? text(body?.error)
  if (message !== undefined) return message
  switch (status) {
    case 400: return 'getform request is invalid'
    case 401: return 'getform api key is missing or invalid'
    case 403: return 'getform request is forbidden'
    case 404: return 'getform resource not found'
    case 429: return 'getform rate limit exceeded'
    default: return 'getform request failed'
  }
}

function getformError(status: number, payload: unknown): TBError {
  const body = record(payload)
  const normalized = errorStatus(status, body)
  return upstreamError(normalized, errorMessage(body, normalized))
}

interface RequestInput {
  body?: Json
  method: 'GET' | 'POST'
}

async function request(ctx: ProviderContext, url: string, input: RequestInput): Promise<unknown> {
  const headers: Record<string, string> = {
    'accept': 'application/json',
    'x-api-key': requireApiKey(ctx, SERVICE),
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  const response = await guardedFetch(url, {
    method: input.method,
    headers,
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  })

  const raw = await response.text().catch(() => '')
  if (!response.ok) {
    let payload: unknown
    if (raw.trim() !== '') {
      try {
        payload = JSON.parse(raw)
      } catch {
        payload = raw
      }
    }
    throw getformError(response.status, payload)
  }

  if (raw.trim() === '') throw upstreamError(502, 'empty getform response')
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    throw upstreamError(502, 'invalid getform JSON response')
  }

  // Forminit 用 200 + `{success:false}` 表示失败,不看这个字段就会把失败当成功透出去。
  if (record(payload)?.success === false) throw getformError(response.status, payload)
  return payload
}

/**
 * formId / blocks 在生成的 schema 里都是 optional —— 上游 `s.object` 只在有显式 optional
 * 字段时才产 required 列表,这个洞被等价地搬了过来。缺失时挡在拼 URL/请求体之前。
 */
function requireFormId(value: string | undefined): string {
  const formId = text(value)
  if (formId === undefined) throw new TBError('invalid_argument', 'formId is required')
  return formId
}

export async function submitForm(
  input: z.infer<typeof submitFormInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  // 上游还手写了 `assertNoFileBlocks`(拒绝 `type:'file'` 的块);这里不重写:三个 block
  // 变体都是 strictObject,`file` 不在任何一个的 type 取值里,envelope 在 handler 之前就拒了。
  const formId = requireFormId(input.formId)
  return request(ctx, new URL(`/f/${encodeURIComponent(formId)}`, SUBMIT_BASE).toString(), {
    method: 'POST',
    body: { blocks: input.blocks },
  })
}

export async function listSubmissions(
  input: z.infer<typeof listSubmissionsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const formId = requireFormId(input.formId)
  const url = new URL(`${API_PATH}/forms/${encodeURIComponent(formId)}`, API_BASE)
  if (input.page !== undefined) url.searchParams.set('page', String(input.page))
  if (input.size !== undefined) url.searchParams.set('size', String(input.size))

  const query = text(input.query)
  if (query !== undefined) url.searchParams.set('query', query)
  // files 的 `false` 是"显式不要文件元数据",与"没给"不同,故用 undefined 判断而非 falsy。
  if (input.files !== undefined) url.searchParams.set('files', input.files ? 'true' : 'false')

  const timezone = text(input.timezone)
  if (timezone !== undefined) url.searchParams.set('timezone', timezone)

  return request(ctx, url.toString(), { method: 'GET' })
}
