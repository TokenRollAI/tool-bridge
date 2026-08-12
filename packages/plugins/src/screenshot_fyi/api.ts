/**
 * screenshot.fyi 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/screenshot_fyi/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * screenshot.fyi 的两个特点决定了这里的形状:
 * - 凭证走 **query 参数 `accessKey`** 而非 header —— 上游 API 就这么设计的,不是迁移取舍。
 *   代价是凭证会进 URL(进而可能进日志),但换成 header 上游直接 401,没有选择余地。
 * - 截图是**同步渲染**:一次调用要等目标页面加载完。上游为此单独设了 30s 超时,这里保留 ——
 *   没有它,一次挂死的渲染会把网关这一路请求一起拖到底层连接自己断开为止。
 */

import type { z } from 'zod/v4'
import type { takeScreenshotInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'screenshot_fyi'
const API_BASE = 'https://www.screenshot.fyi'
const CAPTURE_PATH = '/api/take'
const REQUEST_TIMEOUT_MS = 30_000

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** 非空字符串(取 trim 后的值);上游 `optionalString` 的等价物。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * 上游错误体把消息分放两处:顶层 `error` 与 `details[0].message`。两者都在时拼起来 ——
 * 顶层往往只是分类("Invalid request"),真正说清哪个参数不对的那句在 details 里。
 * 错误体偶尔直接是一个字符串(边缘层返回),故先认这一种。
 */
function errorMessage(payload: unknown, status: number): string {
  const direct = text(payload)
  if (direct !== undefined) return direct

  const record = toRecord(payload)
  const top = text(record?.error)
  const detail = Array.isArray(record?.details) ? text(toRecord(record.details[0])?.message) : undefined
  if (top !== undefined && detail !== undefined) return `${top}: ${detail}`
  return top ?? detail ?? `screenshot.fyi 返回 HTTP ${status}`
}

/** 空体读成 null 而非报错:上游成功/失败两条路都可能回空体,由各自的调用点判定缺什么。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw upstreamError(502, 'screenshot.fyi 返回了非 JSON 响应')
  }
}

function buildQuery(input: z.infer<typeof takeScreenshotInput>): Record<string, string> {
  const query: Record<string, string> = { url: input.url }
  if (input.width !== undefined) query.width = String(input.width)
  if (input.height !== undefined) query.height = String(input.height)
  if (input.fullPage !== undefined) query.fullPage = String(input.fullPage)
  if (input.darkMode !== undefined) query.darkMode = String(input.darkMode)
  if (input.disableCookieBanners !== undefined) query.disableCookieBanners = String(input.disableCookieBanners)
  return query
}

async function capture(url: URL): Promise<Response> {
  try {
    return await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    // 只归一超时。出站策略拦截(EgressBlockedError)等是**永久**拒绝,归到这里会被
    // 标成 retryable,让调用方对着一个不会变的结果重试。故其余原样上抛。
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, `screenshot.fyi ${REQUEST_TIMEOUT_MS / 1000}s 内没有返回截图`)
    }
    throw error
  }
}

export async function takeScreenshot(
  input: z.infer<typeof takeScreenshotInput>,
  ctx: ProviderContext,
): Promise<{ url: string }> {
  const target = new URL(CAPTURE_PATH, API_BASE)
  target.searchParams.set('accessKey', requireApiKey(ctx, SERVICE))
  for (const [key, value] of Object.entries(buildQuery(input))) {
    target.searchParams.set(key, value)
  }

  const response = await capture(target)
  const payload = await readPayload(response)
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))

  const screenshotUrl = text(toRecord(payload)?.url)
  if (screenshotUrl === undefined) {
    // 上游说成功了却没给截图地址:契约破了,不是调用方的错。
    throw upstreamError(502, 'screenshot.fyi 的成功响应里没有截图 url')
  }
  return { url: screenshotUrl }
}
