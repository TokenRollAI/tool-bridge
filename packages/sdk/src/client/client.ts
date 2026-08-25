import {
  feedbackDetailSchema,
  feedbackListSchema,
  feedbackRemoveResponseSchema,
  feedbackSubmitRequestSchema,
  feedbackSubmitResponseSchema,
  feedbackViewSchema,
  feedbackVoteRequestSchema,
  healthResponseSchema,
  helpJsonSchema,
  livenessResponseSchema,
  nodeInputSchema,
  oauthAuthorizeRequestSchema,
  oauthAuthorizeResponseSchema,
  readinessResponseSchema,
  registryNodeSchema,
  tbErrorBodySchema,
  toolSearchPageSchema,
  toolSearchRequestSchema,
  treeJsonSchema,
  type WireFeedbackDetail,
  type WireFeedbackList,
  type WireFeedbackSubmitRequest,
  type WireFeedbackSubmitResponse,
  type WireFeedbackView,
  type WireFeedbackVote,
  type WireHealthResponse,
  type WireHelpJson,
  type WireLivenessResponse,
  type WireNodeInput,
  type WireOAuthAuthorizeRequest,
  type WireOAuthAuthorizeResponse,
  type WireReadinessResponse,
  type WireRegistryNode,
  type WireTBErrorCode,
  type WireToolSearchPage,
  type WireToolSearchRequest,
  type WireTreeJson,
} from '@tool-bridge/core/protocol'

export type ClientErrorKind = 'http' | 'invalid' | 'network' | 'protocol' | 'timeout'

/** SDK client 的稳定错误面；消息不会拼入 URL、SK 或底层 fetch error。 */
export class ToolBridgeClientError extends Error {
  readonly code: WireTBErrorCode | 'network'
  readonly kind: ClientErrorKind
  /** 仅保留形如 ECONNREFUSED 的安全 transport code；绝不保留原始 error/URL。 */
  readonly networkCode?: string
  readonly retryable: boolean
  readonly status: number

  constructor(
    code: ToolBridgeClientError['code'],
    status: number,
    message: string,
    retryable = false,
    kind: ClientErrorKind = 'http',
    networkCode?: string,
  ) {
    super(message)
    this.name = 'ToolBridgeClientError'
    this.code = code
    this.kind = kind
    this.networkCode = networkCode
    this.retryable = retryable
    this.status = status
  }
}

export type ClientQueryPrimitive = boolean | number | string
export type ClientQueryValue = ClientQueryPrimitive | readonly ClientQueryPrimitive[] | undefined

export interface ToolBridgeClientOptions {
  /** 绝对 HTTP(S) URL、同源前缀，或 Dashboard 使用的空串。 */
  baseUrl: string
  fetcher?: typeof fetch
  /** 每次认证请求重新解析，支持轮换凭据。 */
  sk?: string | (() => Promise<string | undefined> | string | undefined)
  /** 单次请求默认超时；缺省不创建 SDK timer。 */
  timeoutMs?: number
}

export interface ClientRequestOptions {
  accept?: string
  /** false 用于 health/liveness/readiness；缺省 true。 */
  authenticated?: boolean
  body?: unknown
  method?: 'DELETE' | 'GET' | 'POST'
  path: string
  query?: Record<string, ClientQueryValue>
  signal?: AbortSignal
  timeoutMs?: number
}

export interface ClientRawResponse {
  contentType: string
  headers: Headers
  ok: boolean
  status: number
  text: string
}

/** Zod 及兼容 validator 的最小结构；public 方法不把 Zod 类型绑死在签名上。 */
export interface ClientResponseSchema<T> {
  safeParse(value: unknown): { data: T, success: true } | { error: unknown, success: false }
}

export interface ClientInvokeResult {
  contentType: string
  json?: unknown
  ms: number
  text: string
}

export interface GetHelpOptions {
  schemas?: boolean
  signal?: AbortSignal
}

