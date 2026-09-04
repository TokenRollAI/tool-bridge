/**
 * Web 标准运行时全局(WebCrypto / TextEncoder / TextDecoder)的唯一类型落点。
 *
 * core 是宿主中立层(lib: ["ES2023"]、types: [],无 DOM 也无 @types/node),这些
 * 全局在 Workers 与 Node 22+ 均真实存在,但没有类型来源。此前九个文件各自就地
 * declare 最小形状且渐次分叉;现统一收敛于此。
 *
 * 用模块导出承接 `globalThis` 上的真实全局、而非 ambient `.d.ts`:core 以源码形态
 * 被下游各包在各自 tsconfig(DOM / workers-types / @types/node)下编译,模块作用域
 * 的绑定随 import 图走,既不污染任何全局作用域,也不与下游 lib 的同名全局声明冲突。
 * 类型取各使用点所需的**并集**;本模块不进 core 的公开导出面(index 不重导出)。
 */

/** WebCrypto key 的最小结构面;真实全局返回的 CryptoKey 结构兼容它。 */
export interface WebCryptoKey { readonly type: string }

interface WebSubtleCrypto {
  decrypt(
    algorithm: { additionalData?: Uint8Array, iv: Uint8Array, name: 'AES-GCM' },
    key: WebCryptoKey,
    data: ArrayBuffer | Uint8Array,
  ): Promise<ArrayBuffer>
  deriveKey(
    algorithm: { hash: 'SHA-256', info: Uint8Array, name: 'HKDF', salt: Uint8Array },
    baseKey: WebCryptoKey,
    derivedKeyType: { length: 256, name: 'AES-GCM' },
    extractable: false,
    keyUsages: ReadonlyArray<'decrypt' | 'encrypt'>,
  ): Promise<WebCryptoKey>
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
  encrypt(
    algorithm: { additionalData?: Uint8Array, iv: Uint8Array, name: 'AES-GCM' },
    key: WebCryptoKey,
    data: ArrayBuffer | Uint8Array,
  ): Promise<ArrayBuffer>
  importKey(
    format: 'raw',
    keyData: ArrayBuffer | Uint8Array,
    algorithm: 'HKDF' | { hash?: string, name: 'AES-GCM' | 'HMAC' },
    extractable: boolean,
    keyUsages: ReadonlyArray<'decrypt' | 'deriveKey' | 'encrypt' | 'sign'>,
  ): Promise<WebCryptoKey>
  sign(algorithm: 'HMAC', key: WebCryptoKey, data: Uint8Array): Promise<ArrayBuffer>
}

interface WebUrlSearchParams {
  delete(name: string): void
  get(name: string): string | null
  getAll(name: string): string[]
  has(name: string): boolean
  set(name: string, value: string): void
  toString(): string
}

interface WebGlobals {
  crypto: {
    getRandomValues<T extends Uint8Array>(array: T): T
    randomUUID(): string
    subtle: WebSubtleCrypto
  }
  TextDecoder: new (label?: string, options?: { fatal?: boolean }) => {
    decode(input: ArrayBuffer | Uint8Array): string
  }
  TextEncoder: new () => { encode(input: string): Uint8Array }
  URL: new (value: string) => {
    hash: string
    password: string
    protocol: string
    searchParams: WebUrlSearchParams
    toString(): string
    username: string
  }
  URLSearchParams: new (entries: [string, string][]) => WebUrlSearchParams
}

const g = globalThis as unknown as WebGlobals

export const URL = g.URL
export const URLSearchParams = g.URLSearchParams
export const crypto = g.crypto
export const TextDecoder = g.TextDecoder
export const TextEncoder = g.TextEncoder
