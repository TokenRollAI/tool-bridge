/**
 * ObjectStore:对象存储抽象(Proto §7,Phase 3 修订形状)。
 *
 * r2(R2 binding)、s3(aws4fetch)与单测内存实现共用此接口;ContextProvider 的
 * 四动词语义全部落在 objectProvider.ts,后端只做本接口适配。core 无 DOM lib:
 * 流与 body 用最小结构类型声明,与 Workers / Node 的全局 ReadableStream 结构兼容。
 */

import { TBError } from '../errors'

declare const TextEncoder: { new (): { encode(input: string): Uint8Array } }
declare const TextDecoder: { new (): { decode(input: Uint8Array): string } }

/** 最小读流(结构兼容全局 ReadableStream<Uint8Array>)。 */
export interface ObjectBodyStream {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>
    releaseLock(): void
  }
}

/** put 可接受的 body 形态(BodyInit 子集;core 无 DOM lib 故自声明)。 */
export type ObjectBody = string | Uint8Array | ArrayBuffer | ObjectBodyStream

export interface ObjectMeta {
  key: string
  etag: string
  size: number
  contentType?: string
  updatedAt: string
  metadata: Record<string, string>
}

export interface ObjectPutOptions {
  contentType?: string
  metadata?: Record<string, string>
  /** 与现存对象 etag 不符(含对象不存在)→ TBError conflict。 */
  ifMatchEtag?: string
}

export interface ObjectListOptions {
  cursor?: string
  limit?: number
  /** 提供时浅层列举:共同子前缀折叠为 { prefix }(含 delimiter 本身)。 */
  delimiter?: string
}

export interface ObjectListResult {
  /** 文件与折叠前缀按字典序混排(与 R2/S3 行为一致)。 */
  items: Array<ObjectMeta | { prefix: string }>
  cursor?: string
}

export interface ObjectStore {
  head(key: string): Promise<ObjectMeta | null>
  get(key: string): Promise<{ meta: ObjectMeta; body: ObjectBodyStream } | null>
  put(key: string, body: ObjectBody, opts?: ObjectPutOptions): Promise<ObjectMeta>
  /** 幂等:不存在静默。 */
  delete(key: string): Promise<void>
  list(prefix: string, opts?: ObjectListOptions): Promise<ObjectListResult>
  /** 生成限时直连 URL;后端不支持则缺省(provider 退化到 relayRefUrl)。 */
  presign?(key: string, ttlSec: number): Promise<string>
}

/** 读尽流并拼接为单个 Uint8Array(二进制安全)。 */
export async function readStreamBytes(stream: ObjectBodyStream): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.byteLength
    }
  }
  reader.releaseLock()
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** 读尽流并按 UTF-8 解码。 */
export async function readStreamText(stream: ObjectBodyStream): Promise<string> {
  return new TextDecoder().decode(await readStreamBytes(stream))
}

/** 任意 ObjectBody → 字节(put 落盘前归一)。 */
export async function objectBodyToBytes(body: ObjectBody): Promise<Uint8Array> {
  if (typeof body === 'string') return new TextEncoder().encode(body)
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  return readStreamBytes(body)
}

function bytesToStream(bytes: Uint8Array): ObjectBodyStream {
  return {
    getReader() {
      let done = false
      return {
        async read() {
          if (done) return { done: true }
          done = true
          return { done: false, value: bytes }
        },
        releaseLock() {},
      }
    },
  }
}

interface StoredObject {
  bytes: Uint8Array
  meta: ObjectMeta
}

/** 进程内存实现:单测与 SDK 内嵌宿主用。etag 为递增计数,不支持 presign。 */
export class MemoryObjectStore implements ObjectStore {
  private m = new Map<string, StoredObject>()
  private seq = 0

  constructor(private now: () => string = () => new Date().toISOString()) {}

  async head(key: string): Promise<ObjectMeta | null> {
    return this.m.get(key)?.meta ?? null
  }

  async get(key: string): Promise<{ meta: ObjectMeta; body: ObjectBodyStream } | null> {
    const stored = this.m.get(key)
    if (!stored) return null
    return { meta: stored.meta, body: bytesToStream(stored.bytes) }
  }

  async put(key: string, body: ObjectBody, opts?: ObjectPutOptions): Promise<ObjectMeta> {
    const existing = this.m.get(key)
    if (opts?.ifMatchEtag !== undefined && opts.ifMatchEtag !== existing?.meta.etag) {
      throw new TBError('conflict', `etag 不匹配:'${key}'`)
    }
    const bytes = await objectBodyToBytes(body)
    const meta: ObjectMeta = {
      key,
      etag: `v${++this.seq}`,
      size: bytes.byteLength,
      contentType: opts?.contentType,
      updatedAt: this.now(),
      metadata: opts?.metadata ?? {},
    }
    this.m.set(key, { bytes, meta })
    return meta
  }

  async delete(key: string): Promise<void> {
    this.m.delete(key)
  }

  async list(prefix: string, opts?: ObjectListOptions): Promise<ObjectListResult> {
    const delimiter = opts?.delimiter
    const limit = opts?.limit ?? 1000
    const keys = [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort()
    // sortKey:文件 = key、折叠前缀 = 前缀串;keys 已按字典序,折叠后仍有序。
    const entries: Array<{ sortKey: string; item: ObjectMeta | { prefix: string } }> = []
    const seenPrefixes = new Set<string>()
    for (const key of keys) {
      if (delimiter !== undefined) {
        const rest = key.slice(prefix.length)
        const idx = rest.indexOf(delimiter)
        if (idx >= 0) {
          const sub = prefix + rest.slice(0, idx + delimiter.length)
          if (!seenPrefixes.has(sub)) {
            seenPrefixes.add(sub)
            entries.push({ sortKey: sub, item: { prefix: sub } })
          }
          continue
        }
      }
      const stored = this.m.get(key)
      if (stored) entries.push({ sortKey: key, item: stored.meta })
    }
    let start = 0
    if (opts?.cursor !== undefined) {
      const cursor = opts.cursor
      start = entries.findIndex((e) => e.sortKey > cursor)
      if (start < 0) return { items: [] }
    }
    const page = entries.slice(start, start + limit)
    const hasMore = start + limit < entries.length
    const last = page[page.length - 1]
    return hasMore && last
      ? { items: page.map((e) => e.item), cursor: last.sortKey }
      : { items: page.map((e) => e.item) }
  }
}
