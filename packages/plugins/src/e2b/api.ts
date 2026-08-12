/**
 * E2B 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/e2b/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。凭证走 `x-api-key` 请求头,不进 URL。
 *
 * 四处上游细节决定了这里的形状:
 * - **两套路径前缀并存**:列表打 `/v2/sandboxes`,创建/查询/删除打 `/sandboxes`。
 *   不是笔误,是 E2B 只把 list 迁到了 v2;统一成一个前缀会 404。
 * - **列表端点直接回一个裸数组**,不是 `{sandboxes:[...]}`。出参 schema 要的是后者,
 *   故这层负责包一次;上游回的不是数组就是契约破了,归 unavailable。
 * - `state` 这个数组 query **逗号拼成一个值**(`state=running,paused`),不是重复同名参数 ——
 *   E2B 只认前者。
 * - DELETE 成功是 204 空 body,出参 schema 却要 `{sandboxID, success}`,由这层合成。
 *
 * 两处 schema 与 executor 的落差(上游就是这样,照搬):
 * - `get_sandbox` / `delete_sandbox` 的 `sandboxID` 在 action 声明里是**可选**的,但 executor
 *   用 `requiredString` 硬断言。schema 忠实反映上游,必填断言留在这里,抛 invalid_argument。
 * - 上游 `notFoundAsInvalidInput` 这个开关实际是**死代码**(命中分支与兜底分支都返回 404),
 *   故不迁;404 由公共 `upstreamError` 归成 not_found。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createSandboxInput,
  deleteSandboxInput,
  getSandboxInput,
  listSandboxesInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'e2b'
const API_BASE = 'https://api.e2b.app'
/** 照搬上游的 30s 单请求上限:沙箱创建偶尔很慢,但挂死比失败更糟。 */
const REQUEST_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | string[] | undefined

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 丢掉值为 undefined 的键(上游 `compactObject`);`null` 要留住(`mcp: null` 有语义)。 */
function compact<T>(input: Record<string, T | undefined>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Record<string, T>
}

/** 上游 `requiredString`:schema 把这些字段声明成可选,但 executor 断言必填。 */
function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} is required.`)
  return result
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错。 */
function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw upstreamError(502, `${label} was not an object`)
  return result
}

/** 上游 `optionalStringArray`:逐项丢空,全空则整个参数不发。 */
function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string' && item !== '')
  return items.length > 0 ? items : undefined
}

/** E2B 的错误文案:纯文本 body 直接用,JSON 则依次看 message / error / detail。 */
function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    if (trimmed !== '') return trimmed
  }
  const body = record(payload)
  return text(body?.message) ?? text(body?.error) ?? text(body?.detail)
    ?? `E2B request failed with status ${status}`
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue
    // 数组 query 拼成一个逗号串:E2B 不认重复的同名参数。
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }
  return url.toString()
}

interface RequestOptions {
  body?: Json
  /** 204 或空 body 时的返回值(上游 `emptySuccess`)。 */
  emptySuccess?: unknown
  method?: 'DELETE' | 'GET' | 'POST'
  path: string
  query?: Record<string, QueryValue>
}

async function request(ctx: ProviderContext, options: RequestOptions): Promise<unknown> {
  const headers: Record<string, string> = {
    'accept': 'application/json',
    'x-api-key': requireApiKey(ctx, SERVICE),
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await guardedFetch(buildUrl(options.path, options.query), {
      method: options.method ?? 'GET',
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch (error) {
    // guardedFetch 拦下的出站(EgressBlockedError)已经是 TBError,原样冒上去。
    if (error instanceof TBError) throw error
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, `E2B ${REQUEST_TIMEOUT_MS / 1000}s 内没有返回`)
    }
    throw upstreamError(502, error instanceof Error ? `E2B request failed: ${error.message}` : 'E2B request failed')
  }

  const raw = response.status === 204 ? '' : await response.text().catch(() => '')
  let payload: unknown = raw === '' ? (options.emptySuccess ?? null) : null
  if (raw !== '') {
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      // 错误响应回 HTML 错误页很常见,那时原始文本就是最好的消息;2xx 回非 JSON 只能是上游坏了。
      if (!response.ok) payload = raw
      else throw upstreamError(502, 'E2B returned invalid JSON')
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return payload
}

/** 列表端点回裸数组;出参 schema 要 `{sandboxes}`,故这层包一次并逐项校形。 */
async function requestSandboxArray(ctx: ProviderContext, options: RequestOptions): Promise<Json[]> {
  const payload = await request(ctx, options)
  if (!Array.isArray(payload)) throw upstreamError(502, 'E2B returned a non-array sandboxes payload')
  return payload.map(sandbox => requireRecord(sandbox, 'E2B sandbox'))
}

export async function createSandbox(
  input: z.infer<typeof createSandboxInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    // 创建走的是 v1 路径,不是列表那个 /v2/sandboxes。
    path: '/sandboxes',
    method: 'POST',
    body: compact({
      templateID: requireText(input.templateID, 'templateID'),
      timeout: input.timeout,
      autoPause: input.autoPause,
      autoPauseMemory: input.autoPauseMemory,
      autoResume: input.autoResume,
      secure: input.secure,
      allow_internet_access: input.allow_internet_access,
      network: input.network,
      metadata: input.metadata,
      envVars: input.envVars,
      // `mcp: null` 是"显式关掉 MCP",与"没给这个字段"不是一回事,故不能被 compact 掉。
      mcp: input.mcp === null ? null : record(input.mcp),
      volumeMounts: input.volumeMounts,
    }),
  })
  return { sandbox: requireRecord(payload, 'E2B create sandbox response') }
}

export async function listSandboxes(
  input: z.infer<typeof listSandboxesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const sandboxes = await requestSandboxArray(ctx, {
    path: '/v2/sandboxes',
    query: compact({
      metadata: text(input.metadata),
      state: stringArray(input.state),
      nextToken: text(input.nextToken),
      limit: input.limit,
    }),
  })
  return { sandboxes }
}

export async function getSandbox(input: z.infer<typeof getSandboxInput>, ctx: ProviderContext): Promise<Json> {
  const sandboxID = requireText(input.sandboxID, 'sandboxID')
  const payload = await request(ctx, { path: `/sandboxes/${encodeURIComponent(sandboxID)}` })
  return { sandbox: requireRecord(payload, 'E2B get sandbox response') }
}

export async function deleteSandbox(
  input: z.infer<typeof deleteSandboxInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const sandboxID = requireText(input.sandboxID, 'sandboxID')
  await request(ctx, {
    path: `/sandboxes/${encodeURIComponent(sandboxID)}`,
    method: 'DELETE',
    // 删除成功是 204 空 body,出参 schema 要的这个形状由本层合成。
    emptySuccess: { sandboxID, success: true },
  })
  return { sandboxID, success: true }
}
