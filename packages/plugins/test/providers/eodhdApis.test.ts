import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEodhdApisPlugin } from '../../src/eodhd_apis/index'
import { eodhdApisActions } from '../../src/eodhd_apis/schema'

/**
 * EODHD APIs 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * api_token 走 query、每个请求都要 fmt=json、方括号形式的 filter[]/page[] 参数、
 * get_eod 随参数变形的三种响应、以及 get_id_mapping 那条跨字段的"至少一个过滤条件"。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'eodhd_demo_token'
const plugin = createEodhdApisPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'market/eodhd',
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

function mockEodhd(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 8 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(eodhdApisActions).length)
    expect(tools).toHaveLength(8)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
      // EODHD 全部是行情查询,不该有写副作用。
      expect(tool.effect, `${tool.name} 的 effect`).toBe('read')
    }
  })
})

describe('请求组装(凭证走 api_token query)', () => {
  it('search_instruments:query 进路径,布尔参数传 1/0', async () => {
    const mock = mockEodhd(200, [{ Code: 'AAPL', Exchange: 'US' }])
    const res = await call('search_instruments', {
      query: 'apple inc',
      type: 'stock',
      exchange: 'US',
      bondsOnly: false,
      limit: 5,
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin).toBe('https://eodhd.com')
    expect(url.pathname).toBe('/api/search/apple%20inc')
    expect(url.searchParams.get('api_token')).toBe(API_KEY)
    expect(url.searchParams.get('fmt')).toBe('json')
    expect(url.searchParams.get('type')).toBe('stock')
    expect(url.searchParams.get('exchange')).toBe('US')
    expect(url.searchParams.get('bonds_only')).toBe('0')
    expect(url.searchParams.get('limit')).toBe('5')
    // 凭证只在 query 里,不该另外冒出 authorization 头。
    expect(request.headers.get('authorization')).toBeNull()

    await expect(res.json()).resolves.toEqual({
      content: { results: [{ Code: 'AAPL', Exchange: 'US' }] },
    })
  })

  it('省略的可选参数不出现在 query 里(api_token 与 fmt 仍在)', async () => {
    const mock = mockEodhd(200, [])
    await call('list_exchanges', {})
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/exchanges-list')
    expect([...url.searchParams.keys()].sort()).toEqual(['api_token', 'fmt'])
  })

  it('get_real_time_quote:附加 ticker 逗号连接进 s,单对象响应也归一成数组', async () => {
    const mock = mockEodhd(200, { code: 'AAPL.US', close: 190.1 })
    const res = await call('get_real_time_quote', {
      ticker: 'AAPL.US',
      additionalTickers: ['MSFT.US', 'GOOG.US'],
      exchange: 'US',
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/real-time/AAPL.US')
    expect(url.searchParams.get('s')).toBe('MSFT.US,GOOG.US')
    expect(url.searchParams.get('ex')).toBe('US')

    await expect(res.json()).resolves.toEqual({
      content: { quotes: [{ code: 'AAPL.US', close: 190.1 }] },
    })
  })

  it('get_ust_yield_rates:方括号形式的 filter[]/page[] 参数原样进 query', async () => {
    const mock = mockEodhd(200, [])
    await call('get_ust_yield_rates', {
      dateFrom: '2024-01-01',
      dateTo: '2024-02-01',
      filterYear: 2024,
      pageLimit: 50,
      pageOffset: 100,
    })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/ust/yield-rates')
    expect(url.searchParams.get('from')).toBe('2024-01-01')
    expect(url.searchParams.get('to')).toBe('2024-02-01')
    expect(url.searchParams.get('filter[year]')).toBe('2024')
    expect(url.searchParams.get('page[limit]')).toBe('50')
    expect(url.searchParams.get('page[offset]')).toBe('100')
  })

  it('get_macro_indicators:国家码大写化后进路径', async () => {
    const mock = mockEodhd(200, [])
    await call('get_macro_indicators', { country: 'usa', indicator: 'gdp_growth_annual' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/macro-indicator/USA')
    expect(url.searchParams.get('indicator')).toBe('gdp_growth_annual')
  })

  it('get_user_info:/user 的字段定型,缺的补 null', async () => {
    mockEodhd(200, { name: 'Ada', email: 'ada@example.com', apiRequests: 12 })
    const res = await call('get_user_info', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        user: {
          name: 'Ada',
          email: 'ada@example.com',
          subscriptionType: null,
          paymentMethod: null,
          apiRequests: 12,
          apiRequestsDate: null,
          dailyRateLimit: null,
        },
      },
    })
  })
})

describe('get_eod 的三种响应形状', () => {
  it('数组 → rows', async () => {
    mockEodhd(200, [{ date: '2024-01-02', close: 185.6 }])
    await expect((await call('get_eod', { ticker: 'AAPL.US' })).json()).resolves.toEqual({
      content: { rows: [{ date: '2024-01-02', close: 185.6 }], value: null, raw: null },
    })
  })

  it('标量(带 filter 时) → value', async () => {
    const mock = mockEodhd(200, 185.6)
    const res = await call('get_eod', { ticker: 'AAPL.US', filter: 'last_close' })
    expect(new URL(sent(mock).url).searchParams.get('filter')).toBe('last_close')
    await expect(res.json()).resolves.toEqual({
      content: { rows: [], value: 185.6, raw: null },
    })
  })

  it('对象 → raw', async () => {
    mockEodhd(200, { note: 'no data for range' })
    await expect((await call('get_eod', { ticker: 'AAPL.US' })).json()).resolves.toEqual({
      content: { rows: [], value: null, raw: { note: 'no data for range' } },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:dateFrom 不是 YYYY-MM-DD → 400 且不打上游', async () => {
    const mock = mockEodhd(200, [])
    const res = await call('get_eod', { ticker: 'AAPL.US', dateFrom: '01/02/2024' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('country 不是 alpha-3 → 400 且不打上游', async () => {
    const mock = mockEodhd(200, [])
    const res = await call('get_macro_indicators', { country: 'US' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_id_mapping 一个过滤条件都不给 → 400 且不打上游(schema 表达不了的跨字段约束)', async () => {
    const mock = mockEodhd(200, [])
    const res = await call('get_id_mapping', { pageLimit: 10 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('过滤条件')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_id_mapping 给了过滤条件就放行', async () => {
    const mock = mockEodhd(200, [{ Code: 'AAPL' }])
    await call('get_id_mapping', { filterIsin: 'US0378331005', pageOffset: 0 })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/id-mapping')
    expect(url.searchParams.get('filter[isin]')).toBe('US0378331005')
    expect(url.searchParams.get('page[offset]')).toBe('0')
  })

  it('上游错误按状态归一', async () => {
    mockEodhd(401, { message: 'Invalid API token' })
    const denied = await call('list_exchanges', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API token',
    })

    mockEodhd(429, { message: 'Too many requests' })
    await expect((await call('list_exchanges', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockEodhd(500, { message: 'EODHD is down' })
    await expect((await call('list_exchanges', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('HTTP 200 + 错误文案也是失败(EODHD 报参数问题的主要路径)', async () => {
    mockEodhd(200, 'Ticker Not Found.')
    const res = await call('get_eod', { ticker: 'NOPE.US' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Ticker Not Found.',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockEodhd(200, [])
    const res = await call('list_exchanges', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
