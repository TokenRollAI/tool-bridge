import type { AddressInfo } from 'node:net'
import { createServer, type Server } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  parseContextUploadGrant,
  PresignedPutError,
  putPresignedObject,
} from '../../src/client/index'

const GRANT = {
  expiresAt: '2099-08-24T12:00:00.000Z',
  headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*' },
  method: 'PUT' as const,
  url: 'https://objects.example/body?signature=secret',
}

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

describe('putPresignedObject', () => {
  it('Context grant 在 PUT 前严格要求稳定 node:// URI', () => {
    expect(parseContextUploadGrant({ ...GRANT, uri: 'node://ctx/photos/a.bin' })).toMatchObject({
      method: 'PUT',
      uri: 'node://ctx/photos/a.bin',
    })
    for (const uri of [undefined, '', 'store://default/AAAAAAAAAAAAAAAAAAAAAA', 'node://']) {
      expect(() => parseContextUploadGrant({ ...GRANT, uri })).toThrow(PresignedPutError)
    }
  })

  it('只发送 grant headers，omit credentials，并拒绝所有重定向', async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 200,
      headers: { etag: 'v1' },
    })) as unknown as typeof fetch
    await expect(putPresignedObject(GRANT, new Uint8Array([1]), { fetcher }))
      .resolves.toEqual({ etag: 'v1' })
    const [url, init] = vi.mocked(fetcher).mock.calls[0]!
    expect(String(url)).toBe(GRANT.url)
    expect(init?.redirect).toBe('error')
    expect(init?.credentials).toBe('omit')
    expect(new Headers(init?.headers).get('authorization')).toBeNull()
  })

  it.each([
    'authorization',
    'cookie',
    'proxy-authorization',
    'x-tb-store-upload',
    'x-tb-store-capability',
    'x-tb-private-future-header',
  ])('拒绝可能携带平台凭证的 header: %s', async (name) => {
    const fetcher = vi.fn() as unknown as typeof fetch
    await expect(putPresignedObject({
      ...GRANT,
      headers: { [name]: 'must-not-leak' },
    }, new Uint8Array([1]), { fetcher })).rejects.toMatchObject({
      kind: 'invalid',
      message: 'gateway returned an invalid upload grant',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('网络异常不回显 URL/header/body', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error(`${GRANT.url} must-not-leak`)
    }) as unknown as typeof fetch
    const error = await putPresignedObject(GRANT, 'private-body', { fetcher })
      .catch(value => value) as PresignedPutError
    expect(error).toMatchObject({ kind: 'network', retryable: true })
    expect(error.message).not.toContain('signature=')
    expect(error.message).not.toContain('private-body')
  })

  it.each([307, 308])('原生 fetch 收到跨源 HTTP %s 时不重放私有 body', async (status) => {
    let exfiltrated = false
    const receiver = createServer((_request, response) => {
      exfiltrated = true
      response.end('unexpected')
    })
    const receiverUrl = await listen(receiver)
    const redirector = createServer((_request, response) => {
      response.statusCode = status
      response.setHeader('location', `${receiverUrl}/steal`)
      response.end()
    })
    const redirectorUrl = await listen(redirector)

    try {
      await expect(putPresignedObject({
        ...GRANT,
        url: `${redirectorUrl}/upload`,
      }, 'private-body', { fetcher: globalThis.fetch })).rejects.toMatchObject({
        kind: 'network',
      })
      expect(exfiltrated).toBe(false)
    } finally {
      await close(redirector)
      await close(receiver)
    }
  })
})
