import type {
  ContextUploadGrant,
  FeedbackView,
  HelpJson,
  Page,
  StoreObjectDescriptor,
  StoreReadGrant,
  StoreShareGrant,
  StoreUploadGrant,
  TBErrorBody,
  ToolSearchItem,
  TreeJson,
} from './types'
import { encodeTreePath } from './path'

function nodeUrl(path: string): string {
  return path === '' ? '' : `/${encodeTreePath(path)}`
}

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
  /** Accept 头;缺省 application/json。 */
  accept?: string
  /** capability-only 数据面控制请求（如 complete）不得附带普通 SK。 */
  auth?: boolean
  body?: unknown
  headers?: Record<string, string>
  method?: 'GET' | 'POST' | 'DELETE'
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
        ...(opts.headers ?? {}),
        ...(opts.auth === false ? {} : { authorization: `Bearer ${conn.sk}` }),
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
  const p = `${nodeUrl(path)}/~help`
  return (await (await request(conn, p, { signal })).json()) as HelpJson
}

/** GET <path>/~help(可读 Markdown 表现,text/markdown = 协议默认)。 */
export async function getHelpMarkdown(conn: Connection, path: string, signal?: AbortSignal) {
  const p = `${nodeUrl(path)}/~help`
  return await (await request(conn, p, { accept: 'text/markdown', signal })).text()
}

/** GET <path>/~tree?depth=N。 */
export async function getTree(conn: Connection, path: string, depth: number, signal?: AbortSignal) {
  const p = `${nodeUrl(path)}/~tree`
  return (await (await request(conn, `${p}?depth=${depth}`, { signal })).json()) as TreeJson
}

/** POST /~search：全局工具检索；权限裁剪与虚拟化由网关完成。 */
export async function searchTools(
  conn: Connection,
  query: string,
  opts: { cursor?: string, limit: number, mode: 'keyword' | 'semantic' },
  signal?: AbortSignal,
): Promise<Page<ToolSearchItem>> {
  return (await (
    await request(conn, '/~search', { method: 'POST', body: { query, opts }, signal })
  ).json()) as Page<ToolSearchItem>
}

export interface InvokeResult {
  contentType: string
  /** application/json 时的解析结果。 */
  json?: unknown
  /** 端到端耗时(fetch 发起到 body 读完)。 */
  ms: number
  /** 响应原文(json 时为 pretty 前的原始文本)。 */
  text: string
}

/**
 * POST 数据面调用。唯一形态:`POST /<commandPath>`,body 即 arguments 本体
 * (commandPath 为含命令/工具叶子段的完整路径,如 `docs/ctx7/resolve` 或 `system/status/get`)。
 * accept 'json' 拿结构化返回,'markdown' 拿默认 markdown 表现。
 */
export async function invoke(
  conn: Connection,
  commandPath: string,
  args: unknown,
  accept: 'json' | 'markdown' = 'json',
): Promise<InvokeResult> {
  const started = performance.now()
  const res = await request(
    conn,
    nodeUrl(commandPath),
    {
      method: 'POST',
      body: args ?? {},
      accept: accept === 'json' ? 'application/json' : 'text/markdown',
    },
  )
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

function parseUploadGrant(value: unknown): ContextUploadGrant {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('internal', 502, '网关返回了无效的上传凭证', true)
  }
  const grant = value as Record<string, unknown>
  if (
    grant.method !== 'PUT'
    || typeof grant.uri !== 'string'
    || !grant.uri.startsWith('node://')
    || typeof grant.url !== 'string'
    || typeof grant.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(grant.expiresAt))
    || grant.headers === null
    || typeof grant.headers !== 'object'
    || Array.isArray(grant.headers)
    || !Object.values(grant.headers).every(value => typeof value === 'string')
  ) {
    throw new ApiError('internal', 502, '网关返回了无效的上传凭证', true)
  }
  try {
    const url = new URL(grant.url)
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.username !== ''
      || url.password !== ''
    ) throw new Error('invalid upload URL')
    new Headers(grant.headers as Record<string, string>)
  } catch {
    throw new ApiError('internal', 502, '网关返回了无效的上传凭证', true)
  }
  return grant as unknown as ContextUploadGrant
}

