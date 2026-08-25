import {
  encodeCredentialValues,
} from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createProviderHarness } from '../support/providerHarness'
import { createWordpressPlugin } from '../../src/wordpress/index'
import { wordpressActions } from '../../src/wordpress/schema'

/**
 * WordPress 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * 三字段凭证拼出的 **Basic** 头(不是 Bearer)与 REST base URL、siteUrl 的归一与出站校验、
 * 分页只在 `X-WP-Total` / `X-WP-TotalPages` 响应头上、数组型 query 是逗号串而非重复参数、
 * include ∩ exclude 的本地拒绝、以及 `deleted` 只认 `=== true`。
 */

const CREDENTIALS = {
  apiKey: 'abcd efgh ijkl mnop qrst uvwx',
  siteUrl: 'https://blog.example.com',
  username: 'editor',
}
const plugin = createWordpressPlugin()

const {
  call,
  envelope,
  sent,
  env: ENV,
  stubFetch,
} = createProviderHarness({
  mountPath: 'cms/wordpress',
  plugin,
  upstreamAuth: encodeCredentialValues(CREDENTIALS),
})

function mockWordpress(
  status: number,
  payload: unknown,
  responseHeaders: Record<string, string> = {},
): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    statusText: status === 404 ? 'Not Found' : '',
    headers: { 'content-type': 'application/json', ...responseHeaders },
  })))
}

const POST = { id: 12, slug: 'hello-world', status: 'publish', title: { rendered: 'Hello world' } }

describe('契约面', () => {
  it('List 出全部 18 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(wordpressActions).length)
    expect(tools).toHaveLength(18)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_category',
      'create_page',
      'create_post',
      'create_tag',
      'delete_comment',
      'delete_page',
      'delete_post',
      'get_current_user',
      'get_page',
      'get_post',
      'list_categories',
      'list_comments',
      'list_pages',
      'list_posts',
      'list_tags',
      'update_comment',
      'update_page',
      'update_post',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报成单个 tools/v1 export,带三字段凭证声明与探针工具名', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as {
      exports: Array<{ credentialFields?: Array<{ key: string }>, credentialProbe?: string }>
    }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.credentialFields?.map(field => field.key)).toEqual(['apiKey', 'siteUrl', 'username'])
    expect(body.exports[0]?.credentialProbe).toBe('get_current_user')
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', () => {
    const spec = wordpressActions.get_current_user
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })
})

