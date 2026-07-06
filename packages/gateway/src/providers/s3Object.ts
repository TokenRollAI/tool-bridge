/**
 * S3 兼容端点 ObjectStore 适配(Proto §5.2 s3 义务):aws4fetch SigV4 → core `ObjectStore`。
 *
 * - 动词映射:head=HEAD / get=GET / put=PUT / delete=DELETE(404 幂等静默)/ list=ListObjectsV2。
 * - 用户 metadata 走 `x-amz-meta-*` 头;条件写 `ifMatchEtag` → `If-Match`(412 → conflict)。
 *   注意 ListObjectsV2 不返回用户 metadata——list 条目 metadata 置 undefined(区别于 {}),
 *   core Search 对此按需 head 补取再做 metadata 值匹配(有界,见 SEARCH_METADATA_HEAD_MAX)。
 * - endpoint 强制 https://(TB_ALLOW_INSECURE_HTTP=true 放行,和 http provider 同规则)。
 * - 上游非 2xx 归一为 TBError(参照 core upstreamError 思路,不透传上游 body 原文):
 *   5xx → unavailable(retryable) / 403 → permission_denied / 404 → not_found / 其余 4xx → internal。
 */

import {
  assertSecureUrl,
  normalizeUpstreamError,
  type ObjectBodyStream,
  type ObjectListOptions,
  type ObjectListResult,
  type ObjectMeta,
  type ObjectStore,
  objectBodyToBytes,
  TBError,
} from '@tool-bridge/core'
import { AwsClient } from 'aws4fetch'
import { encodeObjectKey, presignS3Url } from './r2Object'

/** s3 provider 的构造参数(providerConfig + authRef 解析出的凭证;Proto §3.2)。 */
export interface S3StoreConfig {
  endpoint: string
  bucket: string
  /** 缺省 'auto'(R2 S3 兼容端点的约定;AWS 端点应显式给区域)。 */
  region?: string
  accessKeyId: string
  secretAccessKey: string
}

const META_HEADER_PREFIX = 'x-amz-meta-'

/** ETag 头/XML 值 → version(去两侧引号;S3 恒引号包裹)。 */
function stripEtagQuotes(etag: string): string {
  return etag.replace(/^"|"$/g, '')
}

/** 上游非 2xx → TBError(message 只携带状态码,不透传上游 body)。 */
function s3Error(op: string, status: number): TBError {
  if (status >= 500)
    return new TBError('unavailable', `s3 ${op} 返回 ${status}`, { retryable: true })
  if (status === 403) return new TBError('permission_denied', `s3 ${op} 返回 403`)
  if (status === 404) return TBError.notFound(`s3 ${op} 返回 404`)
  return new TBError('internal', `s3 ${op} 返回 ${status}`, { retryable: false })
}

