/**
 * R2 ObjectStore 适配(default Store 与 r2 Context 共用):R2 binding → core `ObjectStore` 接口。
 *
 * 四动词语义(幂等/conflict/$ref 阈值)全部在 core objectProvider,这里只做 API 映射:
 * - `version` = R2 etag;条件写用 `onlyIf.etagMatches`(不满足时 R2 put 返回 null → conflict)。
 * - list 必须接 `truncated/cursor` 分页(v1 的坑:漏接则大目录静默丢条目);
 *   `include` 带回 http/customMetadata(Search 匹配 metadata 值需要)。
 * - R2 binding 不支持 presign——凭证齐(`R2PresignCredentials`)时经
 *   S3 兼容端点用 aws4fetch signQuery 生成;缺省则 presign 为 undefined,core 退化 relayRefUrl。
 */

import {
  type ObjectBody,
  type ObjectListOptions,
  type ObjectListResult,
  type ObjectMeta,
  type ObjectPutOptions,
  type ObjectStore,
  TBError,
} from '@tool-bridge/core'
import {
  encodeObjectKey,
  presignS3Put,
  presignS3Url,
  toWebObjectBodyStream,
} from '@tool-bridge/app'
import { AwsClient } from 'aws4fetch'

/** R2 S3 兼容端点的 presign 参数(凭证链解析见 app.ts;缺省 = 不提供 presign)。 */
export interface R2PresignCredentials {
  accessKeyId: string
  bucket: string
  endpoint: string
  secretAccessKey: string
}

function toR2Body(body: ObjectBody): ReadableStream | ArrayBuffer | ArrayBufferView | string {
  if (typeof body === 'string' || body instanceof ArrayBuffer || body instanceof Uint8Array) {
    return body
  }
  if (body instanceof ReadableStream) return body

  // core 只要求最小 ObjectBodyStream；共享桥接仍逐块背压、不聚合字节。
  return toWebObjectBodyStream(body)
}

function onlyIfForPut(opts: ObjectPutOptions | undefined): R2Conditional | Headers | undefined {
  if (opts?.ifNoneMatch === '*') {
    // R2 Workers API 支持条件 Headers；HTTP `If-None-Match: *` 即原子 create-only。
    return new Headers({ 'If-None-Match': '*' })
  }
  return opts?.ifMatchEtag !== undefined ? { etagMatches: opts.ifMatchEtag } : undefined
}

function isPreconditionFailed(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as {
    code?: unknown
    name?: unknown
    status?: unknown
    statusCode?: unknown
  }
  return candidate.status === 412
    || candidate.statusCode === 412
    || candidate.code === 412
    || candidate.name === 'PreconditionFailed'
}

function toMeta(obj: R2Object): ObjectMeta {
  const meta: ObjectMeta = {
    key: obj.key,
    etag: obj.etag,
    size: obj.size,
    updatedAt: obj.uploaded.toISOString(),
    metadata: obj.customMetadata ?? {},
  }
  if (obj.httpMetadata?.contentType !== undefined) meta.contentType = obj.httpMetadata.contentType
  return meta
}

export function createR2ObjectStore(bucket: R2Bucket, presign?: R2PresignCredentials): ObjectStore {
  const store: ObjectStore = {
    async head(key) {
      const obj = await bucket.head(key)
      return obj === null ? null : toMeta(obj)
    },

    async get(key) {
      const obj = await bucket.get(key)
      if (obj === null) return null
      return { meta: toMeta(obj), body: obj.body }
    },

    async put(key, body, opts: ObjectPutOptions | undefined) {
      if (opts?.ifMatchEtag !== undefined && opts.ifNoneMatch !== undefined) {
        throw new TBError('invalid_argument', 'ifMatchEtag 与 ifNoneMatch 不能同时使用')
      }
      const onlyIf = onlyIfForPut(opts)
      let res: R2Object | null
      try {
        res = await bucket.put(key, toR2Body(body), {
          httpMetadata: opts?.contentType !== undefined ? { contentType: opts.contentType } : {},
          customMetadata: opts?.metadata ?? {},
          ...(onlyIf !== undefined ? { onlyIf } : {}),
        })
      } catch (error) {
        if (isPreconditionFailed(error)) {
          throw new TBError('conflict', `对象写入条件不满足:'${key}'`)
        }
        throw error
      }
      // 条件不满足(含对象不存在)时 R2 put 返回 null → conflict(core 接口契约)。
      if (res === null) throw new TBError('conflict', `对象写入条件不满足:'${key}'`)
      return toMeta(res)
    },

    async delete(key) {
      await bucket.delete(key)
    },

    async list(prefix: string, opts?: ObjectListOptions): Promise<ObjectListResult> {
      const res = await bucket.list({
        prefix,
        include: ['httpMetadata', 'customMetadata'],
        ...(opts?.cursor !== undefined ? { cursor: opts.cursor } : {}),
        ...(opts?.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts?.delimiter !== undefined ? { delimiter: opts.delimiter } : {}),
      })
      // 文件与折叠前缀按字典序混排(与 MemoryObjectStore/S3 行为一致);
      // 跳过 key 与 prefix 完全相等的目录占位对象。
      const entries = [
        ...res.objects
          .filter(o => o.key !== prefix)
          .map(o => ({ sortKey: o.key, item: toMeta(o) as ObjectMeta | { prefix: string } })),
        ...res.delimitedPrefixes.map(p => ({
          sortKey: p,
          item: { prefix: p } as ObjectMeta | { prefix: string },
        })),
      ].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
      const items = entries.map(e => e.item)
      return res.truncated ? { items, cursor: res.cursor } : { items }
    },
  }

  if (presign !== undefined) {
    const client = new AwsClient({
      accessKeyId: presign.accessKeyId,
      secretAccessKey: presign.secretAccessKey,
      service: 's3',
      region: 'auto',
    })
    const base = presign.endpoint.replace(/\/+$/, '')
    store.presign = (key, ttlSec) =>
      presignS3Url(client, `${base}/${presign.bucket}/${encodeObjectKey(key)}`, ttlSec)
    store.presignPut = (key, ttlSec, opts) =>
      presignS3Put(
        client,
        `${base}/${presign.bucket}/${encodeObjectKey(key)}`,
        ttlSec,
        opts,
      )
    store.presignPutExact = (key, ttlSec, opts) =>
      presignS3Put(
        client,
        `${base}/${presign.bucket}/${encodeObjectKey(key)}`,
        ttlSec,
        opts,
      )
  }

  return store
}
