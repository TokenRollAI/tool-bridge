import { describe, expect, it, vi } from 'vitest'
import { createOpenExchangeRatesPlugin } from '../../src/open_exchange_rates/index'
import { openExchangeRatesActions } from '../../src/open_exchange_rates/schema'
import { createProviderHarness } from '../support/providerHarness'

/**
 * Open Exchange Rates 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 凭证走 query 的 app_id、get_currencies 不带 app_id、symbols 数组拼串、
 * 以及 200 + `{error:true}` 这条软错误路径。
 */

const APP_ID = 'oer_app_id_deadbeef'
const plugin = createOpenExchangeRatesPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockOer,
} = createProviderHarness({
  mountPath: 'finance/oer',
  plugin,
  upstreamAuth: APP_ID,
})

const RATES = {
  disclaimer: 'https://openexchangerates.org/terms/',
  license: 'https://openexchangerates.org/license/',
  timestamp: 1735689600,
  base: 'USD',
  rates: { EUR: 0.96, GBP: 0.79 },
}

describe('契约面', () => {
  it('List 出全部 5 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(openExchangeRatesActions).length)
    expect(tools).toHaveLength(5)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('URL 与凭证', () => {
  it('app_id 走 query,symbols 数组拼成逗号分隔串', async () => {
    const mock = mockOer(200, RATES)
    const res = await call('get_latest_rates', {
      base: 'USD',
      symbols: ['EUR', 'GBP'],
      showAlternative: true,
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://openexchangerates.org/api/latest.json')
    expect(request.method).toBe('GET')
    expect(url.searchParams.get('app_id')).toBe(APP_ID)
    expect(url.searchParams.get('base')).toBe('USD')
    expect(url.searchParams.get('symbols')).toBe('EUR,GBP')
    expect(url.searchParams.get('show_alternative')).toBe('true')
    // 凭证只走 query,不该另外出现在头里。
    expect(request.headers.get('authorization')).toBeNull()

    await expect(res.json()).resolves.toEqual({ content: RATES })
  })

  it('get_currencies 是公开端点,不带 app_id', async () => {
    const mock = mockOer(200, { USD: 'United States Dollar' })
    await call('get_currencies', {})
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/currencies.json')
    expect(url.searchParams.has('app_id')).toBe(false)
  })

  it('historical 与 convert 把参数拼进路径', async () => {
    const historical = mockOer(200, { ...RATES, historical: true })
    await call('get_historical_rates', { date: '2026-01-15', symbols: ['EUR'] })
    expect(new URL(sent(historical).url).pathname).toBe('/api/historical/2026-01-15.json')
    vi.unstubAllGlobals()

    const convert = mockOer(200, { response: 96 })
    await call('convert_currency', { amount: 100, from: 'USD', to: 'EUR' })
    expect(new URL(sent(convert).url).pathname).toBe('/api/convert/100/USD/EUR')
  })

  it('time-series 的 start/end 与过滤器同时进 query', async () => {
    const mock = mockOer(200, { ...RATES, start_date: '2026-01-01', end_date: '2026-01-05' })
    await call('get_timeseries_rates', { startDate: '2026-01-01', endDate: '2026-01-05', base: 'USD' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/time-series.json')
    expect(url.searchParams.get('start')).toBe('2026-01-01')
    expect(url.searchParams.get('end')).toBe('2026-01-05')
    expect(url.searchParams.get('base')).toBe('USD')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:amount 非正 → 400 且不打上游', async () => {
    const mock = mockOer(200, {})
    const res = await call('convert_currency', { amount: 0, from: 'USD', to: 'EUR' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('币种码不是三位大写 → 400 且不打上游', async () => {
    const mock = mockOer(200, {})
    const res = await call('get_latest_rates', { base: 'usd' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('startDate 晚于 endDate 在本地就挡下(schema 表达不了跨字段约束)', async () => {
    const mock = mockOer(200, {})
    const res = await call('get_timeseries_rates', { startDate: '2026-02-01', endDate: '2026-01-01' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('endDate')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取 description', async () => {
    mockOer(401, { error: true, status: 401, message: 'invalid_app_id', description: 'Invalid App ID provided.' })
    const unauthorized = await call('get_latest_rates', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid App ID provided.',
    })

    mockOer(429, { error: true, status: 429, description: 'Access restricted for over-use.' })
    await expect((await call('get_latest_rates', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockOer(500, { error: true, status: 500, description: 'OER is down' })
    await expect((await call('get_latest_rates', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('HTTP 200 但 body 带 error:true 也算失败,状态取 body 里的 status', async () => {
    mockOer(200, { error: true, status: 403, message: 'not_allowed', description: 'Not allowed on your plan.' })
    const forbidden = await call('get_latest_rates', {})
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Not allowed on your plan.',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockOer(200, RATES)
    const res = await call('get_latest_rates', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
