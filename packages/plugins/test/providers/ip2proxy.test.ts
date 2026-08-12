import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIp2proxyPlugin } from '../../src/ip2proxy/index'
import { ip2proxyActions } from '../../src/ip2proxy/schema'

/**
 * IP2Proxy 迁移产物的 wire 级验收。重点在两个迁移最容易丢的地方:
 * 凭证走 query 参数 `key`(不是 header),以及 HTTP 200 + `response != "OK"` 的失败口径。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'ip2p_test_key'
const plugin = createIp2proxyPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'security/ip2proxy',
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

function mockIp2proxy(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(ip2proxyActions).length)
    expect(tools).toHaveLength(1)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('lookup_ip', () => {
  it('凭证与查询参数都进 query,响应原样透出', async () => {
    const mock = mockIp2proxy(200, { response: 'OK', countryCode: 'US', isProxy: 'NO' })
    const res = await call('lookup_ip', { ip: '8.8.8.8', package: 'PX2' })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin).toBe('https://api.ip2proxy.com')
    expect(url.pathname).toBe('/')
    expect(url.searchParams.get('key')).toBe(API_KEY)
    expect(url.searchParams.get('format')).toBe('json')
    expect(url.searchParams.get('ip')).toBe('8.8.8.8')
    expect(url.searchParams.get('package')).toBe('PX2')
    await expect(res.json()).resolves.toEqual({
      content: { response: 'OK', countryCode: 'US', isProxy: 'NO' },
    })
  })

  it('省略 package 时补上游默认的 PX1', async () => {
    const mock = mockIp2proxy(200, { response: 'OK' })
    await call('lookup_ip', { ip: '2001:4860:4860::8888' })
    const url = new URL(sent(mock).url)
    expect(url.searchParams.get('package')).toBe('PX1')
    expect(url.searchParams.get('ip')).toBe('2001:4860:4860::8888')
  })
})

describe('校验与错误', () => {
  it('入参校验生效:ip 不是合法地址 → 400 且不打上游', async () => {
    const mock = mockIp2proxy(200, { response: 'OK' })
    const res = await call('lookup_ip', { ip: 'not-an-ip' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺 ip → 400 且不打上游(schema 标可选,但上游一律拒)', async () => {
    const mock = mockIp2proxy(200, { response: 'OK' })
    const res = await call('lookup_ip', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('ip')
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 但 response 提到 API key → 401', async () => {
    mockIp2proxy(200, { response: 'INVALID ACCOUNT API KEY' })
    const res = await call('lookup_ip', { ip: '8.8.8.8' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'INVALID ACCOUNT API KEY',
    })
  })

  it('HTTP 200 但额度耗尽 → 401(上游把 credit 类文案也归成凭证问题)', async () => {
    mockIp2proxy(200, { response: 'INSUFFICIENT CREDIT' })
    await expect((await call('lookup_ip', { ip: '8.8.8.8' })).json())
      .resolves.toMatchObject({ code: 'permission_denied' })
  })

  it('其余 response 文案归成上游故障', async () => {
    mockIp2proxy(200, { response: 'INVALID PACKAGE' })
    await expect((await call('lookup_ip', { ip: '8.8.8.8' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('HTTP 401 / 429 按状态归一', async () => {
    mockIp2proxy(401, '')
    expect((await call('lookup_ip', { ip: '8.8.8.8' })).status).toBe(401)

    mockIp2proxy(429, '')
    await expect((await call('lookup_ip', { ip: '8.8.8.8' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockIp2proxy(200, { response: 'OK' })
    const res = await call('lookup_ip', { ip: '8.8.8.8' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
