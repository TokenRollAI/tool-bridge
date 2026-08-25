import { TBError } from '@tool-bridge/plugin-sdk'
import { createGuardedFetch, type GuardedFetchOptions } from './guardedFetch'
import { upstreamError } from './upstreamError'

export {
  asJsonObject,
  type JsonObject,
  messageFrom,
  trimmedText as nonEmptyText,
} from './jsonValue'
export type QueryScalar = boolean | number | string
export type QueryValue = QueryScalar | null | undefined | readonly QueryScalar[]
export type ProviderQuery = readonly (readonly [string, QueryValue])[]
export type ResponseType = 'auto' | 'empty' | 'json' | 'text'
export type ResponseBodyKind = 'empty' | 'invalid-json' | 'json' | 'text'

export interface ProviderHttpErrorContext {
  /** 已按 responseType 解析；非 JSON 错误体是字符串，空体是 undefined。 */
  readonly bodyKind: ResponseBodyKind
  readonly data: unknown
  readonly headers: Headers
  /** 需要保留上游非标准错误 envelope 时使用；最终 TBError 仍统一脱敏。 */
  readonly rawText: string | undefined
  readonly status: number
  readonly statusText: string
}

export interface ProviderHttpTransportErrorContext {
  readonly kind: 'network' | 'timeout'
  /** 已去掉 URL 和本次请求中可识别的凭证，不暴露原始 Error。 */
  readonly message: string | undefined
}

export interface ProviderHttpRequest {
  /** 少数端点用非 2xx 表达业务结果（例如 GitHub 404 = false）。 */
  readonly acceptStatuses?: readonly number[]
  /**
   * 动态实例型 provider 的逐请求 base URL。缺省使用 client 级 baseUrl；两处都没给时
   * fail closed。它只改变目标实例，不允许 path 跨 origin。
   */
  readonly baseUrl?: string | URL
  /** 任意 body 的必要逃生口；与 json 互斥。 */
  readonly body?: BodyInit | null
  readonly headers?: HeadersInit
  /** JSON 解析失败时是否把原文本交给 provider；错误响应始终允许自定义钩子读取原文。 */
  readonly invalidJson?: 'error' | 'text'
  readonly invalidJsonMessage?: string
  /** 存在这个键时自动 JSON.stringify，并补 content-type。 */
  readonly json?: unknown
  readonly mapError?: (context: ProviderHttpErrorContext) => TBError
  readonly mapTransportError?: (context: ProviderHttpTransportErrorContext) => TBError
  readonly method?: 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT'
  /** 只能是相对 baseUrl 的路径，防止带凭证的请求意外换 origin。 */
  readonly path: string
  /** 有序 pair；数组值用 append 保留重复 query key。 */
  readonly query?: ProviderQuery
  readonly responseType?: ResponseType
  /** 额外需要从错误中抹掉的值；常规认证头/query 会自动识别。 */
  readonly sensitiveValues?: readonly string[]
  readonly timeoutMs?: number
}

export interface ProviderHttpResult<T = unknown> {
  readonly bodyKind: ResponseBodyKind
  readonly data: T
  readonly headers: Headers
  readonly rawText: string | undefined
  readonly status: number
  readonly statusText: string
}

export interface ProviderHttpClient {
  request<T = unknown>(request: ProviderHttpRequest): Promise<ProviderHttpResult<T>>
}

export interface ProviderHttpClientOptions {
  /** 固定 SaaS provider 的 base URL；动态实例型 provider 可改在每次 request 传。 */
  readonly baseUrl?: string | URL
  readonly crossOriginRedirect?: GuardedFetchOptions['crossOriginRedirect']
  readonly maxRedirects?: number
  readonly sensitiveHeaders?: readonly string[]
  /** 安全、固定的 provider 标签，只用于默认错误，不使用 URL/statusText/body。 */
  readonly service: string
  /** 仅作为 guardedFetch 的底层 transport 注入；不存在绕开出站校验的 request 级 fetch。 */
  readonly transport?: typeof fetch
}

function credentialLike(name: string): boolean {
  return /(?:^|-|_)(?:api[-_]?key|access[-_]?key|key|token|secret|auth(?:entication|orization)?|credentials?|pass(?:word)?|passwd|cookie|signature)(?:$|-|_)/i.test(name)
}

