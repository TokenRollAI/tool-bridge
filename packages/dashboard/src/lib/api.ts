import {
  type ClientInvokeResult,
  createToolBridgeClient,
  parseContextUploadGrant,
  PresignedPutError,
  putPresignedObject,
  type ToolBridgeClient,
  ToolBridgeClientError,
  type ToolSearchRequest,
} from '@tool-bridge/sdk/client'
import type { TBErrorBody } from './types'

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

function client(conn: Connection): ToolBridgeClient {
  return createToolBridgeClient({ baseUrl: conn.baseUrl, sk: conn.sk, fetcher: fetch })
}

/** SDK 错误只在这里映射一次；TanStack Query 的调用方取消保持原 AbortError。 */
async function withClient<T>(
  conn: Connection,
  fn: (value: ToolBridgeClient) => Promise<T>,
): Promise<T> {
  try {
    return await fn(client(conn))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (error instanceof ToolBridgeClientError) {
      if (error.kind === 'network') {
        throw new ApiError('network', 0, '网络请求失败:网关不可达或跨域未放行', true)
      }
      if (error.kind === 'timeout') {
        throw new ApiError('unavailable', 0, '请求超时，请稍后重试', true)
      }
      if (error.kind === 'protocol') {
        throw new ApiError('internal', 502, '网关返回了无效的响应', true)
      }
      throw new ApiError(
        error.code === 'network' ? 'network' : error.code,
        error.status,
        error.message,
        error.retryable,
      )
    }
    throw new ApiError('internal', 0, '请求处理失败', false)
  }
}

/** GET <path>/~help(JSON 表现)。path '' = 根。 */
export async function getHelp(conn: Connection, path: string, signal?: AbortSignal) {
  return await withClient(conn, async value => await value.getHelp(path, { signal }))
}

/** GET <path>/~help(可读 Markdown 表现,text/markdown = 协议默认)。 */
export async function getHelpMarkdown(conn: Connection, path: string, signal?: AbortSignal) {
  return await withClient(
    conn,
    async value => await value.getHelpText(path, { representation: 'markdown', signal }),
  )
}

/** GET <path>/~tree?depth=N。 */
export async function getTree(conn: Connection, path: string, depth: number, signal?: AbortSignal) {
  return await withClient(conn, async value => await value.getTree(path, { depth, signal }))
}

/** POST /~search：全局工具检索；权限裁剪与虚拟化由网关完成。 */
export async function searchTools(
  conn: Connection,
  query: string,
  opts: NonNullable<ToolSearchRequest['opts']>,
  signal?: AbortSignal,
) {
  return await withClient(conn, async value => await value.search({ query, opts }, { signal }))
}

export type InvokeResult = ClientInvokeResult

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
  return await withClient(
    conn,
    async value => await value.invoke(commandPath, args ?? {}, { accept }),
  )
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
  const rawGrant = await withClient(
    conn,
    async value => await value.invokeJson(`${nodePath}/create_upload`, {
      path: entryPath,
      contentType,
      ...(overwrite ? { overwrite: true } : {}),
    }, { signal }),
  )
  try {
    const grant = parseContextUploadGrant(rawGrant)
    const uploaded = await putPresignedObject(grant, file, {
      fetcher: fetch,
      signal,
    })
    return { uri: grant.uri, ...uploaded }
  } catch (error) {
    if (!(error instanceof PresignedPutError)) throw error
    if (error.kind === 'aborted') throw new DOMException('The operation was aborted', 'AbortError')
    if (error.kind === 'invalid') {
      throw new ApiError('internal', 502, '网关返回了无效的上传凭证', true)
    }
    if (error.kind === 'expired') {
      throw new ApiError('unavailable', 503, '上传凭证在开始上传前已经过期，请重试', true)
    }
    if (error.kind === 'conflict') {
      throw new ApiError('conflict', 412, '目标条目已存在', false)
    }
    if (error.kind === 'http') {
      throw new ApiError(
        'unavailable',
        error.status,
        `对象存储直传返回 HTTP ${error.status}`,
        error.retryable,
      )
    }
    throw new ApiError('network', 0, '对象存储直传失败：请检查网络与 R2/S3 CORS 配置', true)
  }
}

/** 登录校验:GET /~help 能过认证即有效(与 tb login 同一判据)。 */
export async function validateConnection(conn: Connection): Promise<void> {
  await withClient(conn, async value => await value.validateConnection())
}

/** POST /<path>/~authorize:mcp 托管 OAuth 发起(auth:'oauth' 挂载;对等 `tb tool auth`)。 */
export async function startOAuthAuthorize(conn: Connection, path: string) {
  return await withClient(conn, async value => await value.startOAuthAuthorization(path))
}

/** GET /healthz(免认证;tb status 同款)。 */
export async function getHealthz(baseUrl: string) {
  return await withClient(
    { baseUrl, sk: '' },
    async value => await value.getHealth(),
  )
}

// --- ~feedback 保留段(per-path Agent 反馈,对等 `tb feedback`)---

/** GET /<path>/~feedback;hidden 含净分 ≤ 阈值的隐藏条目。 */
export async function feedbackList(
  conn: Connection,
  path: string,
  hidden: boolean,
  signal?: AbortSignal,
) {
  return await withClient(
    conn,
    async value => await value.feedback.list(path, { hidden, signal }),
  )
}

/** GET /<path>/~feedback/<id>(含 detail)。 */
export async function feedbackGet(
  conn: Connection,
  path: string,
  id: string,
  signal?: AbortSignal,
) {
  return await withClient(conn, async value => await value.feedback.get(path, id, { signal }))
}

/** POST /<path>/~feedback → 提交(title/detail 强制短)。 */
export async function feedbackSubmit(
  conn: Connection,
  path: string,
  input: { detail: string, title: string },
) {
  return await withClient(conn, async value => await value.feedback.submit(path, input))
}

/** POST /<path>/~feedback/<id> → 投票(每身份一票,可改票)。 */
export async function feedbackVote(
  conn: Connection,
  path: string,
  id: string,
  vote: 'up' | 'down' | 'clear',
) {
  return await withClient(conn, async value => await value.feedback.vote(path, id, vote))
}

/** DELETE /<path>/~feedback/<id>(admin)。 */
export async function feedbackRemove(conn: Connection, path: string, id: string) {
  await withClient(conn, async value => await value.feedback.remove(path, id))
}
