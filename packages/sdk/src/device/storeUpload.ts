/**
 * Hermes-safe default Store upload client.
 *
 * Control requests go to Tool Bridge while bytes use the relay/presigned URL
 * from the short-lived grant. Bearer URLs and upload tokens never enter the
 * returned descriptor or client-created error messages.
 */

import {
  TB_ERROR_CODES,
  TBError,
  type TBErrorBody,
} from '@tool-bridge/core/device'
import type { DeviceCredentialProvider } from './connection'

export interface StoreChecksum {
  algorithm: string
  value: string
}

/** Stable, JSON-safe public view of a ready Store object. */
export interface StoreObjectDescriptor {
  checksum?: StoreChecksum
  contentType: string
  createdAt: string
  etag?: string
  filename?: string
  readyAt: string
  size: number
  uri: `store://default/${string}`
}

export interface UploadObjectInput {
  body: NonNullable<RequestInit['body']>
  checksum?: StoreChecksum
  contentType: string
  filename?: string
  idempotencyKey?: string
  /** Expected byte length. Known in-memory body sizes are inferred when omitted. */
  size?: number
}

export interface UploadObjectOptions extends UploadObjectInput {
  baseUrl: string
  credentialProvider: DeviceCredentialProvider
  deviceId: string
  fetcher?: typeof fetch
  signal?: AbortSignal
}

/** Upload options exposed inside a device call; connection/capability details stay hidden. */
export type CallUploadObjectOptions = UploadObjectInput

interface StoreUploadGrant {
  alreadyCompleted?: boolean
  descriptor?: StoreObjectDescriptor
  expiresAt: string
  headers: Record<string, string>
  maxBytes: number
  method: 'PUT'
  objectUri: `store://default/${string}`
  transport: 'presigned-put' | 'relay'
  uploadId: string
  uploadToken: string
  url: string
}

interface CapabilityUploadOptions extends UploadObjectInput {
  baseUrl: string
  capabilityMaxBytes: number
  capabilityToken: string
  deviceId: string
  fetcher?: typeof fetch
  signal?: AbortSignal
}

type UploadAuthorization
  = | {
    credentialProvider: DeviceCredentialProvider
    kind: 'credential'
  }
  | {
    capabilityToken: string
    kind: 'call-capability'
  }

function invalidGatewayResponse(message: string): TBError {
  return new TBError('internal', message, { retryable: true })
}

function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

