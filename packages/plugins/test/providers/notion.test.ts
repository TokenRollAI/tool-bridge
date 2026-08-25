import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createNotionPlugin } from '../../src/notion/index'
import { notionActions } from '../../src/notion/schema'

/**
 * Notion 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * `Notion-Version` 头必带且钉死版本、`create_page` 三条互斥入参路径的冲突文案、
 * `get_page` 的两跳聚合、`append_block` 的 paragraph 包装、`update_block` 的 looseObject 透传、
 * `filter_properties[]` 的重复同名参数、空响应体归一成 `{}`、以及 id 进路径的编码。
 */

const API_KEY = 'secret_notion_deadbeef'
const API_BASE = 'https://api.notion.com/v1'
const NOTION_VERSION = '2026-03-11'
const PAGE_ID = '11111111-2222-3333-4444-555555555555'
const plugin = createNotionPlugin()

const {
  call,
  envelope,
  sent,
  env: ENV,
  stubFetch,
} = createProviderHarness({
  mountPath: 'docs/notion',
  plugin,
  upstreamAuth: API_KEY,
})

function mockNotion(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return stubFetch(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })))
}

/** 空体响应:`new Response('', {status:204})` 在 undici 下会 TypeError,必须传 null。 */
function mockEmpty(status: number): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(new Response(null, { status })))
}

/** 按请求路径分派(get_page 会并发打两跳)。 */
function mockByPath(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
  return stubFetch((request: Request) => {
    const path = new URL(request.url).pathname
    const payload = routes[path]
    if (payload === undefined) {
      return Promise.resolve(new Response(JSON.stringify({ message: `unexpected ${path}` }), { status: 404 }))
    }
    return Promise.resolve(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
  })
}

describe('契约面', () => {
  it('List 出全部 25 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(notionActions).length)
    expect(tools).toHaveLength(25)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'append_block',
      'append_block_children',
      'create_data_source',
      'create_database',
      'create_page',
      'delete_block',
      'get_page',
      'list_block_children',
      'list_data_source_templates',
      'list_users',
      'move_page',
      'query_data_source',
      'retrieve_block',
      'retrieve_data_source',
      'retrieve_database',
      'retrieve_page',
      'retrieve_page_markdown',
      'retrieve_page_property',
      'retrieve_user',
      'search',
      'update_block',
      'update_data_source',
      'update_database',
      'update_page',
      'update_page_markdown',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报单个 tools/v1 export,且**不**声明 credentialProbe(见 index.ts 的理由)', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as { exports: Array<{ credentialProbe?: string, profile: string }> }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.profile).toBe('tools/v1')
    expect(body.exports[0]?.credentialProbe).toBeUndefined()
  })

  it('delete_block 的 effect 是 destructive(平台按它做二次确认)', () => {
    expect(notionActions.delete_block.effect).toBe('destructive')
  })
})

