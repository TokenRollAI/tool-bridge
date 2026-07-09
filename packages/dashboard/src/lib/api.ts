import type { FeedbackView, HelpJson, TBErrorBody, TreeJson } from './types'

/** TBError 线上形状的客户端异常({code,message,retryable} + HTTP 状态)。 */
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
  method?: 'GET' | 'POST' | 'DELETE'
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
  } catch (error) {
    // React Query 会用 AbortSignal 取消过时的路由/搜索请求;取消不是网络故障,
    // 保留原始 AbortError 才不会触发 retry 或“网关不可达”误报。
    if (error instanceof DOMException && error.name === 'AbortError') throw error
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

/** GET <path>/~help(可读 Markdown 表现,text/markdown = 协议默认)。 */
export async function getHelpMarkdown(conn: Connection, path: string, signal?: AbortSignal) {
  const p = path === '' ? '/~help' : `/${path}/~help`
  return await (await request(conn, p, { accept: 'text/markdown', signal })).text()
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
 * POST 数据面调用。`direct`(mcp/http/tool 工具,~help 宣告直连路径)→
 * `POST /<path>/<tool>`,body 即 arguments 本体;否则信封 `POST /<path>` + {tool,arguments}。
 * accept 'json' 拿结构化返回,'markdown' 拿默认 markdown 表现。
 */
export async function invoke(
  conn: Connection,
  path: string,
  tool: string,
  args: unknown,
  accept: 'json' | 'markdown' = 'json',
  direct = false,
): Promise<InvokeResult> {
  const started = performance.now()
  const res = await request(conn, direct ? `/${path}/${tool}` : `/${path}`, {
    method: 'POST',
    body: direct ? (args ?? {}) : { tool, arguments: args ?? {} },
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

/** POST /<path>/~authorize:mcp 托管 OAuth 发起(auth:'oauth' 挂载;对等 `tb tool auth`)。 */
export async function startOAuthAuthorize(
  conn: Connection,
  path: string,
): Promise<{ status: 'authorized' | 'redirect'; authorizationUrl?: string }> {
  const res = await request(conn, `/${path}/~authorize`, { method: 'POST' })
  return (await res.json()) as { status: 'authorized' | 'redirect'; authorizationUrl?: string }
}

/** GET /healthz(免认证;tb status 同款)。 */
export async function getHealthz(baseUrl: string) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/healthz`)
  if (!res.ok) throw new ApiError('unavailable', res.status, `healthz HTTP ${res.status}`, true)
  return (await res.json()) as { healthy: boolean; version: string }
}

// --- ~feedback 保留段(per-path Agent 反馈,对等 `tb feedback`)---

/** GET /<path>/~feedback;hidden 含净分 ≤ 阈值的隐藏条目。 */
export async function feedbackList(
  conn: Connection,
  path: string,
  hidden: boolean,
  signal?: AbortSignal,
) {
  const p = `/${path}/~feedback${hidden ? '?hidden=1' : ''}`
  return (await (await request(conn, p, { signal })).json()) as { items: FeedbackView[] }
}

/** GET /<path>/~feedback/<id>(含 detail)。 */
export async function feedbackGet(
  conn: Connection,
  path: string,
  id: string,
  signal?: AbortSignal,
) {
  return (await (
    await request(conn, `/${path}/~feedback/${id}`, { signal })
  ).json()) as FeedbackView
}

/** POST /<path>/~feedback → 提交(title/detail 强制短)。 */
export async function feedbackSubmit(
  conn: Connection,
  path: string,
  input: { title: string; detail: string },
) {
  return (await (
    await request(conn, `/${path}/~feedback`, { method: 'POST', body: input })
  ).json()) as { id: string; path: string; title: string }
}

/** POST /<path>/~feedback/<id> → 投票(每身份一票,可改票)。 */
export async function feedbackVote(
  conn: Connection,
  path: string,
  id: string,
  vote: 'up' | 'down' | 'clear',
) {
  return (await (
    await request(conn, `/${path}/~feedback/${id}`, { method: 'POST', body: { vote } })
  ).json()) as FeedbackView
}

/** DELETE /<path>/~feedback/<id>(admin)。 */
export async function feedbackRemove(conn: Connection, path: string, id: string) {
  await request(conn, `/${path}/~feedback/${id}`, { method: 'DELETE' })
}