/** 申请 context 上传凭证，再把 File 直接发往对象存储；二进制不经过 Tool Bridge。 */
export async function uploadContextObject(
  conn: Connection,
  nodePath: string,
  entryPath: string,
  file: File,
  overwrite = false,
  signal?: AbortSignal,
): Promise<{ etag?: string, uri: string }> {
  const contentType = file.type || 'application/octet-stream'
  const grant = parseUploadGrant(await (
    await request(conn, nodeUrl(`${nodePath}/create_upload`), {
      method: 'POST',
      body: { path: entryPath, contentType, ...(overwrite ? { overwrite: true } : {}) },
      signal,
    })
  ).json())
  if (Date.parse(grant.expiresAt) <= Date.now()) {
    throw new ApiError('unavailable', 503, '上传凭证在开始上传前已经过期，请重试', true)
  }
  let response: Response
  try {
    response = await fetch(grant.url, {
      method: 'PUT',
      headers: grant.headers,
      body: file,
      credentials: 'omit',
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(
      'network',
      0,
      '对象存储直传失败：请检查网络与 R2/S3 CORS 配置',
      true,
    )
  }
  const etag = response.headers.get('etag')
  await response.body?.cancel().catch(() => {})
  if (!response.ok) {
    if (response.status === 412) {
      throw new ApiError('conflict', 412, '目标条目已存在', false)
    }
    throw new ApiError(
      'unavailable',
      response.status,
      `对象存储直传返回 HTTP ${response.status}`,
      response.status === 408 || response.status === 429 || response.status >= 500,
    )
  }
  return { uri: grant.uri, ...(etag === null ? {} : { etag }) }
}

function parseStoreUri(value: unknown): value is `store://default/${string}` {
  return typeof value === 'string' && /^store:\/\/default\/[A-Za-z0-9_-]+$/.test(value)
}

function parseStoreUploadGrant(value: unknown): StoreUploadGrant {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('internal', 502, '网关返回了无效的 Store 上传凭证', true)
  }
  const grant = value as Record<string, unknown>
  if (
    typeof grant.uploadId !== 'string'
    || !parseStoreUri(grant.objectUri)
    || (grant.transport !== 'relay' && grant.transport !== 'presigned-put')
    || grant.method !== 'PUT'
    || typeof grant.url !== 'string'
    || grant.headers === null
    || typeof grant.headers !== 'object'
    || Array.isArray(grant.headers)
    || !Object.values(grant.headers).every(header => typeof header === 'string')
    || typeof grant.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(grant.expiresAt))
    || typeof grant.maxBytes !== 'number'
    || !Number.isSafeInteger(grant.maxBytes)
    || grant.maxBytes < 1
    || typeof grant.uploadToken !== 'string'
    || grant.uploadToken.length === 0
  ) {
    throw new ApiError('internal', 502, '网关返回了无效的 Store 上传凭证', true)
  }
  try {
    const url = new URL(grant.url)
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.username !== ''
      || url.password !== ''
    ) throw new Error('invalid URL')
    new Headers(grant.headers as Record<string, string>)
    new Headers({ 'x-tb-store-upload': grant.uploadToken })
  } catch {
    throw new ApiError('internal', 502, '网关返回了无效的 Store 上传凭证', true)
  }
  return grant as unknown as StoreUploadGrant
}

/** 严格白名单投影，阻止服务端误回 driverKey/token/url 时进入 React Query/页面状态。 */
function parseStoreDescriptor(value: unknown, expectedUri?: string): StoreObjectDescriptor {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('internal', 502, '网关返回了无效的 Store 对象描述', true)
  }
  const object = value as Record<string, unknown>
  if (
    !parseStoreUri(object.uri)
    || (expectedUri !== undefined && object.uri !== expectedUri)
    || typeof object.contentType !== 'string'
    || typeof object.size !== 'number'
    || !Number.isSafeInteger(object.size)
    || object.size < 0
    || typeof object.createdAt !== 'string'
    || typeof object.readyAt !== 'string'
    || !Number.isFinite(Date.parse(object.createdAt))
    || !Number.isFinite(Date.parse(object.readyAt))
  ) throw new ApiError('internal', 502, '网关返回了无效的 Store 对象描述', true)
  return {
    uri: object.uri,
    contentType: object.contentType,
    size: object.size,
    createdAt: object.createdAt,
    readyAt: object.readyAt,
    status: 'ready',
    updatedAt: typeof object.updatedAt === 'string' ? object.updatedAt : object.readyAt,
    owner: typeof object.owner === 'string' ? object.owner : '',
    ...(typeof object.filename === 'string' ? { filename: object.filename } : {}),
    ...(typeof object.producer === 'string' ? { producer: object.producer } : {}),
    ...(typeof object.originCallId === 'string' ? { originCallId: object.originCallId } : {}),
    ...(typeof object.expiresAt === 'string' ? { expiresAt: object.expiresAt } : {}),
    ...(object.checksum !== null
      && typeof object.checksum === 'object'
      && (object.checksum as { algorithm?: unknown }).algorithm === 'sha256'
      && typeof (object.checksum as { value?: unknown }).value === 'string'
      ? { checksum: object.checksum as { algorithm: 'sha256', value: string } }
      : {}),
  }
}

