/**
 * Hermes-safe Context object direct upload.
 *
 * The device sends only object metadata to Tool Bridge. The binary body is sent
 * directly to the short-lived upload URL returned by the Context provider.
 */

import {
  normalizePath,
  TB_ERROR_CODES,
  TBError,
  type TBErrorBody,
  validatePath,
} from '@tool-bridge/core/device'
import type { DeviceCredentialProvider } from './connection'

export interface UploadContextObjectOptions {
  baseUrl: string
  body: NonNullable<RequestInit['body']>
  contentType: string
  contextPath: string
  credentialProvider: DeviceCredentialProvider
  deviceId: string
  entryPath: string
  fetcher?: typeof fetch
  /** 缺省 false：目标已存在时以 conflict 失败；true 才允许覆盖。 */
  overwrite?: boolean
  signal?: AbortSignal
}

export interface UploadContextObjectResult {
  etag?: string
  uri: string
}

interface ContextUploadGrant {
  expiresAt: string
  headers: Record<string, string>
  method: 'PUT'
  uri: string
  url: string
}

function invalidGatewayResponse(message: string): TBError {
  return new TBError('internal', message, { retryable: true })
}

function commandUrl(baseUrl: string, contextPath: string): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new TBError('invalid_argument', 'baseUrl must be an absolute HTTP(S) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TBError('invalid_argument', 'baseUrl must use http: or https:')
  }
  if (url.username !== '' || url.password !== '') {
    throw new TBError('invalid_argument', 'baseUrl must not contain userinfo')
  }

  const normalizedPath = normalizePath(contextPath)
  const pathError = validatePath(normalizedPath)
  if (pathError !== null) throw pathError

  const basePath = url.pathname.replace(/\/+$/, '')
  url.pathname = `${basePath}/${normalizedPath}/create_upload`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function isTBErrorBody(value: unknown): value is TBErrorBody {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const body = value as Record<string, unknown>
  return typeof body.code === 'string'
    && (TB_ERROR_CODES as readonly string[]).includes(body.code)
    && typeof body.message === 'string'
    && typeof body.retryable === 'boolean'
}

function errorFromBody(body: TBErrorBody, status: number): TBError | null {
  try {
    return new TBError(body.code, body.message, {
      retryable: body.retryable,
      ...(status === 401 && body.code === 'permission_denied' ? { httpStatus: 401 } : {}),
    })
  } catch {
    return null
  }
}

function fallbackErrorBody(status: number): TBErrorBody {
  if (status === 401 || status === 403) {
    return {
      code: 'permission_denied',
      message: `gateway returned HTTP ${status}`,
      retryable: false,
    }
  }
  return {
    code: 'internal',
    message: `gateway returned an invalid TBError response (HTTP ${status})`,
    retryable: true,
  }
}

async function tbResponseError(response: Response): Promise<{
  body: TBErrorBody
  error: TBError
}> {
  let decoded: unknown
  try {
    decoded = await response.json()
  } catch {
    // Fall through to a status-only error. Never echo an unrecognized body.
  }
  const body = isTBErrorBody(decoded) && errorFromBody(decoded, response.status) !== null
    ? decoded
    : fallbackErrorBody(response.status)
  const error = errorFromBody(body, response.status)
  if (error === null) {
    return {
      body: fallbackErrorBody(response.status),
      error: invalidGatewayResponse(
        `gateway returned an invalid TBError response (HTTP ${response.status})`,
      ),
    }
  }
  return { body, error }
}

function stringRecord(value: unknown): value is Record<string, string> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value).every(item => typeof item === 'string')
}

