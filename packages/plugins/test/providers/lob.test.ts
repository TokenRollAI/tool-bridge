import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLobPlugin } from '../../src/lob/index'
import { lobActions } from '../../src/lob/schema'

/**
 * Lob 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * HTTP Basic 凭证(key 当用户名、密码留空)、批量响应的 `{verifications,raw}` 整形、
 * 空串 query 的处理。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'live_deadbeef'
const plugin = createLobPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'address/lob',
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

function mockLob(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 5 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(lobActions).length)
    expect(tools).toHaveLength(5)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('校验调用会计费,故全部标 write 而非 read', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string }>
    expect(tools.every(t => t.effect === 'write')).toBe(true)
  })
})

describe('请求成形与响应整形', () => {
  it('verify_us_address:凭证是 Basic(key 当用户名、密码留空),入参进 JSON body', async () => {
    const mock = mockLob(200, { id: 'us_ver_1', deliverability: 'deliverable' })
    const res = await call('verify_us_address', { primary_line: '210 King St', city: 'SF', state: 'CA' })

    const request = sent(mock)
    expect(request.url).toBe('https://api.lob.com/v1/us_verifications')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe(`Basic ${btoa(`${API_KEY}:`)}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ primary_line: '210 King St', city: 'SF', state: 'CA' })

    await expect(res.json()).resolves.toEqual({
      content: { verification: { id: 'us_ver_1', deliverability: 'deliverable' } },
    })
  })

  it('bulk:addresses 提到 verifications,raw 保留完整响应', async () => {
    mockLob(200, { addresses: [{ id: 'a1' }, { id: 'a2' }], errors: false, total_count: 2 })
    const res = await call('bulk_verify_us_addresses', {
      addresses: [{ primary_line: '210 King St' }, { primary_line: '1 Market St' }],
    })
    await expect(res.json()).resolves.toEqual({
      content: {
        verifications: [{ id: 'a1' }, { id: 'a2' }],
        raw: { addresses: [{ id: 'a1' }, { id: 'a2' }], errors: false, total_count: 2 },
      },
    })
  })

  it('bulk:addresses 缺席时回空列表而不是报错', async () => {
    mockLob(200, { errors: true })
    await expect((await call('bulk_verify_international_addresses', {
      addresses: [{ primary_line: '1 High St', country: 'GB' }],
    })).json()).resolves.toMatchObject({ content: { verifications: [] } })
  })

  it('autocomplete:参数走 query,GET 不带 body', async () => {
    const mock = mockLob(200, { suggestions: [{ primary_line: '210 King St' }] })
    await call('autocomplete_us_addresses', { address_prefix: '210 King', state: 'CA', geo_ip_sort: true })
    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.pathname).toBe('/v1/us_autocompletions')
    expect(request.method).toBe('GET')
    expect(request.body).toBeNull()
    expect(url.searchParams.get('address_prefix')).toBe('210 King')
    expect(url.searchParams.get('state')).toBe('CA')
    expect(url.searchParams.get('geo_ip_sort')).toBe('true')
    // 省略的可选参数不该出现。
    expect(url.searchParams.has('city')).toBe(false)
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:primary_line 空串 → 400 且不打上游', async () => {
    const mock = mockLob(200, {})
    const res = await call('verify_us_address', { primary_line: '' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('bulk 上限 100 条,超了就在本地挡下', async () => {
    const mock = mockLob(200, {})
    const res = await call('bulk_verify_us_addresses', {
      addresses: Array.from({ length: 101 }, () => ({ primary_line: '210 King St' })),
    })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error.message', async () => {
    mockLob(401, { error: { message: 'Your API key is not valid', status_code: 401 } })
    const unauthorized = await call('verify_us_address', { primary_line: '210 King St' })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: expect.stringContaining('Your API key is not valid') as unknown,
    })

    vi.unstubAllGlobals()
    mockLob(429, { error: { message: 'Too many requests' } })
    await expect((await call('verify_us_address', { primary_line: '210 King St' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockLob(500, {})
    await expect((await call('verify_us_address', { primary_line: '210 King St' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('纯文本错误体的原文也能进消息', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('upstream gateway error', { status: 502 }))))
    await expect((await call('verify_us_address', { primary_line: '210 King St' })).json())
      .resolves.toMatchObject({ message: expect.stringContaining('upstream gateway error') as unknown })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockLob(200, {})
    const res = await call('verify_us_address', { primary_line: '210 King St' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
