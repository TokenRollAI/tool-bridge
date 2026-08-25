import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTBError, type TBError } from '@tool-bridge/core'
import {
  createProviderHttpClient,
  type ProviderHttpErrorContext,
} from '../../src/_runtime/providerHttp'
import { upstreamError } from '../../src/_runtime/upstreamError'

function transport(response: Response): ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.resolve(response))
}

async function caught(promise: Promise<unknown>): Promise<TBError> {
  try {
    await promise
    throw new Error('expected provider request to fail')
  } catch (error) {
    expect(isTBError(error)).toBe(true)
    return error as TBError
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('provider HTTP transport boundary', () => {
  it('注入的 transport 仍先经过 guardedFetch，不能借测试入口访问私网', async () => {
    const fetchImpl = transport(new Response('{}'))
    const client = createProviderHttpClient({
      baseUrl: 'http://127.0.0.1',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })

    await expect(client.request({ path: '/secret' })).rejects.toMatchObject({
      code: 'invalid_argument',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('有注入 transport 时不逃逸到 global fetch，且一次网络失败不重试', async () => {
    const globalFetch = vi.fn(() => Promise.reject(new Error('global fetch must not run')))
    vi.stubGlobal('fetch', globalFetch)
    const fetchImpl = vi.fn(() => Promise.reject(new Error('socket closed')))
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })

    await expect(client.request({ path: '/once' })).rejects.toMatchObject({
      code: 'unavailable',
      retryable: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('timeoutMs 通过 AbortSignal.timeout 中止 transport，并稳定映射为 timeout 而非裸 DOMException', async () => {
    const fetchImpl = vi.fn((input: Request) => new Promise<Response>((_resolve, reject) => {
      input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })
    }))
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })

    await expect(client.request({
      path: '/slow',
      timeoutMs: 5,
      mapTransportError: ({ kind }) => upstreamError(kind === 'timeout' ? 504 : 502, kind),
    })).rejects.toMatchObject({ code: 'unavailable', message: 'timeout', retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('timeoutMs 覆盖响应体读取：响应头已返回但 body 永不结束时仍按 timeout 失败', async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(new ReadableStream({
      start() {
        // 故意不 enqueue/close：模拟响应头已到、响应体永久停顿。
      },
    }), { headers: { 'content-type': 'application/json' } })))
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })

    const pending = client.request({
      path: '/stalled-body',
      timeoutMs: 1_000,
      mapTransportError: ({ kind }) => upstreamError(kind === 'timeout' ? 504 : 502, kind),
    })
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
    controller.abort(new DOMException('body deadline expired', 'TimeoutError'))

    await expect(pending).rejects.toMatchObject({
      code: 'unavailable',
      message: 'timeout',
      retryable: true,
    })
    expect(timeout).toHaveBeenCalledWith(1_000)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('重定向完全交给 guardedFetch：逐跳检查并按 Fetch 语义把 POST 302 降成 GET', async () => {
    const methods: string[] = []
    const fetchImpl = vi.fn((input: Request) => {
      methods.push(input.method)
      return Promise.resolve(methods.length === 1
        ? new Response(null, { status: 302, headers: { location: '/done' } })
        : Response.json({ ok: true }))
    })
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })

    const result = await client.request({ path: '/start', method: 'POST', json: { a: 1 } })
    expect(result.data).toEqual({ ok: true })
    expect(methods).toEqual(['POST', 'GET'])
  })

  it('默认拒绝把 JSON body 经 307/308 转发到另一 origin，显式 follow 才能放宽', async () => {
    const seenBodies: string[] = []
    const fetchImpl = vi.fn(async (input: Request) => {
      seenBodies.push(await input.text())
      return new Response(null, {
        status: 307,
        headers: { location: 'https://other.example/collect' },
      })
    })
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })

    await expect(client.request({ path: '/submit', method: 'POST', json: { secret: 'value' } }))
      .rejects.toMatchObject({ code: 'invalid_argument' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(seenBodies).toEqual(['{"secret":"value"}'])
  })
})

describe('provider HTTP wire encoding', () => {
  it('支持逐请求动态 baseUrl，并拒绝缺失 baseUrl 与跨 origin path', async () => {
    const fetchImpl = transport(Response.json({ ok: true }))
    const client = createProviderHttpClient({
      service: 'dynamic provider',
      transport: fetchImpl as unknown as typeof fetch,
    })

    await expect(client.request({ path: '/missing' }))
      .rejects.toMatchObject({ code: 'invalid_argument', message: 'dynamic provider request requires a baseUrl' })
    await expect(client.request({ baseUrl: 'not a url', path: '/invalid' }))
      .rejects.toMatchObject({ code: 'invalid_argument', message: 'dynamic provider baseUrl must be a valid absolute URL' })
    await expect(client.request({ baseUrl: 'https://tenant.example/api/', path: 'https://evil.example/steal' }))
      .rejects.toMatchObject({ code: 'invalid_argument' })
    expect(fetchImpl).not.toHaveBeenCalled()

    await expect(client.request({ baseUrl: 'https://tenant.example/api/', path: '/users' }))
      .resolves.toMatchObject({ data: { ok: true } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect((fetchImpl.mock.calls[0]?.[0] as Request).url).toBe('https://tenant.example/api/users')
  })

  it('json 与显式 body 互斥，包括 body:null', async () => {
    const fetchImpl = transport(Response.json({ ok: true }))
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })

    await expect(client.request({ path: '/invalid', json: {}, body: null }))
      .rejects.toMatchObject({ code: 'invalid_argument' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('保留 query 顺序和重复键，并编码 JSON body/header', async () => {
    let sent: Request | undefined
    const fetchImpl = vi.fn((input: Request) => {
      sent = input
      return Promise.resolve(Response.json({ id: 'ok' }))
    })
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com/v1/',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })

    await client.request({
      path: 'users',
      method: 'POST',
      query: [
        ['email', ['a@example.com', 'b@example.com']],
        ['limit', 20],
        ['missing', undefined],
      ],
      headers: { 'authorization': 'Bearer test-secret', 'x-trace': 't1' },
      json: { name: 'Ada' },
    })

    expect(sent).toBeDefined()
    const url = new URL(sent!.url)
    expect(url.pathname).toBe('/v1/users')
    expect(url.searchParams.getAll('email')).toEqual(['a@example.com', 'b@example.com'])
    expect([...url.searchParams.keys()]).toEqual(['email', 'email', 'limit'])
    expect(sent!.headers.get('authorization')).toBe('Bearer test-secret')
    expect(sent!.headers.get('content-type')).toBe('application/json')
    await expect(sent!.json()).resolves.toEqual({ name: 'Ada' })
  })

  it('支持 text、auto 与显式 empty 响应模式', async () => {
    const responses = [
      new Response('plain text'),
      new Response('{"ok":true}', { headers: { 'content-type': 'application/json; charset=utf-8' } }),
      new Response('ignored'),
    ]
    const fetchImpl = vi.fn(() => Promise.resolve(responses.shift()!))
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })

    await expect(client.request({ path: '/text', responseType: 'text' }))
      .resolves.toMatchObject({ data: 'plain text' })
    await expect(client.request({ path: '/auto', responseType: 'auto' }))
      .resolves.toMatchObject({ data: { ok: true } })
    await expect(client.request({ path: '/empty', responseType: 'empty' }))
      .resolves.toMatchObject({ data: undefined })
  })
})

describe('provider HTTP response/error semantics', () => {
  it('acceptStatuses 只放行指定的非 2xx，重复值无副作用', async () => {
    const responses = [
      new Response('{"found":false}', { status: 404, statusText: 'Not Found' }),
      new Response(null, { status: 304 }),
    ]
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: vi.fn(() => Promise.resolve(responses.shift()!)) as unknown as typeof fetch,
    })

    await expect(client.request({ path: '/missing', acceptStatuses: [404, 404] })).resolves.toMatchObject({
      data: { found: false },
      status: 404,
      statusText: 'Not Found',
    })
    await expect(client.request({ path: '/cached', acceptStatuses: [404] }))
      .rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it.each([99, 600, 200.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'acceptStatuses 拒绝非法状态 %s，且不发请求',
    async (status) => {
      const fetchImpl = transport(Response.json({ ok: true }))
      const client = createProviderHttpClient({
        baseUrl: 'https://api.example.com',
        service: 'test provider',
        transport: fetchImpl as unknown as typeof fetch,
      })
      await expect(client.request({ path: '/invalid', acceptStatuses: [status] }))
        .rejects.toMatchObject({ code: 'invalid_argument' })
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )

  it.each([0, -1, 1.5, 2_147_483_648, Number.NaN, Number.POSITIVE_INFINITY])(
    'timeoutMs 拒绝计时器安全范围外的值 %s，且不发请求',
    async (timeoutMs) => {
      const fetchImpl = transport(Response.json({ ok: true }))
      const client = createProviderHttpClient({
        baseUrl: 'https://api.example.com',
        service: 'test provider',
        transport: fetchImpl as unknown as typeof fetch,
      })
      await expect(client.request({ path: '/invalid', timeoutMs }))
        .rejects.toMatchObject({ code: 'invalid_argument' })
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )

  it('201 JSON 与 204 空响应都是正常成功', async () => {
    const responses = [
      new Response('{"created":true}', { status: 201, statusText: 'Created' }),
      new Response(null, { status: 204 }),
    ]
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: vi.fn(() => Promise.resolve(responses.shift()!)) as unknown as typeof fetch,
    })
    await expect(client.request({ path: '/created' })).resolves.toMatchObject({
      data: { created: true },
      status: 201,
      statusText: 'Created',
    })
    await expect(client.request({ path: '/deleted' })).resolves.toMatchObject({
      bodyKind: 'empty',
      data: undefined,
      status: 204,
    })
  })

  it.each([204, 205])('HTTP %s 成功空体稳定归一成 undefined', async (status) => {
    const fetchImpl = transport(new Response(null, { status }))
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })
    await expect(client.request({ path: '/empty' })).resolves.toMatchObject({ data: undefined, status })
  })

  it('304 不是成功，空体仍映射成稳定 TBError', async () => {
    const fetchImpl = transport(new Response(null, { status: 304 }))
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })
    try {
      await client.request({ path: '/cached' })
      expect.unreachable('应当抛出')
    } catch (error) {
      expect(isTBError(error)).toBe(true)
      expect((error as TBError).code).toBe('invalid_argument')
    }
  })

  it('2xx 非 JSON 归 unavailable；错误响应可由 provider 钩子按原文定制', async () => {
    const responses = [
      new Response('not-json', { status: 200 }),
      new Response('quota exhausted', { status: 429 }),
    ]
    const fetchImpl = vi.fn(() => Promise.resolve(responses.shift()!))
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })

    await expect(client.request({ path: '/broken' })).rejects.toMatchObject({
      code: 'unavailable',
      retryable: true,
    })
    await expect(client.request({
      path: '/quota',
      mapError: ({ data, status }) => upstreamError(status, String(data)),
    })).rejects.toMatchObject({ code: 'rate_limited', message: 'quota exhausted' })
  })

  it('错误钩子能区分 invalid-json 与合法 JSON 字符串，并读取 headers/statusText', async () => {
    const seen: Array<Record<string, unknown>> = []
    const responses = [
      new Response('<html>bad</html>', {
        status: 418,
        statusText: 'Upstream Teapot',
        headers: { 'content-type': 'application/json', 'x-error-shape': 'edge' },
      }),
      new Response('"json string"', { status: 400, headers: { 'content-type': 'application/json' } }),
    ]
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: vi.fn(() => Promise.resolve(responses.shift()!)) as unknown as typeof fetch,
    })
    const mapError = (context: ProviderHttpErrorContext): TBError => {
      seen.push({
        bodyKind: context.bodyKind,
        data: context.data,
        shape: context.headers.get('x-error-shape'),
        statusText: context.statusText,
      })
      return upstreamError(context.status, 'mapped')
    }

    await expect(client.request({ path: '/invalid', mapError })).rejects.toMatchObject({ message: 'mapped' })
    await expect(client.request({ path: '/string', mapError })).rejects.toMatchObject({ message: 'mapped' })
    expect(seen).toEqual([
      {
        bodyKind: 'invalid-json',
        data: '<html>bad</html>',
        shape: 'edge',
        statusText: 'Upstream Teapot',
      },
      { bodyKind: 'json', data: 'json string', shape: null, statusText: '' },
    ])
  })

  it('默认及自定义错误都不回显 URL、认证头值或响应体中的凭证', async () => {
    const secret = 'sk_live_super_secret'
    const responses = [
      new Response(JSON.stringify({ error: `bad body ${secret}` }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
      new Response(JSON.stringify({ error: `see https://evil.example/x?token=${secret}` }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    ]
    const fetchImpl = vi.fn(() => Promise.resolve(responses.shift()!))
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })

    const first = await caught(client.request({
      path: '/default',
      headers: { authorization: `Bearer ${secret}` },
    }))
    expect(first.message).toBe('test provider request failed with 400')
    expect(first.message).not.toContain(secret)
    expect(first.message).not.toContain('bad body')

    const second = await caught(client.request({
      path: '/custom',
      headers: { authorization: `Bearer ${secret}` },
      mapError: ({ data, status }) => upstreamError(status, JSON.stringify(data)),
    }))
    expect(second.message).not.toContain(secret)
    expect(second.message).not.toContain('https://')
    expect(second.message).toContain('[redacted-url]')
  })

  it('自定义认证方案、Basic 明文和 JSON 深层凭证均不会从错误钩子泄漏', async () => {
    const basicUser = 'tenant-user'
    const basicPassword = 'basic-password'
    const customKey = 'custom-key-secret'
    const bodyPassword = 'body-password'
    const nestedToken = 'nested-token'
    const basicPayload = btoa(`${basicUser}:${basicPassword}`)
    const responses = [
      new Response('{}', { status: 400 }),
      new Response('{}', { status: 400 }),
    ]
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      sensitiveHeaders: ['x-provider-credential'],
      service: 'test provider',
      transport: vi.fn(() => Promise.resolve(responses.shift()!)) as unknown as typeof fetch,
    })

    const headerError = await caught(client.request({
      path: '/header',
      headers: {
        'authorization': `Basic ${basicPayload}`,
        'x-provider-credential': `Key ${customKey}`,
      },
      mapError: ({ status }) => upstreamError(
        status,
        `${basicPayload} ${basicUser} ${basicPassword} ${customKey}`,
      ),
    }))
    expect(headerError.message).not.toContain(basicPayload)
    expect(headerError.message).not.toContain(basicUser)
    expect(headerError.message).not.toContain(basicPassword)
    expect(headerError.message).not.toContain(customKey)

    const bodyError = await caught(client.request({
      path: '/body',
      method: 'POST',
      json: {
        account: { password: bodyPassword },
        credentials: [{ access_token: nestedToken }],
      },
      mapError: ({ status }) => upstreamError(status, `${bodyPassword} ${nestedToken}`),
    }))
    expect(bodyError.message).not.toContain(bodyPassword)
    expect(bodyError.message).not.toContain(nestedToken)
  })

  it('same-origin 绝对 path 自带的凭证 query 同样进入脱敏集合', async () => {
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: vi.fn(() => Promise.reject(
        new Error('https://api.example.com/check?api_key=path-secret exposed path-secret'),
      )) as unknown as typeof fetch,
    })

    const error = await caught(client.request({
      path: 'https://api.example.com/check?api_key=path-secret',
      mapTransportError: ({ message }) => upstreamError(502, message ?? 'missing'),
    }))
    expect(error.message).not.toContain('path-secret')
    expect(error.message).not.toContain('https://')
  })

  it('transport 钩子只拿到脱敏消息，且返回值保持 TBError', async () => {
    const secret = 'query-secret'
    const fetchImpl = vi.fn(() => Promise.reject(
      new Error(`failed https://api.example.com/items?api_key=${secret}`),
    ))
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })
    const error = await caught(client.request({
      path: '/items',
      query: [['api_key', secret]],
      mapTransportError: ({ message }) => upstreamError(502, `network: ${message}`),
    }))

    expect(isTBError(error)).toBe(true)
    expect(error.message).not.toContain(secret)
    expect(error.message).not.toContain('https://')
  })
})
