import {
  createStoreClient,
  type StoreClientObjectDescriptor,
  type StoreListOptions,
  type StoreListPage,
  type StoreReadGrant,
  type StoreShareGrant,
  TBError,
  type StoreObjectDescriptor as UploadedStoreObjectDescriptor,
} from '@tool-bridge/sdk/store'
import { ApiError, type Connection } from './api'

export type {
  StoreListPage,
  StoreClientObjectDescriptor as StoreObjectDescriptor,
  StoreReadGrant,
  StoreShareGrant,
  UploadedStoreObjectDescriptor,
}

/** SDK 要求绝对 URL；Dashboard 的空 baseUrl 表示与当前页面同源。 */
function resolveStoreBaseUrl(baseUrl: string): string {
  const value = baseUrl.trim()
  let url: URL
  try {
    if (value === '') {
      const origin = globalThis.location?.origin
      if (origin === undefined || origin === 'null') throw new Error('missing browser origin')
      url = new URL(origin)
    } else {
      try {
        url = new URL(value)
      } catch {
        const href = globalThis.location?.href
        if (href === undefined) throw new Error('missing browser location')
        url = new URL(value, href)
      }
    }
  } catch {
    throw new ApiError('invalid_argument', 400, '无法解析 Store BaseURL')
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username !== ''
    || url.password !== ''
  ) throw new ApiError('invalid_argument', 400, 'Store BaseURL 必须是无 userinfo 的 HTTP(S) URL')
  return url.toString()
}

function storeClient(conn: Connection) {
  return createStoreClient({
    baseUrl: resolveStoreBaseUrl(conn.baseUrl),
    sk: conn.sk,
    // 间接调用保留测试和宿主在运行时替换 fetch 的能力。
    fetcher: (input, init) => globalThis.fetch(input, init),
  })
}

async function withApiError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof TBError) {
      const status = Number.isSafeInteger(error.httpStatus) ? error.httpStatus : 500
      throw new ApiError(error.code, status, error.message, error.retryable)
    }
    throw error
  }
}

export async function uploadStoreObject(
  conn: Connection,
  file: File,
  input: { filename?: string, idempotencyKey?: string } = {},
  signal?: AbortSignal,
): Promise<UploadedStoreObjectDescriptor> {
  return await withApiError(async () => await storeClient(conn).upload({
    body: file,
    contentType: file.type || 'application/octet-stream',
    filename: input.filename ?? file.name,
    size: file.size,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    signal,
  }))
}

export async function listStoreObjects(
  conn: Connection,
  opts: StoreListOptions = {},
  signal?: AbortSignal,
): Promise<StoreListPage> {
  return await withApiError(async () => await storeClient(conn).list({ ...opts, signal }))
}

export async function statStoreObject(
  conn: Connection,
  uri: string,
  signal?: AbortSignal,
): Promise<StoreClientObjectDescriptor> {
  return await withApiError(async () => await storeClient(conn).stat(uri, { signal }))
}

export async function readStoreObject(
  conn: Connection,
  uri: string,
  signal?: AbortSignal,
): Promise<StoreReadGrant> {
  return await withApiError(async () => await storeClient(conn).read(uri, { signal }))
}

export async function shareStoreObject(
  conn: Connection,
  uri: string,
  ttlSec?: number,
): Promise<StoreShareGrant> {
  return await withApiError(async () => await storeClient(conn).share(uri, { ttlSec }))
}

export async function revokeStoreShare(conn: Connection, shareId: string): Promise<void> {
  await withApiError(async () => await storeClient(conn).revokeShare(shareId))
}

export async function deleteStoreObject(conn: Connection, uri: string): Promise<void> {
  await withApiError(async () => await storeClient(conn).delete(uri))
}
