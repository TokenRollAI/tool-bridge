import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUmamiPlugin } from '../../src/umami/index'
import { umamiActions } from '../../src/umami/schema'

/**
 * Umami 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 四个 action 共用的时间范围 query(漏一个过滤器不会报错,只会静默返回错的数字)、
 * 分页信封的平铺与 page/pageSize 的取值域、metrics 的裸数组响应,
 * 以及 timezone / websiteId 的纯空白拦截(Zod 的 min(1) 拦不住)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'api_umamitestkey'
const WEBSITE_ID = '0b1c2d3e-4f56-7890-abcd-ef1234567890'
const plugin = createUmamiPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'analytics/umami',
  exportId: 'actions',
}

/** 四个带时间范围的 action 的最小必填入参。 */
const RANGE = { websiteId: WEBSITE_ID, startAt: 1735689600000, endAt: 1738368000000, timezone: 'UTC' }

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

function mockUmami(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
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
  it('~describe 报成单个 tools/v1 export,并把凭证探针一并声明出去', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'single', required: true },
        id: 'actions',
        profile: 'tools/v1',
        description: 'Umami',
        credentialProbe: 'get_current_user',
      }],
    })
  })

  it('List 出全部 8 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(umamiActions).length)
    expect(tools).toHaveLength(8)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'get_current_user',
      'get_metrics',
      'get_pageviews',
      'get_realtime',
      'get_website',
      'get_website_stats',
      'list_events',
      'list_websites',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('探针指向的 get_current_user 确实是 read 且零必填入参(否则平台空参调它会被 Zod 拦下)', async () => {
    const mock = mockUmami(200, { id: 'u1', username: 'alice' })
    const res = await call('get_current_user', {})
    expect(res.status).toBe(200)
    expect(umamiActions.get_current_user.effect).toBe('read')
    expect(sent(mock).method).toBe('GET')
  })
})

