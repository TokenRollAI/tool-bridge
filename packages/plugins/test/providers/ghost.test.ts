import {
  encodeCredentialValues,
} from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createProviderHarness } from '../support/providerHarness'
import { createGhostPlugin } from '../../src/ghost/index'
import { ghostActions } from '../../src/ghost/schema'

/**
 * Ghost(Content API)迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * key 走 URL query(不是请求头)、siteUrl 归一同时是出站边界、路径末尾的斜杠、
 * id/slug 两条路径与二者都缺时的必填断言、单资源读取"取集合第一个 + 空则 null"。
 */

const CREDENTIALS = {
  apiKey: 'ghost_content_key_deadbeef',
  siteUrl: 'https://blog.example.com',
}
const plugin = createGhostPlugin()

const {
  call,
  envelope,
  sent,
  env: ENV,
  stubFetch,
} = createProviderHarness({
  mountPath: 'content/ghost',
  plugin,
  upstreamAuth: encodeCredentialValues(CREDENTIALS),
})

function mockGhost(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return stubFetch(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })))
}

describe('契约面', () => {
  it('List 出全部 9 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(ghostActions).length)
    expect(tools).toHaveLength(9)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'get_author',
      'get_page',
      'get_post',
      'get_tag',
      'list_authors',
      'list_pages',
      'list_posts',
      'list_tags',
      'read_settings',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报成单个 tools/v1 export,带两字段凭证声明与探针工具名', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as {
      exports: Array<{ credentialFields?: Array<{ key: string }>, credentialProbe?: string }>
    }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.credentialFields?.map(field => field.key)).toEqual(['apiKey', 'siteUrl'])
    expect(body.exports[0]?.credentialProbe).toBe('read_settings')
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', () => {
    const spec = ghostActions.read_settings
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })
})

