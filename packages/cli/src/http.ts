/**
 * CLI 的 HTTP 层:fetch + Bearer + Accept 内容协商 + TBError 归一。
 *
 * 契约(与网关约定,见任务书):
 * - 认证:`Authorization: Bearer <SK>`;无/无效 → 401 TBError。
 * - `Accept: application/json` → 结构化 JSON;缺省 text/plain(Help DSL 等)。
 * - 错误响应:TBError JSON `{code,message,retryable}` + 对应 HTTP 码。
 *
 * 失败归一集中在两个函数,保证任何失败路径的 CliError 都带 code/retryable
 * (--json 消费者据此判定可否重试,不必对 message 做正则):
 * - errorFromNetwork:fetch/响应体读取抛出的传输层异常(含超时);
 * - errorFromResponse:非 2xx 响应,规范 TBError body 优先,否则按 HTTP status 回退。
 */

/** CLI 错误:携带可选 TBError code/retryable,统一由 output.reportError 落地为退出码 1。 */
export class CliError extends Error {
  readonly code?: string
  /** TBError 的 retryable 语义(true → 呈现"try again"提示);本地错误缺席。 */
  readonly retryable?: boolean
  /** 附加提示(如 ~feedback 已知坑),reportError 在主错误后落地。 */
  hint?: string
  /** 该 path 的 feedback 头部条目(--json 时结构化输出)。 */
  feedback?: Array<{ id: string, score: number, title: string }>
  constructor(message: string, code?: string, retryable?: boolean) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.retryable = retryable
  }
}

export interface Target {
  baseUrl?: string
  sk?: string
  /** 单请求等待上限(毫秒);缺席 = 默认 120s。见 args.resolveTarget。 */
  timeoutMs?: number
}

/** 断言已解析出 baseUrl;否则给出可操作的错误提示。 */
export function requireTarget(target: Target): { baseUrl: string, sk?: string } {
  if (!target.baseUrl) {
    throw new CliError('missing base URL: run `tb login`, pass --base-url, or set TB_BASE_URL')
  }
  return { baseUrl: target.baseUrl, sk: target.sk }
}

// 可注入的 fetch(命令级单测用 setFetch 注入 mock,避免起真实服务器)。
let fetchImpl: typeof fetch = globalThis.fetch

export function setFetch(f: typeof fetch): void {
  fetchImpl = f
}

export function resetFetch(): void {
  fetchImpl = globalThis.fetch
}

export interface ApiOptions {
  accept?: 'json' | 'text' | 'markdown'
  body?: unknown
  method?: 'GET' | 'POST' | 'DELETE'
  path: string
  query?: Record<string, string | number | undefined>
}

export interface ApiResult {
  contentType: string
  ok: boolean
  status: number
  text: string
}

function buildQuery(query?: ApiOptions['query']): string {
  if (!query) return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

/** 无显式 --timeout 时的单请求等待上限(上游长查询可用 --timeout 加大)。 */
export const DEFAULT_TIMEOUT_MS = 120_000

/**
 * HTTP 状态 → TBError code(网关不可达或返回非规范错误体时的回退映射)。
 * 与 core `errors.ts` 的 CODE_TO_STATUS 反向对齐;此处不 import core(它是 devDep,
 * 不进 CLI 运行时产物),按同一 7 码契约本地维护。未知状态一律归 internal。
 */
function codeForStatus(status: number): { code: string, retryable: boolean } {
  if (status === 400) return { code: 'invalid_argument', retryable: false }
  if (status === 401 || status === 403) return { code: 'permission_denied', retryable: false }
  if (status === 404) return { code: 'not_found', retryable: false }
  if (status === 409) return { code: 'conflict', retryable: false }
  if (status === 429) return { code: 'rate_limited', retryable: true }
  // 5xx(除下方细分)与其它未预期状态:服务端侧问题,通常值得重试。
  if (status === 503 || status === 500) return { code: 'unavailable', retryable: true }
  if (status >= 500) return { code: 'unavailable', retryable: true }
  // 其它 4xx:客户端请求被拒,重试无益。
  return { code: 'internal', retryable: false }
}

/**
 * 传输层异常(fetch 抛出,非 HTTP 响应)→ CliError,始终带 code/retryable。
 * undici 把底层原因挂在 `err.cause.code`(如 ECONNREFUSED/ENOTFOUND/ECONNRESET):
 * 连接根本没建立的错误按 unavailable(retryable)呈现,让调用方拿到稳定的重试信号,
 * 而不是只能对 'fetch failed' 这种无 code 的裸消息做正则。
 */
function errorFromNetwork(err: unknown): CliError {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new CliError(
      'request timed out — the upstream may still be processing; retry or raise --timeout',
      'unavailable',
      true,
    )
  }
  const cause = (err as { cause?: { code?: unknown } }).cause
  const causeCode = typeof cause?.code === 'string' ? cause.code : undefined
  const message = err instanceof Error ? err.message : String(err)
  const detail = causeCode !== undefined ? `${message} (${causeCode})` : message
  return new CliError(`request failed: ${detail}`, 'unavailable', true)
}

