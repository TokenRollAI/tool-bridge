import {
  type StoreObjectDescriptor as CoreStoreObjectDescriptor,
  TB_ERROR_CODES,
  TBError,
  type TBErrorBody,
} from '@tool-bridge/core'
import {
  parseStoreObjectDescriptor,
  type StoreObjectDescriptor,
  uploadObject,
  type UploadObjectInput,
} from './device/storeUpload'

export interface StoreClientOptions {
  baseUrl: string
  fetcher?: typeof fetch
  /** Raw Tool Bridge SK, resolved again for every control request to allow rotation. */
  sk: string | (() => Promise<string> | string)
}

export interface StoreReadGrant {
  /** Short-lived bearer URL. Keep it out of logs/history and fetch it immediately. */
  $ref: string
  contentType: string
  expiresAt: string
  size: number
  uri: `store://default/${string}`
}

export interface StoreShareGrant {
  /** Short-lived, revocable bearer URL. */
  $ref: string
  expiresAt: string
  shareId: string
  uri: `store://default/${string}`
}

export interface StoreListOptions {
  cursor?: string
  limit?: number
}

/** Full public descriptor returned by the authenticated Store management API. */
export type StoreClientObjectDescriptor = Omit<CoreStoreObjectDescriptor, 'uri'> & {
  uri: `store://default/${string}`
}

export interface StoreListPage {
  cursor?: string
  items: StoreClientObjectDescriptor[]
}

export interface StoreClient {
  delete(uri: string, opts?: { signal?: AbortSignal }): Promise<void>
  /** Resolve an owner ref and stream the object body without buffering it. */
  download(uri: string, opts?: { signal?: AbortSignal }): Promise<Response>
  list(opts?: StoreListOptions & { signal?: AbortSignal }): Promise<StoreListPage>
  read(uri: string, opts?: { signal?: AbortSignal }): Promise<StoreReadGrant>
  revokeShare(shareId: string, opts?: { signal?: AbortSignal }): Promise<void>
  share(
    uri: string,
    opts?: { signal?: AbortSignal, ttlSec?: number },
  ): Promise<StoreShareGrant>
  stat(uri: string, opts?: { signal?: AbortSignal }): Promise<StoreClientObjectDescriptor>
  /** Upload returns the device-safe stable view; use stat when management metadata is needed. */
  upload(input: UploadObjectInput & { signal?: AbortSignal }): Promise<StoreObjectDescriptor>
}

function commandUrl(baseUrl: string, command: string): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new TBError('invalid_argument', 'baseUrl must be an absolute HTTP(S) URL')
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username !== ''
    || url.password !== ''
  ) throw new TBError('invalid_argument', 'baseUrl must be an HTTP(S) URL without userinfo')
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/system/store/${command}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function validErrorBody(value: unknown): value is TBErrorBody {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const body = value as Record<string, unknown>
  return typeof body.code === 'string'
    && (TB_ERROR_CODES as readonly string[]).includes(body.code)
    && typeof body.message === 'string'
    && typeof body.retryable === 'boolean'
}