async function storeCommand<T>(
  conn: Connection,
  command: string,
  body: unknown,
  opts?: { auth?: boolean, headers?: Record<string, string>, signal?: AbortSignal },
): Promise<T> {
  return (await (await request(conn, `/system/store/${command}`, {
    method: 'POST',
    body,
    ...(opts ?? {}),
  })).json()) as T
}

/** Store create → relay/direct PUT →（direct）capability-only complete。 */
export async function uploadStoreObject(
  conn: Connection,
  file: File,
  input: { filename?: string, idempotencyKey?: string } = {},
  signal?: AbortSignal,
): Promise<StoreObjectDescriptor> {
  const created = await storeCommand<unknown>(conn, 'create_upload', {
    contentType: file.type || 'application/octet-stream',
    filename: input.filename ?? file.name,
    size: file.size,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  }, { signal })
  if (
    created !== null
    && typeof created === 'object'
    && !Array.isArray(created)
    && (created as Record<string, unknown>).alreadyCompleted === true
  ) {
    return parseStoreDescriptor((created as Record<string, unknown>).descriptor)
  }
  const grant = parseStoreUploadGrant(created)
  if (Date.parse(grant.expiresAt) <= Date.now()) {
    throw new ApiError('unavailable', 503, 'Store 上传凭证在开始前已经过期，请重试', true)
  }
  if (file.size > grant.maxBytes) {
    throw new ApiError('invalid_argument', 400, `文件超过本次上传上限 ${grant.maxBytes} bytes`)
  }
  const headers = new Headers(grant.headers)
  if (grant.transport === 'relay') headers.set('x-tb-store-upload', grant.uploadToken)
  let response: Response
  try {
    response = await fetch(grant.url, {
      method: 'PUT',
      headers,
      body: file,
      credentials: 'omit',
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('network', 0, 'Store 对象上传失败，请检查网络与对象存储 CORS', true)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new ApiError(
      'unavailable',
      response.status,
      `Store 对象上传返回 HTTP ${response.status}`,
      response.status === 408 || response.status === 429 || response.status >= 500,
    )
  }
  if (grant.transport === 'relay') {
    return parseStoreDescriptor(await response.json().catch(() => undefined), grant.objectUri)
  }
  await response.body?.cancel().catch(() => {})
  let completed: unknown
  try {
    completed = await storeCommand<unknown>(conn, 'complete_upload', {
      uploadId: grant.uploadId,
    }, {
      auth: false,
      headers: { 'x-tb-store-upload': grant.uploadToken },
      signal,
    })
  } catch (error) {
    const api = error instanceof ApiError ? error : undefined
    // capability 与签名 URL 即使被服务端误写进错误，也不能经 Dashboard 暴露。
    throw new ApiError(
      api?.code ?? 'unavailable',
      api?.status ?? 503,
      'Store 上传完成失败，请重试',
      api?.retryable ?? true,
    )
  }
  return parseStoreDescriptor(completed, grant.objectUri)
}

export async function listStoreObjects(
  conn: Connection,
  opts: { cursor?: string, limit?: number } = {},
  signal?: AbortSignal,
): Promise<Page<StoreObjectDescriptor>> {
  const page = await storeCommand<Page<unknown>>(conn, 'list', { opts }, { signal })
  if (!Array.isArray(page.items)) {
    throw new ApiError('internal', 502, '网关返回了无效的 Store 对象列表', true)
  }
  return { items: page.items.map(item => parseStoreDescriptor(item)), ...(page.cursor ? { cursor: page.cursor } : {}) }
}

export async function statStoreObject(
  conn: Connection,
  uri: string,
  signal?: AbortSignal,
): Promise<StoreObjectDescriptor> {
  return parseStoreDescriptor(await storeCommand(conn, 'stat', { uri }, { signal }), uri)
}

function validateStoreRef(ref: string, purpose: string): void {
  try {
    const url = new URL(ref)
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.username !== ''
      || url.password !== ''
    ) throw new Error('invalid URL')
  } catch {
    throw new ApiError('internal', 502, `网关返回了无效的 Store ${purpose}凭证`, true)
  }
}

export async function readStoreObject(
  conn: Connection,
  uri: string,
  signal?: AbortSignal,
): Promise<StoreReadGrant> {
  const grant = await storeCommand<StoreReadGrant>(conn, 'read', { uri }, { signal })
  if (
    grant === null
    || typeof grant !== 'object'
    || typeof grant.$ref !== 'string'
    || typeof grant.contentType !== 'string'
    || typeof grant.size !== 'number'
    || typeof grant.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(grant.expiresAt))
  ) throw new ApiError('internal', 502, '网关返回了无效的 Store 读取凭证', true)
  validateStoreRef(grant.$ref, '读取')
  return grant
}