describe('请求拼装', () => {
  it('每个请求都带 Notion-Version 头(缺它 Notion 一律 400),token 走 Bearer', async () => {
    const mock = mockNotion(200, { object: 'page', id: PAGE_ID })
    await call('retrieve_page', { pageId: PAGE_ID })
    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe(`${API_BASE}/pages/${PAGE_ID}`)
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('notion-version')).toBe(NOTION_VERSION)
    // GET 不带 content-type,也没有请求体。
    expect(request.headers.get('content-type')).toBeNull()
    expect(await request.text()).toBe('')
  })

  it('id 进路径要编码 —— 含斜杠的 id 不能把请求拐到别的端点(上游是裸拼接)', async () => {
    const mock = mockNotion(200, {})
    await call('retrieve_page', { pageId: '../users/me' })
    expect(new URL(sent(mock).url).pathname).toBe('/v1/pages/..%2Fusers%2Fme')
  })

  it('search:POST /search,query 恒发,可选项按 snake_case 进 body', async () => {
    const mock = mockNotion(200, { object: 'list', results: [], has_more: false })
    await call('search', {
      query: 'roadmap',
      filter: { value: 'page', property: 'object' },
      sort: { direction: 'ascending', timestamp: 'last_edited_time' },
      pageSize: 25,
      startCursor: 'cur1',
    })
    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe(`${API_BASE}/search`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      query: 'roadmap',
      filter: { value: 'page', property: 'object' },
      sort: { direction: 'ascending', timestamp: 'last_edited_time' },
      page_size: 25,
      start_cursor: 'cur1',
    })
  })

  it('search 的空 query 也发(在 Notion 侧就是"列出全部可见对象")', async () => {
    const mock = mockNotion(200, { object: 'list', results: [], has_more: false })
    await call('search', { query: '' })
    await expect(sent(mock).json()).resolves.toEqual({ query: '' })
  })

  it('分页参数在 list 类 action 上统一发成 page_size / start_cursor', async () => {
    const mock = mockNotion(200, { object: 'list', results: [] })
    await call('list_block_children', { blockId: PAGE_ID, pageSize: 10, startCursor: 'cur2' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe(`/v1/blocks/${PAGE_ID}/children`)
    expect(Object.fromEntries(url.searchParams)).toEqual({ page_size: '10', start_cursor: 'cur2' })
  })

  it('retrieve_page_markdown 的布尔参数发成字符串,未给时不发', async () => {
    const on = mockNotion(200, { markdown: '# Title' })
    await call('retrieve_page_markdown', { pageId: PAGE_ID, includeTranscript: false })
    expect(new URL(sent(on).url).searchParams.get('include_transcript')).toBe('false')

    vi.unstubAllGlobals()
    const off = mockNotion(200, { markdown: '# Title' })
    await call('retrieve_page_markdown', { pageId: PAGE_ID })
    expect([...new URL(sent(off).url).searchParams.keys()]).toEqual([])
  })

  it('query_data_source 的 filter_properties[] 是重复的同名参数;空数组不发', async () => {
    const mock = mockNotion(200, { object: 'list', results: [] })
    await call('query_data_source', {
      dataSourceId: 'ds1',
      filterProperties: ['propA', 'propB'],
      filter: { property: 'Status', status: { equals: 'Done' } },
      sorts: [{ property: 'Name', direction: 'ascending' }],
      pageSize: 5,
      in_trash: false,
      result_type: 'page',
    })
    const request = sent(mock)
    expect(new URL(request.url).pathname).toBe('/v1/data_sources/ds1/query')
    expect(new URL(request.url).searchParams.getAll('filter_properties[]')).toEqual(['propA', 'propB'])
    await expect(request.json()).resolves.toEqual({
      filter: { property: 'Status', status: { equals: 'Done' } },
      sorts: [{ property: 'Name', direction: 'ascending' }],
      page_size: 5,
      in_trash: false,
      result_type: 'page',
    })

    vi.unstubAllGlobals()
    const empty = mockNotion(200, { object: 'list', results: [] })
    await call('query_data_source', { dataSourceId: 'ds1', filterProperties: [] })
    expect([...new URL(sent(empty).url).searchParams.keys()]).toEqual([])
  })

  it('update_block 的入参是 looseObject:除 blockId 外的字段原样进 body', async () => {
    const mock = mockNotion(200, { object: 'block', id: 'b1' })
    await call('update_block', {
      blockId: 'b1',
      paragraph: { rich_text: [{ type: 'text', text: { content: 'edited' } }] },
      in_trash: false,
      brand_new_field: { nested: true },
    })
    const request = sent(mock)
    expect(request.method).toBe('PATCH')
    expect(new URL(request.url).pathname).toBe('/v1/blocks/b1')
    await expect(request.json()).resolves.toEqual({
      paragraph: { rich_text: [{ type: 'text', text: { content: 'edited' } }] },
      in_trash: false,
      brand_new_field: { nested: true },
    })
  })

  it('append_block 把纯文本包成 paragraph 块,打的是 children 端点', async () => {
    const mock = mockNotion(200, { object: 'list', results: [] })
    await call('append_block', { pageId: PAGE_ID, text: 'hello world' })
    const request = sent(mock)
    expect(request.method).toBe('PATCH')
    expect(new URL(request.url).pathname).toBe(`/v1/blocks/${PAGE_ID}/children`)
    await expect(request.json()).resolves.toEqual({
      children: [{
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: 'hello world' } }] },
      }],
    })
  })

  it('update_page:给了 title 就并进 properties(与 create_page 不同,这里不冲突)', async () => {
    const mock = mockNotion(200, { object: 'page', id: PAGE_ID })
    await call('update_page', {
      pageId: PAGE_ID,
      title: 'New title',
      properties: { Status: { status: { name: 'Done' } } },
      in_trash: false,
    })
    await expect(sent(mock).json()).resolves.toEqual({
      properties: {
        Status: { status: { name: 'Done' } },
        title: { title: [{ type: 'text', text: { content: 'New title' } }] },
      },
      in_trash: false,
    })
  })

  it('move_page:POST /pages/<id>/move,body 只有 parent', async () => {
    const mock = mockNotion(200, { object: 'page', id: PAGE_ID })
    await call('move_page', { pageId: PAGE_ID, parent: { data_source_id: 'ds1' } })
    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe(`/v1/pages/${PAGE_ID}/move`)
    await expect(request.json()).resolves.toEqual({ parent: { data_source_id: 'ds1' } })
  })

  it('move_page 的 parent 三分支都收(page / data_source / workspace),别的形状拒', async () => {
    for (const parent of [{ page_id: 'p1' }, { data_source_id: 'ds1' }, { workspace: true }]) {
      const mock = mockNotion(200, { object: 'page' })
      const res = await call('move_page', { pageId: PAGE_ID, parent })
      expect(res.status, JSON.stringify(parent)).toBe(200)
      await expect(sent(mock).json()).resolves.toEqual({ parent })
      vi.unstubAllGlobals()
    }

    const rejected = mockNotion(200, {})
    // database_id 不是这三个分支之一(Notion 新 API 用 data_source_id)。
    const res = await call('move_page', { pageId: PAGE_ID, parent: { database_id: 'db1' } })
    expect(res.status).toBe(400)
    expect(rejected).not.toHaveBeenCalled()
  })

  it('delete_block:DELETE /blocks/<id>,无请求体', async () => {
    const mock = mockNotion(200, { object: 'block', id: 'b1', archived: true })
    await call('delete_block', { blockId: 'b1' })
    const request = sent(mock)
    expect(request.method).toBe('DELETE')
    expect(request.headers.get('content-type')).toBeNull()
  })

  it('create_database / create_data_source 的数组字段只在是数组时发', async () => {
    const mock = mockNotion(200, { object: 'database', id: 'db1' })
    await call('create_database', {
      parent: { type: 'page_id', page_id: PAGE_ID },
      title: [{ type: 'text', text: { content: 'Tasks' } }],
      is_inline: true,
      initial_data_source: { properties: { Name: { title: {} } } },
    })
    await expect(sent(mock).json()).resolves.toEqual({
      parent: { type: 'page_id', page_id: PAGE_ID },
      title: [{ type: 'text', text: { content: 'Tasks' } }],
      is_inline: true,
      initial_data_source: { properties: { Name: { title: {} } } },
    })
  })
})

