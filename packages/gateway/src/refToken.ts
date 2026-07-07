/**
 * `/~ref/<token>` 中转下载 token(Proto §5.2 中转下载路由,Phase 3 定型)。
 *
 * token = base64url(JSON{p,k,exp}) + '.' + base64url(HMAC-SHA256(payload, 密钥))。
 * 密钥派生自 `TB_SECRET_ENCRYPTION_KEY`(信任根,env-only);语义与预签名 URL 对齐:
 * 限时、免 SK、不可伪造。验签失败/过期 → 调用方一律 404(不泄露)。
 * 仅依赖 WebCrypto(Workers 全局),无第三方依赖。
 */

import { base64urlDecode, base64urlEncode } from '@tool-bridge/core'

/** token 载荷:p = context 节点树路径,k = 底层对象 key,exp = 过期时刻(epoch 秒)。 */
export interface RefTokenPayload {
  p: string
  k: string
  exp: number
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signRefToken(payload: RefTokenPayload, secret: string): Promise<string> {
  const body = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const mac = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(body),
  )
  return `${body}.${base64urlEncode(new Uint8Array(mac))}`
}

/** 验签 + 结构校验;任何失败(格式/签名/形状)→ null。过期判定留给调用方(便于测钟)。 */
export async function verifyRefToken(
  token: string,
  secret: string,
): Promise<RefTokenPayload | null> {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  let sig: Uint8Array
  try {
    sig = base64urlDecode(token.slice(dot + 1))
  } catch {
    return null
  }
  const ok = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    // Node 的 WebCrypto 类型要求 Uint8Array<ArrayBuffer>;base64urlDecode 的产物满足但类型面是 ArrayBufferLike。
    sig as Uint8Array<ArrayBuffer>,
    new TextEncoder().encode(body),
  )
  if (!ok) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body))) as RefTokenPayload
    if (
      typeof payload.p !== 'string' ||
      typeof payload.k !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      return null
    }
    return payload
  } catch {
    return null
  }
}
