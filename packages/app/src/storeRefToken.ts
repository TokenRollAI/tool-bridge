/**
 * Store owner-read ref token.
 *
 * This token deliberately has a payload and HMAC domain independent from the
 * Context `/~ref` token. A signed Store ref only carries an opaque object id
 * and a short expiry; it never exposes the driver key or owner.
 */
import {
  base64urlDecode,
  base64urlEncode,
  type StoreTokenKeyring,
  validateStoreTokenKeyring,
} from '@tool-bridge/core'

export interface StoreRefTokenPayload {
  exp: number
  objectId: string
  v: 1
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`tb-store-read-ref:v1:${secret}`),
  )
  return crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signStoreRefToken(
  payload: StoreRefTokenPayload,
  secret: string | StoreTokenKeyring,
): Promise<string> {
  const ring = validateStoreTokenKeyring(secret)
  const body = base64urlEncode(
    new TextEncoder().encode(
      JSON.stringify({ ...payload, kid: ring.activeKeyId }),
    ),
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(ring.keys[ring.activeKeyId]!),
    new TextEncoder().encode(body),
  )
  return `${body}.${base64urlEncode(new Uint8Array(mac))}`
}

export async function verifyStoreRefToken(
  token: string,
  secret: string | StoreTokenKeyring,
): Promise<StoreRefTokenPayload | null> {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const ring = validateStoreTokenKeyring(secret)
  let kid: string
  try {
    kid = (
      JSON.parse(new TextDecoder().decode(base64urlDecode(body))) as {
        kid: string
      }
    ).kid
  } catch {
    return null
  }
  if (!Object.hasOwn(ring.keys, kid)) return null
  let signature: Uint8Array
  try {
    signature = base64urlDecode(token.slice(dot + 1))
  } catch {
    return null
  }
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(ring.keys[kid]!),
    signature as Uint8Array<ArrayBuffer>,
    new TextEncoder().encode(body),
  )
  if (!valid) return null
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(body)),
    ) as StoreRefTokenPayload
    if (
      payload.v !== 1
      || typeof payload.objectId !== 'string'
      || payload.objectId.length < 1
      || typeof payload.exp !== 'number'
      || !Number.isSafeInteger(payload.exp)
    )
      return null
    return { exp: payload.exp, objectId: payload.objectId, v: payload.v }
  } catch {
    return null
  }
}