/** 最小 XML 实体反转义(S3 响应只用这五个 + 数字实体;这是解析响应,不是造 XML 框架)。 */
function xmlUnescape(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** 取 XML 片段里首个 `<tag>…</tag>` 的文本(反转义后);缺失 → undefined。 */
function xmlText(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  return m?.[1] !== undefined ? xmlUnescape(m[1]) : undefined
}

/** 空 body(HEAD 响应 / 上游未回流)时的兜底流。 */
const EMPTY_STREAM: ObjectBodyStream = {
  getReader: () => ({ read: async () => ({ done: true }), releaseLock: () => {} }),
}

export function createS3ObjectStore(
  cfg: S3StoreConfig,
  opts: { allowInsecure: boolean },
): ObjectStore {
  const secErr = assertSecureUrl(cfg.endpoint, opts.allowInsecure)
  if (secErr) throw secErr

  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: cfg.region ?? 'auto',
  })
  const base = cfg.endpoint.replace(/\/+$/, '')
  const bucketUrl = `${base}/${cfg.bucket}`
  const urlFor = (key: string): string => `${bucketUrl}/${encodeObjectKey(key)}`

  /** 签名 fetch;网络失败归一为 unavailable(retryable)。 */
  const s3Fetch = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await client.fetch(url, init)
    } catch (err) {
      throw normalizeUpstreamError({
        kind: 'network',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const metaFromHeaders = (key: string, headers: Headers): ObjectMeta => {
    const metadata: Record<string, string> = {}
    headers.forEach((value, name) => {
      if (name.startsWith(META_HEADER_PREFIX))
        metadata[name.slice(META_HEADER_PREFIX.length)] = value
    })
    const lastModified = Date.parse(headers.get('last-modified') ?? '')
    const meta: ObjectMeta = {
      key,
      etag: stripEtagQuotes(headers.get('etag') ?? ''),
      size: Number(headers.get('content-length') ?? '0'),
      updatedAt: Number.isNaN(lastModified) ? '' : new Date(lastModified).toISOString(),
      metadata,
    }
    const contentType = headers.get('content-type')
    if (contentType !== null) meta.contentType = contentType
    return meta
  }

  return {
    async head(key) {
      const resp = await s3Fetch(urlFor(key), { method: 'HEAD' })
      if (resp.status === 404) return null
      if (!resp.ok) throw s3Error('head', resp.status)
      return metaFromHeaders(key, resp.headers)
    },

    async get(key) {
      const resp = await s3Fetch(urlFor(key), { method: 'GET' })
      if (resp.status === 404) {
        await resp.body?.cancel()
        return null
      }
      if (!resp.ok) {
        await resp.body?.cancel()
        throw s3Error('get', resp.status)
      }
      return { meta: metaFromHeaders(key, resp.headers), body: resp.body ?? EMPTY_STREAM }
    },

    async put(key, body, putOpts) {
      const bytes = await objectBodyToBytes(body)
      const headers: Record<string, string> = {}
      if (putOpts?.contentType !== undefined) headers['content-type'] = putOpts.contentType
      for (const [name, value] of Object.entries(putOpts?.metadata ?? {})) {
        headers[`${META_HEADER_PREFIX}${name}`] = value
      }
      if (putOpts?.ifMatchEtag !== undefined) headers['if-match'] = `"${putOpts.ifMatchEtag}"`
      const resp = await s3Fetch(urlFor(key), { method: 'PUT', headers, body: bytes })
      await resp.body?.cancel()
      // 条件不满足 → 412;对象不存在时部分实现回 404——两者都按 core 契约归 conflict。
      if (resp.status === 412 || (putOpts?.ifMatchEtag !== undefined && resp.status === 404)) {
        throw new TBError('conflict', `etag 不匹配:'${key}'`)
      }
      if (!resp.ok) throw s3Error('put', resp.status)
      const meta: ObjectMeta = {
        key,
        etag: stripEtagQuotes(resp.headers.get('etag') ?? ''),
        size: bytes.byteLength,
        updatedAt: new Date().toISOString(),
        metadata: putOpts?.metadata ?? {},
      }
      if (putOpts?.contentType !== undefined) meta.contentType = putOpts.contentType
      return meta
    },

    async delete(key) {
      const resp = await s3Fetch(urlFor(key), { method: 'DELETE' })
      await resp.body?.cancel()
      // 幂等:不存在静默(S3 对缺失 key 的 DELETE 本就 204,404 一并容忍)。
      if (!resp.ok && resp.status !== 404) throw s3Error('delete', resp.status)
    },

    async list(prefix: string, listOpts?: ObjectListOptions): Promise<ObjectListResult> {
      const url = new URL(bucketUrl)
      url.searchParams.set('list-type', '2')
      if (prefix !== '') url.searchParams.set('prefix', prefix)
      if (listOpts?.delimiter !== undefined) url.searchParams.set('delimiter', listOpts.delimiter)
      if (listOpts?.cursor !== undefined)
        url.searchParams.set('continuation-token', listOpts.cursor)
      if (listOpts?.limit !== undefined) url.searchParams.set('max-keys', String(listOpts.limit))
      const resp = await s3Fetch(url.toString(), { method: 'GET' })
      if (!resp.ok) {
        await resp.body?.cancel()
        throw s3Error('list', resp.status)
      }
      const xml = await resp.text()

      // ListObjectsV2 XML 用轻量正则抽取(解析上游响应,不引 XML 框架):
      // <Contents>(Key/ETag/Size/LastModified)、<CommonPrefixes><Prefix>、
      // <NextContinuationToken>、<IsTruncated>。
      const entries: Array<{ sortKey: string; item: ObjectMeta | { prefix: string } }> = []
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const block = m[1] ?? ''
        const key = xmlText(block, 'Key')
        if (key === undefined) continue
        const lastModified = Date.parse(xmlText(block, 'LastModified') ?? '')
        entries.push({
          sortKey: key,
          item: {
            key,
            etag: stripEtagQuotes(xmlText(block, 'ETag') ?? ''),
            size: Number(xmlText(block, 'Size') ?? '0'),
            updatedAt: Number.isNaN(lastModified) ? '' : new Date(lastModified).toISOString(),
            // metadata 缺省(ListObjectsV2 不返回用户 metadata;undefined 表示未知,
            // 让 core Search 走 head 补取,勿置 {} 假装确认为空)
          },
        })
      }
      for (const m of xml.matchAll(
        /<CommonPrefixes>[\s\S]*?<Prefix>([\s\S]*?)<\/Prefix>[\s\S]*?<\/CommonPrefixes>/g,
      )) {
        const p = xmlUnescape(m[1] ?? '')
        entries.push({ sortKey: p, item: { prefix: p } })
      }
      entries.sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
      const items = entries.map((e) => e.item)

      const truncated = xmlText(xml, 'IsTruncated') === 'true'
      const next = xmlText(xml, 'NextContinuationToken')
      return truncated && next !== undefined ? { items, cursor: next } : { items }
    },

    presign(key, ttlSec) {
      return presignS3Url(client, urlFor(key), ttlSec)
    },
  }
}