describe('create_page 的三条互斥入参路径', () => {
  it('官方 parent 对象:parent + properties 原样发', async () => {
    const mock = mockNotion(200, { object: 'page', id: PAGE_ID })
    await call('create_page', {
      parent: { data_source_id: 'ds1' },
      properties: { Name: { title: [{ type: 'text', text: { content: 'Row' } }] } },
      children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }],
      icon: { emoji: '🚀' },
    })
    const request = sent(mock)
    expect(request.url).toBe(`${API_BASE}/pages`)
    await expect(request.json()).resolves.toEqual({
      parent: { data_source_id: 'ds1' },
      properties: { Name: { title: [{ type: 'text', text: { content: 'Row' } }] } },
      children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }],
      icon: { emoji: '🚀' },
    })
  })

  it('简化写法:parentId + title → parent {page_id} 与 title property', async () => {
    const mock = mockNotion(200, { object: 'page', id: PAGE_ID })
    await call('create_page', { parentId: PAGE_ID, title: 'Meeting notes' })
    await expect(sent(mock).json()).resolves.toEqual({
      parent: { page_id: PAGE_ID },
      properties: { title: { title: [{ type: 'text', text: { content: 'Meeting notes' } }] } },
    })
  })

  it('纯 markdown:什么父级都不给也成立', async () => {
    const mock = mockNotion(200, { object: 'page', id: PAGE_ID })
    await call('create_page', { markdown: '# Hello' })
    await expect(sent(mock).json()).resolves.toEqual({ markdown: '# Hello' })
  })

  it('markdown 与 children 同用 → invalid_argument 且不打上游', async () => {
    const mock = mockNotion(200, {})
    const res = await call('create_page', {
      parentId: PAGE_ID,
      title: 'x',
      markdown: '# Hello',
      children: [{ object: 'block' }],
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'markdown cannot be used with children',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('parent 与 title 同用 → 让调用方改用 properties', async () => {
    const mock = mockNotion(200, {})
    const res = await call('create_page', { parent: { page_id: PAGE_ID }, title: 'x' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      message: 'title cannot be used with parent; use properties instead',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('parent 与 parentId 指向不同页面 → 拒;指向同一页面 → 放行', async () => {
    const mock = mockNotion(200, {})
    const res = await call('create_page', { parent: { page_id: 'other' }, parentId: PAGE_ID })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      message: 'parent and parentId must describe the same page parent',
    })
    expect(mock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const same = mockNotion(200, { object: 'page' })
    expect((await call('create_page', { parent: { page_id: PAGE_ID }, parentId: PAGE_ID })).status).toBe(200)
    await expect(sent(same).json()).resolves.toEqual({ parent: { page_id: PAGE_ID } })
  })

  it('三条路径一条都不成立 → 报清楚要什么', async () => {
    const mock = mockNotion(200, {})
    const res = await call('create_page', { properties: { Name: {} } })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      message: 'parent, parentId + title, or markdown is required',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('给了 parentId 却没 title → 拒(简化写法必须成对)', async () => {
    const mock = mockNotion(200, {})
    const res = await call('create_page', { parentId: PAGE_ID })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ message: 'title is required with parentId' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('parent 的三分支之外的形状被 schema 拒(手写的联合是 strictObject)', async () => {
    const mock = mockNotion(200, {})
    expect((await call('create_page', { parent: { page_id: 'p1', data_source_id: 'ds1' } })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('响应整形', () => {
  it('get_page 打两跳并发,合成 {page, block_children}', async () => {
    const mock = mockByPath({
      [`/v1/pages/${PAGE_ID}`]: { object: 'page', id: PAGE_ID, properties: {} },
      [`/v1/blocks/${PAGE_ID}/children`]: { object: 'list', results: [{ id: 'b1' }], has_more: false },
    })
    const res = await call('get_page', { pageId: PAGE_ID })
    expect(mock).toHaveBeenCalledTimes(2)
    await expect(res.json()).resolves.toEqual({
      content: {
        page: { object: 'page', id: PAGE_ID, properties: {} },
        block_children: { object: 'list', results: [{ id: 'b1' }], has_more: false },
      },
    })
  })

  it('出参是 Notion 的原始对象,不裁剪(对象形状随 property 类型变化)', async () => {
    const payload = {
      object: 'page',
      id: PAGE_ID,
      created_time: '2026-01-01T00:00:00.000Z',
      properties: { Custom: { rollup: { type: 'number', number: 3 } } },
      unknown_future_field: ['kept'],
    }
    mockNotion(200, payload)
    await expect((await call('retrieve_page', { pageId: PAGE_ID })).json())
      .resolves.toEqual({ content: payload })
  })

  it('空响应体归一成 {}(DELETE 之类的端点可能什么都不回)', async () => {
    mockEmpty(200)
    await expect((await call('delete_block', { blockId: 'b1' })).json())
      .resolves.toEqual({ content: {} })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:pageSize 越界 / 缺必填 id → 400 且不打上游', async () => {
    const mock = mockNotion(200, {})
    expect((await call('list_users', { pageSize: 500 })).status).toBe(400)
    expect((await call('retrieve_page', {})).status).toBe(400)
    expect((await call('retrieve_page', { pageId: '' })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('validation_error(400)归 invalid_argument,消息取自 message', async () => {
    mockNotion(400, { object: 'error', status: 400, code: 'validation_error', message: 'body failed validation' })
    const res = await call('create_page', { markdown: '# x' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'body failed validation',
    })
  })

  it('401 → permission_denied;403(restricted_resource)也 → permission_denied', async () => {
    mockNotion(401, { code: 'unauthorized', message: 'API token is invalid.' })
    const unauthorized = await call('list_users', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'API token is invalid.',
    })

    vi.unstubAllGlobals()
    mockNotion(403, { code: 'restricted_resource', message: 'Insufficient permissions for this endpoint.' })
    const forbidden = await call('list_users', {})
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toMatchObject({ code: 'permission_denied' })
  })

  it('404 → not_found(页面没共享给 integration 时 Notion 就回这个)', async () => {
    mockNotion(404, { code: 'object_not_found', message: 'Could not find page with ID.' })
    const res = await call('retrieve_page', { pageId: PAGE_ID })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'not_found' })
  })

  it('409 → conflict(并发编辑同一页面)', async () => {
    mockNotion(409, { code: 'conflict_error', message: 'Conflict occurred while saving.' })
    const res = await call('update_page', { pageId: PAGE_ID, title: 'x' })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'conflict' })
  })

  it('429 → rate_limited + retryable;5xx → unavailable + retryable', async () => {
    mockNotion(429, { code: 'rate_limited', message: 'Rate limited' })
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockNotion(502, { code: 'bad_gateway', message: 'Notion is having trouble' })
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'Notion is having trouble' })
  })

  it('错误体不是 JSON 时原文进 message;完全空的错误体退回状态兜底文案', async () => {
    mockNotion(503, '<html>Service Unavailable</html>')
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ message: '<html>Service Unavailable</html>' })

    vi.unstubAllGlobals()
    mockEmpty(500)
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'notion request failed with 500' })
  })

  it('2xx 上回非 JSON → unavailable + retryable(上游会抛裸 SyntaxError 变成 500)', async () => {
    mockNotion(200, 'not json at all')
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('2xx 上回 JSON 数组(不是对象)→ unavailable + retryable', async () => {
    mockNotion(200, [1, 2, 3])
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockNotion(200, {})
    const res = await call('list_users', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
