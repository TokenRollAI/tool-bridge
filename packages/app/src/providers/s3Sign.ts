/**
 * S3 SigV4 的宿主中立小工具(r2Object 与 s3Object 共用;独立成模块以免
 * s3 路径连带引入 Workers 专属的 R2 binding 类型——SDK 的 Node 类型环境编不过)。
 */

import type { AwsClient } from 'aws4fetch'

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
  const target = new URL(url)
  target.searchParams.set('X-Amz-Expires', String(ttlSec))
  const signed = await client.sign(new Request(target.toString(), { method: 'GET' }), {
    aws: { signQuery: true },
  })
  return signed.url
}