function storeCommandUrl(baseUrl: string, command: 'complete_upload' | 'create_upload'): string {
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
  const basePath = url.pathname.replace(/\/+$/, '')
  url.pathname = `${basePath}/system/store/${command}`
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

function sanitizedGatewayMessage(
  message: string,
  status: number,
  sensitiveValues: readonly string[],
): string {
  const authorizationParts = sensitiveValues.flatMap((value) => {
    const bearer = /^Bearer\s+(.+)$/i.exec(value)
    return bearer?.[1] === undefined ? [value] : [value, bearer[1]]
  })
  if (
    /https?:\/\/[^\s"'<>]+/i.test(message)
    || authorizationParts.some(value => value !== '' && message.includes(value))
  ) {
    return `gateway returned a redacted error (HTTP ${status})`
  }
  return message
}

async function tbResponseError(
  response: Response,
  sensitiveValues: readonly string[] = [],
): Promise<{
  body: TBErrorBody
  error: TBError
}> {
  let decoded: unknown
  try {
    decoded = await response.json()
  } catch {
    // Status-only fallback deliberately avoids echoing an unrecognized body.
  }
  const body = isTBErrorBody(decoded) && errorFromBody(decoded, response.status) !== null
    ? {
        ...decoded,
        message: sanitizedGatewayMessage(decoded.message, response.status, sensitiveValues),
      }
    : fallbackErrorBody(response.status)
  const error = errorFromBody(body, response.status)
  if (error !== null) return { body, error }
  const fallback = fallbackErrorBody(response.status)
  return {
    body: fallback,
    error: invalidGatewayResponse(
      `gateway returned an invalid TBError response (HTTP ${response.status})`,
    ),
  }
}

function stringRecord(value: unknown): value is Record<string, string> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value).every(item => typeof item === 'string')
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validByteCount(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
}

function validStoreUri(value: unknown): value is `store://default/${string}` {
  return typeof value === 'string' && /^store:\/\/default\/[^/?#]+$/.test(value)
}

function validChecksum(value: unknown): value is StoreChecksum {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const checksum = value as Record<string, unknown>
  return nonEmptyString(checksum.algorithm) && nonEmptyString(checksum.value)
}

function safeHeaders(value: unknown): value is Record<string, string> {
  if (!stringRecord(value)) return false
  try {
    new Headers(value)
    return true
  } catch {
    return false
  }
}

function safeHeaderToken(value: unknown): value is string {
  if (!nonEmptyString(value)) return false
  try {
    new Headers({ 'x-tb-token-check': value })
    return true
  } catch {
    return false
  }
}

function sensitiveHeaderValues(headers: Headers): string[] {
  const values: string[] = []
  for (const [name, value] of headers.entries()) {
    if (
      name === 'authorization'
      || name === 'proxy-authorization'
      || name === 'cookie'
      || /(?:token|secret|signature|credential|proof|capability|api-key)/i.test(name)
    ) values.push(value)
  }
  return values
}

/** @internal Shared by the authenticated Store management client. */
export function parseStoreObjectDescriptor(
  value: unknown,
  expectedUri: string,
): StoreObjectDescriptor {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidGatewayResponse('gateway returned an invalid Store object descriptor')
  }
  const descriptor = value as Record<string, unknown>
  if (
    !validStoreUri(descriptor.uri)
    || descriptor.uri !== expectedUri
    || !nonEmptyString(descriptor.contentType)
    || !validByteCount(descriptor.size)
    || !validTimestamp(descriptor.createdAt)
    || !validTimestamp(descriptor.readyAt)
    || (descriptor.filename !== undefined && typeof descriptor.filename !== 'string')
    || (descriptor.etag !== undefined && typeof descriptor.etag !== 'string')
    || (descriptor.checksum !== undefined && !validChecksum(descriptor.checksum))
  ) {
    throw invalidGatewayResponse('gateway returned an invalid Store object descriptor')
  }
  return {
    uri: descriptor.uri,
    contentType: descriptor.contentType,
    size: descriptor.size,
    createdAt: descriptor.createdAt,
    readyAt: descriptor.readyAt,
    ...(descriptor.filename === undefined ? {} : { filename: descriptor.filename }),
    ...(descriptor.checksum === undefined
      ? {}
      : {
          checksum: {
            algorithm: descriptor.checksum.algorithm,
            value: descriptor.checksum.value,
          },
        }),
    ...(descriptor.etag === undefined ? {} : { etag: descriptor.etag }),
  }
}

function parseGrant(value: unknown): StoreUploadGrant {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidGatewayResponse('gateway returned an invalid Store upload grant')
  }
  const grant = value as Record<string, unknown>
  if (
    !nonEmptyString(grant.uploadId)
    || !validStoreUri(grant.objectUri)
    || (grant.transport !== 'relay' && grant.transport !== 'presigned-put')
    || grant.method !== 'PUT'
    || !nonEmptyString(grant.url)
    || !safeHeaders(grant.headers)
    || !validTimestamp(grant.expiresAt)
    || !validByteCount(grant.maxBytes)
    || grant.maxBytes === 0
    || !safeHeaderToken(grant.uploadToken)
  ) {
    throw invalidGatewayResponse('gateway returned an invalid Store upload grant')
  }

  let uploadUrl: URL
  try {
    uploadUrl = new URL(grant.url)
  } catch {
    throw invalidGatewayResponse('gateway returned an invalid Store upload grant')
  }
  if (
    (uploadUrl.protocol !== 'http:' && uploadUrl.protocol !== 'https:')
    || uploadUrl.username !== ''
    || uploadUrl.password !== ''
  ) {
    throw invalidGatewayResponse('gateway returned an invalid Store upload grant')
  }

  const parsed: StoreUploadGrant = {
    uploadId: grant.uploadId,
    objectUri: grant.objectUri,
    transport: grant.transport,
    method: grant.method,
    url: uploadUrl.toString(),
    headers: grant.headers,
    expiresAt: grant.expiresAt,
    maxBytes: grant.maxBytes,
    uploadToken: grant.uploadToken,
  }
  if (grant.alreadyCompleted !== undefined) {
    if (grant.alreadyCompleted !== true || grant.descriptor === undefined) {
      throw invalidGatewayResponse('gateway returned an invalid Store upload grant')
    }
    parsed.alreadyCompleted = true
    parsed.descriptor = parseStoreObjectDescriptor(grant.descriptor, grant.objectUri)
  } else if (grant.descriptor !== undefined) {
    throw invalidGatewayResponse('gateway returned an invalid Store upload grant')
  }
  return parsed
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

function bodyByteLength(body: NonNullable<RequestInit['body']>): number | undefined {
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size
  if (typeof ArrayBuffer !== 'undefined') {
    if (body instanceof ArrayBuffer) return body.byteLength
    if (ArrayBuffer.isView(body)) return body.byteLength
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString()).byteLength
  }
  return undefined
}

