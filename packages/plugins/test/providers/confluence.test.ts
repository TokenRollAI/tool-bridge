import {
  encodeCredentialValues,
} from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createConfluencePlugin } from '../../src/confluence/index'
import { createProviderHarness } from '../support/providerHarness'
import { confluenceActions } from '../../src/confluence/schema'

/**
 * Confluence 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * 三字段凭证拼出的 Basic 头与 base URL、siteUrl 的三条校验、
 * 分页 cursor 从 `_links.next` 的 query 里抠出来、以及 update_page 不发空正文。
 */

const CREDENTIALS = {
  apiKey: 'ATATT-token',
  email: 'agent@example.com',
  siteUrl: 'https://acme.atlassian.net',
}
const plugin = createConfluencePlugin()

const {
  call,
  envelope,
  sent,
  env: ENV,
  stubFetch,
} = createProviderHarness({
  mountPath: 'docs/confluence',
  plugin,
  upstreamAuth: encodeCredentialValues(CREDENTIALS),
})

function mockConfluence(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return stubFetch(() => Promise.resolve(new Response(body, {
    status,
    statusText: status === 404 ? 'Not Found' : '',
    headers: { 'content-type': 'application/json' },
  })))
}

describe('契约面', () => {
  it('List 出全部 5 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(confluenceActions).length)
    expect(tools).toHaveLength(5)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_page',
      'get_page',
      'list_spaces',
      'search_content',
      'update_page',
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
    expect(body.exports[0]?.credentialFields?.map(field => field.key)).toEqual(['apiKey', 'email', 'siteUrl'])
    expect(body.exports[0]?.credentialProbe).toBe('list_spaces')
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', () => {
    const spec = confluenceActions.list_spaces
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })
})

describe('请求拼装', () => {
  it('三个凭证字段拼出 base URL 与 Basic 头(email:apiKey,不是 Bearer)', async () => {
    const mock = mockConfluence(200, { results: [] })
    await call('list_spaces', {})

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin).toBe('https://acme.atlassian.net')
    expect(url.pathname).toBe('/wiki/api/v2/spaces')
    expect(request.headers.get('authorization'))
      .toBe(`Basic ${btoa(`${CREDENTIALS.email}:${CREDENTIALS.apiKey}`)}`)
    expect(request.headers.get('accept')).toBe('application/json')
    // GET 不带 body,也就不该带 content-type。
    expect(request.headers.get('content-type')).toBeNull()
  })

  it('limit 缺省补 25(上游显式补的默认值,不是服务端默认)', async () => {
    const mock = mockConfluence(200, { results: [] })
    await call('list_spaces', {})
    expect(new URL(sent(mock).url).searchParams.get('limit')).toBe('25')

    vi.unstubAllGlobals()
    const explicit = mockConfluence(200, { results: [] })
    await call('search_content', { cql: 'type=page', limit: 5 })
    expect(new URL(sent(explicit).url).searchParams.get('limit')).toBe('5')
  })

  it('search_content 打 /search,cql 与 cursor 进 query', async () => {
    const mock = mockConfluence(200, { results: [] })
    await call('search_content', { cql: 'space=DEV and type=page', cursor: 'c1' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/wiki/api/v2/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      cql: 'space=DEV and type=page',
      limit: '25',
      cursor: 'c1',
    })
  })

  it('get_page 的 pageId 进路径并做 URL 编码,bodyFormat 走 body-format 这个键', async () => {
    const mock = mockConfluence(200, { id: '1' })
    await call('get_page', { pageId: 'a/b', bodyFormat: 'storage' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/wiki/api/v2/pages/a%2Fb')
    expect(url.searchParams.get('body-format')).toBe('storage')
  })

  it('create_page:POST /pages,正文包成 {representation, value},status 缺省 current', async () => {
    const mock = mockConfluence(200, { id: '99' })
    await call('create_page', { spaceId: 's1', title: 'Hello', body: '<p>hi</p>' })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/wiki/api/v2/pages')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      spaceId: 's1',
      status: 'current',
      title: 'Hello',
      body: { representation: 'storage', value: '<p>hi</p>' },
    })
  })

  it('update_page:PUT /pages/{id},body 里再带一次 id,version 拼成对象', async () => {
    const mock = mockConfluence(200, { id: '99' })
    await call('update_page', {
      pageId: '99',
      title: 'Updated',
      versionNumber: 4,
      versionMessage: 'tweak',
      minorEdit: true,
      body: '<p>new</p>',
      bodyRepresentation: 'atlas_doc_format',
    })

    const request = sent(mock)
    expect(request.method).toBe('PUT')
    expect(new URL(request.url).pathname).toBe('/wiki/api/v2/pages/99')
    await expect(request.json()).resolves.toEqual({
      id: '99',
      status: 'current',
      title: 'Updated',
      body: { representation: 'atlas_doc_format', value: '<p>new</p>' },
      version: { number: 4, message: 'tweak', minorEdit: true },
    })
  })

  it('update_page 不给正文时整块省略 body —— 发空 value 会把页面内容清空', async () => {
    const mock = mockConfluence(200, { id: '99' })
    await call('update_page', { pageId: '99', title: 'Title only', versionNumber: 2 })
    await expect(sent(mock).json()).resolves.toEqual({
      id: '99',
      status: 'current',
      title: 'Title only',
      version: { number: 2 },
    })
  })
})