describe('请求拼装', () => {
  it('三个凭证字段拼出 REST base URL 与 Basic 头(username:应用密码,不是 Bearer)', async () => {
    const mock = mockWordpress(200, { id: 3, name: 'Editor' })
    await call('get_current_user', {})

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin).toBe('https://blog.example.com')
    expect(url.pathname).toBe('/wp-json/wp/v2/users/me')
    expect(url.searchParams.get('context')).toBe('edit')
    expect(request.headers.get('authorization'))
      .toBe(`Basic ${btoa(`${CREDENTIALS.username}:${CREDENTIALS.apiKey}`)}`)
    expect(request.headers.get('authorization')?.startsWith('Bearer')).toBe(false)
    expect(request.headers.get('accept')).toBe('application/json')
    // GET 不带 body,也就不该带 content-type。
    expect(request.headers.get('content-type')).toBeNull()
  })

  it('siteUrl 粘成 REST 根(/wp-json、/wp-json/wp/v2)时摘掉后缀,不双拼', async () => {
    const restRoot = mockWordpress(200, { id: 3, name: 'Editor' })
    await call('get_current_user', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, siteUrl: 'https://blog.example.com/wp-json/' }),
    })
    expect(new URL(sent(restRoot).url).pathname).toBe('/wp-json/wp/v2/users/me')

    vi.unstubAllGlobals()
    const v2Root = mockWordpress(200, { id: 3, name: 'Editor' })
    await call('get_current_user', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, siteUrl: 'https://blog.example.com/WP-JSON/WP/V2' }),
    })
    expect(new URL(sent(v2Root).url).pathname).toBe('/wp-json/wp/v2/users/me')
  })

  it('子目录安装保留路径前缀,query 与 fragment 被剥掉', async () => {
    const mock = mockWordpress(200, { id: 3, name: 'Editor' })
    await call('get_current_user', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, siteUrl: 'https://example.com/blog/?utm=1#x' }),
    })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/blog/wp-json/wp/v2/users/me')
    expect(url.searchParams.get('utm')).toBeNull()
  })

  it('list_posts:数组参数是逗号串(不是重复的同名参数),perPage 走 per_page,search 去空白', async () => {
    const mock = mockWordpress(200, [POST])
    await call('list_posts', {
      search: '  hello  ',
      status: ['publish', 'draft'],
      include: [1, 2],
      categories: [7],
      perPage: 10,
      page: 2,
      order: 'desc',
      orderby: 'title',
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/wp-json/wp/v2/posts')
    expect(url.searchParams.getAll('include')).toEqual(['1,2'])
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search: 'hello',
      status: 'publish,draft',
      include: '1,2',
      categories: '7',
      per_page: '10',
      page: '2',
      order: 'desc',
      orderby: 'title',
    })
  })

  it('未给的可选参数不出现在 query 里(免得把默认值写死成显式值)', async () => {
    const mock = mockWordpress(200, [])
    await call('list_pages', {})
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual([])
  })

  it('list_categories 的 parent 是单个 ID(post/comment 那边才是数组)', async () => {
    const mock = mockWordpress(200, [])
    await call('list_categories', { parent: 3, hideEmpty: true, slug: ['news', 'tech'] })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/wp-json/wp/v2/categories')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      parent: '3',
      hide_empty: 'true',
      slug: 'news,tech',
    })
  })

  it('create_post:POST /posts,入参名转 snake_case,数组以 JSON 数组进 body', async () => {
    const mock = mockWordpress(200, POST)
    await call('create_post', {
      title: 'Hello world',
      content: '<p>hi</p>',
      status: 'draft',
      categories: [3, 4],
      tags: [9],
      featuredMedia: 7,
      meta: { seo_title: 'Hello' },
      excerpt: '   ',
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/wp-json/wp/v2/posts')
    expect(request.headers.get('content-type')).toBe('application/json')
    // excerpt 只有空白 → 上游 optionalString 当没给,整个键不发。
    await expect(request.json()).resolves.toEqual({
      title: 'Hello world',
      content: '<p>hi</p>',
      status: 'draft',
      categories: [3, 4],
      tags: [9],
      featured_media: 7,
      meta: { seo_title: 'Hello' },
    })
  })

  it('update_post 走 POST /posts/{id}(不是 PUT),id 只进路径不进 body', async () => {
    const mock = mockWordpress(200, POST)
    await call('update_post', { id: 12, title: 'Renamed' })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/wp-json/wp/v2/posts/12')
    await expect(request.json()).resolves.toEqual({ title: 'Renamed' })
  })

  it('delete_post:DELETE /posts/{id},force 进 query;不给 force 时整个键不发', async () => {
    const forced = mockWordpress(200, { deleted: true, previous: POST })
    await call('delete_post', { id: 12, force: true })
    const forcedUrl = new URL(sent(forced).url)
    expect(sent(forced).method).toBe('DELETE')
    expect(forcedUrl.pathname).toBe('/wp-json/wp/v2/posts/12')
    expect(forcedUrl.searchParams.get('force')).toBe('true')

    vi.unstubAllGlobals()
    const trashed = mockWordpress(200, { deleted: false })
    await call('delete_post', { id: 12 })
    expect([...new URL(sent(trashed).url).searchParams.keys()]).toEqual([])
  })

  it('update_comment:POST /comments/{id},作者字段转 snake_case', async () => {
    const mock = mockWordpress(200, { id: 5, status: 'approved' })
    await call('update_comment', {
      id: 5,
      content: 'Thanks!',
      status: 'approve',
      authorName: 'Ann',
      authorEmail: 'ann@example.com',
      authorUrl: 'https://ann.example.com',
    })
    expect(new URL(sent(mock).url).pathname).toBe('/wp-json/wp/v2/comments/5')
    await expect(sent(mock).json()).resolves.toEqual({
      content: 'Thanks!',
      status: 'approve',
      author_name: 'Ann',
      author_email: 'ann@example.com',
      author_url: 'https://ann.example.com',
    })
  })
})

