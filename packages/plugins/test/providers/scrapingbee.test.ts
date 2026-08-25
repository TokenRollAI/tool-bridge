import { describe, expect, it, vi } from 'vitest'
import { createScrapingbeePlugin } from '../../src/scrapingbee/index'
import { createProviderHarness } from '../support/providerHarness'
import { scrapingbeeActions } from '../../src/scrapingbee/schema'

/**
 * ScrapingBee 迁移产物的 wire 级验收。重点:凭证走 query 参数(而非 header)、
 * 布尔/整数参数的字符串化、`spb-*` 响应头上的诊断信息、extract_rules 的 JSON 序列化。
 */

const API_KEY = 'spb_test_deadbeef'
const plugin = createScrapingbeePlugin()

const {
  call,
  envelope,
  sent,
  stubFetch,
} = createProviderHarness({
  mountPath: 'data/scrapingbee',
  plugin,
  upstreamAuth: API_KEY,
})

function mockScrapingbee(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(new Response(body, { status, headers })))
}

const USAGE = JSON.stringify({
  max_api_credit: 1000,
  used_api_credit: 12,
  max_concurrency: 5,
  current_concurrency: 1,
  renewal_subscription_date: '2026-09-01T00:00:00Z',
})

describe('契约面', () => {
  it('List 出全部 3 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(scrapingbeeActions).length)
    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求整形', () => {
  it('fetch_html 把凭证与参数全放 query,布尔/整数字符串化', async () => {
    const mock = mockScrapingbee(200, '<html>ok</html>', {
      'content-type': 'text/html; charset=utf-8',
      'spb-initial-status-code': '301',
      'spb-resolved-url': 'https://example.com/final',
      'spb-cost': '1.5',
    })
    const res = await call('fetch_html', {
      url: 'https://example.com',
      renderJs: true,
      waitMs: 0,
      blockAds: false,
      countryCode: 'us',
      retry: 2,
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://app.scrapingbee.com/api/v1/')
    expect(url.searchParams.get('api_key')).toBe(API_KEY)
    expect(url.searchParams.get('url')).toBe('https://example.com')
    expect(url.searchParams.get('render_js')).toBe('true')
    // waitMs=0 与 blockAds=false 都是有意义的值,不能被 falsy 判断吃掉。
    expect(url.searchParams.get('wait')).toBe('0')
    expect(url.searchParams.get('block_ads')).toBe('false')
    expect(url.searchParams.get('country_code')).toBe('us')
    expect(url.searchParams.get('retry')).toBe('2')
    expect(url.searchParams.has('wait_for')).toBe(false)

    await expect(res.json()).resolves.toEqual({
      content: {
        html: '<html>ok</html>',
        statusCode: 200,
        contentType: 'text/html; charset=utf-8',
        initialStatusCode: 301,
        resolvedUrl: 'https://example.com/final',
        creditCost: 1.5,
      },
    })
  })

  it('spb-initial-status-code 非严格整数串时整个字段省掉', async () => {
    mockScrapingbee(200, '<html/>', { 'spb-initial-status-code': '2e2' })
    const res = await call('fetch_html', { url: 'https://example.com' })
    const body = (await res.json()) as { content: Record<string, unknown> }
    expect(body.content.initialStatusCode).toBeUndefined()
    expect('initialStatusCode' in body.content).toBe(false)
  })

  it('extract_data 把 extractRules 序列化进 extract_rules', async () => {
    const mock = mockScrapingbee(200, JSON.stringify({ title: 'Hello' }), { 'spb-cost': '5' })
    const res = await call('extract_data', {
      url: 'https://example.com',
      extractRules: { title: 'h1' },
    })

    const url = new URL(sent(mock).url)
    expect(url.searchParams.get('extract_rules')).toBe('{"title":"h1"}')
    await expect(res.json()).resolves.toEqual({
      content: { data: { title: 'Hello' }, statusCode: 200, creditCost: 5 },
    })
  })

  it('get_usage_stats 打 /api/v1/usage', async () => {
    const mock = mockScrapingbee(200, USAGE)
    const res = await call('get_usage_stats', {})
    expect(new URL(sent(mock).url).pathname).toBe('/api/v1/usage')
    await expect(res.json()).resolves.toMatchObject({
      content: { usage: { max_api_credit: 1000, current_concurrency: 1 } },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:url 不是合法 URL → 400 且不打上游', async () => {
    const mock = mockScrapingbee(200, '')
    const res = await call('fetch_html', { url: 'not-a-url' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message / error / 原文', async () => {
    mockScrapingbee(401, JSON.stringify({ message: 'Invalid api key' }))
    await expect((await call('fetch_html', { url: 'https://example.com' })).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'Invalid api key' })

    mockScrapingbee(429, JSON.stringify({ error: 'Too many concurrent requests' }))
    await expect((await call('fetch_html', { url: 'https://example.com' })).json())
      .resolves.toMatchObject({
        code: 'rate_limited',
        message: 'Too many concurrent requests',
        retryable: true,
      })

    mockScrapingbee(500, 'upstream exploded')
    await expect((await call('fetch_html', { url: 'https://example.com' })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'upstream exploded', retryable: true })
  })

  it('usage 缺必有字段按上游坏了处理', async () => {
    mockScrapingbee(200, JSON.stringify({ max_api_credit: 1000 }))
    await expect((await call('get_usage_stats', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('extract_data 收到非 JSON → unavailable', async () => {
    mockScrapingbee(200, '<html>not json</html>')
    await expect((await call('extract_data', {
      url: 'https://example.com',
      extractRules: { title: 'h1' },
    })).json()).resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockScrapingbee(200, USAGE)
    const res = await call('get_usage_stats', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
