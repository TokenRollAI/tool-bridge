import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCoinrankingPlugin } from '../../src/coinranking/index'
import { coinrankingActions } from '../../src/coinranking/schema'

/**
 * Coinranking 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * `{status, data}` 信封的成功判定(HTTP 200 + status:'fail' 也是失败)、
 * offset=0 不被真值判断吃掉、凭证走 x-access-token 而非 Bearer、路径参数编码。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'coinranking_test_key'
const plugin = createCoinrankingPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'finance/coinranking',
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

function mockCoinranking(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 6 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(coinrankingActions).length)
    expect(tools).toHaveLength(6)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('全部 action 都是只读', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    for (const tool of tools) {
      expect(tool.effect, `${tool.name} 的 effect 不是 read`).toBe('read')
    }
  })
})

describe('请求构造', () => {
  it('query 编码 + 凭证走 x-access-token(不是 Bearer)', async () => {
    const mock = mockCoinranking(200, {
      status: 'success',
      data: { stats: { total: 2 }, coins: [{ uuid: 'Qwsogvtv82FCd', symbol: 'BTC' }] },
    })
    const res = await call('list_coins', {
      limit: 10,
      search: 'bit coin',
      orderBy: 'marketCap',
      orderDirection: 'desc',
      timePeriod: '24h',
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.coinranking.com/v2/coins')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('search')).toBe('bit coin')
    expect(url.searchParams.get('orderBy')).toBe('marketCap')
    expect(url.searchParams.get('orderDirection')).toBe('desc')
    expect(url.searchParams.get('timePeriod')).toBe('24h')
    expect(request.headers.get('x-access-token')).toBe(API_KEY)
    expect(request.headers.get('authorization')).toBeNull()
    // GET 无请求体。
    expect(await request.text()).toBe('')
    await expect(res.json()).resolves.toEqual({
      content: { stats: { total: 2 }, coins: [{ uuid: 'Qwsogvtv82FCd', symbol: 'BTC' }] },
    })
  })

  it('offset=0 要发出去(真值判断会把它当缺省吃掉),省略的可选参数不出现', async () => {
    const mock = mockCoinranking(200, { status: 'success', data: { stats: {}, coins: [] } })
    await call('list_coins', { offset: 0 })
    const url = new URL(sent(mock).url)
    expect(url.searchParams.get('offset')).toBe('0')
    expect([...url.searchParams.keys()]).toEqual(['offset'])
  })

  it('路径参数被 URL 编码,不会跑出 /coin/ 这一段', async () => {
    const mock = mockCoinranking(200, { status: 'success', data: { coin: { uuid: 'a/b' } } })
    await call('get_coin_details', { uuid: 'a/b', referenceCurrencyUuid: 'yhjMzLPhuIDl' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v2/coin/a%2Fb')
    expect(url.searchParams.get('referenceCurrencyUuid')).toBe('yhjMzLPhuIDl')
  })

  it('search_suggestions 把四类结果原样分组透出', async () => {
    const mock = mockCoinranking(200, {
      status: 'success',
      data: {
        coins: [{ uuid: 'Qwsogvtv82FCd', name: 'Bitcoin' }],
        exchanges: [{ uuid: 'ex1' }],
        markets: [],
        fiat: [{ uuid: 'yhjMzLPhuIDl' }],
      },
    })
    const res = await call('search_suggestions', { query: 'bitcoin' })
    expect(new URL(sent(mock).url).searchParams.get('query')).toBe('bitcoin')
    await expect(res.json()).resolves.toEqual({
      content: {
        results: {
          coins: [{ uuid: 'Qwsogvtv82FCd', name: 'Bitcoin' }],
          exchanges: [{ uuid: 'ex1' }],
          markets: [],
          fiat: [{ uuid: 'yhjMzLPhuIDl' }],
        },
      },
    })
  })

  it('无入参的 action 也照样打对端点', async () => {
    const mock = mockCoinranking(200, { status: 'success', data: { stats: { totalCoins: 1 } } })
    const res = await call('get_global_stats', {})
    expect(sent(mock).url).toBe('https://api.coinranking.com/v2/stats')
    await expect(res.json()).resolves.toEqual({ content: { stats: { totalCoins: 1 } } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:limit 超上限 → 400 且不打上游', async () => {
    const mock = mockCoinranking(200, {})
    const res = await call('list_coins', { limit: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:timePeriod 不在枚举里 → 400 且不打上游', async () => {
    const mock = mockCoinranking(200, {})
    const res = await call('get_coin_price_history', { uuid: 'Qwsogvtv82FCd', timePeriod: '2h' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 但 status 不是 success 也算失败(Coinranking 的信封语义)', async () => {
    mockCoinranking(200, { status: 'fail', message: 'Coin not found' })
    const res = await call('get_coin_details', { uuid: 'nope' })
    // HTTP < 400 时按 502 归一:上游说失败却给了成功状态码,这是上游的问题。
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      message: 'Coin not found',
      retryable: true,
    })
  })

  it('上游错误按状态归一,消息取自 Coinranking 的 message', async () => {
    mockCoinranking(401, { status: 'fail', message: 'API key invalid' })
    const unauthorized = await call('get_global_stats', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'API key invalid',
    })

    mockCoinranking(429, { status: 'fail', message: 'Too many requests' })
    const limited = await call('get_global_stats', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({
      code: 'rate_limited',
      message: 'Too many requests',
      retryable: true,
    })

    mockCoinranking(404, { status: 'fail', message: 'Coin not found' })
    await expect((await call('get_coin_details', { uuid: 'missing' })).json())
      .resolves.toMatchObject({ code: 'not_found' })

    mockCoinranking(503, { status: 'fail', message: 'Coinranking is down' })
    await expect((await call('get_global_stats', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游给不出 message 时退回状态码描述', async () => {
    mockCoinranking(400, { status: 'fail' })
    await expect((await call('get_global_stats', {})).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'Coinranking 请求失败(HTTP 400)' })
  })

  it('信封里缺 data → 502(上游破契约,不是调用方的错)', async () => {
    mockCoinranking(200, { status: 'success' })
    await expect((await call('get_reference_currencies', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockCoinranking(200, {})
    const res = await call('get_global_stats', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