export interface GetHelpTextOptions extends GetHelpOptions {
  representation?: 'dsl' | 'markdown'
}

export interface ToolBridgeClient {
  feedback: {
    get(path: string, id: string, opts?: { signal?: AbortSignal }): Promise<WireFeedbackDetail>
    list(
      path: string,
      opts?: { hidden?: boolean, signal?: AbortSignal },
    ): Promise<WireFeedbackList>
    remove(path: string, id: string, opts?: { signal?: AbortSignal }): Promise<void>
    submit(
      path: string,
      input: WireFeedbackSubmitRequest,
      opts?: { signal?: AbortSignal },
    ): Promise<WireFeedbackSubmitResponse>
    vote(
      path: string,
      id: string,
      vote: WireFeedbackVote,
      opts?: { signal?: AbortSignal },
    ): Promise<WireFeedbackView>
  }
  getHealth(opts?: { signal?: AbortSignal }): Promise<WireHealthResponse>
  getHelp(path?: string, opts?: GetHelpOptions): Promise<WireHelpJson>
  getHelpText(path?: string, opts?: GetHelpTextOptions): Promise<string>
  getLiveness(opts?: { signal?: AbortSignal }): Promise<WireLivenessResponse>
  getReadiness(opts?: { signal?: AbortSignal }): Promise<WireReadinessResponse>
  getTree(path?: string, opts?: { depth?: number, signal?: AbortSignal }): Promise<WireTreeJson>
  invoke(
    commandPath: string,
    args?: unknown,
    opts?: { accept?: 'json' | 'markdown', signal?: AbortSignal },
  ): Promise<ClientInvokeResult>
  invokeJson<T = unknown>(
    commandPath: string,
    args?: unknown,
    opts?: { schema?: ClientResponseSchema<T>, signal?: AbortSignal },
  ): Promise<T>
  json<T = unknown>(
    opts: ClientRequestOptions,
    schema?: ClientResponseSchema<T>,
  ): Promise<T>
  raw(opts: ClientRequestOptions): Promise<ClientRawResponse>
  registerNode(
    input: WireNodeInput,
    opts?: { signal?: AbortSignal },
  ): Promise<WireRegistryNode>
  search(input: WireToolSearchRequest, opts?: { signal?: AbortSignal }): Promise<WireToolSearchPage>
  startOAuthAuthorization(
    path: string,
    input?: WireOAuthAuthorizeRequest,
    opts?: { signal?: AbortSignal },
  ): Promise<WireOAuthAuthorizeResponse>
  text(opts: ClientRequestOptions): Promise<string>
  validateConnection(opts?: { signal?: AbortSignal }): Promise<void>
}

function normalizeBaseUrl(value: string): string {
  const baseUrl = value.replace(/\/+$/, '')
  if (/\r|\n|\?|#/.test(baseUrl) || baseUrl.startsWith('//')) {
    throw new ToolBridgeClientError(
      'invalid_argument',
      0,
      'Tool Bridge base URL is invalid',
      false,
      'invalid',
    )
  }
  const hasScheme = /^[A-Za-z][A-Za-z\d+.-]*:/.test(baseUrl)
  if (hasScheme || baseUrl.includes('://')) {
    try {
      const url = new URL(baseUrl)
      if (
        (url.protocol !== 'https:' && url.protocol !== 'http:')
        || url.username !== ''
        || url.password !== ''
      ) throw new Error('invalid')
    } catch {
      throw new ToolBridgeClientError(
        'invalid_argument',
        0,
        'Tool Bridge base URL is invalid',
        false,
        'invalid',
      )
    }
  } else if (baseUrl !== '' && !baseUrl.startsWith('/')) {
    throw new ToolBridgeClientError(
      'invalid_argument',
      0,
      'Tool Bridge base URL is invalid',
      false,
      'invalid',
    )
  }
  return baseUrl
}

