import { describe, expect, it, vi } from 'vitest'
import {
  TBError,
  uploadContextObject,
  type UploadContextObjectOptions,
} from '../src/device'

const GRANT = {
  uri: 'node://context/photos/device-01/capture.jpg',
  method: 'PUT' as const,
  url: 'https://objects.example/capture.jpg?signature=secret-signature',
  headers: {
    'content-type': 'image/jpeg',
    'x-amz-checksum-sha256': 'signed-checksum',
  },
  expiresAt: '2099-08-24T12:00:00.000Z',
}

function options(overrides: Partial<UploadContextObjectOptions> = {}): UploadContextObjectOptions {
  return {
    baseUrl: 'https://tb.example/api/',
    deviceId: 'camera-01',
    contextPath: '/context/photos/',
    entryPath: 'device-01/capture.jpg',
    contentType: 'image/jpeg',
    body: new Uint8Array([0xff, 0xd8, 0xff]),
    credentialProvider: {
      prepare: () => ({
        headers: {
          'authorization': 'Bearer device-secret',
          'x-device-signature': 'signed-device-request',
        },
      }),
    },
    ...overrides,
  }
}

describe('uploadContextObject', () => {
  it.each([
    { baseUrl: 'not-a-url', contextPath: 'context/photos' },
    { baseUrl: 'ftp://tb.example', contextPath: 'context/photos' },
    { baseUrl: 'https://tb.example', contextPath: 'context//photos' },
  ])('在取凭证前拒绝非法地址或 Context 路径: %j', async (invalid) => {
    const prepare = vi.fn(() => ({ headers: {} }))
    const fetcher: typeof fetch = vi.fn()

    await expect(uploadContextObject(options({
      ...invalid,
      fetcher,
      credentialProvider: { prepare },
    }))).rejects.toMatchObject({ name: 'TBError', code: 'invalid_argument' })
    expect(prepare).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('先以认证 JSON 请求 grant，再把原始二进制和签名头直接 PUT', async () => {
    const binary = new Uint8Array([0xff, 0xd8, 0xff, 0x00])
    const calls: Array<{ init?: RequestInit, input: Parameters<typeof fetch>[0] }> = []
    const uploadResponse = new Response('ignored response body', {
      status: 200,
      headers: { etag: '"photo-etag"' },
    })
    const cancelUploadBody = vi.spyOn(uploadResponse.body!, 'cancel')
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      calls.push({ input, init })
      if (calls.length === 1) {
        return new Response(JSON.stringify(GRANT), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return uploadResponse
    })

    await expect(uploadContextObject(options({ body: binary, fetcher }))).resolves.toEqual({
      uri: GRANT.uri,
      etag: '"photo-etag"',
    })
    expect(calls).toHaveLength(2)

    expect(String(calls[0]?.input)).toBe('https://tb.example/api/context/photos/create_upload')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.body).not.toBe(binary)
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      path: 'device-01/capture.jpg',
      contentType: 'image/jpeg',
    })
    const firstHeaders = new Headers(calls[0]?.init?.headers)
    expect(firstHeaders.get('accept')).toBe('application/json')
    expect(firstHeaders.get('content-type')).toBe('application/json')
    expect(firstHeaders.get('authorization')).toBe('Bearer device-secret')
    expect(firstHeaders.get('x-device-signature')).toBe('signed-device-request')

    expect(String(calls[1]?.input)).toBe(GRANT.url)
    expect(calls[1]?.init).toMatchObject({
      method: 'PUT',
      body: binary,
      headers: GRANT.headers,
    })
    expect(cancelUploadBody).toHaveBeenCalledOnce()
  })

  it('显式 overwrite 只进入 grant 请求，不改变对象存储 PUT 形状', async () => {
    const calls: RequestInit[] = []
    const fetcher: typeof fetch = vi.fn(async (_input, init) => {
      calls.push(init ?? {})
      return calls.length === 1
        ? new Response(JSON.stringify(GRANT), { status: 200 })
        : new Response(null, { status: 200 })
    })

    await uploadContextObject(options({ fetcher, overwrite: true }))
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      path: 'device-01/capture.jpg',
      contentType: 'image/jpeg',
      overwrite: true,
    })
    expect(new Headers(calls[1]?.headers).get('if-none-match')).toBeNull()
  })

  it.each([
    { url: 'wss://tb.example/system/device/ws?ticket=secret' },
    { headers: { authorization: 'Bearer ok\r\nx-leak: 1' } },
  ])('HTTP credential 非法时不发请求也不 invalidate: %j', async (credential) => {
    const invalidate = vi.fn()
    const fetcher: typeof fetch = vi.fn()
    const promise = uploadContextObject(options({
      fetcher,
      credentialProvider: { prepare: () => credential, invalidate },
    }))

    await expect(promise).rejects.toMatchObject({
      name: 'TBError',
      code: 'invalid_argument',
    })
    expect(fetcher).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it.each([401, 403])('Tool Bridge 认证拒绝 HTTP %s 时 invalidate 凭证', async (status) => {
    const reason = {
      code: 'permission_denied' as const,
      message: 'device credential rejected',
      retryable: false,
    }
    const invalidate = vi.fn()
    const fetcher: typeof fetch = vi.fn(async () => new Response(JSON.stringify(reason), {
      status,
      headers: { 'content-type': 'application/json' },
    }))

    const promise = uploadContextObject(options({
      fetcher,
      credentialProvider: {
        prepare: () => ({ headers: { authorization: 'Bearer rejected' } }),
        invalidate,
      },
    }))
    await expect(promise).rejects.toMatchObject({
      name: 'TBError',
      code: 'permission_denied',
      message: reason.message,
      httpStatus: status,
    })
    expect(invalidate).toHaveBeenCalledOnce()
    expect(invalidate).toHaveBeenCalledWith(reason)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('对象存储上传失败只报告 HTTP 状态，不读取或回显响应体', async () => {
    const sensitiveBody = 'SignatureDoesNotMatch: credential=do-not-leak'
    const uploadResponse = new Response(sensitiveBody, { status: 403 })
    const cancelUploadBody = vi.spyOn(uploadResponse.body!, 'cancel')
    const fetcher: typeof fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(GRANT), { status: 200 }))
      .mockResolvedValueOnce(uploadResponse)

    let thrown: unknown
    try {
      await uploadContextObject(options({ fetcher }))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(TBError)
    expect(thrown).toMatchObject({
      code: 'unavailable',
      message: 'object upload failed with HTTP 403',
    })
    expect((thrown as Error).message).not.toContain('do-not-leak')
    expect(cancelUploadBody).toHaveBeenCalledOnce()
  })

  it('默认不覆盖命中 412 时返回 conflict，且不 invalidate Tool Bridge 凭证', async () => {
    const invalidate = vi.fn()
    const fetcher: typeof fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(GRANT), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 412 }))

    await expect(uploadContextObject(options({
      fetcher,
      credentialProvider: {
        prepare: () => ({ headers: { authorization: 'Bearer valid' } }),
        invalidate,
      },
    }))).rejects.toMatchObject({
      name: 'TBError',
      code: 'conflict',
      message: expect.stringContaining('overwrite: true'),
    })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('对象存储网络异常不回显 fetch 错误里的预签名 URL', async () => {
    const fetcher: typeof fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(GRANT), { status: 200 }))
      .mockRejectedValueOnce(new Error(`fetch failed for ${GRANT.url}`))

    let thrown: unknown
    try {
      await uploadContextObject(options({ fetcher }))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({
      name: 'TBError',
      code: 'unavailable',
      message: 'object upload request failed',
    })
    expect((thrown as Error).message).not.toContain('secret-signature')
  })

  it.each([
    null,
    { ...GRANT, method: 'POST' },
    { ...GRANT, headers: { authorization: 123 } },
    { ...GRANT, url: 'file:///tmp/capture.jpg' },
    { ...GRANT, expiresAt: 'not-a-timestamp' },
  ])('拒绝异常 upload grant: %j', async (grant) => {
    const fetcher: typeof fetch = vi.fn(async () => new Response(JSON.stringify(grant), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(uploadContextObject(options({ fetcher }))).rejects.toMatchObject({
      name: 'TBError',
      code: 'internal',
      message: 'gateway returned an invalid upload grant',
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('过期 grant 不发送对象存储请求', async () => {
    const fetcher: typeof fetch = vi.fn(async () => new Response(JSON.stringify({
      ...GRANT,
      expiresAt: '2000-01-01T00:00:00.000Z',
    }), { status: 200 }))

    await expect(uploadContextObject(options({ fetcher }))).rejects.toMatchObject({
      code: 'unavailable',
      message: expect.stringContaining('expired'),
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
