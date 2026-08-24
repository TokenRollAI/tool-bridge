import { describe, expect, it, vi } from 'vitest'
import { createStoreClient } from '../src'

const URI = 'store://default/AAAAAAAAAAAAAAAAAAAAAA' as const
const DESCRIPTOR = {
  uri: URI,
  status: 'ready',
  contentType: 'text/plain',
  size: 5,
  owner: 'agent:owner',
  createdAt: '2099-01-01T00:00:00.000Z',
  updatedAt: '2099-01-01T00:00:01.000Z',
  readyAt: '2099-01-01T00:00:01.000Z',
}

describe('createStoreClient', () => {
  it('提供 stat/list/read/download/share/revoke/delete 的类型安全管理面', async () => {
    const calls: Array<{ init?: RequestInit, url: string }> = []
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url === 'https://tb.example/~store/refs/ref-token') {
        return new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } })
      }
      const command = new URL(url).pathname.split('/').pop()
      if (command === 'stat') return Response.json(DESCRIPTOR)
      if (command === 'list') return Response.json({ items: [DESCRIPTOR], cursor: 'next' })
      if (command === 'read') {
        return Response.json({
          $ref: 'https://tb.example/~store/refs/ref-token',
          uri: URI,
          contentType: 'text/plain',
          size: 5,
          expiresAt: '2099-01-01T00:15:00.000Z',
        })
      }
      if (command === 'share') {
        return Response.json({
          $ref: 'https://tb.example/~store/shares/share-token',
          uri: URI,
          shareId: 'share-id',
          expiresAt: '2099-01-01T00:15:00.000Z',
        })
      }
      return Response.json({ ok: true })
    })
    const sk = vi.fn(() => 'rotating-secret-key')
    const store = createStoreClient({ baseUrl: 'https://tb.example/api/', sk, fetcher })

    await expect(store.stat(URI)).resolves.toMatchObject({ uri: URI, size: 5 })
    await expect(store.list({ limit: 10 })).resolves.toMatchObject({
      items: [{ uri: URI }],
      cursor: 'next',
    })
    await expect(store.read(URI)).resolves.toMatchObject({ uri: URI, size: 5 })
    const downloaded = await store.download(URI)
    await expect(downloaded.text()).resolves.toBe('hello')
    await expect(store.share(URI, { ttlSec: 60 })).resolves.toMatchObject({
      shareId: 'share-id',
      uri: URI,
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
})
