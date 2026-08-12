/**
 * Meituan(美团旅行)的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/meituan/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 这个 provider 的形状由两件事决定:
 * - 上游是**自然语言问答**式的单端点,HTTP 200 只代表"请求到达",真正的成败看响应体里的
 *   业务码 `code`,失败信息藏在 `msg`/`data`。故错误归一要同时看 HTTP 状态和业务码。
 * - 上游把认证失败**混在 200 的正文里**回(中文提示,如"鉴权失败"),没有稳定错误码可依,
 *   只能靠短语匹配。这不优雅,但照搬上游是唯一能保住语义的做法。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { queryTravelInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'meituan'
const ENDPOINT = 'https://mcp-open-cater.meituan.com/v1/api/voyage/openapi/query'
const CHANNEL = 'meituan-developer'
const DEFAULT_CITY = '北京'

/**
 * 上游自带的 120s 上限,保留。action description 对调用方承诺"可能要两分钟",
 * 这个界就是那句承诺的实现;没有它,上游挂住时插件会跟着无限期挂住。
 * 调用方的 signal 不在这里:当前 ProviderContext 不透传它。
 */
const REQUEST_TIMEOUT_MS = 120_000

/**
 * 上游判定"认证失败"的短语表。全部小写,匹配前把待测串一并小写化 ——
 * 中文短语不受大小写影响,英文短语才需要。
 */
const AUTH_ERROR_PHRASES = [
  '鉴权失败',
  '无效的访问令牌',
  'access token',
  'authorization failed',
  'unauthorized',
  'token无效',
  '访问令牌已过期',
]

/** 上游 `optionalString` 的语义:非字符串、或去空白后为空,都算"没给"。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `optionalRecord` 的语义:数组和 null 都不算 record。 */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function isAuthErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return AUTH_ERROR_PHRASES.some(phrase => normalized.includes(phrase))
}

function hasAuthError(payload: unknown): boolean {
  if (typeof payload === 'string') return isAuthErrorMessage(payload)
  const body = record(payload)
  return [text(body?.msg), text(body?.data)].some(
    message => message !== undefined && isAuthErrorMessage(message),
  )
}

/** 错误消息:上游把它放在 `msg`,拿不到再退 `data`,再退状态码描述。 */
function errorMessage(statusOrCode: number | undefined, payload: unknown): string {
  const fromPayload = typeof payload === 'string'
    ? text(payload)
    : text(record(payload)?.msg) ?? text(record(payload)?.data)
  if (fromPayload !== undefined) return fromPayload
  return statusOrCode === undefined
    ? 'Meituan Travel 请求失败'
    : `Meituan Travel 请求失败,code ${statusOrCode}`
}

/**
 * HTTP 状态**或**业务码 → 归一化状态,照搬上游 `createMeituanError` 的分支与**顺序**。
 *
 * 两处反直觉的地方是上游的既有取舍,不是笔误,故原样保留:
 * - 403 与业务码 4 落到 502(即 `unavailable` 可重试),而不是 permission_denied ——
 *   上游认为这是它自己的限流/风控抖动,值得重试,不是调用方凭证不对。
 * - 403 分支排在认证短语判定**之前**,所以正文里带"鉴权失败"的 403 也走 502。
 * 业务码 509 / 50200 是上游自有的限流码,与 HTTP 429 同义。
 */
function normalizedStatus(statusOrCode: number | undefined, payload: unknown): number {
  if (statusOrCode === 429 || statusOrCode === 509 || statusOrCode === 50200) return 429
  if (statusOrCode === 403 || statusOrCode === 4) return 502
  if (statusOrCode === 401 || hasAuthError(payload)) return 401
  return 502
}

function meituanError(statusOrCode: number | undefined, payload: unknown): TBError {
  return upstreamError(normalizedStatus(statusOrCode, payload), errorMessage(statusOrCode, payload))
}