function addSecret(secrets: Set<string>, value: string): void {
  if (value === '') return
  secrets.add(value)
  // 上游/transport 可能回显 URL 编码或 JSON 转义后的请求值；两种形态都必须抹掉。
  try {
    const encoded = encodeURIComponent(value)
    if (encoded !== value) secrets.add(encoded)
  } catch {
    // 非法 surrogate 仍保留原值；JSON.stringify 随后会按既有行为拒绝非法 body。
  }
  const json = JSON.stringify(value)
  const escaped = json.slice(1, -1)
  if (escaped !== value) secrets.add(escaped)
}

function appendQuery(url: URL, query: ProviderQuery | undefined, secrets: Set<string>): void {
  for (const [name, raw] of query ?? []) {
    if (raw === undefined || raw === null) continue
    const values = Array.isArray(raw) ? raw : [raw]
    for (const value of values) {
      const encoded = String(value)
      url.searchParams.append(name, encoded)
      if (credentialLike(name)) addSecret(secrets, encoded)
    }
  }
}

function collectUrlSecrets(url: URL, secrets: Set<string>): void {
  for (const [name, value] of url.searchParams) {
    if (credentialLike(name)) addSecret(secrets, value)
  }
}

function collectHeaderSecrets(
  headers: Headers,
  sensitiveHeaders: ReadonlySet<string>,
  secrets: Set<string>,
): void {
  for (const [name, value] of headers) {
    if (!credentialLike(name) && !sensitiveHeaders.has(name.toLowerCase())) continue
    addSecret(secrets, value)
    const authorization = /^([A-Za-z][A-Za-z0-9._~-]*)\s+(.+)$/.exec(value)
    if (authorization === null) continue
    const scheme = authorization[1] ?? ''
    const payload = authorization[2] ?? ''
    addSecret(secrets, payload)
    if (scheme.toLowerCase() !== 'basic') continue
    try {
      const binary = atob(payload)
      addSecret(secrets, binary)
      const separator = binary.indexOf(':')
      if (separator >= 0) {
        addSecret(secrets, binary.slice(0, separator))
        addSecret(secrets, binary.slice(separator + 1))
      }
      // RFC 7617 实际部署中也常用 UTF-8；同时保存解码后的 Unicode 形态。
      const utf8 = new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
      addSecret(secrets, utf8)
      const utf8Separator = utf8.indexOf(':')
      if (utf8Separator >= 0) {
        addSecret(secrets, utf8.slice(0, utf8Separator))
        addSecret(secrets, utf8.slice(utf8Separator + 1))
      }
    } catch {
      // 非法 Basic payload 已按原始 header/payload 脱敏，不影响请求的既有 wire 行为。
    }
  }
}

function collectJsonSecrets(value: unknown, secrets: Set<string>): void {
  const seen = new Set<object>()
  const pending: Array<{ readonly sensitive: boolean, readonly value: unknown }> = [
    { sensitive: false, value },
  ]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (current.value === null || current.value === undefined) continue
    if (typeof current.value !== 'object') {
      if (current.sensitive) addSecret(secrets, String(current.value))
      continue
    }
    if (seen.has(current.value)) continue
    seen.add(current.value)
    if (Array.isArray(current.value)) {
      for (const item of current.value) pending.push({ sensitive: current.sensitive, value: item })
      continue
    }
    for (const [name, item] of Object.entries(current.value)) {
      pending.push({ sensitive: current.sensitive || credentialLike(name), value: item })
    }
  }
}

function acceptedStatuses(values: readonly number[] | undefined, service: string): ReadonlySet<number> {
  const result = new Set<number>()
  for (const value of values ?? []) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 100 || value > 599) {
      throw new TBError('invalid_argument', `${service} acceptStatuses must contain HTTP status integers from 100 to 599`)
    }
    result.add(value)
  }
  return result
}

interface RequestTimeout {
  readonly cancel: () => void
  readonly race: <T>(operation: Promise<T>) => Promise<T>
  readonly signal: AbortSignal | undefined
}

// Node/浏览器 timer 的可移植上限；更大的值在 Node 会被钳成 1ms，导致请求
// 不是“很久后超时”而是几乎立即失败。
const MAX_TIMEOUT_MS = 2_147_483_647

