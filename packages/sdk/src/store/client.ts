import { TBError } from '@tool-bridge/core/device'
import {
  parseStoreClientObjectDescriptor,
  parseStoreListPage,
  parseStoreReadGrant,
  parseStoreShareGrant,
  parseStoreUri,
  type StoreClientObjectDescriptor,
  type StoreListPage,
  type StoreObjectDescriptor,
  type StoreReadGrant,
  type StoreShareGrant,
} from './wire'
import {
  decodeStoreJson,
  resolveStoreFetcher,
  storeCommandUrl,
  tbResponseError,
} from './transport'
import {
  uploadObject,
  type UploadObjectInput,
} from './upload'
import { validTimeout } from '../shared/transport'

export interface StoreClientOptions {
  baseUrl: string
  fetcher?: typeof fetch
  /** Raw Tool Bridge SK, resolved again for every control request to allow rotation. */
  sk: string | (() => Promise<string> | string)
  /** 单次请求默认超时；缺省不创建 SDK timer。与固定控制面 client 的 timeoutMs 同语义。 */
  timeoutMs?: number
  /** Additional exact origins allowed to host gateway-issued Store bearer URLs. */
  trustedRefOrigins?: readonly string[]
}

export interface StoreListOptions {
  cursor?: string
  limit?: number
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
  /** Upload returns the device-safe stable view; use stat for management metadata. */
  upload(input: UploadObjectInput & { signal?: AbortSignal }): Promise<StoreObjectDescriptor>
}

function validSecret(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !/[\r\n]/.test(value)
}

function validShareId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !/[\r\n]/.test(value)
}

function parseTrustedOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TBError('invalid_argument', 'trusted Store ref origin is invalid')
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username !== ''
    || url.password !== ''
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== ''
  ) throw new TBError('invalid_argument', 'trusted Store ref origin must be an HTTP(S) origin')
  return url.origin
}

function parseTrustedOrigins(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(origin => typeof origin !== 'string')) {
    throw new TBError('invalid_argument', 'trustedRefOrigins must be an array of origins')
  }
  return value.map(parseTrustedOrigin)
}

