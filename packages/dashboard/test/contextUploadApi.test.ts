import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, uploadContextObject } from '../src/lib/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uploadContextObject API', () => {
  it('Tool Bridge 请求带 SK，直传 PUT 不带 SK/cookie，并返回稳定 uri', async () => {
    const grant = {
      uri: 'node://tools/team docs/camera/shot.jpg',
      method: 'PUT',
      url: 'https://objects.example/shot.jpg?signature=secret',
      headers: { 'content-type': 'image/jpeg' },
      expiresAt: '2099-08-24T12:00:00.000Z',
    }
    const calls: Array<{ init?: RequestInit, input: RequestInfo | URL }> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return calls.length === 1
        ? new Response(JSON.stringify(grant), { status: 200 })
        : new Response(null, { status: 200, headers: { etag: 'photo-v1' } })
    })
    vi.stubGlobal('fetch', fetcher)
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'shot.jpg', {
      type: 'image/jpeg',
    })

    await expect(uploadContextObject(
      { baseUrl: 'https://gw.example', sk: 'tbk-secret' },
      'tools/team docs',
      'camera/shot.jpg',
      file,
    )).resolves.toEqual({ uri: grant.uri, etag: 'photo-v1' })

    expect(String(calls[0]?.input)).toBe('https://gw.example/tools/team%20docs/create_upload')
    const firstHeaders = new Headers(calls[0]?.init?.headers)
    expect(firstHeaders.get('authorization')).toBe('Bearer tbk-secret')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      path: 'camera/shot.jpg',
      contentType: 'image/jpeg',
    })
    expect(String(calls[1]?.input)).toBe(grant.url)
    const secondHeaders = new Headers(calls[1]?.init?.headers)
    expect(secondHeaders.get('authorization')).toBeNull()
    expect(calls[1]?.init).toMatchObject({
      method: 'PUT',
      body: file,
      credentials: 'omit',
    })
  })

  it('对象存储失败仅暴露状态，不回显响应体或预签名 URL', async () => {
    const secretUrl = 'https://objects.example/shot.jpg?signature=secret'
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        uri: 'node://photos/shot.jpg',
        method: 'PUT',
        url: secretUrl,
        headers: { 'content-type': 'application/octet-stream' },
        expiresAt: '2099-08-24T12:00:00.000Z',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('SignatureDoesNotMatch: private', { status: 403 }))
    vi.stubGlobal('fetch', fetcher)

    let thrown: unknown
    try {
      await uploadContextObject(
        { baseUrl: 'https://gw.example', sk: 'tbk-secret' },
        'photos',
        'shot.bin',
        new File([new Uint8Array([1])], 'shot.bin'),
      )
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ApiError)
    expect(thrown).toMatchObject({
      code: 'unavailable',
      status: 403,
      message: '对象存储直传返回 HTTP 403',
    })
    expect((thrown as Error).message).not.toContain('private')
    expect((thrown as Error).message).not.toContain(secretUrl)
  })

  it('overwrite 显式进入 grant 请求，412 映射为 conflict', async () => {
    const grant = {
      uri: 'node://photos/shot.jpg',
      method: 'PUT',
      url: 'https://objects.example/shot.jpg?signature=secret',
      headers: { 'content-type': 'application/octet-stream' },
      expiresAt: '2099-08-24T12:00:00.000Z',
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(grant), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
    vi.stubGlobal('fetch', fetcher)

    await expect(uploadContextObject(
      { baseUrl: 'https://gw.example', sk: 'tbk-secret' },
      'photos',
      'shot.bin',
      new File([new Uint8Array([1])], 'shot.bin'),
      true,
    )).rejects.toMatchObject({ code: 'conflict', status: 412 })
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      path: 'shot.bin',
      contentType: 'application/octet-stream',
      overwrite: true,
    })
  })

  it('过期 grant 不发送对象存储请求', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      uri: 'node://photos/shot.jpg',
      method: 'PUT',
      url: 'https://objects.example/shot.jpg?signature=secret',
      headers: { 'content-type': 'application/octet-stream' },
      expiresAt: '2000-01-01T00:00:00.000Z',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    await expect(uploadContextObject(
      { baseUrl: 'https://gw.example', sk: 'tbk-secret' },
      'photos',
      'shot.bin',
      new File([new Uint8Array([1])], 'shot.bin'),
    )).rejects.toMatchObject({ code: 'unavailable', status: 503 })
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