/**
 * 非 2xx 响应 → CliError。body 是规范 TBError(`{code,message,retryable}`)时原样采纳;
 * 否则按 HTTP status 回退出 code/retryable(见 codeForStatus),确保任何失败路径都带结构,
 * 消除 `--json` 下 code/retryable 缺键与显式 false 无法区分的问题。
 */
function errorFromResponse(rawText: string, status: number): CliError {
  let body: unknown
  if (rawText) {
    try {
      body = JSON.parse(rawText)
    } catch {
      // 非 JSON 错误体:落到 status 回退。
    }
  }
  if (
    body
    && typeof body === 'object'
    && 'code' in body
    && 'message' in body
    && typeof (body as { message: unknown }).message === 'string'
  ) {
    const b = body as { code: unknown, message: string, retryable?: unknown }
    const retryable = typeof b.retryable === 'boolean' ? b.retryable : undefined
    return new CliError(b.message, String(b.code), retryable)
  }
  const { code, retryable } = codeForStatus(status)
  return new CliError(`gateway returned HTTP ${status}`, code, retryable)
}

/** 底层请求:构造 URL/头,执行 fetch;网络错误 → CliError,超时 → retryable CliError。 */
export async function apiFetch(target: Target, opts: ApiOptions): Promise<ApiResult> {
  const { baseUrl, sk } = requireTarget(target)
  const timeoutMs = target.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const base = baseUrl.replace(/\/+$/, '')
  const path = opts.path.startsWith('/') ? opts.path : `/${opts.path}`
  const url = `${base}${path}${buildQuery(opts.query)}`

  const headers: Record<string, string> = {}
  if (sk) headers.authorization = `Bearer ${sk}`
  if (opts.accept === 'json') headers.accept = 'application/json'
  else if (opts.accept === 'markdown') headers.accept = 'text/markdown'
  else if (opts.accept === 'text') headers.accept = 'text/plain'

  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  }
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(opts.body)
  }

  let res: Response
  try {
    res = await fetchImpl(url, init)
  } catch (err) {
    // 超时消息补上实际秒数(errorFromNetwork 不知道 timeoutMs)。
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new CliError(
        `request timed out after ${Math.round(timeoutMs / 1000)}s — the upstream may still be processing; retry or raise --timeout`,
        'unavailable',
        true,
      )
    }
    throw errorFromNetwork(err)
  }
  // 响应体读取也可能中途断流(TypeError: terminated);与 fetch 抛出同类,按网络失败归一,
  // 而非让裸 undici 消息逃逸(那样又回到无 code/retryable 的老问题)。
  let text: string
  try {
    text = await res.text()
  } catch (err) {
    throw errorFromNetwork(err)
  }
  return {
    status: res.status,
    ok: res.ok,
    text,
    contentType: res.headers.get('content-type') ?? '',
  }
}

/** JSON 请求:强制 `Accept: application/json`,成功返回解析结果,失败抛 CliError。 */
export async function apiJson<T>(target: Target, opts: Omit<ApiOptions, 'accept'>): Promise<T> {
  const r = await apiFetch(target, { ...opts, accept: 'json' })
  if (!r.ok) throw errorFromResponse(r.text, r.status)
  if (!r.text) return undefined as T
  try {
    return JSON.parse(r.text) as T
  } catch {
    // 2xx 但响应体不是合法 JSON:网关侧异常,值得重试。
    throw new CliError('invalid JSON response from gateway', 'internal', true)
  }
}

/**
 * 文本请求(Help DSL / Markdown 等):成功返回原始文本,失败按 TBError/HTTP status 归一。
 * 缺省 `Accept: text/plain`;`accept: 'markdown'` 请求可读 Markdown 表现。
 */
export async function apiText(
  target: Target,
  opts: Omit<ApiOptions, 'accept'> & { accept?: 'text' | 'markdown' },
): Promise<string> {
  const r = await apiFetch(target, { ...opts, accept: opts.accept ?? 'text' })
  if (!r.ok) throw errorFromResponse(r.text, r.status)
  return r.text
}

/** 直连工具调用:`POST /<node>/<tool>`,body 即 arguments 本体(无信封)。 */
export async function callDirect<T>(
  target: Target,
  toolPath: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return apiJson<T>(target, { method: 'POST', path: toolPath, body: args })
}

async function invokeText(target: Target, path: string, body: unknown): Promise<string> {
  const r = await apiFetch(target, {
    method: 'POST',
    path,
    body,
    accept: 'markdown',
  })
  if (!r.ok) throw errorFromResponse(r.text, r.status)
  return r.text
}

/** 直连工具调用(人类模式):body 即 arguments 本体。 */
export async function callDirectText(
  target: Target,
  toolPath: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  return invokeText(target, toolPath, args)
}