function parseGrant(value: unknown): ContextUploadGrant {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidGatewayResponse('gateway returned an invalid upload grant')
  }
  const grant = value as Record<string, unknown>
  if (
    typeof grant.uri !== 'string'
    || !grant.uri.startsWith('node://')
    || grant.method !== 'PUT'
    || typeof grant.url !== 'string'
    || typeof grant.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(grant.expiresAt))
    || !stringRecord(grant.headers)
  ) {
    throw invalidGatewayResponse('gateway returned an invalid upload grant')
  }

  let uploadUrl: URL
  try {
    uploadUrl = new URL(grant.url)
    // Constructing Headers also rejects malformed names and newline injection.
    new Headers(grant.headers)
  } catch {
    throw invalidGatewayResponse('gateway returned an invalid upload grant')
  }
  if (
    (uploadUrl.protocol !== 'http:' && uploadUrl.protocol !== 'https:')
    || uploadUrl.username !== ''
    || uploadUrl.password !== ''
  ) {
    throw invalidGatewayResponse('gateway returned an invalid upload grant')
  }

  return {
    uri: grant.uri,
    method: grant.method,
    url: uploadUrl.toString(),
    headers: grant.headers,
    expiresAt: grant.expiresAt,
  }
}

function httpCredentialHeaders(credential: Awaited<
  ReturnType<DeviceCredentialProvider['prepare']>
>): Headers {
  let headers: Headers
  try {
    headers = new Headers(credential.headers)
  } catch {
    throw new TBError('invalid_argument', 'device HTTP credential headers are invalid')
  }
  const authorization = headers.get('authorization')
  if (authorization === null || authorization.trim() === '') {
    throw new TBError(
      'invalid_argument',
      'device HTTP credential must include a non-empty Authorization header',
    )
  }
  return headers
}

/**
 * Request a path-scoped upload grant, then PUT the body directly to object storage.
 */
export async function uploadContextObject(
  opts: UploadContextObjectOptions,
): Promise<UploadContextObjectResult> {
  const signal = opts.signal ?? new AbortController().signal
  const fetcher = opts.fetcher ?? globalThis.fetch
  if (typeof fetcher !== 'function') {
    throw TBError.unimplemented('fetch is unavailable; provide uploadContextObject.fetcher')
  }

  const url = commandUrl(opts.baseUrl, opts.contextPath)
  const credential = await opts.credentialProvider.prepare({
    baseUrl: opts.baseUrl,
    deviceId: opts.deviceId,
    purpose: 'http',
    signal,
  })
  const requestHeaders = httpCredentialHeaders(credential)
  requestHeaders.set('accept', 'application/json')
  requestHeaders.set('content-type', 'application/json')

  let grantResponse: Response
  try {
    grantResponse = await fetcher(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        path: opts.entryPath,
        contentType: opts.contentType,
        ...(opts.overwrite === true ? { overwrite: true } : {}),
      }),
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new TBError('unavailable', 'upload grant request failed', { retryable: true })
  }
  if (!grantResponse.ok) {
    const failure = await tbResponseError(grantResponse)
    if (grantResponse.status === 401 || grantResponse.status === 403) {
      opts.credentialProvider.invalidate?.(failure.body)
    }
    throw failure.error
  }

  let decodedGrant: unknown
  try {
    decodedGrant = await grantResponse.json()
  } catch {
    throw invalidGatewayResponse('gateway returned an invalid upload grant')
  }
  const grant = parseGrant(decodedGrant)
  if (Date.parse(grant.expiresAt) <= Date.now()) {
    throw new TBError('unavailable', 'upload grant expired before upload started', {
      retryable: true,
    })
  }
  let uploadResponse: Response
  try {
    uploadResponse = await fetcher(grant.url, {
      method: grant.method,
      headers: grant.headers,
      body: opts.body,
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    // 原始 fetch 错误可能包含完整 presigned URL，不能把 bearer query 带进错误/日志。
    throw new TBError('unavailable', 'object upload request failed', { retryable: true })
  }
  const etag = uploadResponse.headers.get('etag')
  try {
    await uploadResponse.body?.cancel()
  } catch {
    // The status remains authoritative even if a host cannot cancel its response stream.
  }
  if (!uploadResponse.ok) {
    if (uploadResponse.status === 412) {
      throw new TBError(
        'conflict',
        'object already exists; set overwrite: true to replace it',
        { retryable: false },
      )
    }
    throw new TBError(
      'unavailable',
      `object upload failed with HTTP ${uploadResponse.status}`,
      { retryable: uploadResponse.status === 408 || uploadResponse.status === 429 || uploadResponse.status >= 500 },
    )
  }

  return {
    uri: grant.uri,
    ...(etag === null ? {} : { etag }),
  }
}