function requestTimeout(timeoutMs: number | undefined, service: string): RequestTimeout {
  if (timeoutMs === undefined) {
    return { cancel: () => {}, race: operation => operation, signal: undefined }
  }
  if (
    !Number.isFinite(timeoutMs)
    || !Number.isInteger(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new TBError(
      'invalid_argument',
      `${service} timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`,
    )
  }
  let signal: AbortSignal
  try {
    signal = AbortSignal.timeout(timeoutMs)
  } catch {
    throw new TBError('invalid_argument', `${service} timeoutMs is outside the supported range`)
  }
  // Request/clone 对 AbortSignal 的转发在部分 runtime isolate 里并不可靠；直接监听真源并
  // 与 transport 竞争，既能中止真实 fetch，也能保证 timeout 分类不依赖底层抛错形态。
  let onAbort: () => void
  const expired = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException('The operation timed out', 'TimeoutError'))
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  return {
    cancel: () => signal.removeEventListener('abort', onAbort),
    race: operation => Promise.race([operation, expired]),
    signal,
  }
}

function redact(message: string, secrets: ReadonlySet<string>): string {
  let safe = message.replace(/https?:\/\/[^\s)\]}>'"]+/gi, '[redacted-url]')
  for (const secret of secrets) {
    if (secret !== '') safe = safe.replaceAll(secret, '[redacted]')
  }
  return safe.slice(0, 500)
}

function redactError(error: TBError, secrets: ReadonlySet<string>): TBError {
  const message = redact(error.message, secrets)
  if (message === error.message) return error
  return new TBError(error.code, message, {
    httpStatus: error.httpStatus,
    retryable: error.retryable,
  })
}

async function readResponse(
  response: Response,
  responseType: ResponseType,
  invalidJson: 'error' | 'text',
  service: string,
  invalidJsonMessage: string | undefined,
): Promise<{ bodyKind: ResponseBodyKind, data: unknown, rawText: string | undefined }> {
  if (responseType === 'empty' || response.status === 204 || response.status === 205) {
    return { bodyKind: 'empty', data: undefined, rawText: undefined }
  }

  let raw: string
  try {
    raw = await response.text()
  } catch {
    if (!response.ok) return { bodyKind: 'empty', data: undefined, rawText: undefined }
    throw upstreamError(502, `${service} returned an unreadable response`)
  }
  if (raw === '') return { bodyKind: 'empty', data: undefined, rawText: undefined }
  if (responseType === 'json' && raw.trim() === '') return { bodyKind: 'empty', data: undefined, rawText: raw }
  if (responseType === 'text') return { bodyKind: 'text', data: raw, rawText: raw }
  if (responseType === 'auto' && !response.headers.get('content-type')?.toLowerCase().includes('json')) {
    return { bodyKind: 'text', data: raw, rawText: raw }
  }
  try {
    return { bodyKind: 'json', data: JSON.parse(raw) as unknown, rawText: raw }
  } catch {
    if (!response.ok || invalidJson === 'text') return { bodyKind: 'invalid-json', data: raw, rawText: raw }
    throw upstreamError(502, invalidJsonMessage ?? `${service} returned an invalid JSON response`)
  }
}

/**
 * provider 中立 HTTP 薄层：请求只执行一次（retry=0），重定向完全由 guardedFetch 逐跳处理。
 * 它不接收 request 级 fetch，也不直接调用 global fetch，测试 transport 仍必须经过 guardedFetch。
 */
