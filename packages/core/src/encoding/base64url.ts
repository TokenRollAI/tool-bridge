/**
 * base64url(无填充)统一编解码——core 内唯一实现。
 *
 * 此前 secret/secretStore、auth/sk、search/types 各持一份手写实现,且解码
 * 严格度不一致:宽松的 6-bit 累加器会把非法长度输入(如 'A'、'AB···' 等
 * len%4===1 形态)静默解成截断字节,而解码结果直接喂给 AES-GCM 解密与
 * HMAC 验签。合并为唯一实现并统一采用严格语义:
 *   - 字符集必须全落在 base64url 字母表;
 *   - 拒绝 len%4===1 的非法长度;
 *   - 空串解码为空字节(是否拒绝空输入由调用方按语义决定)。
 * 仍手写而不引库/原生方法:core 纪律上唯一运行时依赖 zod,且
 * Uint8Array.fromBase64 在 engines 下限(Node 22)尚不可用。
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** 字节序列 → base64url(无填充)。 */
export function base64urlEncode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += ALPHABET[(n >>> 18) & 63]
    out += ALPHABET[(n >>> 12) & 63]
    if (i + 1 < bytes.length) out += ALPHABET[(n >>> 6) & 63]
    if (i + 2 < bytes.length) out += ALPHABET[n & 63]
  }
  return out
}

/** base64url(无填充)→ 字节序列;非法字符或非法长度(len%4===1)抛 Error。 */
export function base64urlDecode(input: string): Uint8Array {
  if (input.length % 4 === 1 || !/^[A-Za-z0-9_-]*$/.test(input)) {
    throw new Error('base64urlDecode: malformed base64url input')
  }
  const bytes: number[] = []
  for (let i = 0; i < input.length; i += 4) {
    const chunk = input.slice(i, i + 4)
    const a = ALPHABET.indexOf(chunk[0] ?? '')
    const b = ALPHABET.indexOf(chunk[1] ?? '')
    const c = chunk.length >= 3 ? ALPHABET.indexOf(chunk[2] ?? '') : 0
    const d = chunk.length >= 4 ? ALPHABET.indexOf(chunk[3] ?? '') : 0
    const n = (a << 18) | (b << 12) | (c << 6) | d
    bytes.push((n >>> 16) & 255)
    if (chunk.length >= 3) bytes.push((n >>> 8) & 255)
    if (chunk.length >= 4) bytes.push(n & 255)
  }
  return new Uint8Array(bytes)
}
