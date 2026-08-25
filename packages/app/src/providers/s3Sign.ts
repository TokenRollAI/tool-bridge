/**
 * S3 SigV4 的宿主中立小工具(r2Object 与 s3Object 共用;独立成模块以免
 * s3 路径连带引入 Workers 专属的 R2 binding 类型——SDK 的 Node 类型环境编不过)。
 */

import type { AwsClient } from 'aws4fetch'
import {
  assertPresignTtlSec,
  type ObjectPresignPutExactOptions,
  type ObjectPresignPutOptions,
  TBError,
} from '@tool-bridge/core'

/** key 逐段 percent-encode(key 可含空格等;'/' 保持为路径分隔)。 */
export function encodeObjectKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

/** presign GET URL:SigV4 signQuery(service 's3'、region 'auto'),ttlSec → X-Amz-Expires。 */
export async function presignS3Url(
  client: AwsClient,
  url: string,
  ttlSec: number,
): Promise<string> {
  assertPresignTtlSec(ttlSec)
  const target = new URL(url)
  target.searchParams.set('X-Amz-Expires', String(ttlSec))
  const signed = await client.sign(new Request(target.toString(), { method: 'GET' }), {
    aws: { signQuery: true },
  })
  return signed.url
}

/**
 * presign PUT URL，并把 Content-Type 纳入签名。
 * 返回的 headers 是上传方必须原样发送的最小头集合。
 */
export async function presignS3Put(
  client: AwsClient,
  url: string,
  ttlSec: number,
  opts: ObjectPresignPutOptions | ObjectPresignPutExactOptions,
): Promise<{ headers: Record<string, string>, method: 'PUT', url: string }> {
  assertPresignTtlSec(ttlSec)
  if ('contentLength' in opts
    && (!Number.isSafeInteger(opts.contentLength) || opts.contentLength < 0)) {
    throw new TBError('invalid_argument', 'presigned PUT contentLength 必须是非负安全整数')
  }
  const target = new URL(url)
  target.searchParams.set('X-Amz-Expires', String(ttlSec))
  const headers = {
    'content-type': opts.contentType,
    ...('contentLength' in opts ? { 'content-length': String(opts.contentLength) } : {}),
    ...(opts.ifNoneMatch === undefined ? {} : { 'if-none-match': opts.ifNoneMatch }),
  }
  const signed = await client.sign(
    new Request(target.toString(), { method: 'PUT', headers }),
    { aws: { signQuery: true, allHeaders: true } },
  )
  return { method: 'PUT', url: signed.url, headers }
}
