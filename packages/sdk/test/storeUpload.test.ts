import { describe, expect, it, vi } from 'vitest'
import {
  TBError,
  uploadObject,
  type UploadObjectOptions,
} from '../src/device'
import { uploadObject as rootUploadObject } from '../src/index'

const READY = {
  uri: 'store://default/obj_01k4photo',
  contentType: 'image/jpeg',
  filename: 'capture.jpg',
  size: 4,
  checksum: { algorithm: 'sha256', value: 'ready-checksum' },
  etag: '"ready-etag"',
  createdAt: '2099-08-24T11:59:00.000Z',
  readyAt: '2099-08-24T12:00:00.000Z',
  // Server-only/secret fields must never escape the SDK parser.
  owner: { kind: 'key', id: 'secret-owner-shape' },
  driverKey: 'store/v1/internal-key',
  uploadToken: 'must-not-escape',
  url: 'https://objects.example/private?signature=must-not-escape',
}

const RELAY_GRANT = {
  uploadId: 'upload-01',
  objectUri: READY.uri,
  transport: 'relay' as const,
  method: 'PUT' as const,
  url: 'https://tb.example/~store/uploads/upload-01?signature=relay-secret',
  headers: { 'content-type': 'image/jpeg' },
  expiresAt: '2099-08-24T12:10:00.000Z',
  maxBytes: 1024,
  uploadToken: 'session-secret',
}

function options(overrides: Partial<UploadObjectOptions> = {}): UploadObjectOptions {
  return {
    baseUrl: 'https://tb.example/api/',
    deviceId: 'camera-01',
    body: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
    contentType: 'image/jpeg',
    filename: 'capture.jpg',
    checksum: { algorithm: 'sha256', value: 'declared-checksum' },
    idempotencyKey: 'capture-call-01',
    credentialProvider: {
      prepare: () => ({
        headers: {
          'authorization': 'Bearer device-secret',
          'x-device-proof': 'proof',
        },
      }),
    },
    ...overrides,
  }
}

