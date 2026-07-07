import type { HelpJson, TBErrorBody, TreeJson } from './types'

/** TBError 线上形状的客户端异常(Proto §0.2:{code,message,retryable} + HTTP 状态)。 */
export class ApiError extends Error {
  readonly code: TBErrorBody['code'] | 'network'
  readonly status: number
  readonly retryable: boolean

  constructor(code: ApiError['code'], status: number, message: string, retryable = false) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

export interface Connection {
  /** 网关 BaseURL;'' = 同源(生产形态:Dashboard 与 gateway 同 Worker)。 */
  baseUrl: string
  sk: string
}

interface RequestOpts {
  method?: 'GET' | 'POST'
  body?: unknown
  /** Accept 头;缺省 application/json。 */
  accept?: string
  signal?: AbortSignal
}

async function request(conn: Connection, path: string, opts: RequestOpts = {}): Promise<Response> {
  const url = `${conn.baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      signal: opts.signal ?? null,
      headers: {
        authorization: `Bearer ${conn.sk}`,
        accept: opts.accept ?? 'application/json',
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    })
  } catch {
    throw new ApiError('network', 0, '网络请求失败:网关不可达或跨域未放行', true)
  }
  if (!res.ok) {
    const fallback: TBErrorBody = {
      code: res.status === 401 || res.status === 403 ? 'permission_denied' : 'internal',
      message: `HTTP ${res.status}`,
      retryable: false,
    }
    const body = (await res.json().catch(() => fallback)) as TBErrorBody
    throw new ApiError(body.code ?? fallback.code, res.status, body.message, body.retryable)
  }
  return res
}

/** GET <path>/~help(JSON 表现)。path '' = 根。 */
export async function getHelp(conn: Connection, path: string, signal?: AbortSignal) {
  const p = path === '' ? '/~help' : `/${path}/~help`
  return (await (await request(conn, p, { signal })).json()) as HelpJson
}

/** GET <path>/~help(Help DSL 原文,text/plain)。 */
export async function getHelpDsl(conn: Connection, path: string, signal?: AbortSignal) {
  const p = path === '' ? '/~help' : `/${path}/~help`
  return await (await request(conn, p, { accept: 'text/plain', signal })).text()
}

/** GET <path>/~tree?depth=N。 */
export async function getTree(conn: Connection, path: string, depth: number, signal?: AbortSignal) {
  const p = path === '' ? '/~tree' : `/${path}/~tree`
  return (await (await request(conn, `${p}?depth=${depth}`, { signal })).json()) as TreeJson
}

export interface InvokeResult {
  contentType: string
  /** 响应原文(json 时为 pretty 前的原始文本)。 */
  text: string
  /** application/json 时的解析结果。 */
  json?: unknown
  /** 端到端耗时(fetch 发起到 body 读完)。 */
  ms: number
}

/**
 * POST /<path> {tool, arguments} 数据面调用(Proto §1.2)。
 * accept 'json' 拿结构化返回,'markdown' 拿默认 markdown 表现。
 */
export async function invoke(
  conn: Connection,
  path: string,
  tool: string,
  args: unknown,
  accept: 'json' | 'markdown' = 'json',
): Promise<InvokeResult> {
  const started = performance.now()
  const res = await request(conn, `/${path}`, {
    method: 'POST',
    body: { tool, arguments: args ?? {} },
    accept: accept === 'json' ? 'application/json' : 'text/markdown',
  })
  const contentType = res.headers.get('content-type') ?? ''
  const text = await res.text()
  const ms = Math.round(performance.now() - started)
  if (contentType.includes('application/json')) {
    try {
      return { contentType, text, json: JSON.parse(text), ms }
    } catch {
      return { contentType, text, ms }
    }
  }
  return { contentType, text, ms }
}

/** 登录校验:GET /~help 能过认证即有效(与 tb login 同一判据)。 */
export async function validateConnection(conn: Connection): Promise<void> {
  await getHelp(conn, '')
}

/** GET /healthz(免认证;tb status 同款)。 */
export async function getHealthz(baseUrl: string) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/healthz`)
  if (!res.ok) throw new ApiError('unavailable', res.status, `healthz HTTP ${res.status}`, true)
  return (await res.json()) as { healthy: boolean; version: string }
}
