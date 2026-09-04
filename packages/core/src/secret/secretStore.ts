/**
 * SecretStore:上游凭证的"只进不出"加密保管。
 *
 * 值经 AES-256-GCM 加密后写入注入的 StateStore(key 布局 `secret:<name>`,store.ts)。
 * 版本化加密根由宿主受保护 bootstrap keyring 注入，密文保存 keyId 与 revision。
 * 信任根不存入被其加密的数据库；缺失/格式非法时能力禁用。
 *
 * 纯逻辑,仅依赖 WebCrypto(core 无宿主依赖)。`crypto` / `TextEncoder` / `TextDecoder`
 * 在支持的 JavaScript/Node 运行时均为全局;类型经 webGlobals.ts 统一承接(不改 tsconfig、不污染全局)。
 */

import {
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  type ListOptions,
  type Page,
  type Timestamp,
} from '../types'
import { crypto, TextDecoder, TextEncoder, type WebCryptoKey } from '../webGlobals'
import { type EncryptionKeyring, validateEncryptionKeyring } from './keyring'
import { base64urlDecode, base64urlEncode } from '../encoding/base64url'
import { KEY_SECRET, type StateStore } from '../store'
// ---------- base64url 编解码(统一实现见 encoding/base64url,公开面由 index 直接导出) ----------
import { TBError } from '../errors'

// ---------- 存储记录形状 ----------

/** system/secret list 的一行(名字与时间戳,永不含值);CLI/Dashboard 经 SDK 消费同一命名。 */
export interface SecretEntrySummary {
  name: string
  updatedAt: Timestamp
}

/** StateStore 中 `secret:<name>` 的落盘值——只存密文,绝不含明文。 */
export interface StoredSecret {
  /** AES-256-GCM 密文(含 GCM tag,base64url)。 */
  ciphertext: string
  /** 每次 Set 随机生成的 12 字节 IV(base64url)。 */
  iv: string
  keyId: string
  revision: number
  updatedAt: Timestamp
}

const AES_GCM_IV_BYTES = 12

function isStoredSecret(value: unknown): value is StoredSecret {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as StoredSecret).keyId === 'string'
    && Number.isSafeInteger((value as StoredSecret).revision)
    && (value as StoredSecret).revision > 0
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
  private readonly keyring: EncryptionKeyring | undefined
  private readonly importedKeys = new Map<string, Promise<WebCryptoKey>>()

  constructor(store: StateStore, keys: EncryptionKeyring | string | undefined) {
    this.store = store
    try {
      this.keyring = keys === undefined ? undefined : validateEncryptionKeyring(keys)
    } catch {
      this.keyring = undefined
    }
  }

  get available(): boolean { return this.keyring !== undefined }

  private key(id: string): Promise<WebCryptoKey> {
    const root = this.keyring?.keys[id]
    if (root === undefined) throw new TBError('unavailable', 'secret encryption key is unavailable')
    let key = this.importedKeys.get(id)
    if (key === undefined) {
      key = crypto.subtle.importKey('raw', base64urlDecode(root), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
      this.importedKeys.set(id, key)
    }
    return key
  }

  private async encrypt(name: string, value: string, now: Timestamp, revision: number): Promise<StoredSecret> {
    const keyId = this.keyring?.activeKeyId
    if (keyId === undefined) throw new TBError('unavailable', 'secret store master key is not configured', { retryable: false })
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES))
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`tb:secret:${name}:${keyId}`) },
      await this.key(keyId), new TextEncoder().encode(value),
    )
    return { keyId, revision, iv: base64urlEncode(iv), ciphertext: base64urlEncode(new Uint8Array(ciphertext)), updatedAt: now }
  }

  private async decrypt(name: string, record: StoredSecret): Promise<string> {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64urlDecode(record.iv), additionalData: new TextEncoder().encode(`tb:secret:${name}:${record.keyId}`) },
      await this.key(record.keyId), base64urlDecode(record.ciphertext),
    )
    return new TextDecoder().decode(plaintext)
  }

  /**
   * 写入 / 替换 secret;明文仅在此请求中出现。
   * unavailable 态 → 抛 unavailable(retryable:false):主密钥缺失时 Set 不可用。
   */
  async set(name: string, value: string, now: Timestamp): Promise<void> {
    assertValidName(name)
    if (!this.available || this.store.compareAndSwap === undefined) {
      throw new TBError('unavailable', 'secret store requires an encryption key and atomic writes', { retryable: false })
    }
    for (let attempt = 0; attempt < 16; attempt++) {
      const current = await this.store.get(`${KEY_SECRET}${name}`)
      if (current !== null && !isStoredSecret(current)) throw new TBError('internal', 'secret ciphertext is invalid')
      const revision = current === null ? 1 : (current as StoredSecret).revision + 1
      const record = await this.encrypt(name, value, now, revision)
      if (await this.store.compareAndSwap(`${KEY_SECRET}${name}`, current === null ? null : revision - 1, record)) return
    }
    throw new TBError('conflict', 'secret changed concurrently')
  }

  /**
   * 枚举 secret 元数据。**绝不返回明文/密文**——只出 name + updatedAt(只进不出)。
   * limit 默认 50、上限 200 钳制。
   */
  async list(opts?: ListOptions): Promise<Page<SecretEntrySummary>> {
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
   * unavailable 态(主密钥缺失)同样返回 undefined——本层不区分"无从解密"与"引用名不存在"。
   * **消费侧契约:配置声明了引用却拿到 undefined 必须 fail closed**(抛 unavailable),
   * 不得降级为无凭证/匿名出站——上游可能据此当匿名放行或返回误导性结果。
   * 各 Provider(remote/mcp/http/pluginClient)均按此实现。
   */
  async resolve(name: string): Promise<string | undefined> {
    if (!this.available) return undefined
    const record = await this.store.get(`${KEY_SECRET}${name}`)
    if (!isStoredSecret(record)) return undefined
    return this.decrypt(name, record)
  }

  /** Bounded, resumable re-encryption. Concurrent credential replacement wins over stale ciphertext. */
  async reencryptPage(opts: { cursor?: string, limit?: number } = {}): Promise<{ changed: number, cursor?: string }> {
    if (!this.keyring || !this.store.compareAndSwap) throw new TBError('unavailable', 'secret re-encryption is unavailable')
    const page = await this.store.list(KEY_SECRET, { ...opts, limit: Math.min(opts.limit ?? 100, 200) })
    let changed = 0
    for (const item of page.items) {
      if (!isStoredSecret(item.value)) throw new TBError('internal', 'secret ciphertext is invalid')
      if (item.value.keyId === this.keyring.activeKeyId) continue
      const name = item.key.slice(KEY_SECRET.length)
      const next = await this.encrypt(name, await this.decrypt(name, item.value), item.value.updatedAt, item.value.revision + 1)
      if (await this.store.compareAndSwap(item.key, item.value.revision, next)) changed++
    }
    return { changed, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) }
  }
}