function uploadRequestInit(
  body: NonNullable<RequestInit['body']>,
  init: Omit<RequestInit, 'body'>,
): RequestInit {
  const request: RequestInit & { duplex?: 'half' } = { ...init, body }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    // Node's native fetch requires this for streaming request bodies. `duplex`
    // is a Web fetch extension and unknown dictionary fields are ignored by
    // browser/RN implementations that do not expose it in their TypeScript lib.
    request.duplex = 'half'
  }
  return request
}

function validateUploadInput(input: UploadObjectInput): number | undefined {
  if (!nonEmptyString(input.contentType) || /[\r\n]/.test(input.contentType)) {
    throw new TBError('invalid_argument', 'contentType must be a non-empty media type')
  }
  if (input.filename !== undefined && /[\r\n]/.test(input.filename)) {
    throw new TBError('invalid_argument', 'filename must not contain a newline')
  }
  if (input.idempotencyKey !== undefined && !nonEmptyString(input.idempotencyKey)) {
    throw new TBError('invalid_argument', 'idempotencyKey must be non-empty when provided')
  }
  if (input.checksum !== undefined && !validChecksum(input.checksum)) {
    throw new TBError('invalid_argument', 'checksum must include algorithm and value')
  }
  if (input.size !== undefined && !validByteCount(input.size)) {
    throw new TBError('invalid_argument', 'size must be a non-negative safe integer')
  }
  const knownSize = bodyByteLength(input.body)
  if (input.size !== undefined && knownSize !== undefined && input.size !== knownSize) {
    throw new TBError('invalid_argument', 'size does not match the upload body byte length')
  }
  return input.size ?? knownSize
}

function networkError(error: unknown, message: string, signal: AbortSignal): never {
  if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
    throw abortError()
  }
  // Never embed the raw fetch error: runtimes commonly include the signed URL.
  throw new TBError('unavailable', message, { retryable: true })
}

async function decodeJson(response: Response, message: string): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw invalidGatewayResponse(message)
  }
}

