/**
 * Kernel 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/kernel/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Kernel 的两个特点决定了这里的形状:
 * - 分页信息在**响应头**里(`x-limit`/`x-offset`/`x-has-more`/`x-next-offset`),不在 body,
 *   故 list 结果要把头解析出来单独拼进 `pagination`。
 * - list 的 tag 过滤器是 `tags[key]=value` 形式的**动态 query 键**,不是一个 JSON 值。
 *
 * 与上游的有意偏离:上游 `createKernelError` 把 403 压成 401、把其余 4xx 全压成 400;
 * 这里把原始状态原样交给 `upstreamError` 统一归一(403 仍是 permission_denied、404 仍是
 * not_found)—— 收敛各 provider 互不相同的错误口径正是 `_runtime/upstreamError.ts` 的理由。
 *
 * 一处 schema 与上游行为对不上的地方:`delete_browser_session` 的 `id_or_name` 在上游
 * action 定义里是 **optional**,但 executor 无条件把它拼进路径(`String(undefined)` 会
 * 打出 `/browsers/undefined`)。schema 是生成的、不改,故这里保留运行时校验。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createBrowserSessionInput,
  deleteBrowserSessionInput,
  getBrowserSessionInput,
  listBrowserSessionsInput,
  updateBrowserSessionInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'kernel'
const API_BASE = 'https://api.onkernel.com'
const REQUEST_TIMEOUT_MS = 60_000

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

/** `tags: {a: '1'}` → `tags[a]=1`;非字符串的值跳过(Kernel 的 query 只吃标量)。 */
function tagsQuery(tags: Record<string, string> | undefined): Json {
  if (tags === undefined) return {}
  const query: Json = {}
  for (const [key, value] of Object.entries(tags)) {
    if (typeof value === 'string') query[`tags[${key}]`] = value
  }
  return query
}

function buildUrl(path: string, query: Json): string {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/** 分页取自响应头;缺头时按 0 兜底(与上游一致,不把缺失说成"没有下一页之外的信息")。 */
function readPagination(headers: Headers): Json {
  const readInt = (name: string): number | undefined => {
    const value = headers.get(name)
    if (value === null || value === '') return undefined
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return {
    limit: readInt('x-limit') ?? 0,
    offset: readInt('x-offset') ?? 0,
    has_more: headers.get('x-has-more') === 'true',
    next_offset: readInt('x-next-offset') ?? 0,
  }
}

/** 错误消息可能藏在 `details` 数组、`details` 对象或 `inner_error` 里,逐层往下找。 */
function errorMessage(payload: unknown): string | undefined {
  const body = record(payload)
  if (body === undefined) return undefined
  const direct = text(body.message) ?? text(body.error)
  if (direct !== undefined) return direct
  if (Array.isArray(body.details)) {
    return body.details.map(item => errorMessage(item)).find((value): value is string => value !== undefined)
  }
  const details = record(body.details)
  if (details !== undefined) return errorMessage(details)
  const inner = record(body.inner_error)
  if (inner !== undefined) return errorMessage(inner)
  return undefined
}

/** 非 2xx 且解不出 JSON 时把原文塞进 `{message}`,留给消息提取。 */
async function readErrorPayload(response: Response): Promise<unknown> {
  const body = (await response.text().catch(() => '')).trim()
  if (body === '') return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    return { message: body }
  }
}

/** delete 成功时回空体,故空体不算解析失败。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body.trim() === '') return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw upstreamError(502, 'Kernel returned invalid JSON')
  }
}

interface RequestInput {
  body?: Json
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST'
  path: string
  query?: Json
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<{ pagination: Json, payload: unknown }> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await guardedFetch(buildUrl(input.path, input.query ?? {}), {
      method: input.method,
      headers,
      // 上游给了 60s 的独立预算:创建浏览器会话本来就慢,但不设上限会让一次挂死的调用
      // 永远占着连接。
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw upstreamError(504, 'Kernel request timed out')
    }
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    throw upstreamError(502, error instanceof Error ? `Kernel request failed: ${error.message}` : 'Kernel request failed')
  }

  if (!response.ok) {
    const payload = await readErrorPayload(response)
    throw upstreamError(response.status, errorMessage(payload) ?? `Kernel request failed with status ${response.status}`)
  }
  return { payload: await readPayload(response), pagination: readPagination(response.headers) }
}

export async function listBrowserSessions(
  input: z.infer<typeof listBrowserSessionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const result = await request(ctx, {
    method: 'GET',
    path: '/browsers',
    query: {
      status: input.status,
      limit: input.limit,
      offset: input.offset,
      query: input.query,
      ...tagsQuery(input.tags),
    },
  })
  return { browser_sessions: result.payload, pagination: result.pagination }
}

export async function createBrowserSession(
  input: z.infer<typeof createBrowserSessionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const result = await request(ctx, { method: 'POST', path: '/browsers', body: input })
  return { browser_session: result.payload }
}

export async function getBrowserSession(
  input: z.infer<typeof getBrowserSessionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const result = await request(ctx, {
    method: 'GET',
    path: `/browsers/${encodeURIComponent(input.id_or_name)}`,
    query: { include_deleted: input.include_deleted },
  })
  return { browser_session: result.payload }
}

export async function updateBrowserSession(
  input: z.infer<typeof updateBrowserSessionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 路径参数不该再出现在 body 里。
  const { id_or_name: idOrName, ...body } = input
  const result = await request(ctx, {
    method: 'PATCH',
    path: `/browsers/${encodeURIComponent(idOrName)}`,
    body,
  })
  return { browser_session: result.payload }
}

export async function deleteBrowserSession(
  input: z.infer<typeof deleteBrowserSessionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const idOrName = text(input.id_or_name)
  if (idOrName === undefined) throw new TBError('invalid_argument', 'id_or_name is required')
  await request(ctx, { method: 'DELETE', path: `/browsers/${encodeURIComponent(idOrName)}` })
  // Kernel 的 delete 回空体,故成功与否只由状态码决定,结果由本地合成。
  return { deleted: true }
}