export async function shareStoreObject(
  conn: Connection,
  uri: string,
  ttlSec?: number,
): Promise<StoreShareGrant> {
  const grant = await storeCommand<StoreShareGrant>(conn, 'share', {
    uri,
    ...(ttlSec === undefined ? {} : { ttlSec }),
  })
  if (
    grant === null
    || typeof grant !== 'object'
    || typeof grant.$ref !== 'string'
    || typeof grant.shareId !== 'string'
    || !parseStoreUri(grant.uri)
    || typeof grant.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(grant.expiresAt))
  ) throw new ApiError('internal', 502, '网关返回了无效的 Store 分享凭证', true)
  validateStoreRef(grant.$ref, '分享')
  return grant
}

export async function revokeStoreShare(conn: Connection, shareId: string): Promise<void> {
  await storeCommand(conn, 'revoke_share', { shareId })
}

export async function deleteStoreObject(conn: Connection, uri: string): Promise<void> {
  await storeCommand(conn, 'delete', { uri })
}

/** 登录校验:GET /~help 能过认证即有效(与 tb login 同一判据)。 */
export async function validateConnection(conn: Connection): Promise<void> {
  await getHelp(conn, '')
}

/** POST /<path>/~authorize:mcp 托管 OAuth 发起(auth:'oauth' 挂载;对等 `tb tool auth`)。 */
export async function startOAuthAuthorize(
  conn: Connection,
  path: string,
): Promise<{ authorizationUrl?: string, status: 'authorized' | 'redirect' }> {
  const res = await request(conn, `${nodeUrl(path)}/~authorize`, { method: 'POST' })
  return (await res.json()) as { authorizationUrl?: string, status: 'authorized' | 'redirect' }
}

/** GET /healthz(免认证;tb status 同款)。 */
export async function getHealthz(baseUrl: string) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/healthz`)
  if (!res.ok) throw new ApiError('unavailable', res.status, `healthz HTTP ${res.status}`, true)
  return (await res.json()) as { healthy: boolean, version: string }
}

// --- ~feedback 保留段(per-path Agent 反馈,对等 `tb feedback`)---

/** GET /<path>/~feedback;hidden 含净分 ≤ 阈值的隐藏条目。 */
export async function feedbackList(
  conn: Connection,
  path: string,
  hidden: boolean,
  signal?: AbortSignal,
) {
  const p = `${nodeUrl(path)}/~feedback${hidden ? '?hidden=1' : ''}`
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
    await request(conn, `${nodeUrl(path)}/~feedback/${encodeURIComponent(id)}`, { signal })
  ).json()) as FeedbackView
}

/** POST /<path>/~feedback → 提交(title/detail 强制短)。 */
export async function feedbackSubmit(
  conn: Connection,
  path: string,
  input: { detail: string, title: string },
) {
  return (await (
    await request(conn, `${nodeUrl(path)}/~feedback`, { method: 'POST', body: input })
  ).json()) as { id: string, path: string, title: string }
}

/** POST /<path>/~feedback/<id> → 投票(每身份一票,可改票)。 */
export async function feedbackVote(
  conn: Connection,
  path: string,
  id: string,
  vote: 'up' | 'down' | 'clear',
) {
  return (await (
    await request(conn, `${nodeUrl(path)}/~feedback/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: { vote },
    })
  ).json()) as FeedbackView
}

/** DELETE /<path>/~feedback/<id>(admin)。 */
export async function feedbackRemove(conn: Connection, path: string, id: string) {
  await request(conn, `${nodeUrl(path)}/~feedback/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
