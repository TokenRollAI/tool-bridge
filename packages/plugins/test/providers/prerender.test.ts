import { describe, expect, it } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createPrerenderPlugin } from '../../src/prerender/index'
import { prerenderActions } from '../../src/prerender/schema'

/**
 * Prerender 迁移产物的 wire 级验收。重点在两处非常规约定:凭证进 body/路径而不进请求头,
 * 以及 403 表示"清理任务进行中"而非鉴权失败。
 */

const API_KEY = 'pr_token_deadbeef'
const plugin = createPrerenderPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockPrerender,
} = createProviderHarness({
  mountPath: 'seo/prerender',
  plugin,
  upstreamAuth: API_KEY,
})

describe('契约面', () => {
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(prerenderActions).length)
    expect(tools).toHaveLength(4)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('get_cache_clear_status')).toBe('read')
    expect(effectOf('recache_urls')).toBe('write')
    expect(effectOf('clear_cache')).toBe('write')
  })
})

describe('凭证位置(不进请求头)', () => {
  it('recache_urls 把 token 放进 JSON body,而不是 Authorization 头', async () => {
    const mock = mockPrerender(200, null)
    const res = await call('recache_urls', {
      urls: ['https://example.com/a', 'https://example.com/b'],
      adaptiveType: 'mobile',
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.prerender.io/recache')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(request.headers.get('user-agent')).toBeNull()
    // 凭证不在请求头里:上游 API 的设计就是走 body。
    expect(request.headers.get('authorization')).toBeNull()
    await expect(request.json()).resolves.toEqual({
      prerenderToken: API_KEY,
      urls: ['https://example.com/a', 'https://example.com/b'],
      adaptiveType: 'mobile',
    })
    await expect(res.json()).resolves.toEqual({ content: { accepted: true, raw: null } })
  })

  it('get_cache_clear_status 把 token 拼进路径段并做 URL 编码', async () => {
    const mock = mockPrerender(200, { status: 'ok' })
    const res = await call('get_cache_clear_status', {})
    expect(sent(mock).url).toBe(`https://api.prerender.io/cache-clear-status/${API_KEY}`)
    expect(sent(mock).method).toBe('GET')
    await expect(res.json()).resolves.toMatchObject({ content: { status: 'idle' } })
  })

  it('省略的 adaptiveType 不出现在 body 里', async () => {
    const mock = mockPrerender(200, null)
    await call('recache_urls', { urls: ['https://example.com/a'] })
    await expect(sent(mock).json()).resolves.toEqual({
      prerenderToken: API_KEY,
      urls: ['https://example.com/a'],
    })
  })
})

describe('403 表示"进行中"而非失败', () => {
  it('clear_cache 收到 403 → status=in_progress,不报错', async () => {
    mockPrerender(403, { error: 'cache clear in progress' })
    const res = await call('clear_cache', { query: 'https://example.com%' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      content: { status: 'in_progress', raw: { error: 'cache clear in progress' } },
    })
  })

  it('clear_cache 正常返回 → status=queued,query 进 body', async () => {
    const mock = mockPrerender(200, null)
    const res = await call('clear_cache', { query: 'https://example.com%' })
    await expect(sent(mock).json()).resolves.toEqual({
      prerenderToken: API_KEY,
      query: 'https://example.com%',
    })
    await expect(res.json()).resolves.toMatchObject({ content: { status: 'queued' } })
  })

  it('get_cache_clear_status 收到 403 → status=in_progress', async () => {
    mockPrerender(403, null)
    await expect((await call('get_cache_clear_status', {})).json())
      .resolves.toMatchObject({ content: { status: 'in_progress' } })
  })

  it('recache_urls 的 403 仍然是错误(它没有"进行中"语义)', async () => {
    mockPrerender(403, { error: 'invalid token' })
    const res = await call('recache_urls', { urls: ['https://example.com/a'] })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ code: 'permission_denied' })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:urls 里给非 URL → 400 且不打上游', async () => {
    const mock = mockPrerender(200, null)
    const res = await call('recache_urls', { urls: ['not a url'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('urls 为空数组 → 400 且不打上游', async () => {
    const mock = mockPrerender(200, null)
    expect((await call('recache_urls', { urls: [] })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('add_sitemap 缺 url → 400 且不打上游(schema 里是 optional,靠手写校验挡)', async () => {
    const mock = mockPrerender(200, null)
    const res = await call('add_sitemap', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'url is required' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一', async () => {
    mockPrerender(401, { error: 'invalid token' })
    const unauth = await call('recache_urls', { urls: ['https://example.com/a'] })
    expect(unauth.status).toBe(401)
    await expect(unauth.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'invalid token',
    })

    mockPrerender(429, { message: 'rate limited' })
    await expect((await call('recache_urls', { urls: ['https://example.com/a'] })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockPrerender(500, { error: 'boom' })
    await expect((await call('recache_urls', { urls: ['https://example.com/a'] })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockPrerender(200, null)
    const res = await call('get_cache_clear_status', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
