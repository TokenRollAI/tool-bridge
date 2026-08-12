import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createZipcodebasePlugin } from '../../src/zipcodebase/index'
import { zipcodebaseActions } from '../../src/zipcodebase/schema'

/**
 * Zipcodebase 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 凭证走 `apikey` 头、邮编逗号拼接、以及**HTTP 200 里的 error 码**才是真正的失败信号。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'zcb_deadbeef'
const plugin = createZipcodebasePlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'geo/zipcodebase',
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

function mockZipcodebase(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
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
  it('List 出全部 7 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(zipcodebaseActions).length)
    expect(tools).toHaveLength(7)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('get_status')).toBe('read')
    expect(effectOf('search_postal_codes')).toBe('read')
    expect(effectOf('list_postal_codes_by_city')).toBe('read')
  })
})

describe('请求成形', () => {
  it('凭证走 apikey 头,邮编逗号拼接', async () => {
    const mock = mockZipcodebase(200, { results: {} })
    await call('search_postal_codes', { codes: ['10001', ' 90210 '], country: 'us' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://app.zipcodebase.com/api/v1/search')
    expect(request.headers.get('apikey')).toBe(API_KEY)
    expect(request.headers.get('authorization')).toBeNull()
    expect(url.searchParams.get('codes')).toBe('10001,90210')
    expect(url.searchParams.get('country')).toBe('us')
  })

  it('数值参数与可选 unit 进 query,省略的不出现', async () => {
    const mock = mockZipcodebase(200, { results: [] })
    await call('list_postal_codes_within_radius', { code: '10001', radius: 25, country: 'us' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v1/radius')
    expect(url.searchParams.get('radius')).toBe('25')
    expect(url.searchParams.has('unit')).toBe(false)
  })

  it('嵌套路径 /code/city 拼对', async () => {
    const mock = mockZipcodebase(200, { results: [] })
    await call('list_postal_codes_by_city', { city: 'New York', country: 'us' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v1/code/city')
    expect(url.searchParams.get('city')).toBe('New York')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:country 不是两位 → 400 且不打上游', async () => {
    const mock = mockZipcodebase(200, {})
    const res = await call('calculate_distance', {
      code: '10001',
      compare: ['90210'],
      country: 'usa',
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('list_postal_codes_by_state 的两个字段 schema 是 optional,但上游必填 → 400 且不打上游', async () => {
    const mock = mockZipcodebase(200, {})
    const res = await call('list_postal_codes_by_state', { country: 'us' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('state_name')
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 里的 error 码才是真正的失败信号', async () => {
    // 101 = 无效 key。
    mockZipcodebase(200, {
      success: false,
      error: { code: 101, type: 'invalid_access_key', info: 'Invalid API key' },
    })
    const denied = await call('get_status', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    // 104 = 超额度,必须归到可重试的 rate_limited。
    mockZipcodebase(200, {
      success: false,
      error: { code: 104, type: 'usage_limit_reached', info: 'Monthly quota reached' },
    })
    await expect((await call('get_status', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    // 102/103/105 是用法错误。
    mockZipcodebase(200, {
      success: false,
      error: { code: 105, type: 'function_access_restricted', info: 'Not on your plan' },
    })
    await expect((await call('get_status', {})).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'Not on your plan' })

    // 认不出的错误码保守归成 unavailable。
    mockZipcodebase(200, { success: false, error: 'something odd' })
    await expect((await call('get_status', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'something odd' })
  })

  it('HTTP 层的错误也归一', async () => {
    mockZipcodebase(429, { message: 'slow down' })
    await expect((await call('get_status', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockZipcodebase(500, { ok: false })
    await expect((await call('get_status', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockZipcodebase(200, {})
    const res = await call('get_status', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
