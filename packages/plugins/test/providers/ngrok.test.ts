import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNgrokPlugin } from '../../src/ngrok/index'
import { ngrokActions } from '../../src/ngrok/schema'

/**
 * ngrok 迁移产物的 wire 级验收。重点:必带的 `ngrok-version` 头、
 * filter 只对认它的端点开放、404 不再被压成 400。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'ngrok_test_deadbeef'
const plugin = createNgrokPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'dev/ngrok',
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

function mockNgrok(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    { status, headers: { 'content-type': 'application/json' } },
  )))
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 6 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(ngrokActions).length)
    expect(tools).toHaveLength(6)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('六个 action 全是 read', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string }>
    expect(tools.every(tool => tool.effect === 'read')).toBe(true)
  })
})

describe('请求整形', () => {
  it('list_endpoints 带 ngrok-version 头与分页/过滤参数,响应原样透出', async () => {
    const mock = mockNgrok(200, {
      uri: 'https://api.ngrok.com/endpoints',
      endpoints: [{ id: 'ep_1', public_url: 'https://x.ngrok.io' }],
      next_page_uri: null,
    })
    const res = await call('list_endpoints', {
      limit: 10,
      before_id: 'ep_0',
      filter: 'type == "cloud"',
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('ngrok-version')).toBe('2')
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.ngrok.com/endpoints')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('before_id')).toBe('ep_0')
    expect(url.searchParams.get('filter')).toBe('type == "cloud"')

    await expect(res.json()).resolves.toEqual({
      content: {
        uri: 'https://api.ngrok.com/endpoints',
        endpoints: [{ id: 'ep_1', public_url: 'https://x.ngrok.io' }],
        next_page_uri: null,
      },
    })
  })

  it('list_tunnels 不接受 filter(tunnels 端点不认它),strictObject 挡在打上游之前', async () => {
    const mock = mockNgrok(200, { tunnels: [] })
    const res = await call('list_tunnels', { limit: 5, filter: 'x' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('未给的 list 参数不进 query', async () => {
    const mock = mockNgrok(200, { tunnels: [] })
    await call('list_tunnels', {})
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/tunnels')
    expect([...url.searchParams.keys()]).toEqual([])
  })

  it('get_endpoint / get_reserved_domain 的路径参数被 URL 编码', async () => {
    const endpoints = mockNgrok(200, { id: 'a/b' })
    await call('get_endpoint', { endpoint_id: 'a/b' })
    expect(sent(endpoints).url).toBe('https://api.ngrok.com/endpoints/a%2Fb')
    vi.unstubAllGlobals()

    const domains = mockNgrok(200, { id: 'rd_1' })
    await call('get_reserved_domain', { reserved_domain_id: 'rd 1' })
    expect(sent(domains).url).toBe('https://api.ngrok.com/reserved_domains/rd%201')
  })

  it('list_tunnel_sessions / list_reserved_domains 各打自己的端点', async () => {
    const sessions = mockNgrok(200, { tunnel_sessions: [] })
    await call('list_tunnel_sessions', {})
    expect(new URL(sent(sessions).url).pathname).toBe('/tunnel_sessions')
    vi.unstubAllGlobals()

    const domains = mockNgrok(200, { reserved_domains: [] })
    await call('list_reserved_domains', {})
    expect(new URL(sent(domains).url).pathname).toBe('/reserved_domains')
  })
})

describe('校验与错误', () => {
  it('入参校验生效:limit 超上限 → 400 且不打上游', async () => {
    const mock = mockNgrok(200, {})
    const res = await call('list_endpoints', { limit: 101 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息优先取 ngrok 的 msg 字段', async () => {
    mockNgrok(401, { msg: 'authentication failed', error_code: 'ERR_NGROK_202' })
    await expect((await call('list_endpoints', {})).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'authentication failed' })

    mockNgrok(429, { msg: 'rate limited' })
    await expect((await call('list_endpoints', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    // 上游把 404 压成 400,迁移后交回 upstreamError 统一归一。
    mockNgrok(404, { msg: 'endpoint not found' })
    await expect((await call('get_endpoint', { endpoint_id: 'ep_x' })).json())
      .resolves.toMatchObject({ code: 'not_found' })

    mockNgrok(500, { msg: 'ngrok is down' })
    await expect((await call('list_endpoints', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游回非对象 JSON → unavailable(契约说好是对象)', async () => {
    mockNgrok(200, [{ id: 'ep_1' }])
    await expect((await call('list_endpoints', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockNgrok(200, { endpoints: [] })
    const res = await call('list_endpoints', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