describe('请求拼装', () => {
  it('list_posts:key 走 URL query(Content API 不认请求头),路径末尾带斜杠', async () => {
    const mock = mockGhost(200, { posts: [], meta: { pagination: { page: 1 } } })
    await call('list_posts', {
      limit: 15,
      page: 2,
      include: 'authors,tags',
      fields: 'id,title',
      formats: 'html,plaintext',
      filter: 'tag:news',
      order: 'published_at desc',
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin).toBe('https://blog.example.com')
    // 末尾斜杠不能少:Ghost 对 /posts 会回 301。
    expect(url.pathname).toBe('/ghost/api/content/v5.0/posts/')
    expect(request.headers.get('accept')).toBe('application/json')
    expect(await request.text()).toBe('')
    // 凭证在 query 上,不在头上 —— 这是 Ghost Content API 的设计(日志要脱敏)。
    expect(request.headers.get('authorization')).toBeNull()
    expect(Object.fromEntries(url.searchParams)).toEqual({
      key: CREDENTIALS.apiKey,
      limit: '15',
      page: '2',
      include: 'authors,tags',
      fields: 'id,title',
      formats: 'html,plaintext',
      filter: 'tag:news',
      order: 'published_at desc',
    })
  })

  it('未给的可选参数不出现在 query 里(只剩 key)', async () => {
    const mock = mockGhost(200, { posts: [] })
    await call('list_posts', {})
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual(['key'])
  })

  it('纯空白的字符串参数被丢掉(它能过 Zod 的 min(1),发上去只是噪声)', async () => {
    const mock = mockGhost(200, { posts: [] })
    await call('list_posts', { filter: '   ', order: ' published_at desc ' })
    const params = new URL(sent(mock).url).searchParams
    expect(params.has('filter')).toBe(false)
    expect(params.get('order')).toBe('published_at desc')
  })

  it('四个集合各打自己的端点', async () => {
    for (const [action, path] of [
      ['list_pages', '/ghost/api/content/v5.0/pages/'],
      ['list_tags', '/ghost/api/content/v5.0/tags/'],
      ['list_authors', '/ghost/api/content/v5.0/authors/'],
    ] as const) {
      const mock = mockGhost(200, {})
      await call(action, {})
      expect(new URL(sent(mock).url).pathname).toBe(path)
      vi.unstubAllGlobals()
    }
  })

  it('read_settings 打 /settings/,零入参', async () => {
    const mock = mockGhost(200, { settings: { title: 'Blog' } })
    await call('read_settings', {})
    expect(new URL(sent(mock).url).pathname).toBe('/ghost/api/content/v5.0/settings/')
  })

  it('get_post:id 走 /posts/<id>/,slug 走 /posts/slug/<slug>/,id 优先', async () => {
    const byId = mockGhost(200, { posts: [{ id: 'p1' }] })
    await call('get_post', { id: 'p1', include: 'tags' })
    const idUrl = new URL(sent(byId).url)
    expect(idUrl.pathname).toBe('/ghost/api/content/v5.0/posts/p1/')
    expect(idUrl.searchParams.get('include')).toBe('tags')

    vi.unstubAllGlobals()
    const bySlug = mockGhost(200, { posts: [{ slug: 'hello' }] })
    await call('get_post', { slug: 'hello' })
    expect(new URL(sent(bySlug).url).pathname).toBe('/ghost/api/content/v5.0/posts/slug/hello/')

    vi.unstubAllGlobals()
    const both = mockGhost(200, { posts: [{ id: 'p1' }] })
    await call('get_post', { id: 'p1', slug: 'hello' })
    expect(new URL(sent(both).url).pathname).toBe('/ghost/api/content/v5.0/posts/p1/')
  })

  it('id / slug 进路径要 URL 编码', async () => {
    const mock = mockGhost(200, { posts: [] })
    await call('get_post', { slug: 'a/b c' })
    expect(new URL(sent(mock).url).pathname).toBe('/ghost/api/content/v5.0/posts/slug/a%2Fb%20c/')
  })

  it('单资源读取不认 browse 独有的参数', async () => {
    const mock = mockGhost(200, {})
    const res = await call('get_post', { id: 'p1', filter: 'tag:news' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('siteUrl 归一(它同时是出站边界)', () => {
  it('末尾斜杠、query 与 fragment 都被剥掉,不双拼', async () => {
    const mock = mockGhost(200, { posts: [] })
    await call('list_posts', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, siteUrl: 'https://blog.example.com/?a=1#frag' }),
    })
    expect(new URL(sent(mock).url).pathname).toBe('/ghost/api/content/v5.0/posts/')
  })

  it('带子路径的站点地址保留那段路径', async () => {
    const mock = mockGhost(200, { posts: [] })
    await call('list_posts', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, siteUrl: 'https://corp.example.com/blog/' }),
    })
    expect(new URL(sent(mock).url).pathname).toBe('/blog/ghost/api/content/v5.0/posts/')
  })

  it('内网地址被拦下,且消息说清是凭证里的 siteUrl 触发的(不回显那个值)', async () => {
    const mock = mockGhost(200, {})
    const res = await call('list_posts', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, siteUrl: 'http://169.254.169.254/' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('siteUrl')
    expect(body.message).toContain('SSRF')
    expect(body.message).not.toContain('169.254.169.254')
    expect(mock).not.toHaveBeenCalled()
  })

  it('siteUrl 内嵌凭证 → invalid_argument 且不打上游', async () => {
    const mock = mockGhost(200, {})
    const res = await call('list_posts', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, siteUrl: 'https://user:pw@blog.example.com' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('siteUrl')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺 apiKey → 400 且点名缺哪个,不裸调上游', async () => {
    const mock = mockGhost(200, {})
    const res = await call('list_posts', {}, {
      auth: encodeCredentialValues({ siteUrl: CREDENTIALS.siteUrl }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('apiKey')
    expect(mock).not.toHaveBeenCalled()
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockGhost(200, {})
    const res = await call('list_posts', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('响应整形', () => {
  it('browse 出参是 {<集合>, meta};集合缺失给 [],meta 缺失给 null', async () => {
    mockGhost(200, { posts: [{ id: 'p1', title: 'A' }], meta: { pagination: { page: 1, pages: 3 } } })
    await expect((await call('list_posts', {})).json()).resolves.toEqual({
      content: { posts: [{ id: 'p1', title: 'A' }], meta: { pagination: { page: 1, pages: 3 } } },
    })

    vi.unstubAllGlobals()
    mockGhost(200, {})
    await expect((await call('list_tags', {})).json()).resolves.toEqual({
      content: { tags: [], meta: null },
    })
  })

  it('单资源读取取集合的第一个,空集合归一成 null(而不是报 not_found)', async () => {
    mockGhost(200, { posts: [{ id: 'p1' }, { id: 'p2' }] })
    await expect((await call('get_post', { id: 'p1' })).json())
      .resolves.toEqual({ content: { post: { id: 'p1' } } })

    vi.unstubAllGlobals()
    mockGhost(200, { posts: [] })
    await expect((await call('get_post', { id: 'nope' })).json())
      .resolves.toEqual({ content: { post: null } })
  })

  it('出参键是单数:tags → tag、authors → author、pages → page', async () => {
    mockGhost(200, { tags: [{ id: 't1' }] })
    await expect((await call('get_tag', { slug: 'news' })).json())
      .resolves.toEqual({ content: { tag: { id: 't1' } } })

    vi.unstubAllGlobals()
    mockGhost(200, { authors: [{ id: 'a1' }] })
    await expect((await call('get_author', { slug: 'jdoe' })).json())
      .resolves.toEqual({ content: { author: { id: 'a1' } } })

    vi.unstubAllGlobals()
    mockGhost(200, { pages: [{ id: 'g1' }] })
    await expect((await call('get_page', { slug: 'about' })).json())
      .resolves.toEqual({ content: { page: { id: 'g1' } } })
  })

  it('read_settings 的 settings 缺失时给 null', async () => {
    mockGhost(200, {})
    await expect((await call('read_settings', {})).json()).resolves.toEqual({ content: { settings: null } })
  })
})

describe('校验与错误', () => {
  it('id 与 slug 都没给 → invalid_argument 且不打上游(生成的 schema 里两者都 optional)', async () => {
    const mock = mockGhost(200, {})
    const res = await call('get_post', { include: 'tags' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'id or slug is required',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:limit 越界 → 400 且不打上游', async () => {
    const mock = mockGhost(200, {})
    const res = await call('list_posts', { limit: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('错误文案取 errors[0].message,401 归 permission_denied(上游把它压成 400,这里不跟)', async () => {
    mockGhost(401, { errors: [{ message: 'Unknown Content API Key' }] })
    const res = await call('list_posts', {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unknown Content API Key',
    })
  })

  it('404 保留成 not_found(上游把单资源读取的 404 压成 400,这里不跟)', async () => {
    mockGhost(404, { errors: [{ message: 'Resource not found' }] })
    const res = await call('get_post', { slug: 'nope' })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'not_found', message: 'Resource not found' })
  })

  it('429 → rate_limited + retryable;5xx → unavailable + retryable', async () => {
    mockGhost(429, { errors: [{ message: 'Too many requests' }] })
    await expect((await call('list_posts', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockGhost(503, { errors: [{ message: 'Ghost is down' }] })
    await expect((await call('list_posts', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'Ghost is down' })
  })

  it('错误体不是 JSON 时(CDN 的 HTML 错误页),原文进 message 并按状态归一', async () => {
    mockGhost(502, '<html>Bad Gateway</html>')
    await expect((await call('list_posts', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: '<html>Bad Gateway</html>' })
  })

  it('2xx 上回非 JSON → unavailable + retryable(上游坏了,不是调用方的错)', async () => {
    mockGhost(200, 'not json at all')
    await expect((await call('list_posts', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('空响应体当空对象(Ghost 偶尔回 204),不报解析失败', async () => {
    const fn = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    vi.stubGlobal('fetch', fn)
    await expect((await call('list_posts', {})).json())
      .resolves.toEqual({ content: { posts: [], meta: null } })
  })
})