describe('响应整形', () => {
  it('list_spaces 裁剪出命名字段并保留 raw,homepage.id 兜底到 homepageId', async () => {
    mockConfluence(200, {
      results: [
        { id: '1', key: 'DEV', name: 'Dev', type: 'global', status: 'current', homepage: { id: 'h1' }, extra: 1 },
      ],
      _links: {},
    })
    const res = await call('list_spaces', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        spaces: [{
          id: '1',
          key: 'DEV',
          name: 'Dev',
          type: 'global',
          status: 'current',
          homepageId: 'h1',
          raw: { id: '1', key: 'DEV', name: 'Dev', type: 'global', status: 'current', homepage: { id: 'h1' }, extra: 1 },
        }],
        pagination: { nextCursor: null },
      },
    })
  })

  it('分页 cursor 从 _links.next 的 query 里抠出来,不是把整个链接透出去', async () => {
    mockConfluence(200, {
      results: [],
      _links: { next: '/wiki/api/v2/spaces?cursor=eyJpZCI6MX0&limit=25' },
    })
    const res = await call('list_spaces', {})
    await expect(res.json()).resolves.toMatchObject({
      content: { pagination: { nextCursor: 'eyJpZCI6MX0' } },
    })
  })

  it('_links.next 存在但没有 cursor 参数时给 null(不硬塞一个假游标)', async () => {
    mockConfluence(200, { results: [], _links: { next: '/wiki/api/v2/spaces?limit=25' } })
    await expect((await call('list_spaces', {})).json())
      .resolves.toMatchObject({ content: { pagination: { nextCursor: null } } })
  })

  it('search_content 的 id/type/title 在顶层缺席时回退到 content 下', async () => {
    mockConfluence(200, {
      results: [{
        content: { id: 'c1', type: 'page', title: 'From content' },
        excerpt: 'snippet',
        webUrl: 'https://acme.atlassian.net/wiki/x',
        resultGlobalContainer: { title: 'DEV space' },
      }],
    })
    const res = await call('search_content', { cql: 'type=page' })
    await expect(res.json()).resolves.toMatchObject({
      content: {
        results: [{
          id: 'c1',
          type: 'page',
          title: 'From content',
          url: 'https://acme.atlassian.net/wiki/x',
          excerpt: 'snippet',
          containerTitle: 'DEV space',
        }],
      },
    })
  })

  it('get_page 的 version 缺席时给 null,parentId 缺席时也给 null', async () => {
    mockConfluence(200, { id: '99', title: 'Page', spaceId: 's1' })
    await expect((await call('get_page', { pageId: '99' })).json()).resolves.toMatchObject({
      content: { page: { id: '99', title: 'Page', spaceId: 's1', parentId: null, version: null, body: null } },
    })
  })

  it('搜索响应不是对象 → unavailable + retryable(契约破了)', async () => {
    mockConfluence(200, [1, 2, 3])
    await expect((await call('search_content', { cql: 'type=page' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('凭证与错误', () => {
  it('siteUrl 不是 atlassian.net 站点 → invalid_argument 且不打上游', async () => {
    const mock = mockConfluence(200, { results: [] })
    const res = await call('list_spaces', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, siteUrl: 'https://confluence.evil.test' }),
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Confluence siteUrl must be an atlassian.net Cloud site',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('siteUrl 是 http → invalid_argument;缺协议时补 https 后放行', async () => {
    const rejected = mockConfluence(200, { results: [] })
    const res = await call('list_spaces', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, siteUrl: 'http://acme.atlassian.net' }),
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ message: 'Confluence siteUrl must use https' })
    expect(rejected).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const accepted = mockConfluence(200, { results: [] })
    await call('list_spaces', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, siteUrl: 'acme.atlassian.net' }),
    })
    expect(new URL(sent(accepted).url).origin).toBe('https://acme.atlassian.net')
  })

  it('缺必填凭证字段 → 400 且点名缺哪个,不裸调上游', async () => {
    const mock = mockConfluence(200, { results: [] })
    const res = await call('list_spaces', {}, {
      auth: encodeCredentialValues({ apiKey: 'x', email: 'a@b.test' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('siteUrl')
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:cql 为空串 → 400 且不打上游', async () => {
    const mock = mockConfluence(200, {})
    const res = await call('search_content', { cql: '' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 4xx → invalid_argument;404 保留成 not_found', async () => {
    mockConfluence(400, { message: 'Invalid CQL' })
    const bad = await call('search_content', { cql: 'nope' })
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'Invalid CQL' })

    vi.unstubAllGlobals()
    mockConfluence(404, { errors: [{ message: 'Page not found' }] })
    const missing = await call('get_page', { pageId: 'x' })
    expect(missing.status).toBe(404)
    // 消息可以落在 errors[].message 上,而不只是顶层 message。
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'Page not found' })
  })

  it('上游 5xx → unavailable + retryable', async () => {
    mockConfluence(503, { message: 'Confluence is down' })
    await expect((await call('list_spaces', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'Confluence is down' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockConfluence(200, {})
    const res = await call('list_spaces', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
