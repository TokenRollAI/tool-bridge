import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createScrapflyPlugin } from '../../src/scrapfly/index'
import { scrapflyActions } from '../../src/scrapfly/schema'

/**
 * Scrapfly 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * key 走 query 而非 header、`headers[Name]` 与 `tags[]` 两套不同的方括号编码、
 * 计费信息只在响应头里、body/content_type 的成对约束。
 */

const API_KEY = 'scp-live-deadbeef'
const plugin = createScrapflyPlugin()

const {
  call,
  envelope,
  sent,
  stubFetch,
} = createProviderHarness({
  mountPath: 'scrape/scrapfly',
  plugin,
  upstreamAuth: API_KEY,
})

function mockScrapfly(
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  })))
}

describe('契约面', () => {
  it('List 出全部 2 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(scrapflyActions).length)
    expect(tools).toHaveLength(2)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义(scrape 会消耗额度,算 write)', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    expect(tools.find(t => t.name === 'scrape')?.effect).toBe('write')
    expect(tools.find(t => t.name === 'get_monitoring_metrics')?.effect).toBe('read')
  })
})

describe('请求成形', () => {
  it('key 进 query,headers[] 与 tags[] 各按各的编码', async () => {
    const mock = mockScrapfly(200, { result: { status_code: 200 } })
    await call('scrape', {
      url: 'https://example.com/',
      country: 'us',
      render_js: true,
      headers: { 'X-Trace': 't1', 'Accept-Language': 'en' },
      tags: ['a', 'b'],
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.scrapfly.io/scrape')
    expect(url.searchParams.get('key')).toBe(API_KEY)
    expect(url.searchParams.get('url')).toBe('https://example.com/')
    expect(url.searchParams.get('render_js')).toBe('true')
    expect(url.searchParams.get('headers[X-Trace]')).toBe('t1')
    expect(url.searchParams.get('headers[Accept-Language]')).toBe('en')
    expect(url.searchParams.getAll('tags[]')).toEqual(['a', 'b'])
    // 凭证不该同时出现在 header 里。
    expect(request.headers.get('authorization')).toBeNull()
  })

  it('POST 抓取把 body 与 content-type 透传给目标请求', async () => {
    const mock = mockScrapfly(200, { result: { status_code: 201 } })
    await call('scrape', {
      url: 'https://example.com/api',
      method: 'POST',
      body: '{"a":1}',
      content_type: 'application/json',
    })
    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.text()).resolves.toBe('{"a":1}')
  })

  it('监控指标的过滤项进 query,省略的不出现', async () => {
    const mock = mockScrapfly(200, { account: {} })
    await call('get_monitoring_metrics', { aggregation: 'account', period: 'last24h' })
    const url = new URL(sent(mock).url)
    expect(url.origin + url.pathname).toBe('https://api.scrapfly.io/scrape/monitoring/metrics')
    expect(url.searchParams.get('aggregation')).toBe('account')
    expect(url.searchParams.get('period')).toBe('last24h')
    expect(url.searchParams.has('start')).toBe(false)
  })
})

describe('响应归一', () => {
  it('计费与拒绝信息从响应头提到 metadata,完整 headers 一并透出', async () => {
    mockScrapfly(200, { result: { status_code: 200 }, config: { asp: true }, context: { cost: 1 } }, {
      'x-scrapfly-api-cost': '25',
      'x-scrapfly-remaining-api-credit': '9975',
      'x-scrapfly-reject-code': 'ERR::ASP::SHIELD_ERROR',
    })
    const body = (await (await call('scrape', { url: 'https://example.com/' })).json()) as {
      content: { config: unknown, headers: Record<string, string>, metadata: Record<string, unknown> }
    }
    expect(body.content.metadata).toEqual({
      status_code: 200,
      api_cost: 25,
      remaining_api_credit: 9975,
      reject_code: 'ERR::ASP::SHIELD_ERROR',
      reject_description: null,
      reject_retryable: null,
    })
    expect(body.content.config).toEqual({ asp: true })
    expect(body.content.headers['x-scrapfly-api-cost']).toBe('25')
  })

  it('成功响应缺 result → unavailable(契约破了,不是调用方的错)', async () => {
    mockScrapfly(200, { config: {} })
    await expect((await call('scrape', { url: 'https://example.com/' })).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:url 不是合法 URL → 400 且不打上游', async () => {
    const mock = mockScrapfly(200, {})
    const res = await call('scrape', { url: 'not-a-url' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('GET 带 body、以及 body 缺 content_type,都在本地挡下', async () => {
    const mock = mockScrapfly(200, {})
    const withBody = await call('scrape', { url: 'https://example.com/', body: 'x' })
    expect(withBody.status).toBe(400)
    expect(((await withBody.json()) as { message: string }).message).toContain('body')

    const noContentType = await call('scrape', {
      url: 'https://example.com/',
      method: 'POST',
      body: 'x',
    })
    expect(noContentType.status).toBe(400)
    expect(((await noContentType.json()) as { message: string }).message).toContain('content_type')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一', async () => {
    mockScrapfly(401, { message: 'Invalid API key' })
    const denied = await call('get_monitoring_metrics', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockScrapfly(429, { message: 'Throttled' })
    await expect((await call('get_monitoring_metrics', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockScrapfly(500, { error: 'Scrapfly is down' })
    await expect((await call('get_monitoring_metrics', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockScrapfly(200, {})
    const res = await call('get_monitoring_metrics', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
