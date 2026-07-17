/**
 * CLI 的 HTTP 层:fetch + Bearer + Accept 内容协商 + TBError 归一。
 *
 * 契约(与网关约定,见任务书):
 * - 认证:`Authorization: Bearer <SK>`;无/无效 → 401 TBError。
 * - `Accept: application/json` → 结构化 JSON;缺省 text/plain(Help DSL 等)。
 * - 错误响应:TBError JSON `{code,message,retryable}` + 对应 HTTP 码。
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
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new CliError(
        `request timed out after ${Math.round(timeoutMs / 1000)}s — the upstream may still be processing; retry or raise --timeout`,
        'unavailable',
        true,
      )
    }
    throw new CliError(`request failed: ${(err as Error).message}`)
  }
  const text = await res.text()
  return {
    status: res.status,
    ok: res.ok,
    text,
    contentType: res.headers.get('content-type') ?? '',
  }
}

/** 把非 2xx 响应体解释为 TBError(拿不到规范形状则回退到 HTTP 码)。 */
function toCliError(body: unknown, status: number): CliError {
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
  return new CliError(`gateway returned HTTP ${status}`)
}

/** JSON 请求:强制 `Accept: application/json`,成功返回解析结果,失败抛 CliError。 */
export async function apiJson<T>(target: Target, opts: Omit<ApiOptions, 'accept'>): Promise<T> {
  const r = await apiFetch(target, { ...opts, accept: 'json' })
  let body: unknown
  if (r.text) {
    try {
      body = JSON.parse(r.text)
    } catch {
      if (!r.ok) throw new CliError(`gateway returned HTTP ${r.status}`)
      throw new CliError('invalid JSON response from gateway')
    }
  }
  if (!r.ok) throw toCliError(body, r.status)
  return body as T
}

/**
 * 文本请求(Help DSL / Markdown 等):成功返回原始文本,失败尝试解释 TBError JSON。
 * 缺省 `Accept: text/plain`;`accept: 'markdown'` 请求可读 Markdown 表现。
 */
export async function apiText(
  target: Target,
  opts: Omit<ApiOptions, 'accept'> & { accept?: 'text' | 'markdown' },
): Promise<string> {
  const r = await apiFetch(target, { ...opts, accept: opts.accept ?? 'text' })
  if (!r.ok) {
    let body: unknown
    try {
      body = JSON.parse(r.text)
    } catch {
      // 非 JSON 错误体:回退到 HTTP 码
    }
    throw toCliError(body, r.status)
  }
  return r.text
}

/** 数据面工具调用(信封形态):`POST /<path>` body `{tool, arguments}`。 */
export async function callTool<T>(
  target: Target,
  path: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return apiJson<T>(target, { method: 'POST', path, body: { tool, arguments: args } })
}

/** 直连工具调用:`POST /<node>/<tool>`,body 即 arguments 本体(无信封)。 */
export async function callDirect<T>(
  target: Target,
  toolPath: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return apiJson<T>(target, { method: 'POST', path: toolPath, body: args })
}

/**
 * 数据面调用(人类模式):`Accept: text/markdown`,返回原始渲染文本。
 * 非 2xx 时按 TBError 归一为 CliError。
 */
export async function callToolText(
  target: Target,
  path: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  return invokeText(target, path, { tool, arguments: args })
}

/** 直连工具调用(人类模式):body 即 arguments 本体。 */
export async function callDirectText(
  target: Target,
  toolPath: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  return invokeText(target, toolPath, args)
}

async function invokeText(target: Target, path: string, body: unknown): Promise<string> {
  const r = await apiFetch(target, {
    method: 'POST',
    path,
    body,
    accept: 'markdown',
  })
  if (!r.ok) {
    let body: unknown
    try {
      body = JSON.parse(r.text)
    } catch {
      // 非 JSON 错误体:回退到 HTTP 码
    }
    throw toCliError(body, r.status)
  }
  return r.text
}