export function createProviderHttpClient(options: ProviderHttpClientOptions): ProviderHttpClient {
  let fixedBaseUrl: URL | undefined
  if (options.baseUrl !== undefined) {
    try {
      fixedBaseUrl = new URL(options.baseUrl)
    } catch {
      throw new TBError('invalid_argument', `${options.service} baseUrl must be a valid absolute URL`)
    }
  }
  const guardedFetch = createGuardedFetch({
    crossOriginRedirect: options.crossOriginRedirect ?? 'error',
    fetch: options.transport,
    maxRedirects: options.maxRedirects,
    sensitiveHeaders: options.sensitiveHeaders,
  })
  const sensitiveHeaders = new Set(
    (options.sensitiveHeaders ?? []).map(name => name.toLowerCase()),
  )

  return {
    async request<T = unknown>(request: ProviderHttpRequest): Promise<ProviderHttpResult<T>> {
      const hasJson = Object.hasOwn(request, 'json')
      const hasBody = Object.hasOwn(request, 'body')
      if (hasJson && hasBody) {
        throw new TBError('invalid_argument', `${options.service} request cannot contain both json and body`)
      }
      const accepted = acceptedStatuses(request.acceptStatuses, options.service)

      let baseUrl = fixedBaseUrl
      if (request.baseUrl !== undefined) {
        try {
          baseUrl = new URL(request.baseUrl)
        } catch {
          throw new TBError('invalid_argument', `${options.service} baseUrl must be a valid absolute URL`)
        }
      }
      if (baseUrl === undefined) {
        throw new TBError('invalid_argument', `${options.service} request requires a baseUrl`)
      }

      const url = new URL(request.path.replace(/^\/+/, ''), baseUrl)
      if (url.origin !== baseUrl.origin) {
        throw new TBError('invalid_argument', `${options.service} request path must stay on the configured origin`)
      }

      const secrets = new Set(request.sensitiveValues ?? [])
      for (const secret of [...secrets]) addSecret(secrets, secret)
      // same-origin 绝对 path 可能自带 query（如上游 self 链接）；同样纳入凭证脱敏。
      collectUrlSecrets(url, secrets)
      appendQuery(url, request.query, secrets)
      const headers = new Headers(request.headers)
      collectHeaderSecrets(headers, sensitiveHeaders, secrets)
      if (hasJson) collectJsonSecrets(request.json, secrets)

      if (hasJson && !headers.has('content-type')) headers.set('content-type', 'application/json')
      const timeout = requestTimeout(request.timeoutMs, options.service)
      const signal = timeout.signal

      // timeout 是整个响应消费的 deadline，而不只是“等到响应头”。部分 transport 会很快
      // resolve Response、随后让 body 永远不结束；只 race guardedFetch 会让这类请求永久挂起。
      // 把 fetch 与 readResponse 放进同一次竞争，也保持单次 transport（retry=0）。
      const completed = await (async () => {
        try {
          return await timeout.race((async () => {
            const response = await guardedFetch(url, {
              method: request.method ?? 'GET',
              headers,
              body: hasJson ? JSON.stringify(request.json) : request.body,
              ...(signal === undefined ? {} : { signal }),
            })
            const parsed = await readResponse(
              response,
              request.responseType ?? 'json',
              request.invalidJson ?? 'error',
              options.service,
              request.invalidJsonMessage,
            )
            return { parsed, response }
          })())
        } catch (error) {
          // response.text() 在原生 fetch 中可能先因 signal abort 抛错并被 readResponse
          // 归一成 TBError；只要 deadline 已触发，仍必须稳定归类为 timeout。
          if (error instanceof TBError && signal?.aborted !== true) throw error
          const kind = signal?.aborted === true ? 'timeout' : 'network'
          const rawMessage = error instanceof Error ? error.message : undefined
          const context: ProviderHttpTransportErrorContext = {
            kind,
            message: rawMessage === undefined ? undefined : redact(rawMessage, secrets),
          }
          const mapped = request.mapTransportError?.(context)
            ?? upstreamError(kind === 'timeout' ? 504 : 502, `${options.service} request failed`)
          throw redactError(mapped, secrets)
        } finally {
          timeout.cancel()
        }
      })()
      const { parsed, response } = completed
      if (!response.ok && !accepted.has(response.status)) {
        const mapped = request.mapError?.({
          bodyKind: parsed.bodyKind,
          data: parsed.data,
          headers: response.headers,
          rawText: parsed.rawText,
          status: response.status,
          statusText: response.statusText,
        })
        ?? upstreamError(response.status, `${options.service} request failed with ${response.status}`)
        throw redactError(mapped, secrets)
      }
      return {
        bodyKind: parsed.bodyKind,
        data: parsed.data as T,
        headers: response.headers,
        rawText: parsed.rawText,
        status: response.status,
        statusText: response.statusText,
      }
    },
  }
}
