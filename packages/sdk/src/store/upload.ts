import { TBError, type TBErrorBody } from '@tool-bridge/core/device'
import {
  parseStoreObjectDescriptor,
  parseStoreUploadGrant,
  type StoreChecksum,
  storeChecksumSchema,
  type StoreObjectDescriptor,
  type StoreUploadGrant,
} from './wire'
import {
  decodeStoreJson,
  networkError,
  resolveStoreFetcher,
  storeCommandUrl,
  tbResponseError,
  throwIfAborted,
  uploadRequestInit,
} from './transport'
import { PresignedPutError, putPresignedObject } from '../client/presignedPut'

export interface PreparedStoreCredential {
  headers?: Readonly<Record<string, string>>
}

/** Minimal HTTP credential contract shared by Node, browser, RN, and device adapters. */
export interface StoreCredentialProvider {
  invalidate?(reason: TBErrorBody): void
  prepare(input: {
    baseUrl: string
    deviceId: string
    purpose?: 'http' | 'websocket'
    signal: AbortSignal
  }): Promise<PreparedStoreCredential> | PreparedStoreCredential
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
  credentialProvider: StoreCredentialProvider
  deviceId: string
  fetcher?: typeof fetch
  signal?: AbortSignal
}

/** Upload options exposed inside a device call; connection/capability details stay hidden. */
export type CallUploadObjectOptions = UploadObjectInput

export interface CapabilityUploadOptions extends UploadObjectInput {
  baseUrl: string
  capabilityMaxBytes: number
  capabilityToken: string
  deviceId: string
  fetcher?: typeof fetch
  signal?: AbortSignal
}

type UploadAuthorization
  = | {
    credentialProvider: StoreCredentialProvider
    kind: 'credential'
  }
  | {
    capabilityToken: string
    kind: 'call-capability'
  }

function safeHeaderToken(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false
  try {
    new Headers({ 'x-tb-token-check': value })
    return true
  } catch {
    return false
  }
}

