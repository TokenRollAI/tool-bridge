import { DEFAULT_STORE_NAME } from './types'
import { TBError } from '../errors'

/** 18-byte 随机 id 为 24 个 base64url 字符；上限为未来实现保留空间。 */
export const STORE_OBJECT_ID_RE = /^[A-Za-z0-9_-]{22,64}$/

export interface ParsedStoreUri {
  objectId: string
  store: typeof DEFAULT_STORE_NAME
}

export function storeUri(objectId: string): `store://${typeof DEFAULT_STORE_NAME}/${string}` {
  if (!STORE_OBJECT_ID_RE.test(objectId)) {
    throw new TBError('invalid_argument', '非法 Store object id')
  }
  return `store://${DEFAULT_STORE_NAME}/${objectId}`
}

/** 严格 URI：不接受 query/fragment/percent-encoding/trailing slash 或非 default store。 */
export function parseStoreUri(uri: unknown): ParsedStoreUri {
  if (typeof uri !== 'string') {
    throw new TBError('invalid_argument', 'Store URI 必须是字符串')
  }
  const prefix = `store://${DEFAULT_STORE_NAME}/`
  if (!uri.startsWith(prefix)) {
    throw new TBError('invalid_argument', 'Store URI 必须使用 store://default/<objectId>')
  }
  const objectId = uri.slice(prefix.length)
  if (!STORE_OBJECT_ID_RE.test(objectId)) {
    throw new TBError('invalid_argument', '非法 Store URI')
  }
  return { store: DEFAULT_STORE_NAME, objectId }
}
