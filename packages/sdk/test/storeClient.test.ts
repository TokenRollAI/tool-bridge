import type { AddressInfo } from 'node:net'
import { createServer, type Server } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  createStoreClient as createStoreClientFromStore,
  parseStoreUri,
  TBError as StoreEntryTBError,
} from '../src/store'
import { createStoreClient, type StoreClientObjectDescriptor } from '../src'

const URI = 'store://default/AAAAAAAAAAAAAAAAAAAAAA' as const
const DESCRIPTOR = {
  uri: URI,
  status: 'ready',
  contentType: 'text/plain',
  filename: 'note.txt',
  size: 5,
  owner: 'agent:owner',
  producer: 'device:camera-01',
  originCallId: 'call-01',
  checksum: { algorithm: 'sha256', value: 'abc123' },
  etag: '"etag-01"',
  createdAt: '2099-01-01T00:00:00.000Z',
  updatedAt: '2099-01-01T00:00:01.000Z',
  readyAt: '2099-01-01T00:00:01.000Z',
  expiresAt: '2099-01-02T00:00:00.000Z',
} satisfies StoreClientObjectDescriptor

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })
}

describe('createStoreClient', () => {
  it('根入口与 neutral Store 子入口复用同一 client factory', () => {
    expect(createStoreClient).toBe(createStoreClientFromStore)
  })

  it('提供 stat/list/read/download/share/revoke/delete 的类型安全管理面', async () => {
    const calls: Array<{ init?: RequestInit, url: string }> = []
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url === 'https://tb.example/~store/refs/ref-token') {
        return new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } })
      }
      const command = new URL(url).pathname.split('/').pop()
      if (command === 'stat') {
        return Response.json({ ...DESCRIPTOR, driverKey: 'must-not-escape' })
      }
      if (command === 'list') {
        return Response.json({
          items: [{ ...DESCRIPTOR, uploadToken: 'must-not-escape' }],
          cursor: 'next',
          internalCursor: 'must-not-escape',
        })
      }
      if (command === 'read') {
        return Response.json({
          $ref: 'https://tb.example/~store/refs/ref-token',
          uri: URI,
          contentType: 'text/plain',
          size: 5,
          expiresAt: '2099-01-01T00:15:00.000Z',
          tokenHash: 'must-not-escape',
        })
      }
      if (command === 'share') {
        return Response.json({
          $ref: 'https://tb.example/~store/shares/share-token',
          uri: URI,
          shareId: 'share-id',
          expiresAt: '2099-01-01T00:15:00.000Z',
          uploadToken: 'must-not-escape',
        })
      }
      return Response.json({ ok: true })
    })
    const sk = vi.fn(() => 'rotating-secret-key')
    const store = createStoreClient({ baseUrl: 'https://tb.example/api/', sk, fetcher })

    await expect(store.stat(URI)).resolves.toEqual(DESCRIPTOR)
    await expect(store.list({ limit: 10 })).resolves.toEqual({
      items: [DESCRIPTOR],
      cursor: 'next',
    })
    await expect(store.read(URI)).resolves.toEqual({
      $ref: 'https://tb.example/~store/refs/ref-token',
      uri: URI,
      contentType: 'text/plain',
      size: 5,
      expiresAt: '2099-01-01T00:15:00.000Z',
    })
    const downloaded = await store.download(URI)
    await expect(downloaded.text()).resolves.toBe('hello')
    await expect(store.share(URI, { ttlSec: 60 })).resolves.toEqual({
      $ref: 'https://tb.example/~store/shares/share-token',
      shareId: 'share-id',
      uri: URI,
      expiresAt: '2099-01-01T00:15:00.000Z',
    })
    await expect(store.revokeShare('share-id')).resolves.toBeUndefined()
    await expect(store.delete(URI)).resolves.toBeUndefined()

    const controlCalls = calls.filter(call => call.url.includes('/system/store/'))
    expect(controlCalls).toHaveLength(7)
    expect(sk).toHaveBeenCalledTimes(7)
    for (const call of controlCalls) {
      expect(new Headers(call.init?.headers).get('authorization')).toBe(
        'Bearer rotating-secret-key',
      )
      expect(call.init?.redirect).toBe('error')
    }
    for (const call of calls) {
      expect(call.init?.credentials).toBe('omit')
      expect(call.init?.redirect).toBe('error')
    }
    expect(JSON.parse(String(controlCalls[1]?.init?.body))).toEqual({ opts: { limit: 10 } })
    expect(JSON.parse(String(controlCalls[4]?.init?.body))).toEqual({ uri: URI, ttlSec: 60 })
  })

  it('结构化错误含 bearer URL 时脱敏，未知 body 不回显', async () => {
    const fetcher: typeof fetch = vi.fn(async () => Response.json({
      code: 'unavailable',
      message: 'failed https://objects.example/file?signature=secret',
      retryable: true,
    }, { status: 503 }))
    const store = createStoreClient({ baseUrl: 'https://tb.example', sk: 'secret', fetcher })

    await expect(store.stat(URI)).rejects.toMatchObject({
      code: 'unavailable',
      message: 'gateway returned a redacted error (HTTP 503)',
    })
  })

  it.each([307, 308])('Store control 收到跨源 HTTP %s 时不重放 SK 或 JSON body', async (status) => {
    let exfiltrated = false
    const receiver = createServer((_request, response) => {
      exfiltrated = true
      response.end('{}')
    })
    const receiverUrl = await listen(receiver)
    const gateway = createServer((_request, response) => {
      response.statusCode = status
      response.setHeader('location', `${receiverUrl}/steal`)
      response.end()
    })
    const gatewayUrl = await listen(gateway)

    try {
      const store = createStoreClient({
        baseUrl: gatewayUrl,
        sk: 'must-not-leak',
        fetcher: globalThis.fetch,
      })
      await expect(store.stat(URI)).rejects.toMatchObject({
        code: 'unavailable',
        message: 'Store control request failed',
      })
      expect(exfiltrated).toBe(false)
    } finally {
      await close(gateway)
      await close(receiver)
    }
  })

  it('结构化错误误带当前 SK 时也脱敏，Store 子入口直接导出 TBError', async () => {
    const sk = 'top-secret-store-key'
    const fetcher: typeof fetch = vi.fn(async () => Response.json({
      code: 'permission_denied',
      message: `credential ${sk} was rejected`,
      retryable: false,
    }, { status: 403 }))
    const store = createStoreClient({ baseUrl: 'https://tb.example', sk, fetcher })

    let thrown: unknown
    try {
      await store.stat(URI)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(StoreEntryTBError)
    expect(thrown).toMatchObject({
      code: 'permission_denied',
      message: 'gateway returned a redacted error (HTTP 403)',
    })
    expect((thrown as Error).message).not.toContain(sk)
  })

  it('拒绝非法 Store URI/list descriptor 与换行 SK', async () => {
    const badList: typeof fetch = vi.fn(async () => Response.json({
      items: [{ ...DESCRIPTOR, uri: 'store://other/not-allowed' }],
    }))
    await expect(createStoreClient({
      baseUrl: 'https://tb.example',
      sk: 'secret',
      fetcher: badList,
    }).list()).rejects.toMatchObject({ code: 'internal' })

    const never: typeof fetch = vi.fn()
    await expect(createStoreClient({
      baseUrl: 'https://tb.example',
      sk: 'bad\nsecret',
      fetcher: never,
    }).stat(URI)).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(never).not.toHaveBeenCalled()
  })

  it('Store URI canonical parser 严格接受 22–64 位 base64url，非法输入不发请求', async () => {
    const min = 'store://default/AAAAAAAAAAAAAAAAAAAAAA'
    const max = `store://default/${'A'.repeat(64)}`
    expect(parseStoreUri(min)).toBe(min)
    expect(parseStoreUri(max)).toBe(max)
    for (const invalid of [
      `store://default/${'A'.repeat(21)}`,
      `store://default/${'A'.repeat(65)}`,
      'store://default/not+base64url_________',
      'store://other/AAAAAAAAAAAAAAAAAAAAAA',
    ]) {
      expect(() => parseStoreUri(invalid)).toThrow(StoreEntryTBError)
    }

    const fetcher: typeof fetch = vi.fn()
    await expect(createStoreClient({
      baseUrl: 'https://tb.example',
      sk: 'secret',
      fetcher,
    }).stat('store://default/short')).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['read', 'share'] as const)('%s grant 的 URI 必须与请求 URI 一致', async (command) => {
    const otherUri = 'store://default/ZZZZZZZZZZZZZZZZZZZZZZ'
    const fetcher: typeof fetch = vi.fn(async () => Response.json(command === 'read'
      ? {
          $ref: 'https://tb.example/~store/refs/ref-token',
          uri: otherUri,
          contentType: 'text/plain',
          size: 5,
          expiresAt: '2099-01-01T00:15:00.000Z',
        }
      : {
          $ref: 'https://tb.example/~store/shares/share-token',
          uri: otherUri,
          shareId: 'share-id',
          expiresAt: '2099-01-01T00:15:00.000Z',
        }))
    const store = createStoreClient({ baseUrl: 'https://tb.example', sk: 'secret', fetcher })

    const request = command === 'read' ? store.read(URI) : store.share(URI)
    await expect(request).rejects.toMatchObject({ code: 'internal' })
  })

  it('download 在过期 read grant 上 fail closed，不请求 bearer URL', async () => {
    const fetcher: typeof fetch = vi.fn(async () => Response.json({
      $ref: 'https://tb.example/~store/refs/expired-token',
      uri: URI,
      contentType: 'text/plain',
      size: 5,
      expiresAt: '2000-01-01T00:00:00.000Z',
    }))
    const store = createStoreClient({ baseUrl: 'https://tb.example', sk: 'secret', fetcher })

    await expect(store.download(URI)).rejects.toMatchObject({
      code: 'internal',
      message: expect.stringContaining('expired'),
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it.each([
    'http://127.0.0.1:9/admin',
    'https://other.example/~store/refs/body.signature',
    'https://tb.example/~store/shares/body.signature',
    'https://tb.example/~store/refs/body.signature?redirect=internal',
    'https://tb.example/~store/refs/body%2Fescape.signature',
  ])('download 拒绝越权 bearer URL 且不发第二次请求: %s', async ($ref) => {
    const fetcher: typeof fetch = vi.fn(async () => Response.json({
      $ref,
      uri: URI,
      contentType: 'text/plain',
      size: 5,
      expiresAt: '2099-01-01T00:15:00.000Z',
    }))
    const store = createStoreClient({ baseUrl: 'https://tb.example/api', sk: 'secret', fetcher })

    await expect(store.download(URI)).rejects.toMatchObject({
      code: 'internal',
      message: 'gateway returned an invalid Store bearer URL',
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('显式 trustedRefOrigins 支持规范外部 origin，但仍钉死 Store 路径', async () => {
    const fetcher: typeof fetch = vi.fn(async input => String(input).includes('/system/store/read')
      ? Response.json({
          $ref: 'https://objects.example/~store/refs/body.signature',
          uri: URI,
          contentType: 'text/plain',
          size: 5,
          expiresAt: '2099-01-01T00:15:00.000Z',
        })
      : new Response('hello'))
    const store = createStoreClient({
      baseUrl: 'https://tb.example/api',
      sk: 'secret',
      fetcher,
      trustedRefOrigins: ['https://objects.example'],
    })

    const response = await store.download(URI)
    await expect(response.text()).resolves.toBe('hello')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each([
    'https://objects.example/path',
    'https://user:secret@objects.example',
    'file:///tmp/store',
  ])('trustedRefOrigins 只接受纯 HTTP(S) origin: %s', (origin) => {
    expect(() => createStoreClient({
      baseUrl: 'https://tb.example',
      sk: 'secret',
      trustedRefOrigins: [origin],
    })).toThrowError(expect.objectContaining({ code: 'invalid_argument' }))
  })

  it('trustedRefOrigins 在 JS 调用面也 fail closed', () => {
    expect(() => createStoreClient({
      baseUrl: 'https://tb.example',
      sk: 'secret',
      trustedRefOrigins: 'https://objects.example' as never,
    })).toThrowError(expect.objectContaining({
      code: 'invalid_argument',
      message: 'trustedRefOrigins must be an array of origins',
    }))
  })

  it('stat/list 必须是完整 core wire descriptor，不能把 device 精简形状冒充管理结果', async () => {
    const stripped = {
      uri: URI,
      contentType: 'text/plain',
      size: 5,
      createdAt: '2099-01-01T00:00:00.000Z',
      readyAt: '2099-01-01T00:00:01.000Z',
    }
    const fetcher: typeof fetch = vi.fn(async input => Response.json(
      String(input).endsWith('/list') ? { items: [stripped] } : stripped,
    ))
    const store = createStoreClient({ baseUrl: 'https://tb.example', sk: 'secret', fetcher })

    await expect(store.stat(URI)).rejects.toMatchObject({ code: 'internal' })
    await expect(store.list()).rejects.toMatchObject({ code: 'internal' })
  })
})
