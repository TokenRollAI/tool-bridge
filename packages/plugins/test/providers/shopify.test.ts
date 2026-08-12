import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  encodeCredentialValues,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createShopifyPlugin } from '../../src/shopify/index'
import { shopifyActions } from '../../src/shopify/schema'

/**
 * Shopify REST Admin(Legacy)迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * shopDomain 归一(既是配置容错也是出站白名单)、分页 cursor 藏在 Link 响应头里、
 * `page_info` 与筛选参数互斥、`popular` 用 `1` 而不是 `true`、以及 errors 三种形态的错误消息。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const CREDENTIALS = {
  apiKey: 'shpat_deadbeef',
  shopDomain: 'acme.myshopify.com',
}
const API_BASE = 'https://acme.myshopify.com/admin/api/2026-04'
const plugin = createShopifyPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'shop/shopify',
  exportId: 'actions',
}

function envelope(body: unknown, opts: { auth?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(CALLER),
  }
  const auth = opts.auth === undefined ? encodeCredentialValues(CREDENTIALS) : opts.auth
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

function mockShopify(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

/** 换一份凭证跑一次(shopDomain 的各种填法)。 */
function callWithShopDomain(shopDomain: string, name: string, args: unknown): Promise<Response> {
  return call(name, args, { auth: encodeCredentialValues({ apiKey: CREDENTIALS.apiKey, shopDomain }) })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 13 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(shopifyActions).length)
    expect(tools).toHaveLength(13)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'count_articles',
      'count_blogs',
      'count_pages',
      'get_article',
      'get_blog',
      'get_page',
      'get_shop',
      'list_article_authors',
      'list_article_tags',
      'list_articles',
      'list_blog_article_tags',
      'list_blogs',
      'list_pages',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报单个 tools/v1 export,带两字段凭证声明与探针工具名', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as {
      exports: Array<{
        credentialFields?: Array<{ key: string, secret?: boolean }>
        credentialProbe?: string
        profile?: string
      }>
    }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.profile).toBe('tools/v1')
    expect(body.exports[0]?.credentialFields?.map(field => field.key)).toEqual(['apiKey', 'shopDomain'])
    // shopDomain 不是密钥(它决定出站主机),但仍走 authRef 而不是 providerConfig。
    expect(body.exports[0]?.credentialFields?.map(field => field.secret)).toEqual([true, false])
    expect(body.exports[0]?.credentialProbe).toBe('get_shop')
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', () => {
    const spec = shopifyActions.get_shop
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })
})

