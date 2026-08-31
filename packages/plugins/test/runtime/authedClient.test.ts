import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTBError, type TBError } from '@tool-bridge/core'
import { type ProviderContext, requireCredential } from '../../src/_runtime/plugin'
import { createAuthedClient } from '../../src/_runtime/authedClient'
import { upstreamError } from '../../src/_runtime/upstreamError'

/**
 * `createAuthedClient` 的行为面:认证头注入位置、头合并次序、标准错误提取的键序与
 * 兜底、以及与整段覆写 `mapError` 的互斥。传输语义(guardedFetch、超时、脱敏)不在
 * 这里重复 —— 那是 providerHttp.test.ts 的领地,本层只是往它上面放声明。
 */

const CTX: ProviderContext = { config: undefined, credentials: undefined, upstreamAuth: 'k-123' }

function transport(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return vi.fn(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })))
}

function sent(fetchImpl: ReturnType<typeof vi.fn>): Request {
  return fetchImpl.mock.calls[0]?.[0] as Request
}

async function caught(promise: Promise<unknown>): Promise<TBError> {
  try {
    await promise
    throw new Error('expected authed request to fail')
  } catch (error) {
    expect(isTBError(error)).toBe(true)
    return error as TBError
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('认证头注入', () => {
  it.each([
    ['bearer', { kind: 'bearer' } as const, 'authorization', 'Bearer k-123'],
    ['token', { kind: 'token' } as const, 'authorization', 'Token k-123'],
    ['命名头', { kind: 'header', name: 'x-api-key' } as const, 'x-api-key', 'k-123'],
  ])('%s 头型', async (_label, auth, headerName, expected) => {
    const fetchImpl = transport({})
    const client = createAuthedClient({
      auth,
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })
    await client.request(CTX, { path: '/x' })
    expect(sent(fetchImpl).headers.get(headerName)).toBe(expected)
  })

  it('custom 头型拿到 ctx,可用多字段凭证拼任意头', async () => {
    const fetchImpl = transport({})
    const client = createAuthedClient({
      auth: {
        kind: 'custom',
        headers: ctx => ({ authorization: `Key ${requireCredential(ctx, 'test provider', 'apiKey')}` }),
      },
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })
    await client.request(
      { config: undefined, credentials: { apiKey: 'multi-1' }, upstreamAuth: undefined },
      { path: '/x' },
    )
    expect(sent(fetchImpl).headers.get('authorization')).toBe('Key multi-1')
  })

  it('没配凭证 → unavailable 且不打上游(fail closed 先于请求)', async () => {
    const fetchImpl = transport({})
    const client = createAuthedClient({
      auth: { kind: 'bearer' },
      baseUrl: 'https://api.example.com',
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })
    const error = await caught(client.request(
      { config: undefined, credentials: undefined, upstreamAuth: undefined },
      { path: '/x' },
    ))
    expect(error.code).toBe('unavailable')
    expect(error.message).toContain('authRef')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('头合并次序:请求级覆盖静态头,认证头最后写入不可被覆盖', async () => {
    const fetchImpl = transport({})
    const client = createAuthedClient({
      auth: { kind: 'bearer' },
      baseUrl: 'https://api.example.com',
      headers: { 'accept': 'application/json', 'x-static': 'client' },
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })
    await client.request(CTX, {
      path: '/x',
      headers: { 'x-static': 'request', 'authorization': 'Bearer forged' },
    })
    const headers = sent(fetchImpl).headers
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('x-static')).toBe('request')
    expect(headers.get('authorization')).toBe('Bearer k-123')
  })
})

describe('标准错误提取', () => {
  function failingClient(fetchImpl: ReturnType<typeof vi.fn>) {
    return createAuthedClient({
      auth: { kind: 'bearer' },
      baseUrl: 'https://api.example.com',
      errorMessage: {
        keys: ['error.message', 'message', 'detail'],
        fallback: (status, statusText) => statusText || `test provider 返回 HTTP ${status}`,
      },
      service: 'test provider',
      transport: fetchImpl as unknown as typeof fetch,
    })
  }

  it('按键序取值,支持一层点路径', async () => {
    const nested = await caught(
      failingClient(transport({ error: { message: 'nested wins' }, message: 'flat' }, 400))
        .request(CTX, { path: '/x' }),
    )
    expect(nested.code).toBe('invalid_argument')
    expect(nested.message).toBe('nested wins')

    const flat = await caught(
      failingClient(transport({ message: '  flat value  ' }, 500)).request(CTX, { path: '/x' }),
    )
    expect(flat.code).toBe('unavailable')
    expect(flat.message).toBe('flat value')
  })

  it('string 错误体整段取文;键全不中时先用 statusText,再退模板', async () => {
    const text = await caught(
      failingClient(transport('<html>Bad Gateway</html>', 502)).request(CTX, { path: '/x' }),
    )
    expect(text.message).toBe('<html>Bad Gateway</html>')

    const withStatusText = vi.fn(() => Promise.resolve(new Response('{}', {
      status: 418,
      statusText: 'I Am A Teapot',
      headers: { 'content-type': 'application/json' },
    })))
    const teapot = await caught(failingClient(withStatusText).request(CTX, { path: '/x' }))
    expect(teapot.message).toBe('I Am A Teapot')

    // 测试 Response 的 statusText 默认是空串,正好覆盖 `statusText ||` 退到模板这条路。
    const fallback = await caught(
      failingClient(transport({ unrelated: true }, 418)).request(CTX, { path: '/x' }),
    )
    expect(fallback.message).toBe('test provider 返回 HTTP 418')
  })

  it('请求级 mapError 覆盖客户端级标准提取', async () => {
    const error = await caught(
      failingClient(transport({ message: 'ignored' }, 400)).request(CTX, {
        path: '/x',
        mapError: ({ status }) => upstreamError(status, 'per-request wins'),
      }),
    )
    expect(error.message).toBe('per-request wins')
  })

  it('errorMessage 与 mapError 同时声明 → 当场拒', () => {
    expect(() => createAuthedClient({
      auth: { kind: 'bearer' },
      baseUrl: 'https://api.example.com',
      errorMessage: { keys: ['message'], fallback: status => `HTTP ${status}` },
      mapError: () => upstreamError(500, 'x'),
      service: 'test provider',
    })).toThrowError(/不能同时声明/)
  })
})

describe('传输错误', () => {
  it('客户端级 mapTransportError 生效,请求级覆盖它', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('socket closed')))
    const client = createAuthedClient({
      auth: { kind: 'bearer' },
      baseUrl: 'https://api.example.com',
      mapTransportError: ({ message }) => upstreamError(
        502,
        message === undefined ? 'test provider 请求失败' : `test provider 请求失败: ${message}`,
      ),
      service: 'test provider',
      transport: failing as unknown as typeof fetch,
    })
    const clientLevel = await caught(client.request(CTX, { path: '/x' }))
    expect(clientLevel.message).toBe('test provider 请求失败: socket closed')

    const requestLevel = await caught(client.request(CTX, {
      path: '/x',
      mapTransportError: () => upstreamError(502, 'per-request transport'),
    }))
    expect(requestLevel.message).toBe('per-request transport')
  })
})
