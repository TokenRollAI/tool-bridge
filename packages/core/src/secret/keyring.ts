import { base64urlDecode } from '../encoding/base64url'
import { TBError } from '../errors'

/** Roots live in the host's protected bootstrap secret file, never in their own encrypted database. */
export interface EncryptionKeyring {
  activeKeyId: string
  keys: Record<string, string>
}

export function validateEncryptionKeyring(input: EncryptionKeyring | string): EncryptionKeyring {
  const value = typeof input === 'string' ? { activeKeyId: 'k1', keys: { k1: input } } : input
  if (!value || typeof value.activeKeyId !== 'string' || !value.keys || typeof value.keys !== 'object'
    || !Object.hasOwn(value.keys, value.activeKeyId)) throw new TBError('invalid_argument', 'encryption keyring has no active encryption key')
  for (const [id, root] of Object.entries(value.keys)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof root !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/.test(root) || base64urlDecode(root).length !== 32) {
      throw new TBError('invalid_argument', 'encryption key must be 32-byte base64url with a valid keyId')
    }
  }
  return { activeKeyId: value.activeKeyId, keys: { ...value.keys } }
}

/** Explicit single-key convenience for embedded hosts and fixtures; persisted ciphertext always has keyId. */
export function createEncryptionKeyring(root: string, keyId = 'k1'): EncryptionKeyring {
  return validateEncryptionKeyring({ activeKeyId: keyId, keys: { [keyId]: root } })
}

/** Separate signing roots; encryption-root rotation must not invalidate outstanding capabilities. */
export interface StoreTokenKeyring {
  activeKeyId: string
  keys: Record<string, string>
}

export function validateStoreTokenKeyring(input: StoreTokenKeyring | string): StoreTokenKeyring {
  const value = typeof input === 'string' ? { activeKeyId: 'k1', keys: { k1: input } } : input
  if (!value || typeof value.activeKeyId !== 'string' || !value.keys || typeof value.keys !== 'object' || Array.isArray(value.keys) || !Object.hasOwn(value.keys, value.activeKeyId)) {
    throw new TBError('invalid_argument', 'Store token keyring has no active key')
  }
  for (const [id, root] of Object.entries(value.keys)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof root !== 'string' || root.length < 16) {
      throw new TBError('invalid_argument', 'Store tokenSecret 至少需要 16 个字符且 keyId 必须有效')
    }
  }
  return { activeKeyId: value.activeKeyId, keys: { ...value.keys } }
}
