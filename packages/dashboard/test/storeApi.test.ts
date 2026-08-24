import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listStoreObjects,
  readStoreObject,
  shareStoreObject,
  uploadStoreObject,
} from '../src/lib/api'

const conn = { baseUrl: 'https://gw.example', sk: 'tbk_owner' }
const READY = {
  uri: 'store://default/obj_01k4photo',
  contentType: 'image/jpeg',
  filename: 'capture.jpg',
  size: 4,
  owner: 'user:alice',
  producer: 'device:camera-01',
  status: 'ready',
  createdAt: '2099-08-24T11:59:00.000Z',
  updatedAt: '2099-08-24T12:00:00.000Z',
  readyAt: '2099-08-24T12:00:00.000Z',
  driverKey: 'store/v1/private',
  uploadToken: 'must-not-escape',
  url: 'https://objects.example/private?signature=must-not-escape',
}
const RELAY = {
  uploadId: 'upload-01',
  objectUri: READY.uri,
  transport: 'relay' as const,
  method: 'PUT' as const,
  url: 'https://gw.example/~store/uploads/upload-01',
  headers: { 'content-type': 'image/jpeg' },
  expiresAt: '2099-08-24T12:10:00.000Z',
  maxBytes: 1024,
  uploadToken: 'session-secret',
}

afterEach(() => vi.unstubAllGlobals())

describe('Store upload API', () => {
  it('relay PUT 带 session header，返回严格裁剪的 ready descriptor', async () => {
    const calls: Array<{ init?: RequestInit, input: RequestInfo | URL }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return calls.length === 1
        ? new Response(JSON.stringify(RELAY), { status: 200 })
        : new Response(JSON.stringify(READY), { status: 200 })
    }))
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], 'capture.jpg', {
      type: 'image/jpeg',
    })

    const result = await uploadStoreObject(conn, file)

    expect(result).toMatchObject({
      uri: READY.uri,
      owner: 'user:alice',
      producer: 'device:camera-01',
      size: 4,
    })
    expect(result).not.toHaveProperty('driverKey')
    expect(result).not.toHaveProperty('uploadToken')
    expect(result).not.toHaveProperty('url')
    expect(String(calls[0]?.input)).toBe('https://gw.example/system/store/create_upload')
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer tbk_owner')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      contentType: 'image/jpeg', filename: 'capture.jpg', size: 4,
    })
    expect(String(calls[1]?.input)).toBe(RELAY.url)
    expect(new Headers(calls[1]?.init?.headers).get('x-tb-store-upload')).toBe(RELAY.uploadToken)
    expect(calls[1]?.init?.credentials).toBe('omit')
  })

  it('direct PUT 不带 session token，complete 只带 token、不带 SK', async () => {
    const direct = {
      ...RELAY,
      transport: 'presigned-put' as const,
      url: 'https://objects.example/upload?signature=secret',
    }
    const calls: Array<{ init?: RequestInit, input: RequestInfo | URL }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      if (calls.length === 1) return new Response(JSON.stringify(direct), { status: 200 })
      if (calls.length === 2) return new Response(null, { status: 200 })
      return new Response(JSON.stringify(READY), { status: 200 })
    }))

    await uploadStoreObject(conn, new File([new Uint8Array(4)], 'capture.jpg', {
      type: 'image/jpeg',
    }))

    expect(new Headers(calls[1]?.init?.headers).get('x-tb-store-upload')).toBeNull()
    expect(String(calls[2]?.input)).toBe('https://gw.example/system/store/complete_upload')
    const completeHeaders = new Headers(calls[2]?.init?.headers)
    expect(completeHeaders.get('x-tb-store-upload')).toBe(direct.uploadToken)
    expect(completeHeaders.get('authorization')).toBeNull()
  })

  it('provider 错误不读取或回显签名 URL/响应体', async () => {
    const secretUrl = 'https://objects.example/upload?signature=do-not-leak'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...RELAY, transport: 'presigned-put', url: secretUrl,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('private provider body', { status: 403 })))

    let thrown: unknown
    try {
      await uploadStoreObject(conn, new File([new Uint8Array(4)], 'capture.jpg'))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ message: 'Store 对象上传返回 HTTP 403', status: 403 })
    expect((thrown as Error).message).not.toContain(secretUrl)
    expect((thrown as Error).message).not.toContain('private provider body')
  })

  it('幂等 create 已完成时直接返回裁剪 descriptor，绝不再次 PUT', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      alreadyCompleted: true,
      descriptor: READY,
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    const result = await uploadStoreObject(
      conn,
      new File([new Uint8Array(4)], 'capture.jpg', { type: 'image/jpeg' }),
      { idempotencyKey: 'call-01' },
    )

    expect(fetcher).toHaveBeenCalledOnce()
    expect(result.uri).toBe(READY.uri)
    expect(result).not.toHaveProperty('driverKey')
    expect(result).not.toHaveProperty('uploadToken')
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      idempotencyKey: 'call-01',
    })
  })

  it('complete 错误即使误带 session token/URL 也会在客户端脱敏', async () => {
    const direct = {
      ...RELAY,
      transport: 'presigned-put' as const,
      url: 'https://objects.example/upload?signature=secret',
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(direct), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 'unavailable',
        message: `failed ${direct.url} token=${direct.uploadToken}`,
        retryable: true,
      }), { status: 503 })))

    let thrown: unknown
    try {
      await uploadStoreObject(conn, new File([new Uint8Array(4)], 'capture.jpg'))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ message: 'Store 上传完成失败，请重试', status: 503 })
    expect((thrown as Error).message).not.toContain(direct.url)
    expect((thrown as Error).message).not.toContain(direct.uploadToken)
  })
})

describe('Store management API', () => {
  it('list descriptor 做白名单投影，不缓存内部 key/token/url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [READY] }), {
      status: 200,
    })))
    const page = await listStoreObjects(conn)
    expect(page.items[0]).toMatchObject({ uri: READY.uri, owner: READY.owner })
    expect(page.items[0]).not.toHaveProperty('driverKey')
    expect(page.items[0]).not.toHaveProperty('uploadToken')
    expect(page.items[0]).not.toHaveProperty('url')
  })

  it('read/share 使用固定 system/store 路径和裸 arguments', async () => {
    const calls: Array<{ init?: RequestInit, input: RequestInfo | URL }> = []
    const ref = 'https://gw.example/~store/refs/secret'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return calls.length === 1
        ? new Response(JSON.stringify({
            $ref: ref, contentType: 'image/jpeg', size: 4,
            expiresAt: '2099-08-24T12:10:00.000Z',
          }), { status: 200 })
        : new Response(JSON.stringify({
            $ref: ref, shareId: 'share-01', uri: READY.uri,
            expiresAt: '2099-08-24T12:10:00.000Z',
          }), { status: 200 })
    }))

    await readStoreObject(conn, READY.uri)
    await shareStoreObject(conn, READY.uri, 60)

    expect(String(calls[0]?.input)).toBe('https://gw.example/system/store/read')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ uri: READY.uri })
    expect(String(calls[1]?.input)).toBe('https://gw.example/system/store/share')
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ uri: READY.uri, ttlSec: 60 })
  })
})
