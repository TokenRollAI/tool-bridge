import { describe, expect, it, vi } from 'vitest'
import { createBraveSearchPlugin } from '../../src/brave_search/index'
import { createProviderHarness } from '../support/providerHarness'
import { braveSearchActions } from '../../src/brave_search/schema'

/**
 * Brave Search 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * query 参数的取舍与空白语义、goggles 的单串/数组双形态、按结果族裁剪的出参、
 * 以及比 HTTP 状态更准的上游错误码。
 */

const API_KEY = 'BSAtestdeadbeef'
const plugin = createBraveSearchPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockBrave,
} = createProviderHarness({
  mountPath: 'search/brave',
  plugin,
  upstreamAuth: API_KEY,
})

describe('契约面', () => {
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(braveSearchActions).length)
    expect(tools).toHaveLength(4)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'image_search',
      'news_search',
      'video_search',
      'web_search',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求拼装', () => {
  it('web_search:参数进 query,凭证走 x-subscription-token 头,GET 无请求体', async () => {
    const mock = mockBrave(200, { type: 'search', web: { results: [] } })
    await call('web_search', {
      q: 'brave browser',
      country: 'US',
      safesearch: 'strict',
      count: 5,
      offset: 1,
      spellcheck: false,
      freshness: 'pw',
      result_filter: 'web,news',
      text_decorations: true,
      units: 'metric',
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin).toBe('https://api.search.brave.com')
    expect(url.pathname).toBe('/res/v1/web/search')
    expect(request.headers.get('x-subscription-token')).toBe(API_KEY)
    expect(request.headers.get('accept')).toBe('application/json')
    expect(await request.text()).toBe('')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'brave browser',
      country: 'US',
      safesearch: 'strict',
      count: '5',
      offset: '1',
      spellcheck: 'false',
      freshness: 'pw',
      result_filter: 'web,news',
      text_decorations: 'true',
      units: 'metric',
    })
  })

  it('未给的可选参数不出现在 query 里(免得把默认值写死成显式值)', async () => {
    const mock = mockBrave(200, { type: 'search' })
    await call('web_search', { q: 'x' })
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual(['q'])
  })

  it('goggles 数组展开成重复的同名参数,单串原样发', async () => {
    const many = mockBrave(200, { type: 'search' })
    await call('web_search', { q: 'x', goggles: ['https://g.example/a.goggle', 'https://g.example/b.goggle'] })
    expect(new URL(sent(many).url).searchParams.getAll('goggles')).toEqual([
      'https://g.example/a.goggle',
      'https://g.example/b.goggle',
    ])

    vi.unstubAllGlobals()
    const one = mockBrave(200, { type: 'search' })
    await call('web_search', { q: 'x', goggles: 'https://g.example/a.goggle' })
    expect(new URL(sent(one).url).searchParams.getAll('goggles')).toEqual(['https://g.example/a.goggle'])
  })

  it('image_search 打 images 端点,且不认 web 独有的参数', async () => {
    const mock = mockBrave(200, { type: 'images', results: [] })
    await call('image_search', { q: 'cats', country: 'JP', safesearch: 'strict', count: 30 })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/res/v1/images/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'cats',
      country: 'JP',
      safesearch: 'strict',
      count: '30',
    })

    vi.unstubAllGlobals()
    const rejected = mockBrave(200, {})
    const res = await call('image_search', { q: 'cats', offset: 2 })
    expect(res.status).toBe(400)
    expect(rejected).not.toHaveBeenCalled()
  })

  it('news / video 各自打自己的端点', async () => {
    const news = mockBrave(200, { type: 'news', results: [] })
    await call('news_search', { q: 'election' })
    expect(new URL(sent(news).url).pathname).toBe('/res/v1/news/search')

    vi.unstubAllGlobals()
    const video = mockBrave(200, { type: 'videos', results: [] })
    await call('video_search', { q: 'guitar' })
    expect(new URL(sent(video).url).pathname).toBe('/res/v1/videos/search')
  })
})

describe('响应整形', () => {
  it('web_search 按结果族裁剪:未声明的字段丢掉,null 保留,type 缺失时兜底 search', async () => {
    mockBrave(200, {
      query: { original: 'brave' },
      web: { results: [{ title: 'Brave' }] },
      news: null,
      videos: { results: [] },
      unknown_family: { nope: true },
    })
    const res = await call('web_search', { q: 'brave' })
    await expect(res.json()).resolves.toEqual({
      content: {
        type: 'search',
        query: { original: 'brave' },
        web: { results: [{ title: 'Brave' }] },
        news: null,
        videos: { results: [] },
      },
    })
  })

  it('news_search 出参是 {type, query, results},不带 extra(上游声明里没有这个字段)', async () => {
    mockBrave(200, {
      type: 'news',
      query: { original: 'election' },
      results: [{ title: 'A' }, { title: 'B' }],
      extra: { might_be_missing: true },
    })
    const res = await call('news_search', { q: 'election' })
    await expect(res.json()).resolves.toEqual({
      content: {
        type: 'news',
        query: { original: 'election' },
        results: [{ title: 'A' }, { title: 'B' }],
      },
    })
  })

  it('video_search 保留 extra', async () => {
    mockBrave(200, { type: 'videos', results: [{ title: 'V' }], extra: { might_be_missing: false } })
    const res = await call('video_search', { q: 'guitar' })
    await expect(res.json()).resolves.toMatchObject({
      content: { extra: { might_be_missing: false }, results: [{ title: 'V' }] },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:count 越界 → 400 且不打上游', async () => {
    const mock = mockBrave(200, {})
    const res = await call('web_search', { q: 'x', count: 99 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的 q 能过 Zod 的 min(1),但在本地就挡下(空查询打上游必然失败)', async () => {
    const mock = mockBrave(200, {})
    const res = await call('web_search', { q: '   ' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('q')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error.detail', async () => {
    mockBrave(401, { error: { code: 'SUBSCRIPTION_TOKEN_INVALID', detail: 'Invalid subscription token' } })
    const unauthorized = await call('web_search', { q: 'x' })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid subscription token',
    })

    vi.unstubAllGlobals()
    mockBrave(429, { error: { code: 'RATE_LIMITED', detail: 'Too many requests' } })
    const limited = await call('web_search', { q: 'x' })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockBrave(500, { error: { code: 'INTERNAL', detail: 'Brave is down' } })
    await expect((await call('web_search', { q: 'x' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('配额耗尽即便以非 429 状态回来也归一成 rate_limited(错误码比状态准)', async () => {
    mockBrave(403, { error: { code: 'QUOTA_LIMITED', detail: 'Monthly quota exhausted' } })
    const res = await call('web_search', { q: 'x' })
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({
      code: 'rate_limited',
      retryable: true,
      message: 'Monthly quota exhausted',
    })
  })

  it('套餐不含该选项 → invalid_argument,消息拿不到 detail 时退回错误码', async () => {
    mockBrave(422, { error: { code: 'OPTION_NOT_IN_PLAN' } })
    const res = await call('web_search', { q: 'x', extra_snippets: true })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'OPTION_NOT_IN_PLAN',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockBrave(200, {})
    const res = await call('web_search', { q: 'x' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
