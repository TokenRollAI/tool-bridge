/** Web-standard、宿主中立的预签名 PUT 安全原语。 */

export interface PresignedPutGrant {
  expiresAt: string
  headers: Record<string, string>
  method: 'PUT'
  url: string
}

export interface ContextUploadGrant extends PresignedPutGrant {
  /** 上传成功后可持久化的稳定 Context URI，不是 bearer URL。 */
  uri: string
}

export type PresignedPutErrorKind
  = | 'aborted'
    | 'conflict'
    | 'expired'
    | 'http'
    | 'invalid'
    | 'network'
    | 'timeout'

/** 不携带底层异常、预签名 URL、响应体或 header 值的稳定错误。 */
export class PresignedPutError extends Error {
  readonly kind: PresignedPutErrorKind
  readonly retryable: boolean
  readonly status: number

  constructor(kind: PresignedPutErrorKind, message: string, status = 0, retryable = false) {
    super(message)
    this.name = 'PresignedPutError'
    this.kind = kind
    this.retryable = retryable
    this.status = status
  }
}

export interface PutPresignedOptions {
  fetcher?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}

function invalidGrant(): PresignedPutError {
  return new PresignedPutError('invalid', 'gateway returned an invalid upload grant')
}

function forbiddenPlatformHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === 'authorization'
    || lower === 'cookie'
    || lower === 'cookie2'
    || lower === 'proxy-authorization'
    || lower.startsWith('x-tb-')
}

function validTimeout(value: number | undefined): value is number {
  return value !== undefined
    && Number.isInteger(value)
    && value > 0
    && value <= 2_147_483_647
}

export function parsePresignedPutGrant(value: unknown): PresignedPutGrant {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidGrant()
  const grant = value as Record<string, unknown>
  if (
    grant.method !== 'PUT'
    || typeof grant.url !== 'string'
    || typeof grant.expiresAt !== 'string'
    || grant.headers === null
    || typeof grant.headers !== 'object'
    || Array.isArray(grant.headers)
    || !Object.values(grant.headers).every(entry => typeof entry === 'string')
  ) throw invalidGrant()

  let url: URL
  let headers: Headers
  try {
    url = new URL(grant.url)
    headers = new Headers(grant.headers as Record<string, string>)
  } catch {
    throw invalidGrant()
  }
  const expiresAt = Date.parse(grant.expiresAt)
  if (
    !Number.isFinite(expiresAt)
    || (url.protocol !== 'https:' && url.protocol !== 'http:')
    || url.username !== ''
    || url.password !== ''
    || [...headers.keys()].some(forbiddenPlatformHeader)
  ) throw invalidGrant()
  return {
    expiresAt: grant.expiresAt,
    headers: Object.fromEntries(headers.entries()),
    method: 'PUT',
    url: url.toString(),
  }
}

/** Context create_upload 的完整 wire parser；稳定 uri 必须在发送私有文件前验证。 */
export function parseContextUploadGrant(value: unknown): ContextUploadGrant {
  const parsed = parsePresignedPutGrant(value)
  const uri = (value as Record<string, unknown>).uri
  if (
    typeof uri !== 'string'
    || !uri.startsWith('node://')
    || uri.length <= 'node://'.length
    || /[\r\n]/.test(uri)
  ) throw invalidGrant()
  return { ...parsed, uri }
}

function prepareGrant(value: unknown): { expiresAt: number, headers: Headers, url: URL } {
  const grant = parsePresignedPutGrant(value)
  return {
    expiresAt: Date.parse(grant.expiresAt),
    headers: new Headers(grant.headers),
    url: new URL(grant.url),
  }
}

function requestInit(
  body: NonNullable<RequestInit['body']>,
  headers: Headers,
  signal: AbortSignal | undefined,
): RequestInit {
  const init: RequestInit & { duplex?: 'half' } = {
    method: 'PUT',
    headers,
    body,
    credentials: 'omit',
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    init.duplex = 'half'
  }
  return init
}

/**
 * 执行一次预签名 PUT。所有重定向都 fail closed，且拒绝平台凭证类 header。
 * 成功只返回稳定 ETag；响应体无论成功失败都不会进入错误消息。
 */
export async function putPresignedObject(
  grant: PresignedPutGrant | unknown,
  body: NonNullable<RequestInit['body']>,
  options: PutPresignedOptions = {},
): Promise<{ etag?: string }> {
  const parsed = prepareGrant(grant)
  if (parsed.expiresAt <= Date.now()) {
    throw new PresignedPutError(
      'expired',
      'upload grant expired before upload started',
      0,
      true,
    )
  }
  if (options.timeoutMs !== undefined && !validTimeout(options.timeoutMs)) throw invalidGrant()
  const fetcher = options.fetcher ?? globalThis.fetch
  if (typeof fetcher !== 'function') {
    throw new PresignedPutError('network', 'object upload request failed', 0, true)
  }

  let timeoutSignal: AbortSignal | undefined
  let signal: AbortSignal | undefined
  try {
    timeoutSignal = options.timeoutMs === undefined
      ? undefined
      : AbortSignal.timeout(options.timeoutMs)
    signal = options.signal === undefined
      ? timeoutSignal
      : timeoutSignal === undefined
        ? options.signal
        : AbortSignal.any([options.signal, timeoutSignal])
  } catch {
    throw invalidGrant()
  }

  let response: Response
  try {
    response = await fetcher(parsed.url, requestInit(body, parsed.headers, signal))
  } catch {
    if (options.signal?.aborted) {
      throw new PresignedPutError('aborted', 'object upload was aborted')
    }
    if (timeoutSignal?.aborted) {
      throw new PresignedPutError('timeout', 'object upload timed out', 0, true)
    }
    throw new PresignedPutError('network', 'object upload request failed', 0, true)
  }

  const etag = response.headers.get('etag')
  try {
    await response.body?.cancel()
  } catch {
    // HTTP status remains authoritative when a host cannot cancel the stream.
  }
  if (!response.ok) {
    if (response.status === 412) {
      throw new PresignedPutError('conflict', 'object already exists', 412)
    }
    throw new PresignedPutError(
      'http',
      `object upload returned HTTP ${response.status}`,
      response.status,
      response.status === 408 || response.status === 429 || response.status >= 500,
    )
  }
  return etag === null ? {} : { etag }
}
