import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGeokeoPlugin } from '../../src/geokeo/index'
import { geokeoActions } from '../../src/geokeo/schema'

/**
 * Geokeo 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * API key 走 `api` query 参数(不是 header)、省略的可选参数不出现在 query 里、
 * 以及 Geokeo 那条"HTTP 200 + status 字段也可能是失败"的分支。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'geokeo_test_key'
const plugin = createGeokeoPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'location/geokeo',
  exportId: 'actions',
}

function envelope(body: unknown, opts: { auth?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(CALLER),
  }
  const auth = opts.auth === undefined ? API_KEY : opts.auth
  if (auth !== null) {
    headers[HEADER_TB_UPSTREAM_AUTH] = base64urlEncode(new TextEncoder().encode(auth))
  }
  return Promise.resolve(plugin.fetch(
    new Request('https://plugin.test/', { method: 'POST', headers, body: JSON.stringify(body) }),
    ENV as never,
  ))
}

function call(name: string, args: unknown, opts?: { auth?: string | null }): Promise<Response> {
  return envelope({ tool: 'Call', arguments: { name, args } }, opts)
}

function mockGeokeo(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 取上游收到的那个请求。 */
function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

const OK_PAYLOAD = {
  status: 'ok',
  credits: 'https://geokeo.com',
  results: [{ formatted_address: '1600 Amphitheatre Pkwy' }],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 2 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(geokeoActions).length)
    expect(tools).toHaveLength(2)
    expect(tools.map(t => t.name)).toEqual(['geocode_forward', 'geocode_reverse'])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('URL 组装(Geokeo 把 API key 放 query)', () => {
  it('geocode_forward:q/country 进 query,凭证是 api 参数', async () => {
    const mock = mockGeokeo(200, OK_PAYLOAD)
    const res = await call('geocode_forward', { q: '1600 Amphitheatre Pkwy', country: 'us' })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin).toBe('https://geokeo.com')
    expect(url.pathname).toBe('/geocode/v1/search.php')
    expect(url.searchParams.get('api')).toBe(API_KEY)
    expect(url.searchParams.get('q')).toBe('1600 Amphitheatre Pkwy')
    expect(url.searchParams.get('country')).toBe('us')
    // 凭证只在 query 里,不该另外冒出 authorization 头。
    expect(request.headers.get('authorization')).toBeNull()
    await expect(res.json()).resolves.toMatchObject({ content: { status: 'ok' } })
  })

  it('省略的 country 不出现在 query 里', async () => {
    const mock = mockGeokeo(200, OK_PAYLOAD)
    await call('geocode_forward', { q: 'Paris' })
    const url = new URL(sent(mock).url)
    expect([...url.searchParams.keys()].sort()).toEqual(['api', 'q'])
  })

  it('geocode_reverse:lat/lng 数字转字符串进 query', async () => {
    const mock = mockGeokeo(200, OK_PAYLOAD)
    await call('geocode_reverse', { lat: 37.4224, lng: -122.0841 })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/geocode/v1/reverse.php')
    expect(url.searchParams.get('lat')).toBe('37.4224')
    expect(url.searchParams.get('lng')).toBe('-122.0841')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:lat 超出 -90..90 → 400 且不打上游', async () => {
    const mock = mockGeokeo(200, OK_PAYLOAD)
    const res = await call('geocode_reverse', { lat: 999, lng: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('q 为空串 → 400 且不打上游', async () => {
    const mock = mockGeokeo(200, OK_PAYLOAD)
    const res = await call('geocode_forward', { q: '' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一', async () => {
    mockGeokeo(401, { status: 'ACCESS_DENIED' })
    const denied = await call('geocode_forward', { q: 'Paris' })
    // 上游把 ACCESS_DENIED 归成 400(body 的 status 优先于 HTTP 状态码),此处保持等价。
    expect(denied.status).toBe(400)

    mockGeokeo(401, {})
    const bare = await call('geocode_forward', { q: 'Paris' })
    expect(bare.status).toBe(401)
    await expect(bare.json()).resolves.toMatchObject({ code: 'permission_denied' })

    mockGeokeo(429, {})
    await expect((await call('geocode_forward', { q: 'Paris' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockGeokeo(500, {})
    await expect((await call('geocode_forward', { q: 'Paris' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('HTTP 200 + status 非 ok 也是失败(Geokeo 的主要失败路径)', async () => {
    mockGeokeo(200, { status: 'OVER_QUERY_LIMIT' })
    const limited = await call('geocode_forward', { q: 'Paris' })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockGeokeo(200, { status: 'INVALID_REQUEST' })
    expect((await call('geocode_forward', { q: 'Paris' })).status).toBe(400)
  })

  it('ZERO_RESULTS 是成功(查不到不等于出错)', async () => {
    mockGeokeo(200, { status: 'ZERO_RESULTS', results: [] })
    const res = await call('geocode_forward', { q: 'nowhere' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ content: { status: 'ZERO_RESULTS' } })
  })

  it('响应不是 JSON → unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>oops</html>', { status: 200 }))))
    const res = await call('geocode_forward', { q: 'Paris' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockGeokeo(200, OK_PAYLOAD)
    const res = await call('geocode_forward', { q: 'Paris' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