function safeServerMessage(message: string, status: number): string {
  return /https?:\/\/[^\s"'<>]+/i.test(message)
    ? `gateway returned a redacted error (HTTP ${status})`
    : message
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validUri(value: unknown): value is `store://default/${string}` {
  return typeof value === 'string' && /^store:\/\/default\/[A-Za-z0-9_-]{22,64}$/.test(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function parseStoreClientObjectDescriptor(
  value: unknown,
  expectedUri: string,
): StoreClientObjectDescriptor {
  const stable = parseStoreObjectDescriptor(value, expectedUri)
  const descriptor = value as Record<string, unknown>
  const checksum = descriptor.checksum as Record<string, unknown> | undefined
  if (
    descriptor.status !== 'ready'
    || !nonEmptyString(descriptor.owner)
    || !validTimestamp(descriptor.updatedAt)
    || (descriptor.producer !== undefined && !nonEmptyString(descriptor.producer))
    || (descriptor.originCallId !== undefined && !nonEmptyString(descriptor.originCallId))
    || (descriptor.expiresAt !== undefined && !validTimestamp(descriptor.expiresAt))
    || (checksum !== undefined && checksum.algorithm !== 'sha256')
  ) throw new TBError('internal', 'gateway returned an invalid Store object descriptor')

  return {
    uri: stable.uri,
    status: 'ready',
    contentType: stable.contentType,
    size: stable.size,
    owner: descriptor.owner,
    createdAt: stable.createdAt,
    updatedAt: descriptor.updatedAt,
    readyAt: stable.readyAt,
    ...(stable.filename === undefined ? {} : { filename: stable.filename }),
    ...(stable.etag === undefined ? {} : { etag: stable.etag }),
    ...(stable.checksum === undefined
      ? {}
      : { checksum: { algorithm: 'sha256' as const, value: stable.checksum.value } }),
    ...(descriptor.producer === undefined ? {} : { producer: descriptor.producer }),
    ...(descriptor.originCallId === undefined
      ? {}
      : { originCallId: descriptor.originCallId }),
    ...(descriptor.expiresAt === undefined ? {} : { expiresAt: descriptor.expiresAt }),
  }
}

function parseRef(value: unknown, kind: 'read' | 'share'): StoreReadGrant | StoreShareGrant {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TBError('internal', `gateway returned an invalid Store ${kind} grant`)
  }
  const grant = value as Record<string, unknown>
  let ref: URL
  try {
    ref = new URL(String(grant.$ref))
  } catch {
    throw new TBError('internal', `gateway returned an invalid Store ${kind} grant`)
  }
  if (
    !validUri(grant.uri)
    || !validTimestamp(grant.expiresAt)
    || (ref.protocol !== 'https:' && ref.protocol !== 'http:')
    || ref.username !== ''
    || ref.password !== ''
  ) throw new TBError('internal', `gateway returned an invalid Store ${kind} grant`)
  if (kind === 'share') {
    if (typeof grant.shareId !== 'string' || grant.shareId === '') {
      throw new TBError('internal', 'gateway returned an invalid Store share grant')
    }
    return {
      $ref: ref.toString(),
      uri: grant.uri,
      shareId: grant.shareId,
      expiresAt: grant.expiresAt,
    }
  }
  if (
    typeof grant.contentType !== 'string'
    || !Number.isSafeInteger(grant.size)
    || (grant.size as number) < 0
  ) throw new TBError('internal', 'gateway returned an invalid Store read grant')
  return {
    $ref: ref.toString(),
    uri: grant.uri,
    contentType: grant.contentType,
    size: grant.size as number,
    expiresAt: grant.expiresAt,
  }
}

export function createStoreClient(options: StoreClientOptions): StoreClient {
  const fetcher = options.fetcher ?? globalThis.fetch
  if (typeof fetcher !== 'function') {
    throw TBError.unimplemented('fetch is unavailable; provide createStoreClient.fetcher')
  }
  const resolveSk = async (): Promise<string> => {
    const sk = typeof options.sk === 'function' ? await options.sk() : options.sk
    if (typeof sk !== 'string' || sk.trim() === '' || /[\r\n]/.test(sk)) {
      throw new TBError('invalid_argument', 'Store client SK is invalid')
    }
    return sk
  }
  const control = async (
    command: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    // Resolve and validate credentials before the transport boundary so a local
    // configuration error is not mislabeled as a retryable network failure.
    const sk = await resolveSk()
    let response: Response
    try {
      response = await fetcher(commandUrl(options.baseUrl, command), {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${sk}`,
          'accept': 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
      throw new TBError('unavailable', 'Store control request failed', { retryable: true })
    }
    let decoded: unknown
    try {
      decoded = await response.json()
    } catch {
      // Do not echo an unrecognized response body; it may contain a signed URL.
    }
    if (!response.ok) {
      if (validErrorBody(decoded)) {
        throw new TBError(decoded.code, safeServerMessage(decoded.message, response.status), {
          retryable: decoded.retryable,
          ...(response.status === 401 ? { httpStatus: 401 } : {}),
        })
      }
      throw new TBError('internal', `gateway returned HTTP ${response.status}`, {
        retryable: response.status >= 500,
      })
    }
    return decoded
  }

  return {
    async upload(input) {
      return await uploadObject({
        ...input,
        baseUrl: options.baseUrl,
        deviceId: 'store-client',
        fetcher,
        credentialProvider: {
          prepare: async () => ({ headers: { authorization: `Bearer ${await resolveSk()}` } }),
        },
      })
    },
    async stat(uri, opts) {
      return parseStoreClientObjectDescriptor(
        await control('stat', { uri }, opts?.signal),
        uri,
      )
    },
    async list(opts = {}) {
      const { signal, ...pageOpts } = opts
      const decoded = await control('list', { opts: pageOpts }, signal)
      if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
        throw new TBError('internal', 'gateway returned an invalid Store list page')
      }
      const page = decoded as Record<string, unknown>
      if (!Array.isArray(page.items) || (page.cursor !== undefined && typeof page.cursor !== 'string')) {
        throw new TBError('internal', 'gateway returned an invalid Store list page')
      }
      return {
        items: page.items.map((item) => {
          const uri = (item as { uri?: unknown } | null)?.uri
          if (!validUri(uri)) throw new TBError('internal', 'gateway returned an invalid Store list page')
          return parseStoreClientObjectDescriptor(item, uri)
        }),
        ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
      }
    },
    async read(uri, opts) {
      return parseRef(await control('read', { uri }, opts?.signal), 'read') as StoreReadGrant
    },
    async download(uri, opts) {
      const grant = parseRef(
        await control('read', { uri }, opts?.signal),
        'read',
      ) as StoreReadGrant
      try {
        const response = await fetcher(grant.$ref, { signal: opts?.signal })
        if (response.ok) return response
        await response.body?.cancel()
        throw new TBError('unavailable', `Store download returned HTTP ${response.status}`, {
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        })
      } catch (error) {
        if (error instanceof TBError) throw error
        if (opts?.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
        throw new TBError('unavailable', 'Store download failed', { retryable: true })
      }
    },
    async share(uri, opts) {
      return parseRef(await control('share', {
        uri,
        ...(opts?.ttlSec === undefined ? {} : { ttlSec: opts.ttlSec }),
      }, opts?.signal), 'share') as StoreShareGrant
    },
    async revokeShare(shareId, opts) {
      await control('revoke_share', { shareId }, opts?.signal)
    },
    async delete(uri, opts) {
      await control('delete', { uri }, opts?.signal)
    },
  }
}
