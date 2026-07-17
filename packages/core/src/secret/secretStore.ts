/**
 * SecretStore:上游凭证的"只进不出"加密保管。
 *
 * 值经 AES-256-GCM 加密后写入注入的 StateStore(key 布局 `secret:<name>`,store.ts)。
 * 主密钥 `TB_SECRET_ENCRYPTION_KEY` 是部署期 env-only 的 base64url(32 字节)——
 * 信任根不自举存储(spec-digest)。主密钥缺失/格式非法时能力禁用:Set 抛 unavailable。
 *
 * 纯逻辑,仅依赖 WebCrypto(core 无宿主依赖)。`crypto` / `TextEncoder` / `TextDecoder`
 * 在 Workers 与 Node 20+ 均为全局;此处以模块作用域最小声明补齐类型(不改 tsconfig、不污染全局)。
 */

import {
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  type ListOptions,
  type Page,
  type Timestamp,
} from '../types'
import { KEY_SECRET, type StateStore } from '../store'
import { TBError } from '../errors'

// ---------- 最小 WebCrypto 类型声明(模块作用域) ----------

type Aes256GcmKeyBytes = ArrayBuffer | Uint8Array

interface MinimalCryptoKey {
  readonly type: string
}

interface MinimalSubtleCrypto {
  decrypt(
    algorithm: { iv: Uint8Array, name: 'AES-GCM' },
    key: MinimalCryptoKey,
    data: Aes256GcmKeyBytes,
  ): Promise<ArrayBuffer>
  encrypt(
    algorithm: { iv: Uint8Array, name: 'AES-GCM' },
    key: MinimalCryptoKey,
    data: Aes256GcmKeyBytes,
  ): Promise<ArrayBuffer>
  importKey(
    format: 'raw',
    keyData: Aes256GcmKeyBytes,
    algorithm: { name: 'AES-GCM' },
    extractable: boolean,
    keyUsages: Array<'encrypt' | 'decrypt'>,
  ): Promise<MinimalCryptoKey>
}

declare const crypto: {
  getRandomValues(array: Uint8Array): Uint8Array
  subtle: MinimalSubtleCrypto
}
declare const TextEncoder: { new (): { encode(input: string): Uint8Array } }
declare const TextDecoder: { new (): { decode(input: ArrayBuffer | Uint8Array): string } }

// ---------- base64url 编解码(手写:不依赖 Buffer / btoa / atob) ----------

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** 字节序列 → base64url(无填充)。 */
export function base64urlEncode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0
    const hasB1 = i + 1 < bytes.length
    const hasB2 = i + 2 < bytes.length
    const b1 = bytes[i + 1] ?? 0
    const b2 = bytes[i + 2] ?? 0
    out += B64URL_ALPHABET.charAt(b0 >> 2)
    out += B64URL_ALPHABET.charAt(((b0 & 0x03) << 4) | (b1 >> 4))
    if (!hasB1) break
    out += B64URL_ALPHABET.charAt(((b1 & 0x0f) << 2) | (b2 >> 6))
    if (!hasB2) break
    out += B64URL_ALPHABET.charAt(b2 & 0x3f)
  }
  return out
}

/** base64url → 字节序列;遇非法字符抛错(供主密钥格式校验)。 */
export function base64urlDecode(input: string): Uint8Array {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const ch of input) {
    const val = B64URL_ALPHABET.indexOf(ch)
    if (val === -1) {
      throw new Error(`base64urlDecode: invalid character ${JSON.stringify(ch)}`)
    }
    buffer = (buffer << 6) | val
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

// ---------- 存储记录形状 ----------

/** StateStore 中 `secret:<name>` 的落盘值——只存密文,绝不含明文。 */
interface StoredSecret {
  /** AES-256-GCM 密文(含 GCM tag,base64url)。 */
  ciphertext: string
  /** 每次 Set 随机生成的 12 字节 IV(base64url)。 */
  iv: string
  updatedAt: Timestamp
}

const AES_GCM_IV_BYTES = 12
const MASTER_KEY_BYTES = 32

function isStoredSecret(value: unknown): value is StoredSecret {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as StoredSecret).iv === 'string'
    && typeof (value as StoredSecret).ciphertext === 'string'
    && typeof (value as StoredSecret).updatedAt === 'string'
  )
}

/**
 * name 校验:空 → invalid_argument。含 ':' 的名字是**平台内部保留命名空间**
 * (如 `plugin-token:<id>`,platform-token 注记)——impl 层放行(平台代码
 * 直接调 set),节点面(builtin/secret 的 set/delete cmd)拒绝,防止用户伪造/误删平台凭证。
 */
function assertValidName(name: string): void {
  if (name.length === 0) {
    throw new TBError(
      'invalid_argument',
      `secret name must be non-empty (got ${JSON.stringify(name)})`,
    )
  }
}