/** URL parser/server decoder 都不能把一个逻辑段重解释成导航或分隔符。 */
function unsafeEncodedPathSegment(segment: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return true
  }
  return decoded === '.'
    || decoded === '..'
    || decoded.includes('/')
    || decoded.includes('\\')
    || [...decoded].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
}

function unsafeGeneratedPathSegment(segment: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return true
  }
  return decoded === '.'
    || decoded === '..'
    || [...decoded].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
}

function normalizeRequestPath(value: string, generatedPath = false): string {
  const withoutLeadingSlash = value.replace(/^\/+/, '')
  const segments = withoutLeadingSlash === '' ? [] : withoutLeadingSlash.split('/')
  if (
    /\r|\n|\?|#|\\/.test(withoutLeadingSlash)
    || segments.some(segment => segment === '' || (
      generatedPath ? unsafeGeneratedPathSegment(segment) : unsafeEncodedPathSegment(segment)
    ))
  ) {
    throw new ToolBridgeClientError(
      'invalid_argument',
      0,
      'Tool Bridge request path is invalid',
      false,
      'invalid',
    )
  }
  return `/${withoutLeadingSlash}`
}

function invalidRequest(): ToolBridgeClientError {
  return new ToolBridgeClientError(
    'invalid_argument',
    400,
    'invalid fixed control-plane request',
    false,
    'invalid',
  )
}

function encodeTreePath(path: string): string {
  const normalized = path
    .trim()
    .replace(/^\/+|\/+$/g, '')
  if (normalized === '') return ''
  const segments = normalized.split('/')
  // 这是逻辑 TreePath：除真实 dot/空段外，先逐段编码。字面 `%2F`、`\\` 等
  // 是 core 允许的标识符内容；编码后不会再被 URL parser 当成导航或分隔符。
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw invalidRequest()
  }
  return segments.map(segment => encodeURIComponent(segment)).join('/')
}

function reservedPath(path: string, reserved: string, id?: string): string {
  const encoded = encodeTreePath(path)
  const base = encoded === '' ? `/${reserved}` : `/${encoded}/${reserved}`
  if (id === undefined) return base
  if (id === '' || id === '.' || id === '..') throw invalidRequest()
  return `${base}/${encodeURIComponent(id)}`
}

function queryString(query?: ClientRequestOptions['query']): string {
  if (query === undefined) return ''
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const entry of value) params.append(name, String(entry))
    } else {
      params.append(name, String(value))
    }
  }
  const value = params.toString()
  return value === '' ? '' : value
}

function statusFallback(status: number): { code: WireTBErrorCode, retryable: boolean } {
  if (status === 400 || status === 422) return { code: 'invalid_argument', retryable: false }
  if (status === 401 || status === 403) return { code: 'permission_denied', retryable: false }
  if (status === 404) return { code: 'not_found', retryable: false }
  if (status === 409) return { code: 'conflict', retryable: false }
  if (status === 429) return { code: 'rate_limited', retryable: true }
  // 规范 500 TBError body 仍保留其 internal code；仅非规范 fallback 沿用 CLI 的
  // unavailable/retryable 兼容语义。
  if (status === 500) return { code: 'unavailable', retryable: true }
  if (status >= 500) return { code: 'unavailable', retryable: true }
  return { code: 'internal', retryable: false }
}

function redacted(value: string, secrets: readonly string[]): string {
  let result = value
  for (const secret of secrets) {
    if (secret !== '') result = result.split(secret).join('[REDACTED]')
  }
  return result
}

function protocolError(message: string): ToolBridgeClientError {
  return new ToolBridgeClientError('internal', 502, message, true, 'protocol')
}

function parseJson(text: string): unknown {
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw protocolError('gateway returned invalid JSON')
  }
}

function parsed<T>(value: unknown, schema: ClientResponseSchema<T>): T {
  const result = schema.safeParse(value)
  if (!result.success) throw protocolError('gateway returned an invalid fixed control-plane response')
  return result.data
}

function parseRequest<T>(value: unknown, schema: ClientResponseSchema<T>): T {
  const result = schema.safeParse(value)
  if (!result.success) throw invalidRequest()
  return result.data
}