describe('出站目标与凭证', () => {
  it('get_shop:base URL 由 shopDomain 现算,凭证走 X-Shopify-Access-Token 头', async () => {
    const mock = mockShopify(200, { shop: { id: 1, name: 'Acme' } })
    const res = await call('get_shop', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe(`${API_BASE}/shop.json`)
    expect(request.headers.get('x-shopify-access-token')).toBe(CREDENTIALS.apiKey)
    expect(request.headers.get('accept')).toBe('application/json')
    expect(await request.text()).toBe('')
    await expect(res.json()).resolves.toEqual({ content: { shop: { id: 1, name: 'Acme' } } })
  })

  it('shopDomain 允许粘贴完整后台地址,取其主机名', async () => {
    const mock = mockShopify(200, { shop: { id: 1 } })
    await callWithShopDomain('https://ACME.myshopify.com/admin/products?x=1', 'get_shop', {})
    expect(sent(mock).url).toBe(`${API_BASE}/shop.json`)
  })

  it('非 myshopify.com 的 shopDomain 当场拒:归 invalid_argument 且不打上游', async () => {
    for (const shopDomain of ['acme.example.com', 'http://169.254.169.254/', 'not a url', '.myshopify.com']) {
      vi.unstubAllGlobals()
      const mock = mockShopify(200, {})
      const res = await callWithShopDomain(shopDomain, 'get_shop', {})
      expect(res.status, shopDomain).toBe(400)
      await expect(res.json(), shopDomain).resolves.toMatchObject({ code: 'invalid_argument' })
      expect(mock, shopDomain).not.toHaveBeenCalled()
    }
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockShopify(200, {})
    const res = await call('get_shop', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('请求拼装与分页', () => {
  it('list_blogs:筛选进 query,分页 cursor 从 Link 头里抠出来', async () => {
    const link = `<${API_BASE}/blogs.json?limit=2&page_info=NEXTCURSOR>; rel="next"`
      + `, <${API_BASE}/blogs.json?limit=2&page_info=PREVCURSOR>; rel="previous"`
    const mock = mockShopify(200, { blogs: [{ id: 11, title: 'News' }] }, { link })
    const res = await call('list_blogs', { handle: 'news', since_id: 5, limit: 2 })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/admin/api/2026-04/blogs.json')
    expect(Object.fromEntries(url.searchParams)).toEqual({ handle: 'news', since_id: '5', limit: '2' })
    // 出参要的是能直接回填进 page_info 入参的值,不是整个链接。
    await expect(res.json()).resolves.toEqual({
      content: {
        blogs: [{ id: 11, title: 'News' }],
        pagination: { nextPageInfo: 'NEXTCURSOR', previousPageInfo: 'PREVCURSOR' },
        raw: { blogs: [{ id: 11, title: 'News' }] },
      },
    })
  })

  it('没有 Link 头时两个 cursor 都是 null(而不是缺席)', async () => {
    mockShopify(200, { pages: [] })
    await expect((await call('list_pages', {})).json()).resolves.toMatchObject({
      content: { pagination: { nextPageInfo: null, previousPageInfo: null } },
    })
  })

  it('page_info 不能与筛选同用:本层就拒,不让 Shopify 回 400', async () => {
    const mock = mockShopify(200, { blogs: [] })
    const res = await call('list_blogs', { page_info: 'CURSOR', handle: 'news' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()

    // limit 与路径上的 blog_id 不算筛选,可以与 cursor 同用。
    vi.unstubAllGlobals()
    const allowed = mockShopify(200, { articles: [] })
    expect((await call('list_articles', { blog_id: 11, page_info: 'CURSOR', limit: 5 })).status).toBe(200)
    const url = new URL(sent(allowed).url)
    expect(url.pathname).toBe('/admin/api/2026-04/blogs/11/articles.json')
    expect(Object.fromEntries(url.searchParams)).toEqual({ page_info: 'CURSOR', limit: '5' })
  })

  it('list_article_tags 的 popular 用 1 表达,且只在为真时发', async () => {
    const on = mockShopify(200, { tags: ['sale', 'news'] })
    const res = await call('list_article_tags', { popular: true, limit: 10 })
    expect(Object.fromEntries(new URL(sent(on).url).searchParams)).toEqual({ popular: '1', limit: '10' })
    await expect(res.json()).resolves.toEqual({ content: { tags: ['sale', 'news'] } })

    vi.unstubAllGlobals()
    const off = mockShopify(200, { tags: [] })
    await call('list_blog_article_tags', { blog_id: 11, popular: false })
    const url = new URL(sent(off).url)
    expect(url.pathname).toBe('/admin/api/2026-04/blogs/11/articles/tags.json')
    expect([...url.searchParams.keys()]).toEqual([])
  })

  it('count 类只发自己认的筛选参数', async () => {
    const mock = mockShopify(200, { count: 7 })
    const res = await call('count_pages', { title: 'About', published_status: 'published' })
    expect(new URL(sent(mock).url).pathname).toBe('/admin/api/2026-04/pages/count.json')
    expect(Object.fromEntries(new URL(sent(mock).url).searchParams))
      .toEqual({ title: 'About', published_status: 'published' })
    await expect(res.json()).resolves.toEqual({ content: { count: 7 } })
  })
})

describe('校验与错误', () => {
  it('schema 里是 optional 的路径 id,必填断言留在本层', async () => {
    const mock = mockShopify(200, {})
    // get_blog 的 blog_id 在上游没有 required 声明,但没有它就拼不出 URL。
    const res = await call('get_blog', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'blog_id 必须是正整数' })
    expect(mock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const article = mockShopify(200, {})
    expect((await call('get_article', { blog_id: 11 })).status).toBe(400)
    expect(article).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:limit 越界 → 400 且不打上游', async () => {
    const mock = mockShopify(200, {})
    const res = await call('list_blogs', { limit: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('errors 的三种形态都能拼出可读消息,状态按公共表归一', async () => {
    mockShopify(401, { errors: '[API] Invalid API key or access token' })
    const unauthorized = await call('get_shop', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Shopify REST 返回 HTTP 401: [API] Invalid API key or access token',
    })

    vi.unstubAllGlobals()
    mockShopify(422, { errors: { title: ['can\'t be blank', 'too short'] } })
    await expect((await call('get_shop', {})).json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Shopify REST 返回 HTTP 422: title: can\'t be blank, too short',
    })

    vi.unstubAllGlobals()
    mockShopify(404, { errors: ['Not Found', 'blog'] })
    const missing = await call('get_blog', { blog_id: 999 })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'Shopify REST 返回 HTTP 404: Not Found; blog',
    })
  })

  it('上游 5xx → unavailable + retryable;限流页回 HTML 也按状态归一', async () => {
    mockShopify(500, { errors: 'Internal server error' })
    await expect((await call('get_shop', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockShopify(429, '<html><body>Too many requests</body></html>')
    const limited = await call('get_shop', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('上游回的形状不符契约 → unavailable 且标 retryable', async () => {
    mockShopify(200, { blogs: 'not-an-array' })
    const res = await call('list_blogs', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockShopify(200, { count: 1.5 })
    await expect((await call('count_blogs', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('2xx 回非 JSON 是上游坏了(而不是调用方的错)', async () => {
    mockShopify(200, '<html>maintenance</html>')
    const res = await call('get_shop', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})
