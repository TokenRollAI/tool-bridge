import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFixerPlugin } from '../../src/fixer/index'
import { fixerActions } from '../../src/fixer/schema'

/**
 * Fixer 迁移产物的 wire 级验收。重点在两个"迁移最容易迁丢"的地方:
 * 凭证进 query 而非 header,以及 **HTTP 200 也可能是失败**(body 里的 success:false)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'fixer_deadbeef'
const plugin = createFixerPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'fx/fixer',
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

function mockFixer(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 3 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(fixerActions).length)
    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('全部 action 都是只读', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string }>
    expect(tools.every(t => t.effect === 'read')).toBe(true)
  })
})

describe('请求成形', () => {
  it('get_latest_rates:凭证进 query,symbols 逗号拼接', async () => {
    const mock = mockFixer(200, { success: true, base: 'EUR', rates: { USD: 1.1 } })
    const res = await call('get_latest_rates', { base: 'EUR', symbols: ['USD', 'GBP'] })

    const url = new URL(sent(mock).url)
    expect(url.origin + url.pathname).toBe('https://data.fixer.io/api/latest')
    // 凭证在 URL 里,不是 header —— 这是 Fixer API 本身的设计。
    expect(url.searchParams.get('access_key')).toBe(API_KEY)
    expect(sent(mock).headers.get('authorization')).toBeNull()
    expect(url.searchParams.get('base')).toBe('EUR')
    expect(url.searchParams.get('symbols')).toBe('USD,GBP')

    await expect(res.json()).resolves.toMatchObject({
      content: { success: true, base: 'EUR', rates: { USD: 1.1 } },
    })
  })

  it('get_historical_rates:日期是路径段,不是 query 参数', async () => {
    const mock = mockFixer(200, { success: true, historical: true, date: '2020-03-01', base: 'EUR', rates: {} })
    await call('get_historical_rates', { date: '2020-03-01' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/2020-03-01')
    expect(url.searchParams.has('date')).toBe(false)
  })

  it('省略的可选参数不出现在 query 里', async () => {
    const mock = mockFixer(200, { success: true, symbols: {} })
    await call('get_supported_symbols', {})
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual(['access_key'])
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:base 小写 → 400 且不打上游', async () => {
    const mock = mockFixer(200, {})
    const res = await call('get_latest_rates', { base: 'eur' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('未来日期在本地就挡下(schema 只能管格式,管不了范围)', async () => {
    const mock = mockFixer(200, {})
    const res = await call('get_historical_rates', { date: '2999-01-01' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('future')
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 + success:false 也算失败,按 error.type 分类', async () => {
    mockFixer(200, { success: false, error: { code: 101, type: 'invalid_access_key', info: 'You have not supplied a valid API Access Key.' } })
    const badKey = await call('get_supported_symbols', {})
    // 上游把它归成 400;这里归成 permission_denied,好让 credentialProbe 认出是配错了 key。
    expect(badKey.status).toBe(401)
    await expect(badKey.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'You have not supplied a valid API Access Key.',
    })

    vi.unstubAllGlobals()
    mockFixer(200, { success: false, error: { type: 'monthly_limit_reached', info: 'quota exhausted' } })
    await expect((await call('get_latest_rates', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockFixer(200, { success: false, error: { type: 'invalid_base_currency', info: 'bad base' } })
    await expect((await call('get_latest_rates', { base: 'XXX' })).json())
      .resolves.toMatchObject({ code: 'invalid_argument' })
  })

  it('上游状态码错误按状态归一', async () => {
    mockFixer(429, { message: 'slow down' })
    await expect((await call('get_supported_symbols', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockFixer(401, {})
    expect((await call('get_supported_symbols', {})).status).toBe(401)

    vi.unstubAllGlobals()
    mockFixer(500, {})
    await expect((await call('get_supported_symbols', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('非 JSON 响应按上游破契约处理', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>502</html>', { status: 200 }))))
    await expect((await call('get_supported_symbols', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: expect.stringContaining('invalid JSON') as unknown })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockFixer(200, {})
    const res = await call('get_supported_symbols', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