function responseError(
  response: ClientRawResponse,
  secrets: readonly string[],
): ToolBridgeClientError {
  let body: unknown
  try {
    body = response.text === '' ? undefined : JSON.parse(response.text)
  } catch {
    body = undefined
  }
  const known = tbErrorBodySchema.safeParse(body)
  if (known.success) {
    return new ToolBridgeClientError(
      known.data.code,
      response.status,
      redacted(known.data.message, secrets),
      known.data.retryable,
      'http',
    )
  }
  const fallback = statusFallback(response.status)
  return new ToolBridgeClientError(
    fallback.code,
    response.status,
    `gateway returned HTTP ${response.status}`,
    fallback.retryable,
    'http',
  )
}

function validTimeout(value: number | undefined): value is number {
  // Node timers above signed 32-bit max are silently clamped to 1ms; keep the
  // Web-standard client deterministic across Node and browser hosts.
  return value !== undefined
    && Number.isInteger(value)
    && value > 0
    && value <= 2_147_483_647
}

/** 建立 Web-standard、宿主中立的 Tool Bridge 固定控制面 client。 */
export function createToolBridgeClient(options: ToolBridgeClientOptions): ToolBridgeClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const fetcher = options.fetcher ?? globalThis.fetch
  const responseSecrets = new WeakMap<ClientRawResponse, readonly string[]>()
  if (typeof fetcher !== 'function') {
    throw new ToolBridgeClientError(
      'invalid_argument',
      0,
      'Tool Bridge client requires fetch',
      false,
      'invalid',
    )
  }
  if (options.timeoutMs !== undefined && !validTimeout(options.timeoutMs)) throw invalidRequest()

  const resolveSk = async (): Promise<string | undefined> => {
    const value = typeof options.sk === 'function' ? await options.sk() : options.sk
    if (value === undefined) return undefined
    if (typeof value !== 'string' || value.trim() === '' || /\r|\n/.test(value)) {
      throw new ToolBridgeClientError(
        'invalid_argument',
        0,
        'Tool Bridge credential is invalid',
        false,
        'invalid',
      )
    }
    return value
  }

  const requestRaw = async (
    request: ClientRequestOptions,
    generatedPath = false,
  ): Promise<ClientRawResponse> => {
    const timeoutMs = request.timeoutMs ?? options.timeoutMs
    if (timeoutMs !== undefined && !validTimeout(timeoutMs)) throw invalidRequest()
    const sk = request.authenticated === false ? undefined : await resolveSk()
    const secrets = sk === undefined ? [] : [sk, `Bearer ${sk}`]
    const headers = new Headers()
    try {
      if (sk !== undefined) headers.set('authorization', `Bearer ${sk}`)
      if (request.accept !== undefined) headers.set('accept', request.accept)
      if (request.body !== undefined) headers.set('content-type', 'application/json')
    } catch {
      throw invalidRequest()
    }

    const query = queryString(request.query)
    const path = normalizeRequestPath(request.path, generatedPath)
    const url = query === '' ? `${baseUrl}${path}` : `${baseUrl}${path}?${query}`
    let body: string | undefined
    if (request.body !== undefined) {
      try {
        body = JSON.stringify(request.body)
      } catch {
        throw invalidRequest()
      }
      if (body === undefined) throw invalidRequest()
    }

    let timeoutSignal: AbortSignal | undefined
    let signal: AbortSignal | undefined
    try {
      timeoutSignal = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)
      signal = request.signal === undefined
        ? timeoutSignal
        : timeoutSignal === undefined
          ? request.signal
          : AbortSignal.any([request.signal, timeoutSignal])
    } catch {
      throw invalidRequest()
    }

    let response: Response
    try {
      const requestHeaders = Object.fromEntries(headers.entries())
      response = await fetcher(url, {
        method: request.method ?? 'GET',
        headers: requestHeaders,
        ...(body === undefined ? {} : { body }),
        credentials: 'omit',
        // 固定控制面请求会携带 SK/capability；任何重定向都视为部署错误并 fail closed。
        redirect: 'error',
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (request.signal?.aborted) throw error
      if (timeoutSignal?.aborted) {
        throw new ToolBridgeClientError(
          'unavailable',
          0,
          'Tool Bridge request timed out',
          true,
          'timeout',
        )
      }
      const rawCode = (error as { cause?: { code?: unknown } }).cause?.code
      const networkCode = typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(rawCode)
        ? rawCode
        : undefined
      throw new ToolBridgeClientError(
        'network',
        0,
        'Tool Bridge request failed',
        true,
        'network',
        networkCode,
      )
    }

    let text: string
    try {
      text = await response.text()
    } catch (error) {
      if (request.signal?.aborted) throw error
      if (timeoutSignal?.aborted) {
        throw new ToolBridgeClientError(
          'unavailable',
          0,
          'Tool Bridge request timed out',
          true,
          'timeout',
        )
      }
      throw new ToolBridgeClientError(
        'network',
        0,
        'Tool Bridge response stream failed',
        true,
        'network',
      )
    }
    const result: ClientRawResponse = {
      contentType: response.headers.get('content-type') ?? '',
      headers: response.headers,
      ok: response.ok,
      status: response.status,
      text,
    }
    responseSecrets.set(result, secrets)
    return result
  }

  const raw = async (request: ClientRequestOptions): Promise<ClientRawResponse> =>
    await requestRaw(request)

  const requestJson = async <T = unknown>(
    request: ClientRequestOptions,
    schema?: ClientResponseSchema<T>,
    generatedPath = false,
  ): Promise<T> => {
    const response = await requestRaw(
      { ...request, accept: request.accept ?? 'application/json' },
      generatedPath,
    )
    if (!response.ok) throw responseError(response, responseSecrets.get(response) ?? [])
    const value = parseJson(response.text)
    return schema === undefined ? value as T : parsed(value, schema)
  }

  const json = async <T = unknown>(
    request: ClientRequestOptions,
    schema?: ClientResponseSchema<T>,
  ): Promise<T> => await requestJson(request, schema)

  const requestText = async (
    request: ClientRequestOptions,
    generatedPath = false,
  ): Promise<string> => {
    const response = await requestRaw(request, generatedPath)
    if (!response.ok) throw responseError(response, responseSecrets.get(response) ?? [])
    return response.text
  }

  const text = async (request: ClientRequestOptions): Promise<string> => await requestText(request)

  const invoke = async (
    commandPath: string,
    args: unknown = {},
    opts: { accept?: 'json' | 'markdown', signal?: AbortSignal } = {},
  ): Promise<ClientInvokeResult> => {
    const started = Date.now()
    const response = await requestRaw({
      method: 'POST',
      path: `/${encodeTreePath(commandPath)}`,
      body: args ?? {},
      accept: opts.accept === 'markdown' ? 'text/markdown' : 'application/json',
      signal: opts.signal,
    }, true)
    if (!response.ok) throw responseError(response, responseSecrets.get(response) ?? [])
    const result: ClientInvokeResult = {
      contentType: response.contentType,
      ms: Math.round(Date.now() - started),
      text: response.text,
    }
    if (response.contentType.includes('application/json')) {
      try {
        result.json = response.text === '' ? undefined : JSON.parse(response.text)
      } catch {
        // 动态 HTBP 仍保留原始 text；固定控制面与 invokeJson 会 fail closed。
      }
    }
    return result
  }

  const invokeJson = async <T = unknown>(
    commandPath: string,
    args: unknown = {},
    opts: { schema?: ClientResponseSchema<T>, signal?: AbortSignal } = {},
  ): Promise<T> => await requestJson<T>({
    method: 'POST',
    path: `/${encodeTreePath(commandPath)}`,
    body: args ?? {},
    signal: opts.signal,
  }, opts.schema, true)

  const getReadiness = async (opts: { signal?: AbortSignal } = {}): Promise<WireReadinessResponse> => {
    const response = await raw({ path: '/readyz', authenticated: false, signal: opts.signal })
    if (response.status !== 200 && response.status !== 503) throw responseError(response, [])
    return parsed(parseJson(response.text), readinessResponseSchema)
  }

  return {
    raw,
    json,
    text,
    invoke,
    invokeJson,
    async getHelp(path = '', opts = {}) {
      return await requestJson({
        path: reservedPath(path, '~help'),
        query: opts.schemas ? { schemas: '1' } : undefined,
        signal: opts.signal,
      }, helpJsonSchema, true)
    },
    async getHelpText(path = '', opts = {}) {
      return await requestText({
        path: reservedPath(path, '~help'),
        query: opts.schemas ? { schemas: '1' } : undefined,
        accept: opts.representation === 'dsl' ? 'text/plain' : 'text/markdown',
        signal: opts.signal,
      }, true)
    },
    async getTree(path = '', opts = {}) {
      return await requestJson({
        path: reservedPath(path, '~tree'),
        query: opts.depth === undefined ? undefined : { depth: opts.depth },
        signal: opts.signal,
      }, treeJsonSchema, true)
    },
    async search(input, opts = {}) {
      const body = parseRequest(input, toolSearchRequestSchema)
      return await json({ method: 'POST', path: '/~search', body, signal: opts.signal }, toolSearchPageSchema)
    },
    async registerNode(input, opts = {}) {
      const body = parseRequest(input, nodeInputSchema) as WireNodeInput
      return await requestJson({
        method: 'POST',
        path: reservedPath(body.path, '~register'),
        body,
        signal: opts.signal,
      }, registryNodeSchema, true)
    },
    async startOAuthAuthorization(path, input = {}, opts = {}) {
      const body = parseRequest(input, oauthAuthorizeRequestSchema)
      return await requestJson({
        method: 'POST',
        path: reservedPath(path, '~authorize'),
        ...(Object.keys(body).length === 0 ? {} : { body }),
        signal: opts.signal,
      }, oauthAuthorizeResponseSchema, true)
    },
    async validateConnection(opts = {}) {
      await json({ path: '/~help', signal: opts.signal }, helpJsonSchema)
    },
    async getHealth(opts = {}) {
      return await json({ path: '/healthz', authenticated: false, signal: opts.signal }, healthResponseSchema)
    },
    async getLiveness(opts = {}) {
      return await json({ path: '/livez', authenticated: false, signal: opts.signal }, livenessResponseSchema)
    },
    getReadiness,
    feedback: {
      async list(path, opts = {}) {
        return await requestJson({
          path: reservedPath(path, '~feedback'),
          query: opts.hidden ? { hidden: '1' } : undefined,
          signal: opts.signal,
        }, feedbackListSchema, true)
      },
      async get(path, id, opts = {}) {
        return await requestJson({
          path: reservedPath(path, '~feedback', id),
          signal: opts.signal,
        }, feedbackDetailSchema, true)
      },
      async submit(path, input, opts = {}) {
        const body = parseRequest(input, feedbackSubmitRequestSchema)
        return await requestJson({
          method: 'POST',
          path: reservedPath(path, '~feedback'),
          body,
          signal: opts.signal,
        }, feedbackSubmitResponseSchema, true)
      },
      async vote(path, id, vote, opts = {}) {
        const body = parseRequest({ vote }, feedbackVoteRequestSchema)
        return await requestJson({
          method: 'POST',
          path: reservedPath(path, '~feedback', id),
          body,
          signal: opts.signal,
        }, feedbackViewSchema, true)
      },
      async remove(path, id, opts = {}) {
        await requestJson({
          method: 'DELETE',
          path: reservedPath(path, '~feedback', id),
          signal: opts.signal,
        }, feedbackRemoveResponseSchema, true)
      },
    },
  }
}
