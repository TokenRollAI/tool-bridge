import { describe, expect, it } from 'vitest'
import { AwsClient } from 'aws4fetch'
import { presignS3Put, presignS3Url } from '../src/providers/s3Sign'

describe('presignS3Put', () => {
  it('签发默认不覆盖 PUT，并把 content-type/if-none-match 纳入 SignedHeaders', async () => {
    const client = new AwsClient({
      accessKeyId: 'test-access',
      secretAccessKey: 'test-secret',
      service: 's3',
      region: 'auto',
    })
    const grant = await presignS3Put(
      client,
      'https://example.r2.cloudflarestorage.com/bucket/camera/a%201.jpg',
      90,
      { contentType: 'image/jpeg', ifNoneMatch: '*' },
    )
    const url = new URL(grant.url)
    expect(grant.method).toBe('PUT')
    expect(grant.headers).toEqual({
      'content-type': 'image/jpeg',
      'if-none-match': '*',
    })
    expect(url.searchParams.get('X-Amz-Expires')).toBe('90')
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual([
      'content-type',
      'host',
      'if-none-match',
    ])
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/)
  })

  it('GET/PUT 在签名前拒绝超过 SigV4 上限的 TTL', async () => {
    const client = new AwsClient({
      accessKeyId: 'test-access',
      secretAccessKey: 'test-secret',
      service: 's3',
      region: 'auto',
    })
    const url = 'https://example.r2.cloudflarestorage.com/bucket/a.jpg'
    await expect(presignS3Url(client, url, 604_801)).rejects.toMatchObject({
      code: 'invalid_argument',
    })
    await expect(presignS3Put(client, url, 604_801, {
      contentType: 'image/jpeg',
    })).rejects.toMatchObject({ code: 'invalid_argument' })
  })
})