describe('uploadObject', () => {
  it('根入口与 device 子入口导出同一个 neutral helper', () => {
    expect(rootUploadObject).toBe(uploadObject)
  })

  it('relay:以 HTTP credential create，PUT 成功即返回裁剪后的 ready descriptor', async () => {
    const calls: Array<{ init?: RequestInit, input: Parameters<typeof fetch>[0] }> = []
    const prepare = vi.fn(() => ({
      headers: {
        'authorization': 'Bearer device-secret',
        'x-device-proof': 'proof',
      },
    }))
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      calls.push({ input, init })
      return calls.length === 1
        ? new Response(JSON.stringify(RELAY_GRANT), { status: 200 })
        : new Response(JSON.stringify(READY), { status: 200 })
    })

    const result = await uploadObject(options({
      credentialProvider: { prepare },
      fetcher,
    }))

    expect(result).toEqual({
      uri: READY.uri,
      contentType: READY.contentType,
      filename: READY.filename,
      size: READY.size,
      checksum: READY.checksum,
      etag: READY.etag,
      createdAt: READY.createdAt,
      readyAt: READY.readyAt,
    })
    expect(result).not.toHaveProperty('uploadToken')
    expect(result).not.toHaveProperty('url')
    expect(result).not.toHaveProperty('owner')
    expect(result).not.toHaveProperty('driverKey')
    expect(prepare).toHaveBeenCalledWith({
      baseUrl: 'https://tb.example/api/',
      deviceId: 'camera-01',
      purpose: 'http',
      signal: expect.objectContaining({ aborted: false }),
    })
    expect(calls).toHaveLength(2)
    expect(String(calls[0]?.input)).toBe('https://tb.example/api/system/store/create_upload')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      contentType: 'image/jpeg',
      filename: 'capture.jpg',
      size: 4,
      checksum: { algorithm: 'sha256', value: 'declared-checksum' },
      idempotencyKey: 'capture-call-01',
    })
    const createHeaders = new Headers(calls[0]?.init?.headers)
    expect(createHeaders.get('authorization')).toBe('Bearer device-secret')
    expect(createHeaders.get('x-device-proof')).toBe('proof')
    expect(createHeaders.get('x-tb-store-capability')).toBeNull()

    expect(String(calls[1]?.input)).toBe(RELAY_GRANT.url)
    expect(calls[1]?.init?.method).toBe('PUT')
    const relayHeaders = new Headers(calls[1]?.init?.headers)
    expect(relayHeaders.get('content-type')).toBe('image/jpeg')
    expect(relayHeaders.get('x-tb-store-upload')).toBe(RELAY_GRANT.uploadToken)
  })

  it('presigned-put:直传后用 session token complete，不向对象存储发送额外 token', async () => {
    const directGrant = {
      ...RELAY_GRANT,
      transport: 'presigned-put' as const,
      url: 'https://objects.example/upload?signature=direct-secret',
      headers: {
        'content-type': 'image/jpeg',
        'x-amz-checksum-sha256': 'signed-checksum',
      },
    }
    const calls: Array<{ init?: RequestInit, input: Parameters<typeof fetch>[0] }> = []
    const directResponse = new Response('sensitive provider body', { status: 200 })
    const cancel = vi.spyOn(directResponse.body!, 'cancel')
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      calls.push({ input, init })
      if (calls.length === 1) return new Response(JSON.stringify(directGrant), { status: 200 })
      if (calls.length === 2) return directResponse
      return new Response(JSON.stringify(READY), { status: 200 })
    })

    await expect(uploadObject(options({ fetcher }))).resolves.toMatchObject({ uri: READY.uri })
    expect(calls).toHaveLength(3)
    expect(String(calls[1]?.input)).toBe(directGrant.url)
    expect(new Headers(calls[1]?.init?.headers).get('x-tb-store-upload')).toBeNull()
    expect(cancel).toHaveBeenCalledOnce()

    expect(String(calls[2]?.input)).toBe('https://tb.example/api/system/store/complete_upload')
    expect(calls[2]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ uploadId: directGrant.uploadId })
    const completeHeaders = new Headers(calls[2]?.init?.headers)
    expect(completeHeaders.get('x-tb-store-upload')).toBe(directGrant.uploadToken)
    expect(completeHeaders.get('authorization')).toBeNull()
  })

  it('幂等 create 已完成时直接返回 descriptor，不重复 PUT 或 complete', async () => {
    const fetcher: typeof fetch = vi.fn(async () => new Response(JSON.stringify({
      ...RELAY_GRANT,
      alreadyCompleted: true,
      descriptor: READY,
    }), { status: 200 }))

    await expect(uploadObject(options({ fetcher }))).resolves.toMatchObject({
      uri: READY.uri,
      size: READY.size,
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it.each([401, 403])('普通 create 认证拒绝 HTTP %s 时 invalidate credential', async (status) => {
    const reason = {
      code: 'permission_denied' as const,
      message: 'credential rejected',
      retryable: false,
    }
    const invalidate = vi.fn()
    const fetcher: typeof fetch = vi.fn(async () => new Response(JSON.stringify(reason), {
      status,
    }))

    await expect(uploadObject(options({
      fetcher,
      credentialProvider: {
        prepare: () => ({ headers: { authorization: 'Bearer rejected' } }),
        invalidate,
      },
    }))).rejects.toMatchObject({
      code: 'permission_denied',
      message: `gateway returned a redacted error (HTTP ${status})`,
    })
    expect(invalidate).toHaveBeenCalledWith({
      ...reason,
      message: `gateway returned a redacted error (HTTP ${status})`,
    })
  })

  it('grant 已过期时不发送 PUT', async () => {
    const fetcher: typeof fetch = vi.fn(async () => new Response(JSON.stringify({
      ...RELAY_GRANT,
      expiresAt: '2000-01-01T00:00:00.000Z',
    }), { status: 200 }))

    await expect(uploadObject(options({ fetcher }))).rejects.toMatchObject({
      code: 'unavailable',
      message: expect.stringContaining('expired'),
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('已知 size 超过 grant.maxBytes 时不发送 PUT', async () => {
    const fetcher: typeof fetch = vi.fn(async () => new Response(JSON.stringify({
      ...RELAY_GRANT,
      maxBytes: 3,
    }), { status: 200 }))

    await expect(uploadObject(options({ fetcher }))).rejects.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('maxBytes'),
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('直传网络错误不回显 presigned URL 或上传 token', async () => {
    const directGrant = {
      ...RELAY_GRANT,
      transport: 'presigned-put' as const,
      url: 'https://objects.example/upload?signature=do-not-leak',
    }
    const fetcher: typeof fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(directGrant), { status: 200 }))
      .mockRejectedValueOnce(new Error(
        `fetch failed for ${directGrant.url}; token=${directGrant.uploadToken}`,
      ))

    let thrown: unknown
    try {
      await uploadObject(options({ fetcher }))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(TBError)
    expect(thrown).toMatchObject({
      code: 'unavailable',
      message: 'Store object upload request failed',
    })
    expect((thrown as Error).message).not.toContain('do-not-leak')
    expect((thrown as Error).message).not.toContain(RELAY_GRANT.uploadToken)
  })

  it('relay 的结构化网关错误即使误带 URL/token 也会被客户端脱敏', async () => {
    const fetcher: typeof fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(RELAY_GRANT), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 'unavailable',
        message: `failed ${RELAY_GRANT.url} with ${RELAY_GRANT.uploadToken}`,
        retryable: true,
      }), { status: 503 }))

    let thrown: unknown
    try {
      await uploadObject(options({ fetcher }))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({
      code: 'unavailable',
      message: 'gateway returned a redacted error (HTTP 503)',
    })
    expect((thrown as Error).message).not.toContain('signature=')
    expect((thrown as Error).message).not.toContain(RELAY_GRANT.uploadToken)
  })

  it('AbortSignal 在取 credential 前终止请求，并返回稳定 AbortError', async () => {
    const controller = new AbortController()
    controller.abort(new Error(`sensitive ${RELAY_GRANT.url}`))
    const prepare = vi.fn()
    const fetcher: typeof fetch = vi.fn()

    let thrown: unknown
    try {
      await uploadObject(options({
        signal: controller.signal,
        credentialProvider: { prepare },
        fetcher,
      }))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ name: 'AbortError', message: 'The operation was aborted' })
    expect((thrown as Error).message).not.toContain('signature=')
    expect(prepare).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    null,
    { ...RELAY_GRANT, objectUri: 'node://context/photos/capture.jpg' },
    { ...RELAY_GRANT, transport: 'multipart' },
    { ...RELAY_GRANT, uploadToken: 'bad\r\ntoken' },
    { ...RELAY_GRANT, maxBytes: -1 },
    { ...RELAY_GRANT, url: 'file:///tmp/capture.jpg' },
  ])('拒绝异常 Store upload grant: %j', async (grant) => {
    const fetcher: typeof fetch = vi.fn(async () => new Response(JSON.stringify(grant), {
      status: 200,
    }))
    await expect(uploadObject(options({ fetcher }))).rejects.toMatchObject({
      code: 'internal',
      message: 'gateway returned an invalid Store upload grant',
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('descriptor URI 必须与 grant 一致且必须是 store://default', async () => {
    const fetcher: typeof fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(RELAY_GRANT), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...READY,
        uri: 'store://default/different-object',
      }), { status: 200 }))
    await expect(uploadObject(options({ fetcher }))).rejects.toMatchObject({
      code: 'internal',
      message: 'gateway returned an invalid Store object descriptor',
    })
  })
})
