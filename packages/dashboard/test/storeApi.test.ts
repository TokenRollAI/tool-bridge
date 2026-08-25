import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listStoreObjects,
  readStoreObject,
  shareStoreObject,
  uploadStoreObject,
} from '../src/lib/store'
import { ApiError } from '../src/lib/api'

const conn = { baseUrl: 'https://gw.example', sk: 'tbk_owner' }
const READY = {
  uri: 'store://default/AbCdEfGhIjKlMnOpQrStUv',
  contentType: 'image/jpeg',
  filename: 'capture.jpg',
  size: 4,
  owner: 'user:alice',
  producer: 'device:camera-01',
  status: 'ready',
  createdAt: '2099-08-24T11:59:00.000Z',
  updatedAt: '2099-08-24T12:00:00.000Z',
  readyAt: '2099-08-24T12:00:00.000Z',
  driverKey: '__tool_bridge_internal__/store/v1/private',
  uploadToken: 'must-not-escape',
  url: 'https://objects.example/private?signature=must-not-escape',
}

afterEach(() => vi.unstubAllGlobals())

describe('Dashboard Store SDK adapter', () => {
  it('relay upload 只做 File→neutral client 适配，capability 不进入返回值', async () => {
    const calls: Array<{ init?: RequestInit, input: RequestInfo | URL }> = []
    const relay = {
      uploadId: 'upload-01',
      objectUri: READY.uri,
      transport: 'relay',
      method: 'PUT',
      url: 'https://gw.example/~store/uploads/upload-01',
      headers: { 'content-type': 'image/jpeg' },
      expiresAt: '2099-08-24T12:10:00.000Z',
      maxBytes: 1024,
      uploadToken: 'session-secret',
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return calls.length === 1
        ? new Response(JSON.stringify(relay), { status: 200 })
        : new Response(JSON.stringify(READY), { status: 200 })
    }))

    const result = await uploadStoreObject(
      conn,
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], 'capture.jpg', {
        type: 'image/jpeg',
      }),
    )

    expect(result).toMatchObject({ uri: READY.uri, size: 4 })
    expect(result).not.toHaveProperty('driverKey')
    expect(result).not.toHaveProperty('uploadToken')
    expect(result).not.toHaveProperty('url')
    expect(String(calls[0]?.input)).toBe('https://gw.example/system/store/create_upload')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      contentType: 'image/jpeg', filename: 'capture.jpg', size: 4,
    })
    expect(new Headers(calls[1]?.init?.headers).get('x-tb-store-upload')).toBe('session-secret')
    expect(calls[1]?.init?.credentials).toBe('omit')
  })

  it('空 baseUrl 从浏览器 origin 安全转为 SDK 要求的绝对 URL', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [READY] }), {
      status: 200,
    }))
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('location', {
      href: 'https://same-origin.example/ui/manage/store',
      origin: 'https://same-origin.example',
    })

    const page = await listStoreObjects({ baseUrl: '', sk: conn.sk })

    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://same-origin.example/system/store/list',
    )
    expect(page.items[0]).toMatchObject({ uri: READY.uri, owner: READY.owner })
    expect(page.items[0]).not.toHaveProperty('driverKey')
    expect(page.items[0]).not.toHaveProperty('uploadToken')
    expect(page.items[0]).not.toHaveProperty('url')
  })

  it('非空相对 baseUrl 也按当前浏览器位置解析', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('location', {
      href: 'https://same-origin.example/ui/manage/store',
      origin: 'https://same-origin.example',
    })

    await listStoreObjects({ baseUrl: '../gateway', sk: conn.sk })

    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://same-origin.example/ui/gateway/system/store/list',
    )
  })

  it('SDK TBError 统一映射为 ApiError，不重新解析服务端响应', async () => {
    const secretUrl = 'https://objects.example/private?signature=must-not-escape'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 'unavailable',
      message: `provider failed at ${secretUrl}`,
      retryable: true,
    }), { status: 503 })))

    let thrown: unknown
    try {
      await listStoreObjects(conn)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ApiError)
    expect(thrown).toMatchObject({ code: 'unavailable', status: 503, retryable: true })
    expect((thrown as Error).message).not.toContain(secretUrl)
  })

  it('read/share 保持固定命令路径和裸 arguments', async () => {
    const calls: Array<{ init?: RequestInit, input: RequestInfo | URL }> = []
    const readRef = 'https://gw.example/~store/refs/read-secret'
    const shareRef = 'https://gw.example/~store/shares/share-secret'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return calls.length === 1
        ? new Response(JSON.stringify({
            $ref: readRef,
            uri: READY.uri,
            contentType: 'image/jpeg',
            size: 4,
            expiresAt: '2099-08-24T12:10:00.000Z',
          }), { status: 200 })
        : new Response(JSON.stringify({
            $ref: shareRef,
            shareId: 'share-01',
            uri: READY.uri,
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