/** 空体按 null 处理(交给业务码分支去报错),非法 JSON 直接判上游故障。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw upstreamError(502, 'Meituan Travel 返回了非法 JSON')
  }
}

/**
 * 本 action 的输出字段恰好叫 `content`,与 `ToolResult` 的信封键**同名**,于是撞上了
 * `toToolResult`(core/operation/registry.ts)的判定:它认为"对象里有 content 就已经是
 * ToolResult",直接原样透传、不再包一层。结果 `result.content` 会变成那段 markdown 字符串,
 * 而不是 outputSchema 声明的 `{content: string}` 对象 —— 与其他所有 provider 的约定相反,
 * 且 outputSchema 只声明不校验,这个偏差不会有任何东西报错。
 *
 * 故这里**自己把信封搭好**(这是 `toToolResult` 明确支持的路径:已是结果形状就透传),
 * 让 wire 上的形状与声明的 outputSchema 一致。若日后平台在 core 里统一修掉这个碰撞,
 * 这里会变成双层包裹 —— `test/providers/meituan.test.ts` 断言的是精确形状,会红,不会静默。
 */
function toolResult(output: { content: string }): { content: { content: string } } {
  return { content: output }
}

function parsePayload(payload: unknown): { content: string } {
  const body = record(payload)
  const code = typeof body?.code === 'number' ? body.code : undefined
  // `code` 缺失时也走这里:上游要求成功响应必须显式带 `code: 0`,没有就不认。
  if (code !== 0) throw meituanError(code, payload)

  const content = text(body?.data)
  if (content === undefined) {
    throw new TBError('unavailable', 'Meituan Travel 的成功响应里没有正文', { retryable: true })
  }
  // code=0 但正文是认证失败提示:上游在这条路径上判 502 而非 401(与上面 401 分支不同),
  // 因为"声称成功却回鉴权错误"是上游自相矛盾,重试可能恢复。
  if (isAuthErrorMessage(content)) {
    throw new TBError('unavailable', content, { retryable: true })
  }

  return { content }
}

export async function queryTravel(
  input: z.infer<typeof queryTravelInput>,
  ctx: ProviderContext,
): Promise<{ content: { content: string } }> {
  // schema 的 `.min(1)` 拦不住纯空白;上游会把它 trim 成空串再判必填,这里对齐。
  const query = text(input.query)
  if (query === undefined) throw new TBError('invalid_argument', 'query 不能只有空白')
  const city = text(input.city) ?? DEFAULT_CITY
  const originQuery = text(input.originQuery) ?? query

  const apiKey = requireApiKey(ctx, SERVICE)
  // 留住 signal 本体,靠 `signal.aborted` 而非错误名判超时:宿主(Node/Workers)对
  // 中断错误的命名并不一致,问信号自己才是稳的。
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)

  // 请求与**读体**一起裹在 try 里(上游也是):120s 的超时可能落在正文传输途中,
  // 那时 fetch 已经 resolve、断的是 body 流。只裹 fetch 的话这类中断会漏成 internal 500。
  try {
    const response = await guardedFetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'authorization': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ city, query, originQuery, channel: CHANNEL }),
      signal,
    })

    const payload = await readPayload(response)
    if (!response.ok) throw meituanError(response.status, payload)
    return toolResult(parsePayload(payload))
  } catch (error) {
    // 已归一的错误原样上抛,别被下面的兜底改写成 unavailable(上游同样先认自己的错误类型)。
    if (error instanceof TBError) throw error
    if (signal.aborted) {
      throw new TBError(
        'unavailable',
        `Meituan Travel 请求超过 ${REQUEST_TIMEOUT_MS / 1000}s 未返回`,
        { retryable: true },
      )
    }
    throw new TBError(
      'unavailable',
      error instanceof Error ? `Meituan Travel 请求失败: ${error.message}` : 'Meituan Travel 请求失败',
      { retryable: true },
    )
  }
}
