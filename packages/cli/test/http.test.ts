import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiFetch,
  apiJson,
  apiText,
  callDirect,
  CliError,
  requireTarget,
  resetFetch,
  setFetch,
} from '../src/http'

const TARGET = { baseUrl: 'https://gw.example', sk: 'tbk_secret' }

afterEach(() => {
  resetFetch()
  vi.restoreAllMocks()
})

function mockOnce(body: string, init: ResponseInit): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(body, init))
  setFetch(fn as unknown as typeof fetch)
  return fn
}

describe('requireTarget', () => {
  it('缺 baseUrl → CliError', () => {
    expect(() => requireTarget({})).toThrow(CliError)
  })
})

describe('apiFetch 构造请求', () => {
  it('拼 URL、Bearer 头、Accept 与 query', async () => {
    const fn = mockOnce('ok', { status: 200 })
    await apiFetch(TARGET, {
      path: '/~tree',
      query: { depth: 3, missing: undefined },
      accept: 'json',
    })
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw.example/~tree?depth=3')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer tbk_secret')
    expect(headers.accept).toBe('application/json')
  })

  it('body 时带 content-type 并序列化', async () => {
    const fn = mockOnce('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    await callDirect(TARGET, '/system/sk/list', { a: 1 })
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ a: 1 })
  })

  it('网络错误 → CliError,带 unavailable/retryable(不再是无 code 的裸消息)', async () => {
    setFetch(
      vi.fn(async () => {
        throw new Error('fetch failed')
      }) as unknown as typeof fetch,
    )
    await expect(apiFetch(TARGET, { path: '/x' })).rejects.toMatchObject({
      message: expect.stringMatching(/request failed/),
      code: 'unavailable',
      retryable: true,
    })
  })

  it('undici cause.code 拼进 message(如 ECONNREFUSED)', async () => {
    setFetch(
      vi.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
      }) as unknown as typeof fetch,
    )
    await expect(apiFetch(TARGET, { path: '/x' })).rejects.toMatchObject({
      message: expect.stringMatching(/ECONNREFUSED/),
      code: 'unavailable',
      retryable: true,
    })
  })

  it('响应体中途断流 → 按网络失败归一(不裸露 undici 消息)', async () => {
    setFetch(
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: () => Promise.reject(new TypeError('terminated')),
      })) as unknown as typeof fetch,
    )
    await expect(apiFetch(TARGET, { path: '/x' })).rejects.toMatchObject({
      code: 'unavailable',
      retryable: true,
    })
  })
})

describe('apiJson TBError 归一', () => {
  it('非 2xx 的 TBError body → CliError(带 code)', async () => {
    mockOnce(JSON.stringify({ code: 'permission_denied', message: 'nope', retryable: false }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
    await expect(
      apiJson(TARGET, { path: '/system/sk', method: 'POST', body: {} }),
    ).rejects.toMatchObject({ message: 'nope', code: 'permission_denied' })
  })

  it('TBError 的 retryable 透传(503 unavailable → retryable:true)', async () => {
    mockOnce(JSON.stringify({ code: 'unavailable', message: 'upstream down', retryable: true }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })
    await expect(apiJson(TARGET, { path: '/x' })).rejects.toMatchObject({
      code: 'unavailable',
      retryable: true,
    })
  })

  it('2xx JSON 正常解析', async () => {
    mockOnce(JSON.stringify({ items: [1, 2] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    expect(await apiJson(TARGET, { path: '/x' })).toEqual({ items: [1, 2] })
  })

  it('非规范错误体(HTML 502)→ 按 status 回退出 unavailable/retryable', async () => {
    mockOnce('<html>502 Bad Gateway</html>', { status: 502 })
    await expect(apiJson(TARGET, { path: '/x' })).rejects.toMatchObject({
      code: 'unavailable',
      retryable: true,
    })
  })

  it('非规范错误体(429)→ rate_limited/retryable', async () => {
    mockOnce('too many', { status: 429 })
    await expect(apiJson(TARGET, { path: '/x' })).rejects.toMatchObject({
      code: 'rate_limited',
      retryable: true,
    })
  })

  it('非规范错误体(400)→ invalid_argument,不可重试', async () => {
    mockOnce('bad', { status: 400 })
    await expect(apiJson(TARGET, { path: '/x' })).rejects.toMatchObject({
      code: 'invalid_argument',
      retryable: false,
    })
  })

  it('2xx 但响应体非法 JSON → internal/retryable', async () => {
    mockOnce('not json', { status: 200, headers: { 'content-type': 'application/json' } })
    await expect(apiJson(TARGET, { path: '/x' })).rejects.toMatchObject({
      message: expect.stringMatching(/invalid JSON/),
      code: 'internal',
      retryable: true,
    })
  })
})

describe('apiFetch 超时', () => {
  it('timeoutMs 到点 → retryable CliError(unavailable),message 提示 --timeout', async () => {
    setFetch(
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
          }),
      ) as unknown as typeof fetch,
    )
    await expect(apiFetch({ ...TARGET, timeoutMs: 30 }, { path: '/x' })).rejects.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: expect.stringMatching(/timed out .* --timeout/),
    })
  })

  it('未显式给 timeout → 默认信号仍挂上(AbortSignal 存在)', async () => {
    const fn = mockOnce('ok', { status: 200 })
    await apiFetch(TARGET, { path: '/x' })
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('apiText', () => {
  it('2xx 返回原始文本', async () => {
    mockOnce('htbp 0.1\n', { status: 200 })
    expect(await apiText(TARGET, { path: '/~help' })).toBe('htbp 0.1\n')
  })

  it('accept: \'markdown\' → 发送 Accept: text/markdown(tb help --md 用)', async () => {
    const fn = mockOnce('# /\n', { status: 200 })
    expect(await apiText(TARGET, { path: '/~help', accept: 'markdown' })).toBe('# /\n')
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).accept).toBe('text/markdown')
  })

  it('401 → CliError', async () => {
    mockOnce(JSON.stringify({ code: 'permission_denied', message: 'unauth', retryable: false }), {
      status: 401,
    })
    await expect(apiText(TARGET, { path: '/~help' })).rejects.toThrow('unauth')
  })
})