export function createStoreClient(options: StoreClientOptions): StoreClient {
  const fetcher = resolveStoreFetcher(options.fetcher)
  if (options.timeoutMs !== undefined && !validTimeout(options.timeoutMs)) {
    throw new TBError('invalid_argument', 'Store client timeoutMs is invalid')
  }
  /**
   * timeoutMs 与调用方 signal 组合成单一 signal;超时中止在此边界重分类为
   * retryable unavailable(内部各链路把一切 abort 当调用方中止透传,不足以区分)。
   */
  const guarded = async <T>(
    callerSignal: AbortSignal | undefined,
    run: (signal: AbortSignal | undefined) => Promise<T>,
  ): Promise<T> => {
    if (options.timeoutMs === undefined) return await run(callerSignal)
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs)
    const signal = callerSignal === undefined
      ? timeoutSignal
      : AbortSignal.any([callerSignal, timeoutSignal])
    try {
      return await run(signal)
    } catch (error) {
      if (timeoutSignal.aborted && callerSignal?.aborted !== true) {
        throw new TBError('unavailable', 'Store request timed out', { retryable: true })
      }
      throw error
    }
  }
  const controlOrigin = new URL(storeCommandUrl(options.baseUrl, 'read')).origin
  const trustedRefOrigins = new Set([
    controlOrigin,
    ...parseTrustedOrigins(options.trustedRefOrigins),
  ])
  const validateRef = <T extends StoreReadGrant | StoreShareGrant>(
    grant: T,
    family: 'refs' | 'shares',
  ): T => {
    const url = new URL(grant.$ref)
    const prefix = `/~store/${family}/`
    const token = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : ''
    if (
      !trustedRefOrigins.has(url.origin)
      || url.search !== ''
      || url.hash !== ''
      || !/^[A-Za-z0-9._~-]+$/.test(token)
    ) {
      throw new TBError('internal', 'gateway returned an invalid Store bearer URL', {
        retryable: true,
      })
    }
    return grant
  }
  const resolveSk = async (): Promise<string> => {
    const sk = typeof options.sk === 'function' ? await options.sk() : options.sk
    if (!validSecret(sk)) throw new TBError('invalid_argument', 'Store client SK is invalid')
    return sk
  }
  const control = async (
    command: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    // Resolve credentials before the fetch boundary so local configuration errors
    // are never mislabeled as retryable network failures.
    const sk = await resolveSk()
    let response: Response
    try {
      response = await fetcher(storeCommandUrl(options.baseUrl, command), {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${sk}`,
          'accept': 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        credentials: 'omit',
        redirect: 'error',
        signal,
      })
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
      throw new TBError('unavailable', 'Store control request failed', { retryable: true })
    }
    if (!response.ok) {
      throw (await tbResponseError(response, [sk, `Bearer ${sk}`], signal)).error
    }
    return await decodeStoreJson(response, 'gateway returned an invalid Store response', signal)
  }

  return {
    async upload(input) {
      return await guarded(input.signal, async signal => await uploadObject({
        ...input,
        ...(signal === undefined ? {} : { signal }),
        baseUrl: options.baseUrl,
        deviceId: 'store-client',
        fetcher,
        credentialProvider: {
          prepare: async () => ({ headers: { authorization: `Bearer ${await resolveSk()}` } }),
        },
      }))
    },
    async stat(uri, opts) {
      const expectedUri = parseStoreUri(uri)
      return await guarded(opts?.signal, async signal => parseStoreClientObjectDescriptor(
        await control('stat', { uri: expectedUri }, signal),
        expectedUri,
      ))
    },
    async list(opts = {}) {
      const { signal, ...pageOpts } = opts
      return await guarded(signal, async composed =>
        parseStoreListPage(await control('list', { opts: pageOpts }, composed)))
    },
    async read(uri, opts) {
      const expectedUri = parseStoreUri(uri)
      return await guarded(opts?.signal, async signal => validateRef(parseStoreReadGrant(
        await control('read', { uri: expectedUri }, signal),
        expectedUri,
      ), 'refs'))
    },
    async download(uri, opts) {
      const expectedUri = parseStoreUri(uri)
      return await guarded(opts?.signal, async (signal) => {
        const grant = validateRef(parseStoreReadGrant(
          await control('read', { uri: expectedUri }, signal),
          expectedUri,
        ), 'refs')
        if (Date.parse(grant.expiresAt) <= Date.now()) {
          throw new TBError('internal', 'gateway returned an expired Store read grant', {
            retryable: true,
          })
        }
        try {
          const response = await fetcher(grant.$ref, {
            credentials: 'omit',
            redirect: 'error',
            signal,
          })
          if (response.ok) return response
          await response.body?.cancel()
          throw new TBError('unavailable', `Store download returned HTTP ${response.status}`, {
            retryable: response.status === 408 || response.status === 429 || response.status >= 500,
          })
        } catch (error) {
          if (error instanceof TBError) throw error
          if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
            throw error
          }
          // The raw fetch error can contain the bearer URL; never forward it.
          throw new TBError('unavailable', 'Store download failed', { retryable: true })
        }
      })
    },
    async share(uri, opts) {
      const expectedUri = parseStoreUri(uri)
      return await guarded(opts?.signal, async signal =>
        validateRef(parseStoreShareGrant(await control('share', {
          uri: expectedUri,
          ...(opts?.ttlSec === undefined ? {} : { ttlSec: opts.ttlSec }),
        }, signal), expectedUri), 'shares'))
    },
    async revokeShare(shareId, opts) {
      if (!validShareId(shareId)) {
        throw new TBError('invalid_argument', 'Store shareId must be non-empty')
      }
      await guarded(opts?.signal, async signal => await control('revoke_share', { shareId }, signal))
    },
    async delete(uri, opts) {
      const expectedUri = parseStoreUri(uri)
      await guarded(opts?.signal, async signal => await control('delete', { uri: expectedUri }, signal))
    },
  }
}