function httpCredentialHeaders(
  credential: Awaited<ReturnType<StoreCredentialProvider['prepare']>>,
): Headers {
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
  for (const name of headers.keys()) {
    if (
      name === 'cookie'
      || name === 'cookie2'
      || name === 'proxy-authorization'
      || name.startsWith('x-tb-')
    ) {
      throw new TBError(
        'invalid_argument',
        `device HTTP credential cannot set reserved header '${name}'`,
      )
    }
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

function validByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function invalidUploadGrant(): never {
  throw new TBError('internal', 'gateway returned an invalid Store upload grant', {
    retryable: true,
  })
}

async function stableUploadResponseError(
  response: Response,
  prefix: string,
  signal: AbortSignal,
): Promise<{ body: TBErrorBody, error: TBError }> {
  // 解析 code/retryable，但上传链路绝不信任上游 message：driver 可能回显私有 body，
  // credential provider 也可以使用无法穷举名字的自定义 header。
  const failure = await tbResponseError(response, [], signal)
  const message = `${prefix} with HTTP ${response.status}`
  const body: TBErrorBody = { ...failure.body, message }
  return {
    body,
    error: new TBError(body.code, message, {
      retryable: body.retryable,
      ...(response.status === 401 && body.code === 'permission_denied'
        ? { httpStatus: 401 }
        : {}),
    }),
  }
}

/** relay grant 只能指回同一网关签发的唯一 uploadId 路由。 */
function validateRelayTarget(baseUrl: string, grant: StoreUploadGrant): void {
  if (grant.transport !== 'relay') return
  const base = new URL(storeCommandUrl(baseUrl, 'create_upload'))
  const target = new URL(grant.url)
  if (
    target.origin !== base.origin
    || target.pathname !== `/~store/uploads/${encodeURIComponent(grant.uploadId)}`
    || target.search !== ''
    || target.hash !== ''
  ) invalidUploadGrant()
}

function validateUploadInput(input: UploadObjectInput): number | undefined {
  if (
    typeof input.contentType !== 'string'
    || input.contentType.trim() === ''
    || /[\r\n]/.test(input.contentType)
  ) throw new TBError('invalid_argument', 'contentType must be a non-empty media type')
  if (input.filename !== undefined && /[\r\n]/.test(input.filename)) {
    throw new TBError('invalid_argument', 'filename must not contain a newline')
  }
  if (
    input.idempotencyKey !== undefined
    && (input.idempotencyKey.trim() === '' || /[\r\n]/.test(input.idempotencyKey))
  ) throw new TBError('invalid_argument', 'idempotencyKey must be non-empty when provided')
  if (input.checksum !== undefined && !storeChecksumSchema.safeParse(input.checksum).success) {
    throw new TBError('invalid_argument', 'checksum must use sha256 and include a value')
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

async function uploadObjectAuthorized(
  opts: Omit<UploadObjectOptions, 'credentialProvider'>,
  authorization: UploadAuthorization,
  capabilityMaxBytes?: number,
): Promise<StoreObjectDescriptor> {
  const signal = opts.signal ?? new AbortController().signal
  const fetcher = resolveStoreFetcher(opts.fetcher)
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
      throw new TBError('unavailable', 'device call upload capability is unavailable')
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
      credentials: 'omit',
      redirect: 'error',
      signal,
    })
  } catch (error) {
    networkError(error, 'Store upload grant request failed', signal)
  }
  if (!grantResponse.ok) {
    const failure = await stableUploadResponseError(
      grantResponse,
      'Store upload grant request failed',
      signal,
    )
    if (
      authorization.kind === 'credential'
      && (grantResponse.status === 401 || grantResponse.status === 403)
    ) authorization.credentialProvider.invalidate?.(failure.body)
    throw failure.error
  }
  const grant = parseStoreUploadGrant(await decodeStoreJson(
    grantResponse,
    'gateway returned an invalid Store upload grant',
    signal,
  ))
  validateRelayTarget(opts.baseUrl, grant)
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

  if (grant.transport === 'relay') {
    const uploadHeaders = new Headers(grant.headers)
    const grantedToken = uploadHeaders.get('x-tb-store-upload')
    if (grantedToken !== null && grantedToken !== grant.uploadToken) {
      invalidUploadGrant()
    }
    uploadHeaders.set('x-tb-store-upload', grant.uploadToken)
    let uploadResponse: Response
    try {
      uploadResponse = await fetcher(grant.url, uploadRequestInit(opts.body, {
        method: grant.method,
        headers: uploadHeaders,
        credentials: 'omit',
        redirect: 'error',
        signal,
      }))
    } catch (error) {
      networkError(error, 'Store object upload request failed', signal)
    }
    if (!uploadResponse.ok) {
      const failure = await stableUploadResponseError(
        uploadResponse,
        'Store object upload failed',
        signal,
      )
      throw failure.error
    }
    return parseStoreObjectDescriptor(await decodeStoreJson(
      uploadResponse,
      'gateway returned an invalid Store object descriptor',
      signal,
    ), grant.objectUri)
  }

  try {
    await putPresignedObject(grant, opts.body, { fetcher, signal })
  } catch (error) {
    if (!(error instanceof PresignedPutError)) {
      networkError(error, 'Store object upload request failed', signal)
    }
    if (error.kind === 'aborted') throwIfAborted(signal)
    if (error.kind === 'invalid') invalidUploadGrant()
    if (error.kind === 'expired') {
      throw new TBError('unavailable', 'Store upload grant expired before upload started', {
        retryable: true,
      })
    }
    if (error.kind === 'http' || error.kind === 'conflict') {
      throw new TBError(
        'unavailable',
        `Store object upload failed with HTTP ${error.status}`,
        { retryable: error.retryable },
      )
    }
    throw new TBError('unavailable', 'Store object upload request failed', { retryable: true })
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
      credentials: 'omit',
      redirect: 'error',
      signal,
    })
  } catch (error) {
    networkError(error, 'Store upload completion request failed', signal)
  }
  if (!completeResponse.ok) {
    const failure = await stableUploadResponseError(
      completeResponse,
      'Store upload completion failed',
      signal,
    )
    throw failure.error
  }
  return parseStoreObjectDescriptor(await decodeStoreJson(
    completeResponse,
    'gateway returned an invalid Store object descriptor',
    signal,
  ), grant.objectUri)
}

/** Upload a new object using ordinary Store HTTP credentials. */
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