async function uploadObjectAuthorized(
  opts: Omit<UploadObjectOptions, 'credentialProvider'>,
  authorization: UploadAuthorization,
  capabilityMaxBytes?: number,
): Promise<StoreObjectDescriptor> {
  const signal = opts.signal ?? new AbortController().signal
  const fetcher = opts.fetcher ?? globalThis.fetch
  if (typeof fetcher !== 'function') {
    throw TBError.unimplemented('fetch is unavailable; provide uploadObject.fetcher')
  }
  const createUrl = storeCommandUrl(opts.baseUrl, 'create_upload')
  const expectedSize = validateUploadInput(opts)
  if (
    capabilityMaxBytes !== undefined
    && expectedSize !== undefined
    && expectedSize > capabilityMaxBytes
  ) {
    throw new TBError('invalid_argument', 'upload exceeds the device call capability maxBytes')
  }
  throwIfAborted(signal)

  let requestHeaders: Headers
  if (authorization.kind === 'credential') {
    const credential = await authorization.credentialProvider.prepare({
      baseUrl: opts.baseUrl,
      deviceId: opts.deviceId,
      purpose: 'http',
      signal,
    })
    throwIfAborted(signal)
    requestHeaders = httpCredentialHeaders(credential)
  } else {
    if (!safeHeaderToken(authorization.capabilityToken)) {
      throw new TBError('unavailable', 'device call upload capability is unavailable', {
        retryable: false,
      })
    }
    requestHeaders = new Headers({
      'x-tb-store-capability': authorization.capabilityToken,
    })
  }
  requestHeaders.set('accept', 'application/json')
  requestHeaders.set('content-type', 'application/json')

  let grantResponse: Response
  try {
    grantResponse = await fetcher(createUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        contentType: opts.contentType,
        ...(opts.filename === undefined ? {} : { filename: opts.filename }),
        ...(expectedSize === undefined ? {} : { size: expectedSize }),
        ...(opts.checksum === undefined ? {} : { checksum: opts.checksum }),
        ...(opts.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: opts.idempotencyKey }),
      }),
      signal,
    })
  } catch (error) {
    networkError(error, 'Store upload grant request failed', signal)
  }
  if (!grantResponse.ok) {
    const failure = await tbResponseError(grantResponse, sensitiveHeaderValues(requestHeaders))
    if (
      authorization.kind === 'credential'
      && (grantResponse.status === 401 || grantResponse.status === 403)
    ) {
      authorization.credentialProvider.invalidate?.(failure.body)
    }
    throw failure.error
  }
  const grant = parseGrant(await decodeJson(
    grantResponse,
    'gateway returned an invalid Store upload grant',
  ))
  if (grant.alreadyCompleted === true && grant.descriptor !== undefined) {
    return grant.descriptor
  }
  if (Date.parse(grant.expiresAt) <= Date.now()) {
    throw new TBError('unavailable', 'Store upload grant expired before upload started', {
      retryable: true,
    })
  }
  if (expectedSize !== undefined && expectedSize > grant.maxBytes) {
    throw new TBError('invalid_argument', 'upload exceeds the Store grant maxBytes')
  }
  throwIfAborted(signal)

  const uploadHeaders = new Headers(grant.headers)
  if (grant.transport === 'relay') {
    const grantedToken = uploadHeaders.get('x-tb-store-upload')
    if (grantedToken !== null && grantedToken !== grant.uploadToken) {
      throw invalidGatewayResponse('gateway returned an invalid Store upload grant')
    }
    uploadHeaders.set('x-tb-store-upload', grant.uploadToken)
  }

  let uploadResponse: Response
  try {
    uploadResponse = await fetcher(grant.url, uploadRequestInit(opts.body, {
      method: grant.method,
      headers: uploadHeaders,
      signal,
    }))
  } catch (error) {
    networkError(error, 'Store object upload request failed', signal)
  }

  if (grant.transport === 'relay') {
    if (!uploadResponse.ok) {
      const failure = await tbResponseError(uploadResponse, [
        grant.uploadToken,
        grant.url,
        ...sensitiveHeaderValues(uploadHeaders),
      ])
      throw failure.error
    }
    return parseStoreObjectDescriptor(await decodeJson(
      uploadResponse,
      'gateway returned an invalid Store object descriptor',
    ), grant.objectUri)
  }

  try {
    await uploadResponse.body?.cancel()
  } catch {
    // The status remains authoritative if a host cannot cancel the response stream.
  }
  if (!uploadResponse.ok) {
    throw new TBError(
      'unavailable',
      `Store object upload failed with HTTP ${uploadResponse.status}`,
      {
        retryable: uploadResponse.status === 408
          || uploadResponse.status === 429
          || uploadResponse.status >= 500,
      },
    )
  }
  throwIfAborted(signal)

  const completeHeaders = new Headers({
    'accept': 'application/json',
    'content-type': 'application/json',
    'x-tb-store-upload': grant.uploadToken,
  })
  let completeResponse: Response
  try {
    completeResponse = await fetcher(storeCommandUrl(opts.baseUrl, 'complete_upload'), {
      method: 'POST',
      headers: completeHeaders,
      body: JSON.stringify({ uploadId: grant.uploadId }),
      signal,
    })
  } catch (error) {
    networkError(error, 'Store upload completion request failed', signal)
  }
  if (!completeResponse.ok) {
    const failure = await tbResponseError(completeResponse, [grant.uploadToken, grant.url])
    throw failure.error
  }
  return parseStoreObjectDescriptor(await decodeJson(
    completeResponse,
    'gateway returned an invalid Store object descriptor',
  ), grant.objectUri)
}

/**
 * Upload a new object to the deployment's default Store using device HTTP credentials.
 */
export async function uploadObject(opts: UploadObjectOptions): Promise<StoreObjectDescriptor> {
  return await uploadObjectAuthorized(opts, {
    kind: 'credential',
    credentialProvider: opts.credentialProvider,
  })
}

/** @internal Used by connectDevice's call-scoped authoring surface. */
export async function uploadObjectWithCapability(
  opts: CapabilityUploadOptions,
): Promise<StoreObjectDescriptor> {
  return await uploadObjectAuthorized(opts, {
    kind: 'call-capability',
    capabilityToken: opts.capabilityToken,
  }, opts.capabilityMaxBytes)
}
