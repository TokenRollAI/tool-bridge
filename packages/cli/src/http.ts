/** CLI 宿主适配：SDK neutral client + CliError/对象直传边界。 */
import {
  type ContextUploadGrant,
  createToolBridgeClient,
  parseContextUploadGrant as parseSdkContextUploadGrant,
  PresignedPutError,
  type PresignedPutGrant,
  putPresignedObject,
  type ToolBridgeClient,
  ToolBridgeClientError,
} from '@tool-bridge/sdk/client'

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

/** 共享当前注入的 transport；SDK-backed 命令必须沿用同一个测试/宿主边界。 */
export function getFetch(): typeof fetch {
  return fetchImpl
}

export interface ApiOptions {
  accept?: 'json' | 'text' | 'markdown'
  body?: unknown
  method?: 'GET' | 'POST' | 'DELETE'
  path: string
  query?: Record<string, boolean | number | string | readonly (boolean | number | string)[] | undefined>
}

export interface ApiResult {
  contentType: string
  ok: boolean
  status: number
  text: string
}

/** 无显式 --timeout 时的单请求等待上限(上游长查询可用 --timeout 加大)。 */
export const DEFAULT_TIMEOUT_MS = 120_000

function clientError(error: unknown, target: Target): CliError {
  if (error instanceof ToolBridgeClientError) {
    if (error.kind === 'timeout') {
      const timeoutMs = target.timeoutMs ?? DEFAULT_TIMEOUT_MS
      return new CliError(
        `request timed out after ${Math.round(timeoutMs / 1000)}s — the upstream may still be processing; retry or raise --timeout`,
        'unavailable',
        true,
      )
    }
    if (error.kind === 'network') {
      const detail = error.networkCode === undefined ? '' : ` (${error.networkCode})`
      return new CliError(`request failed: gateway unavailable${detail}`, 'unavailable', true)
    }
    return new CliError(
      error.message,
      error.code === 'network' ? 'unavailable' : error.code,
      error.retryable,
    )
  }
  return new CliError('request failed: gateway unavailable', 'unavailable', true)
}

/** 当前 target 对应的 SDK client；保留 CLI 的 fetch 注入与单请求 timeout 默认。 */
export function clientForTarget(target: Target): ToolBridgeClient {
  const { baseUrl, sk } = requireTarget(target)
  try {
    return createToolBridgeClient({
      baseUrl,
      sk,
      fetcher: fetchImpl,
      timeoutMs: target.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
  } catch (error) {
    throw clientError(error, target)
  }
}

export async function withClient<T>(
  target: Target,
  fn: (client: ToolBridgeClient) => Promise<T>,
): Promise<T> {
  try {
    return await fn(clientForTarget(target))
  } catch (error) {
    if (error instanceof CliError) throw error
    throw clientError(error, target)
  }
}

/** 底层请求保留非 2xx 原始结果，供 status/login 的既有判定使用。 */
export async function apiFetch(target: Target, opts: ApiOptions): Promise<ApiResult> {
  return await withClient(target, async client => await client.raw({
    path: opts.path,
    method: opts.method,
    body: opts.body,
    query: opts.query,
    accept: opts.accept === 'json'
      ? 'application/json'
      : opts.accept === 'markdown'
        ? 'text/markdown'
        : opts.accept === 'text'
          ? 'text/plain'
          : undefined,
  }))
}

export async function apiJson<T>(target: Target, opts: Omit<ApiOptions, 'accept'>): Promise<T> {
  return await withClient(target, async client => await client.json<T>({
    ...opts,
    accept: 'application/json',
  }))
}

export async function apiText(
  target: Target,
  opts: Omit<ApiOptions, 'accept'> & { accept?: 'text' | 'markdown' },
): Promise<string> {
  return await withClient(target, async client => await client.text({
    ...opts,
    accept: opts.accept === 'markdown' ? 'text/markdown' : 'text/plain',
  }))
}

/** 动态 HTBP 直连：完整 path + 裸 arguments，绝不引入静态 envelope。 */
export async function callDirect<T>(
  target: Target,
  toolPath: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return await withClient(target, async client => await client.invokeJson<T>(toolPath, args))
}

/**
 * 把二进制直接 PUT 到对象存储。此请求绝不携带 Tool Bridge SK，错误也不读取/回显
 * 上游响应体或预签名 URL（两者都可能含敏感信息）。
 */
export async function putPresigned(
  grant: PresignedPutGrant,
  body: NonNullable<RequestInit['body']>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ etag?: string }> {
  try {
    return await putPresignedObject(grant, body, {
      fetcher: fetchImpl,
      timeoutMs,
    })
  } catch (error) {
    if (!(error instanceof PresignedPutError)) throw error
    if (error.kind === 'invalid') {
      throw new CliError(error.message, 'internal', true)
    }
    if (error.kind === 'expired') {
      throw new CliError(error.message, 'unavailable', true)
    }
    if (error.kind === 'timeout' || error.kind === 'aborted') {
      throw new CliError('object upload timed out', 'unavailable', true)
    }
    if (error.kind === 'conflict') {
      throw new CliError(
        'object already exists; re-run with --force to overwrite it',
        'conflict',
        false,
      )
    }
    throw new CliError(
      error.message,
      'unavailable',
      error.retryable,
    )
  }
}

/** Context grant 的 CLI 错误适配；必须在读取/发送本地文件前完成。 */
export function parseContextUploadGrant(value: unknown): ContextUploadGrant {
  try {
    return parseSdkContextUploadGrant(value)
  } catch (error) {
    if (error instanceof PresignedPutError) {
      throw new CliError(error.message, 'internal', true)
    }
    throw error
  }
}

/** 直连工具调用(人类模式):body 即 arguments 本体。 */
export async function callDirectText(
  target: Target,
  toolPath: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  return await withClient(
    target,
    async client => (await client.invoke(toolPath, args, { accept: 'markdown' })).text,
  )
}