/**
 * SecretStore 的纯逻辑实现。以注入的 StateStore 为后端。
 *
 * 主密钥缺失或格式非法(非 base64url / 非 32 字节)→ 实例处于 **unavailable 态**:
 * Set 抛 unavailable,resolve 返回 undefined(见方法注释)。
 */
export class SecretStoreImpl {
  private readonly store: StateStore
  /** 32 字节主密钥;undefined 表示 unavailable 态。 */
  private readonly keyBytes: Uint8Array | undefined
  /** 惰性导入的 CryptoKey(仅可用时);首次加解密时创建并缓存。 */
  private importedKey: Promise<MinimalCryptoKey> | undefined

  /**
   * @param masterKey base64url 编码的 32 字节(TB_SECRET_ENCRYPTION_KEY);
   *   undefined / 解码失败 / 长度非 32 → 实例处于 unavailable 态。
   */
  constructor(store: StateStore, masterKey: string | undefined) {
    this.store = store
    this.keyBytes = SecretStoreImpl.decodeMasterKey(masterKey)
  }

  private static decodeMasterKey(masterKey: string | undefined): Uint8Array | undefined {
    if (masterKey === undefined) {
      return undefined
    }
    let decoded: Uint8Array
    try {
      decoded = base64urlDecode(masterKey)
    } catch {
      return undefined
    }
    return decoded.length === MASTER_KEY_BYTES ? decoded : undefined
  }

  /** secret 能力是否可用(主密钥有效)。 */
  get available(): boolean {
    return this.keyBytes !== undefined
  }

  private key(): Promise<MinimalCryptoKey> {
    if (this.keyBytes === undefined) {
      // 调用方(set/resolve)已先行处理 unavailable;此处仅为类型收窄兜底。
      throw new TBError('unavailable', 'secret store master key is not configured')
    }
    if (this.importedKey === undefined) {
      this.importedKey = crypto.subtle.importKey('raw', this.keyBytes, { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt',
      ])
    }
    return this.importedKey
  }

  /**
   * 写入 / 替换 secret;明文仅在此请求中出现。
   * unavailable 态 → 抛 unavailable(retryable:false):主密钥缺失时 Set 不可用。
   */
  async set(name: string, value: string, now: Timestamp): Promise<void> {
    assertValidName(name)
    if (this.keyBytes === undefined) {
      throw new TBError('unavailable', 'secret store unavailable: master key not configured', {
        retryable: false,
      })
    }
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES))
    const plaintext = new TextEncoder().encode(value)
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await this.key(),
      plaintext,
    )
    const record: StoredSecret = {
      iv: base64urlEncode(iv),
      ciphertext: base64urlEncode(new Uint8Array(ciphertext)),
      updatedAt: now,
    }
    await this.store.put(`${KEY_SECRET}${name}`, record)
  }

  /**
   * 枚举 secret 元数据。**绝不返回明文/密文**——只出 name + updatedAt(只进不出)。
   * limit 默认 50、上限 200 钳制。
   */
  async list(opts?: ListOptions): Promise<Page<{ name: string, updatedAt: Timestamp }>> {
    const limit = Math.min(opts?.limit ?? LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX)
    const { items, cursor } = await this.store.list(KEY_SECRET, { cursor: opts?.cursor, limit })
    return {
      items: items.map(({ key, value }) => ({
        name: key.slice(KEY_SECRET.length),
        updatedAt: isStoredSecret(value) ? value.updatedAt : '',
      })),
      cursor,
    }
  }

  /** 删除 secret;不存在 → not_found。 */
  async delete(name: string): Promise<void> {
    const existing = await this.store.get(`${KEY_SECRET}${name}`)
    if (existing === null) {
      throw new TBError('not_found', `secret not found: ${JSON.stringify(name)}`)
    }
    await this.store.delete(`${KEY_SECRET}${name}`)
  }

  /**
   * 解密并返回明文(不存在 → undefined)。
   *
   * **仅供网关内部 Provider 解析引用名(authRef/skRef/secretRef);不暴露为节点 cmd**
   * (节点面只有 Set/List/Delete,resolve 不是 cmd)。
   * unavailable 态 → 返回 undefined:主密钥缺失时无从解密,与"引用名不存在"同样处理为不可解析,
   * 由 Provider 侧降级(避免在数据面抛 unavailable)。
   */
  async resolve(name: string): Promise<string | undefined> {
    if (this.keyBytes === undefined) {
      return undefined
    }
    const record = await this.store.get(`${KEY_SECRET}${name}`)
    if (!isStoredSecret(record)) {
      return undefined
    }
    const iv = base64urlDecode(record.iv)
    const ciphertext = base64urlDecode(record.ciphertext)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      await this.key(),
      ciphertext,
    )
    return new TextDecoder().decode(plaintext)
  }
}
