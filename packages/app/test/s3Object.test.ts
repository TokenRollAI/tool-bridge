import { DEFAULT_STORE_DRIVER_KEY_ROOT, type ObjectBodyStream } from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createS3ObjectStore } from '../src/providers/s3Object'

const CONFIG = {
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  endpoint: 'https://s3.example.test',
  bucket: 'objects',
  region: 'us-east-1',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function streamOf(chunks: Uint8Array[], onRead?: () => void): ObjectBodyStream {
  return {
    getReader() {
      let index = 0
      return {
        async read() {
          onRead?.()
          const value = chunks[index++]
          return value === undefined ? { done: true } : { done: false, value }
        },
        releaseLock() {},
        async cancel() {
          index = chunks.length
        },
      }
    },
  }
}

describe('S3 ObjectStore streaming put', () => {
  it('只通过 presignPutExact 公开 Store 可信的定长直传', async () => {
    const store = createS3ObjectStore(CONFIG, { allowInsecure: false })
    const grant = await store.presignPutExact?.(`${DEFAULT_STORE_DRIVER_KEY_ROOT}/aa/object`, 90, {
      contentType: 'video/mp4',
      contentLength: 4096,
      ifNoneMatch: '*',
    })
    expect(grant?.headers).toMatchObject({
      'content-type': 'video/mp4',
      'content-length': '4096',
      'if-none-match': '*',
    })
    expect(new URL(grant?.url ?? '').searchParams.get('X-Amz-SignedHeaders')).toContain(
      'content-length',
    )
  })

  it('在 fetch 接管前不预读流，使用 UNSIGNED-PAYLOAD/retries:0，并以 HEAD 元数据为准', async () => {
    let reads = 0
    const calls: Request[] = []
    const fetcher: typeof fetch = vi.fn(async (input) => {
      const request = input as Request
      calls.push(request)
      if (request.method === 'PUT') {
        expect(reads).toBe(0)
        expect(request.headers.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD')
        expect(request.headers.get('if-none-match')).toBe('*')
        expect(request.headers.get('x-amz-meta-kind')).toBe('artifact')
        expect([...new Uint8Array(await request.arrayBuffer())]).toEqual([1, 2, 3, 4])
        expect(reads).toBeGreaterThan(0)
        return new Response(null, { status: 200, headers: { etag: '"put-etag"' } })
      }
      expect(request.method).toBe('HEAD')
      return new Response(null, {
        status: 200,
        headers: {
          'content-length': '4',
          'content-type': 'video/mp4',
          'etag': '"head-etag"',
          'last-modified': 'Tue, 25 Aug 2026 00:00:00 GMT',
          'x-amz-meta-kind': 'artifact',
        },
      })
    })
    vi.stubGlobal('fetch', fetcher)
    const store = createS3ObjectStore(CONFIG, { allowInsecure: false })
    const meta = await store.put(
      `${DEFAULT_STORE_DRIVER_KEY_ROOT}/aa/object`,
      streamOf([new Uint8Array([1, 2]), new Uint8Array([3, 4])], () => reads++),
      {
        contentType: 'video/mp4',
        metadata: { kind: 'artifact' },
        ifNoneMatch: '*',
      },
    )

    expect(calls.map(call => call.method)).toEqual(['PUT', 'HEAD'])
    expect(meta).toEqual({
      key: `${DEFAULT_STORE_DRIVER_KEY_ROOT}/aa/object`,
      etag: 'head-etag',
      size: 4,
      contentType: 'video/mp4',
      updatedAt: '2026-08-25T00:00:00.000Z',
      metadata: { kind: 'artifact' },
    })
  })

  it.each([409, 412])('create-only 收到 HTTP %s 归一 conflict 且不再 HEAD', async (status) => {
    const fetcher: typeof fetch = vi.fn(async (input) => {
      const request = input as Request
      expect(request.method).toBe('PUT')
      expect(request.headers.get('if-none-match')).toBe('*')
      return new Response(null, { status })
    })
    vi.stubGlobal('fetch', fetcher)
    const store = createS3ObjectStore(CONFIG, { allowInsecure: false })
    await expect(store.put('store/v1/existing', 'new', { ifNoneMatch: '*' })).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('流式 PUT 的 5xx 不重放不可重放 body', async () => {
    let reads = 0
    const fetcher: typeof fetch = vi.fn(async (input) => {
      const request = input as Request
      await request.arrayBuffer()
      return new Response(null, { status: 503 })
    })
    vi.stubGlobal('fetch', fetcher)
    const store = createS3ObjectStore(CONFIG, { allowInsecure: false })
    await expect(store.put(
      'store/v1/video',
      streamOf([new Uint8Array([1]), new Uint8Array([2])], () => reads++),
    )).rejects.toMatchObject({ code: 'unavailable', retryable: true })
    expect(reads).toBeGreaterThan(0)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('HEAD 的 5xx 也不使用 aws4fetch 默认重试', async () => {
    const fetcher: typeof fetch = vi.fn(async () => new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    const store = createS3ObjectStore(CONFIG, { allowInsecure: false })

    await expect(store.head('store/v1/unavailable')).rejects.toMatchObject({
      code: 'unavailable',
      retryable: true,
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
