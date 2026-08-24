import { type ObjectBodyStream, readStreamBytes } from '@tool-bridge/core'
import { afterEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { createR2ObjectStore } from '../src/providers/r2Object'

const actualBucket = (env as unknown as { TB_R2: R2Bucket }).TB_R2

function r2Object(key: string, size = 0): R2Object {
  return {
    key,
    etag: 'etag-1',
    size,
    uploaded: new Date('2026-01-01T00:00:00.000Z'),
    customMetadata: {},
  } as R2Object
}

function bucketWithPut(
  put: (key: string, body: unknown, options: R2PutOptions | undefined) => Promise<R2Object | null>,
): R2Bucket {
  return { put } as unknown as R2Bucket
}

const actualKeys: string[] = []

afterEach(async () => {
  await Promise.all(actualKeys.splice(0).map(key => actualBucket.delete(key)))
})

describe('R2 ObjectStore 流与条件写映射', () => {
  it('原生 ReadableStream 直接交给 binding，不预读或聚合', async () => {
    let captured: unknown
    const bucket = bucketWithPut(async (key, body) => {
      captured = body
      return r2Object(key, 256 * 1024 * 1024)
    })
    const store = createR2ObjectStore(bucket)
    const stream = new ReadableStream<Uint8Array>()

    await store.put('large/video.mp4', stream)

    // 旧实现 objectBodyToBytes 会把这里变成 Uint8Array；身份相同证明没有读尽大流。
    expect(captured).toBe(stream)
  })

  it('最小 ObjectBodyStream 逐块桥接为 R2 可接受的 ReadableStream', async () => {
    let captured: unknown
    const bucket = bucketWithPut(async (key, body) => {
      captured = body
      return r2Object(key, 3)
    })
    const store = createR2ObjectStore(bucket)
    let read = 0
    const minimal: ObjectBodyStream = {
      getReader() {
        return {
          async read() {
            read++
            return read === 1
              ? { done: false, value: new Uint8Array([1, 2, 3]) }
              : { done: true }
          },
          releaseLock() {},
        }
      },
    }

    await store.put('minimal.bin', minimal)
    expect(captured).toBeInstanceOf(ReadableStream)
    expect([...await readStreamBytes(captured as ReadableStream<Uint8Array>)]).toEqual([1, 2, 3])
  })

  it('string 与 bytes 不改形态直接交给 binding', async () => {
    const captured: unknown[] = []
    const bucket = bucketWithPut(async (key, body) => {
      captured.push(body)
      return r2Object(key)
    })
    const store = createR2ObjectStore(bucket)
    const bytes = new Uint8Array([1, 2])

    await store.put('a', 'text')
    await store.put('b', bytes)
    expect(captured).toEqual(['text', bytes])
  })

  it('ifNoneMatch 映射 If-None-Match:*，null 与 412 都映射 conflict', async () => {
    let options: R2PutOptions | undefined
    const nullBucket = bucketWithPut(async (_key, _body, input) => {
      options = input
      return null
    })
    const createOnly = { ifNoneMatch: '*' } as const
    await expect(createR2ObjectStore(nullBucket).put('exists', 'x', createOnly)).rejects.toMatchObject(
      { code: 'conflict' },
    )
    expect(options?.onlyIf).toBeInstanceOf(Headers)
    expect((options?.onlyIf as Headers).get('if-none-match')).toBe('*')

    const throwingBucket = bucketWithPut(async () => {
      throw Object.assign(new Error('precondition failed'), { status: 412 })
    })
    await expect(
      createR2ObjectStore(throwingBucket).put('exists', 'x', createOnly),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('真实 R2 binding 的 create-only 并发只有一个成功', async () => {
    const key = `r2-object-test/${crypto.randomUUID()}`
    actualKeys.push(key)
    const store = createR2ObjectStore(actualBucket)
    const createOnly = { ifNoneMatch: '*' } as const
    const results = await Promise.allSettled([
      store.put(key, new Uint8Array([1]), createOnly),
      store.put(key, new Uint8Array([2]), createOnly),
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'conflict' },
    })
  })
})
