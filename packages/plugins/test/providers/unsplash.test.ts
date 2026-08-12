import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUnsplashPlugin } from '../../src/unsplash/index'
import { unsplashActions } from '../../src/unsplash/schema'

/**
 * Unsplash 迁移产物的 wire 级验收。重点钉住几个"迁移最容易迁丢"的地方:
 * `Client-ID` 凭证前缀、数组入参的 CSV 编码、random 响应的数组/单对象双形态、
 * 以及 query 与 collections/topics 的互斥断言。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'unsplash_access_key_test'
const plugin = createUnsplashPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'media/unsplash',
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

function mockUnsplash(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('~describe 报单个 tools/v1 export', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as { exports: Array<{ id: string, profile: string }> }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.profile).toBe('tools/v1')
  })

  it('List 出全部 6 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(unsplashActions).length)
    expect(tools).toHaveLength(6)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'get_photo',
      'get_random_photo',
      'get_topic_photos',
      'list_photos',
      'list_topics',
      'search_photos',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求拼装', () => {
  it('list_photos:GET,凭证走 Client-ID 前缀,camelCase 入参改成 snake_case query', async () => {
    const mock = mockUnsplash(200, [])
    await call('list_photos', { page: 2, perPage: 10, orderBy: 'popular' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin).toBe('https://api.unsplash.com')
    expect(url.pathname).toBe('/photos')
    // Bearer 会 401:Unsplash 用自己的方案名。
    expect(request.headers.get('authorization')).toBe(`Client-ID ${API_KEY}`)
    expect(request.headers.get('accept-version')).toBe('v1')
    expect(await request.text()).toBe('')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '2',
      per_page: '10',
      order_by: 'popular',
    })
  })

  it('未给的可选参数不出现在 query 里', async () => {
    const mock = mockUnsplash(200, [])
    await call('list_photos', {})
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual([])
  })

  it('collections 数组编码成逗号分隔串,不是重复的同名参数', async () => {
    const mock = mockUnsplash(200, { total: 0, total_pages: 0, results: [] })
    await call('search_photos', { query: 'dogs', collections: ['1234', '5678'] })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/search/photos')
    expect(url.searchParams.getAll('collections')).toEqual(['1234,5678'])
    // 参数名是 query 而不是 q。
    expect(url.searchParams.get('query')).toBe('dogs')
  })

  it('路径段里的 id / topic 做 URL 编码', async () => {
    const photo = mockUnsplash(200, { id: 'a/b' })
    await call('get_photo', { id: 'a/b' })
    expect(new URL(sent(photo).url).pathname).toBe('/photos/a%2Fb')

    vi.unstubAllGlobals()
    const topic = mockUnsplash(200, [])
    await call('get_topic_photos', { topicIdOrSlug: 'nature photos' })
    expect(new URL(sent(topic).url).pathname).toBe('/topics/nature%20photos/photos')
  })
})

describe('响应整形', () => {
  it('search_photos 把 total_pages 映射成 totalPages,缺失时兜底 0', async () => {
    mockUnsplash(200, { results: [{ id: 'p1' }] })
    const res = await call('search_photos', { query: 'cats' })
    await expect(res.json()).resolves.toEqual({
      content: { total: 0, totalPages: 0, results: [{ id: 'p1' }] },
    })
  })

  it('get_random_photo 不带 count 时上游回单个对象,也要收成 photos 数组', async () => {
    mockUnsplash(200, { id: 'r1', slug: 'one' })
    const single = await call('get_random_photo', {})
    await expect(single.json()).resolves.toEqual({
      content: { photos: [{ id: 'r1', slug: 'one' }] },
    })

    vi.unstubAllGlobals()
    mockUnsplash(200, [{ id: 'r1' }, { id: 'r2' }])
    const many = await call('get_random_photo', { count: 2 })
    await expect(many.json()).resolves.toEqual({
      content: { photos: [{ id: 'r1' }, { id: 'r2' }] },
    })
  })

  it('该回数组的端点回了对象 → unavailable + retryable(上游违约,不是调用方的错)', async () => {
    mockUnsplash(200, { nope: true })
    const res = await call('list_photos', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:perPage 越界 → 400 且不打上游', async () => {
    const mock = mockUnsplash(200, [])
    const res = await call('list_photos', { perPage: 100 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的 query 能过 Zod 的 min(1),但在本地就挡下', async () => {
    const mock = mockUnsplash(200, {})
    const res = await call('search_photos', { query: '   ' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('query')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_random_photo 的 query 与 collections/topics 互斥,本地拦下不打上游', async () => {
    const mock = mockUnsplash(200, {})
    const res = await call('get_random_photo', { query: 'cats', collections: ['1234'] })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()

    // 只给 collections 则放行。
    vi.unstubAllGlobals()
    const allowed = mockUnsplash(200, { id: 'r1' })
    expect((await call('get_random_photo', { collections: ['1234'], topics: ['t1'] })).status).toBe(200)
    expect(new URL(sent(allowed).url).searchParams.get('collections')).toBe('1234')
  })

  it('上游 4xx → invalid_argument 系,消息取自 errors[0]', async () => {
    mockUnsplash(401, { errors: ['OAuth error: The access token is invalid'] })
    const unauthorized = await call('list_photos', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'OAuth error: The access token is invalid',
    })

    vi.unstubAllGlobals()
    mockUnsplash(404, { errors: ['Couldn\'t find Photo'] })
    const missing = await call('get_photo', { id: 'nope' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found' })

    vi.unstubAllGlobals()
    mockUnsplash(429, { errors: ['Rate Limit Exceeded'] })
    await expect((await call('list_photos', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('上游 5xx → unavailable + retryable', async () => {
    mockUnsplash(503, { error: 'Service Unavailable' })
    const res = await call('list_photos', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Service Unavailable',
    })
  })

  it('上游回 HTML 错误页时按 HTTP 状态归一,而不是报"响应不是 JSON"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>502</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }))))
    const res = await call('list_photos', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockUnsplash(200, [])
    const res = await call('list_photos', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
