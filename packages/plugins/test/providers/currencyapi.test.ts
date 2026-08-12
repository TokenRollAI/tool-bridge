import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCurrencyapiPlugin } from '../../src/currencyapi/index'
import { currencyapiActions } from '../../src/currencyapi/schema'

/**
 * currencyapi 迁移产物的 wire 级验收。重点在自定义 `apikey` 头、currencies 的逗号拼接,
 * 以及响应归一的严格口径(出参 schema 里字段全必填,残缺响应必须 502 而不是悄悄放行)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'cur_live_deadbeef'
const plugin = createCurrencyapiPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'fx/currencyapi',
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

function mockCurrencyapi(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

const RATES = {
  meta: { last_updated_at: '2024-06-01T23:59:59Z' },
  data: { EUR: { code: 'EUR', value: 0.92 } },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 5 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(currencyapiActions).length)
    expect(tools).toHaveLength(5)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('get_latest_rates')).toBe('read')
    expect(effectOf('get_api_status')).toBe('read')
    // convert_currency 其实也是只读查询,但生成器按前缀播种成 write,保守放行。
    expect(effectOf('convert_currency')).toBe('write')
  })
})

describe('请求成形', () => {
  it('凭证走 apikey 头(不是 Authorization),currencies 逗号拼接', async () => {
    const mock = mockCurrencyapi(200, RATES)
    await call('get_latest_rates', { base_currency: 'USD', currencies: ['EUR', 'JPY'], type: 'fiat' })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('apikey')).toBe(API_KEY)
    expect(request.headers.get('authorization')).toBeNull()
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.currencyapi.com/v3/latest')
    expect(url.searchParams.get('base_currency')).toBe('USD')
    expect(url.searchParams.get('currencies')).toBe('EUR,JPY')
    expect(url.searchParams.get('type')).toBe('fiat')
  })

  it('convert_currency 把 value 与 date 送进 query,响应归一成 meta/data', async () => {
    const mock = mockCurrencyapi(200, RATES)
    const res = await call('convert_currency', { value: 12.5, date: '2024-06-01', base_currency: 'USD' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v3/convert')
    expect(url.searchParams.get('value')).toBe('12.5')
    expect(url.searchParams.get('date')).toBe('2024-06-01')
    await expect(res.json()).resolves.toEqual({
      content: {
        meta: { last_updated_at: '2024-06-01T23:59:59Z' },
        data: { EUR: { code: 'EUR', value: 0.92 } },
      },
    })
  })

  it('省略的可选字段不出现在 query 里', async () => {
    const mock = mockCurrencyapi(200, RATES)
    await call('get_latest_rates', {})
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual([])
  })

  it('get_api_status 归一出两个配额桶', async () => {
    mockCurrencyapi(200, {
      account_id: 42,
      quotas: {
        month: { total: 300, used: 10, remaining: 290, extra: 'ignored' },
        grace: { total: 0, used: 0, remaining: 0 },
      },
    })
    const res = await call('get_api_status', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        account_id: 42,
        quotas: {
          month: { total: 300, used: 10, remaining: 290 },
          grace: { total: 0, used: 0, remaining: 0 },
        },
      },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:currencies 给小写码 → 400 且不打上游', async () => {
    const mock = mockCurrencyapi(200, RATES)
    const res = await call('get_latest_rates', { currencies: ['eur'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('historical 的 date 格式不对 → 400 且不打上游', async () => {
    const mock = mockCurrencyapi(200, RATES)
    const res = await call('get_historical_rates', { date: '01/06/2024' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一(401 保留成 permission_denied,不压成 400)', async () => {
    mockCurrencyapi(401, { message: 'Invalid authentication credentials' })
    const denied = await call('get_latest_rates', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid authentication credentials',
    })

    mockCurrencyapi(429, { message: 'You have exceeded your quota' })
    await expect((await call('get_latest_rates', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockCurrencyapi(500, { error: { message: 'server error' } })
    await expect((await call('get_latest_rates', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'server error' })
  })

  it('响应缺 meta.last_updated_at → unavailable(上游破契约,不是入参错)', async () => {
    mockCurrencyapi(200, { meta: {}, data: {} })
    const res = await call('get_latest_rates', {})
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockCurrencyapi(200, RATES)
    const res = await call('get_latest_rates', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