describe('响应整形', () => {
  it('分页取自 X-WP-Total / X-WP-TotalPages 响应头(body 里没有这两个数)', async () => {
    mockWordpress(200, [POST], { 'x-wp-total': '57', 'x-wp-totalpages': '6' })
    const res = await call('list_posts', { perPage: 10 })
    await expect(res.json()).resolves.toEqual({
      content: {
        posts: [POST],
        pagination: { total: 57, totalPages: 6 },
      },
    })
  })

  it('分页头缺席或不是整数时给 null(不猜、也不报错)', async () => {
    mockWordpress(200, [], { 'x-wp-total': 'many' })
    await expect((await call('list_comments', {})).json())
      .resolves.toEqual({ content: { comments: [], pagination: { total: null, totalPages: null } } })
  })

  it('delete_post 的 deleted 只认 `=== true`:只移入回收站时报 false', async () => {
    mockWordpress(200, { previous: POST })
    await expect((await call('delete_post', { id: 12 })).json()).resolves.toEqual({
      content: { deleted: false, previous: POST },
    })

    vi.unstubAllGlobals()
    mockWordpress(200, { deleted: true })
    await expect((await call('delete_page', { id: 3 })).json()).resolves.toEqual({
      content: { deleted: true, previous: null },
    })
  })

  it('单资源读取原样透出在单数键下', async () => {
    mockWordpress(200, POST)
    await expect((await call('get_post', { id: 12 })).json()).resolves.toEqual({ content: { post: POST } })
  })

  it('列表响应不是数组 → unavailable + retryable(契约破了)', async () => {
    mockWordpress(200, { posts: [] })
    await expect((await call('list_posts', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('单资源响应不是对象 → unavailable + retryable', async () => {
    mockWordpress(200, [POST])
    await expect((await call('get_post', { id: 12 })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('get_post 的 id 在 schema 里是 optional,但缺了就在本地拒(上游的必填断言)', async () => {
    const mock = mockWordpress(200, POST)
    const res = await call('get_post', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'id must be an integer',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('include 与 exclude 有交集 → invalid_argument 且不打上游(WordPress 会静默回空集合)', async () => {
    const mock = mockWordpress(200, [])
    const res = await call('list_posts', { include: [1, 2], exclude: [2, 3] })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'include and exclude must not contain the same ID.',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:perPage 越界 → 400 且不打上游', async () => {
    const mock = mockWordpress(200, [])
    const res = await call('list_posts', { perPage: 101 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 4xx → invalid_argument(消息取自 message);404 保留成 not_found', async () => {
    mockWordpress(400, { code: 'rest_invalid_param', message: 'Invalid parameter(s): status' })
    const bad = await call('list_posts', {})
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Invalid parameter(s): status',
    })

    vi.unstubAllGlobals()
    // 上游把这条 404 压成 400;这里保留 not_found —— "参数不对"与"这篇 post 不存在"是两件事。
    mockWordpress(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.' })
    const missing = await call('get_post', { id: 999 })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'Invalid post ID.' })
  })

  it('上游 401/403 → permission_denied(不是可重试码)', async () => {
    mockWordpress(401, { code: 'incorrect_password', message: 'The provided password is incorrect.' })
    const res = await call('get_current_user', {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'The provided password is incorrect.',
    })
  })

  it('上游 5xx → unavailable + retryable;拿不到 message 时退回 statusText', async () => {
    mockWordpress(503, {})
    const res = await call('list_posts', {})
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockWordpress(404, 'not json at all')
    await expect((await call('get_page', { id: 1 })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'WordPress request failed: Not Found' })
  })

  it('siteUrl 是 http → invalid_argument 且不打上游(应用密码走 Basic 头,明文即泄露)', async () => {
    const mock = mockWordpress(200, { id: 3, name: 'Editor' })
    const res = await call('get_current_user', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, siteUrl: 'http://blog.example.com' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('https')
    expect(mock).not.toHaveBeenCalled()
  })

  it('siteUrl 指向内网 → invalid_argument,消息说清是出站策略拦的(不回显地址)', async () => {
    const mock = mockWordpress(200, { id: 3, name: 'Editor' })
    const res = await call('get_current_user', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, siteUrl: 'https://10.1.2.3' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('SSRF')
    expect(body.message).toContain('siteUrl')
    expect(body.message).not.toContain('10.1.2.3')
    expect(mock).not.toHaveBeenCalled()
  })

  it('siteUrl 内嵌用户名/密码 → invalid_argument 且不打上游', async () => {
    const mock = mockWordpress(200, { id: 3, name: 'Editor' })
    const res = await call('get_current_user', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, siteUrl: 'https://root:pw@blog.example.com' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('内嵌')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺必填凭证字段 → 400 且点名缺哪个,不裸调上游', async () => {
    const mock = mockWordpress(200, { id: 3, name: 'Editor' })
    const res = await call('get_current_user', {}, {
      auth: encodeCredentialValues({ apiKey: 'x', siteUrl: 'https://blog.example.com' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('username')
    expect(mock).not.toHaveBeenCalled()
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockWordpress(200, {})
    const res = await call('get_current_user', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