describe('请求拼装', () => {
  it('get_current_user:GET /api/me,凭证走 Authorization: Bearer 头', async () => {
    const mock = mockUmami(200, { id: 'u1', username: 'alice' })
    await call('get_current_user', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://api.umami.is/api/me')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
    // 凭证只在头上,URL 上不该出现它(部署侧的日志脱敏据此定策)。
    expect(request.url).not.toContain(API_KEY)
  })

  it('时间范围 query 一个不落:startAt/endAt/timezone 加全部维度过滤器', async () => {
    const mock = mockUmami(200, { pageviews: 1 })
    await call('get_website_stats', {
      ...RANGE,
      timezone: 'Asia/Shanghai',
      url: '/pricing',
      referrer: 'google.com',
      title: 'Pricing',
      host: 'example.com',
      os: 'macOS',
      browser: 'chrome',
      device: 'desktop',
      country: 'CN',
      region: 'CN-31',
      city: 'Shanghai',
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe(`/api/websites/${WEBSITE_ID}/stats`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      startAt: '1735689600000',
      endAt: '1738368000000',
      timezone: 'Asia/Shanghai',
      url: '/pricing',
      referrer: 'google.com',
      title: 'Pricing',
      host: 'example.com',
      os: 'macOS',
      browser: 'chrome',
      device: 'desktop',
      country: 'CN',
      region: 'CN-31',
      city: 'Shanghai',
    })
  })

  it('未给的过滤器不出现在 query 里', async () => {
    const mock = mockUmami(200, {})
    await call('get_website_stats', RANGE)
    expect([...new URL(sent(mock).url).searchParams.keys()].sort())
      .toEqual(['endAt', 'startAt', 'timezone'])
  })

  it('各 action 打各自的端点(realtime 不挂在 /api/websites 下)', async () => {
    const pageviews = mockUmami(200, {})
    await call('get_pageviews', { ...RANGE, unit: 'day' })
    const pageviewsUrl = new URL(sent(pageviews).url)
    expect(pageviewsUrl.pathname).toBe(`/api/websites/${WEBSITE_ID}/pageviews`)
    expect(pageviewsUrl.searchParams.get('unit')).toBe('day')

    vi.unstubAllGlobals()
    const metrics = mockUmami(200, [])
    await call('get_metrics', { ...RANGE, type: 'browser', limit: 10 })
    const metricsUrl = new URL(sent(metrics).url)
    expect(metricsUrl.pathname).toBe(`/api/websites/${WEBSITE_ID}/metrics`)
    expect(metricsUrl.searchParams.get('type')).toBe('browser')
    expect(metricsUrl.searchParams.get('limit')).toBe('10')

    vi.unstubAllGlobals()
    const realtime = mockUmami(200, { visitors: 3 })
    await call('get_realtime', { websiteId: WEBSITE_ID })
    expect(new URL(sent(realtime).url).pathname).toBe(`/api/realtime/${WEBSITE_ID}`)

    vi.unstubAllGlobals()
    const website = mockUmami(200, { id: WEBSITE_ID })
    await call('get_website', { websiteId: WEBSITE_ID })
    expect(new URL(sent(website).url).pathname).toBe(`/api/websites/${WEBSITE_ID}`)
  })

  it('websiteId 进路径段前做 encode(带斜杠的 id 不能改写路径结构)', async () => {
    const mock = mockUmami(200, { id: 'x' })
    await call('get_website', { websiteId: 'a/b c' })
    expect(new URL(sent(mock).url).pathname).toBe('/api/websites/a%2Fb%20c')
  })

  it('list_websites / list_events 的分页参数转成字符串进 query', async () => {
    const websites = mockUmami(200, { data: [], count: 0, page: 2, pageSize: 25 })
    await call('list_websites', { query: 'shop', page: 2, pageSize: 25 })
    expect(Object.fromEntries(new URL(sent(websites).url).searchParams))
      .toEqual({ query: 'shop', page: '2', pageSize: '25' })

    vi.unstubAllGlobals()
    const events = mockUmami(200, { data: [], count: 0, page: 1, pageSize: 10 })
    await call('list_events', { ...RANGE, query: 'signup', page: 1, pageSize: 10 })
    const eventsUrl = new URL(sent(events).url)
    expect(eventsUrl.pathname).toBe(`/api/websites/${WEBSITE_ID}/events`)
    // 时间范围与分页在同一张 query 上,别让后者盖掉前者。
    expect(Object.fromEntries(eventsUrl.searchParams)).toEqual({
      startAt: '1735689600000',
      endAt: '1738368000000',
      timezone: 'UTC',
      query: 'signup',
      page: '1',
      pageSize: '10',
    })
  })
})

describe('响应整形', () => {
  it('get_current_user 把响应体同时透出为 user 与 raw', async () => {
    mockUmami(200, { id: 'u1', username: 'alice', role: 'admin', isAdmin: true })
    const res = await call('get_current_user', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        user: { id: 'u1', username: 'alice', role: 'admin', isAdmin: true },
        raw: { id: 'u1', username: 'alice', role: 'admin', isAdmin: true },
      },
    })
  })

  it('分页信封平铺成 {websites, count, page, pageSize, raw}', async () => {
    const payload = {
      data: [{ id: 'w1', name: 'Shop', domain: 'shop.example', shareId: null }],
      count: 1,
      page: 1,
      pageSize: 10,
    }
    mockUmami(200, payload)
    const res = await call('list_websites', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        websites: [{ id: 'w1', name: 'Shop', domain: 'shop.example', shareId: null }],
        count: 1,
        page: 1,
        pageSize: 10,
        raw: payload,
      },
    })
  })

  it('get_metrics 的响应顶层是裸数组,metrics 与 raw 都取它', async () => {
    mockUmami(200, [{ x: 'chrome', y: 120 }, { x: 'safari', y: 30 }])
    const res = await call('get_metrics', { ...RANGE, type: 'browser' })
    await expect(res.json()).resolves.toEqual({
      content: {
        metrics: [{ x: 'chrome', y: 120 }, { x: 'safari', y: 30 }],
        raw: [{ x: 'chrome', y: 120 }, { x: 'safari', y: 30 }],
      },
    })
  })

  it('count 可以是 0,page/pageSize 是 0 则归 unavailable(0 页是个不能用的游标)', async () => {
    mockUmami(200, { data: [], count: 0, page: 1, pageSize: 10 })
    const empty = await call('list_websites', {})
    expect(empty.status).toBe(200)
    await expect(empty.json()).resolves.toMatchObject({ content: { count: 0, websites: [] } })

    vi.unstubAllGlobals()
    mockUmami(200, { data: [], count: 0, page: 0, pageSize: 10 })
    const broken = await call('list_websites', {})
    expect(broken.status).toBe(503)
    await expect(broken.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('分页信封缺 data 数组 → unavailable(是上游破契约,不是调用方的错)', async () => {
    mockUmami(200, { count: 0, page: 1, pageSize: 10 })
    const res = await call('list_websites', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('metrics 回对象而不是数组 → unavailable', async () => {
    mockUmami(200, { data: [] })
    const res = await call('get_metrics', { ...RANGE, type: 'url' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('纯空白的 timezone 能过 Zod 的 min(1),但在本地就挡下(上游会静默按 UTC 算错数字)', async () => {
    const mock = mockUmami(200, {})
    const res = await call('get_website_stats', { ...RANGE, timezone: '  ' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'timezone 不能为空' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的 websiteId 同样在本地挡下(否则会打出 /api/websites/%20)', async () => {
    const mock = mockUmami(200, {})
    const res = await call('get_website', { websiteId: ' ' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:type 不在枚举内 → 400 且不打上游', async () => {
    const mock = mockUmami(200, [])
    const res = await call('get_metrics', { ...RANGE, type: 'not_a_dimension' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 4xx → invalid_argument;5xx → unavailable + retryable', async () => {
    mockUmami(400, { message: 'startAt is required' })
    const bad = await call('get_website_stats', RANGE)
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'startAt is required',
    })

    vi.unstubAllGlobals()
    mockUmami(503, { message: 'Umami is down' })
    const down = await call('get_website_stats', RANGE)
    expect(down.status).toBe(503)
    await expect(down.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Umami is down',
    })
  })

  it('401 → permission_denied,404 → not_found,429 → rate_limited', async () => {
    mockUmami(401, { error: 'Unauthorized' })
    const unauthorized = await call('get_current_user', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthorized',
    })

    vi.unstubAllGlobals()
    mockUmami(404, { error: { message: 'Website not found' } })
    const missing = await call('get_website', { websiteId: WEBSITE_ID })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'Website not found',
    })

    vi.unstubAllGlobals()
    mockUmami(429, { message: 'Too many requests' })
    const limited = await call('get_current_user', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('2xx 回非 JSON → unavailable(不能把 HTML 错误页包成 {message} 当业务对象透出)', async () => {
    mockUmami(200, '<html>Bad Gateway</html>')
    const res = await call('get_current_user', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockUmami(200, {})
    const res = await call('get_current_user', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
