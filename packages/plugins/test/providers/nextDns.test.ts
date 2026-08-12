import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNextDnsPlugin } from '../../src/next_dns/index'
import { nextDnsActions } from '../../src/next_dns/schema'

/**
 * NextDNS 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 凭证走 X-Api-Key 头、analytics 的 family 拼进路径、list 信封整形(data/meta/raw),
 * 以及 NextDNS 那条"HTTP 200 + errors[] 也是失败"的分支。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'nextdns_test_key'
const plugin = createNextDnsPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'network/nextdns',
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

function mockNextDns(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 7 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(nextDnsActions).length)
    expect(tools).toHaveLength(7)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
      // NextDNS 全部是查询接口,不该有写副作用。
      expect(tool.effect, `${tool.name} 的 effect`).toBe('read')
    }
  })
})

describe('请求组装', () => {
  it('list_profiles:凭证走 X-Api-Key 头,响应整形成 data/meta/raw', async () => {
    const mock = mockNextDns(200, {
      data: [{ id: 'abc123', name: 'Home' }],
      meta: { pagination: { cursor: 'c1' } },
    })
    const res = await call('list_profiles', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(new URL(request.url).toString()).toBe('https://api.nextdns.io/profiles')
    expect(request.headers.get('x-api-key')).toBe(API_KEY)
    expect(request.headers.get('accept')).toBe('application/json')
    // 凭证只走 X-Api-Key,不该另外冒出 authorization 头。
    expect(request.headers.get('authorization')).toBeNull()

    await expect(res.json()).resolves.toEqual({
      content: {
        data: [{ id: 'abc123', name: 'Home' }],
        meta: { pagination: { cursor: 'c1' } },
        raw: { data: [{ id: 'abc123', name: 'Home' }], meta: { pagination: { cursor: 'c1' } } },
      },
    })
  })

  it('get_logs:过滤参数进 query,布尔转字符串', async () => {
    const mock = mockNextDns(200, { data: [] })
    await call('get_logs', {
      profileId: 'abc123',
      from: '-1d',
      to: 'now',
      limit: 50,
      cursor: 'c1',
      device: '__UNIDENTIFIED__',
      search: 'example.com',
      status: 'blocked',
      sort: 'desc',
      raw: true,
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/profiles/abc123/logs')
    expect(url.searchParams.get('from')).toBe('-1d')
    expect(url.searchParams.get('to')).toBe('now')
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.get('cursor')).toBe('c1')
    expect(url.searchParams.get('device')).toBe('__UNIDENTIFIED__')
    expect(url.searchParams.get('search')).toBe('example.com')
    expect(url.searchParams.get('status')).toBe('blocked')
    expect(url.searchParams.get('sort')).toBe('desc')
    expect(url.searchParams.get('raw')).toBe('true')
  })

  it('省略的可选参数不出现在 query 里', async () => {
    const mock = mockNextDns(200, { data: [] })
    await call('get_analytics_devices', { profileId: 'abc123' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/profiles/abc123/analytics/devices')
    expect([...url.searchParams.keys()]).toEqual([])
  })

  it('四个 analytics action 各自打到自己的 family 路径', async () => {
    for (const [action, family] of [
      ['get_analytics_domains', 'domains'],
      ['get_analytics_devices', 'devices'],
      ['get_analytics_status', 'status'],
      ['get_analytics_reasons', 'reasons'],
    ] as const) {
      const mock = mockNextDns(200, { data: [] })
      await call(action, { profileId: 'abc123' })
      expect(new URL(sent(mock).url).pathname).toBe(`/profiles/abc123/analytics/${family}`)
      vi.unstubAllGlobals()
    }
  })

  it('get_profile:没有 data 包裹时整个响应就是 profile', async () => {
    mockNextDns(200, { id: 'abc123', name: 'Home' })
    const res = await call('get_profile', { profileId: 'abc123' })
    await expect(res.json()).resolves.toEqual({
      content: {
        profile: { id: 'abc123', name: 'Home' },
        raw: { id: 'abc123', name: 'Home' },
      },
    })
  })

  it('profileId 被 URL 编码', async () => {
    const mock = mockNextDns(200, { data: [] })
    await call('get_profile', { profileId: 'a/b' })
    expect(new URL(sent(mock).url).pathname).toBe('/profiles/a%2Fb')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:profileId 为空 → 400 且不打上游', async () => {
    const mock = mockNextDns(200, {})
    const res = await call('get_profile', { profileId: '' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('logs 的 limit 低于 10 → 400 且不打上游', async () => {
    const mock = mockNextDns(200, {})
    const res = await call('get_logs', { profileId: 'abc123', limit: 5 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一', async () => {
    mockNextDns(401, { error: 'unauthorized' })
    const denied = await call('list_profiles', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'unauthorized',
    })

    mockNextDns(429, { message: 'slow down' })
    await expect((await call('list_profiles', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    // 上游把 404 压成 400,这里保留 not_found:profile 不存在与参数不合法是两件事。
    mockNextDns(404, { errors: [{ code: 'notFound' }] })
    const missing = await call('get_profile', { profileId: 'nope' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found' })

    mockNextDns(500, { message: 'NextDNS is down' })
    await expect((await call('list_profiles', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('HTTP 200 + errors[] 也是失败,消息取第一条的 detail', async () => {
    mockNextDns(200, { errors: [{ code: 'invalidParam', detail: 'limit is too large' }] })
    const res = await call('get_analytics_domains', { profileId: 'abc123' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'limit is too large',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockNextDns(200, {})
    const res = await call('list_profiles', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
