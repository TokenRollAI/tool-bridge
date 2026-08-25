import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createFigmaPlugin } from '../../src/figma/index'
import { figmaActions } from '../../src/figma/schema'

/**
 * Figma 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 多个 node id 逗号拼成**一个** `ids` 参数(不是重复同名参数)、纯空白入参在本地就挡下、
 * 各 action 从 `meta` 的不同键里取自己那一族、以及 `update_dev_resources` 的元素级 refine。
 */

const API_KEY = 'figd_testdeadbeef'
const FILE = 'abc123'
const plugin = createFigmaPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockFigma,
  stubFetch,
} = createProviderHarness({
  mountPath: 'design/figma',
  plugin,
  upstreamAuth: API_KEY,
})

function mockRaw(status: number, body: string): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(new Response(body, { status })))
}

describe('契约面', () => {
  it('List 出全部 26 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(figmaActions).length)
    expect(tools).toHaveLength(26)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求拼装', () => {
  it('get_current_user:凭证走 X-Figma-Token 头(不是 Bearer),GET 无请求体', async () => {
    const mock = mockFigma(200, { id: 'u1', handle: 'ann' })
    await call('get_current_user', {})

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin).toBe('https://api.figma.com')
    expect(url.pathname).toBe('/v1/me')
    expect(request.headers.get('x-figma-token')).toBe(API_KEY)
    // OAuth 走的是 authorization: Bearer,本次迁移只落 PAT,别把两种认证同时发出去。
    expect(request.headers.get('authorization')).toBeNull()
    expect(request.headers.get('accept')).toBe('application/json')
    expect(await request.text()).toBe('')
  })

  it('多个 node id 逗号拼成一个 ids 参数,不是重复同名参数', async () => {
    const mock = mockFigma(200, { nodes: {} })
    await call('get_file_nodes', { fileKey: FILE, nodeIds: ['1:2', '3:4'], depth: 2 })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe(`/v1/files/${FILE}/nodes`)
    expect(url.searchParams.getAll('ids')).toEqual(['1:2,3:4'])
    expect(Object.fromEntries(url.searchParams)).toEqual({ ids: '1:2,3:4', depth: '2' })
  })

  it('node id 逐项去空白、丢空项;可选的那个全空时整个参数不发', async () => {
    const mock = mockFigma(200, { nodes: {} })
    await call('get_file_nodes', { fileKey: FILE, nodeIds: ['  1:2  ', '3:4'] })
    expect(new URL(sent(mock).url).searchParams.get('ids')).toBe('1:2,3:4')

    vi.unstubAllGlobals()
    const optional = mockFigma(200, { dev_resources: [] })
    await call('get_dev_resources', { fileKey: FILE, nodeIds: ['   '] })
    expect([...new URL(sent(optional).url).searchParams.keys()]).toEqual([])
  })

  it('必填的 nodeIds 全是空白时本地就报错,不打上游', async () => {
    const mock = mockFigma(200, {})
    const res = await call('get_file_nodes', { fileKey: FILE, nodeIds: ['   ', ' '] })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的 fileKey 能过 Zod 的 min(1),但在本地就挡下(拼进路径必然 404)', async () => {
    const mock = mockFigma(200, {})
    const res = await call('get_file_metadata', { fileKey: '   ' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('fileKey')
    expect(mock).not.toHaveBeenCalled()
  })

  it('路径段被 encodeURIComponent 转义(node id 里的冒号也在 query 里正常编码)', async () => {
    const mock = mockFigma(200, { images: {}, err: null })
    await call('render_images', { fileKey: 'a/b', nodeIds: ['1:2'], format: 'svg', scale: 2 })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/images/a%2Fb')
    expect(Object.fromEntries(url.searchParams)).toEqual({ ids: '1:2', format: 'svg', scale: '2' })
  })

  it('post_comment:POST + JSON body,只发给到的字段', async () => {
    const mock = mockFigma(200, { id: 'c1', message: 'hi' })
    await call('post_comment', { fileKey: FILE, message: 'hi', commentId: 'c0' })
    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe(`/v1/files/${FILE}/comments`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ message: 'hi', comment_id: 'c0' })
  })

  it('delete_comment_reaction 把 emoji 放 query,不是请求体', async () => {
    const mock = mockFigma(200, {})
    await call('delete_comment_reaction', { fileKey: FILE, commentId: 'c1', emoji: 'eyes' })
    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('DELETE')
    expect(url.pathname).toBe(`/v1/files/${FILE}/comments/c1/reactions`)
    expect(url.searchParams.get('emoji')).toBe('eyes')
    expect(await request.text()).toBe('')
  })

  it('dev resource 的建/改不在文件路径下,改用 PUT 且字段改名成 snake_case', async () => {
    const created = mockFigma(200, { links_created: [{ id: 'd1' }], errors: [] })
    await call('create_dev_resources', {
      devResources: [{ name: 'Spec', url: 'https://example.com/spec', fileKey: FILE, nodeId: '1:2' }],
    })
    const create = sent(created)
    expect(create.method).toBe('POST')
    expect(new URL(create.url).pathname).toBe('/v1/dev_resources')
    await expect(create.json()).resolves.toEqual({
      dev_resources: [{ name: 'Spec', url: 'https://example.com/spec', file_key: FILE, node_id: '1:2' }],
    })

    vi.unstubAllGlobals()
    const updated = mockFigma(200, { links_updated: [{ id: 'd1' }], errors: [] })
    await call('update_dev_resources', { devResources: [{ id: 'd1', name: 'Spec v2' }] })
    const update = sent(updated)
    expect(update.method).toBe('PUT')
    expect(new URL(update.url).pathname).toBe('/v1/dev_resources')
    await expect(update.json()).resolves.toEqual({ dev_resources: [{ id: 'd1', name: 'Spec v2' }] })
  })
})

describe('响应整形', () => {
  it('库列表从 meta 里取自己那一族,游标缺席时给空对象', async () => {
    mockFigma(200, {
      meta: { components: [{ key: 'k1' }], cursor: { after: 7 } },
      status: 200,
    })
    const withCursor = await call('list_file_components', { fileKey: FILE })
    await expect(withCursor.json()).resolves.toEqual({
      content: {
        items: [{ key: 'k1' }],
        pagination: { after: 7 },
        raw: { meta: { components: [{ key: 'k1' }], cursor: { after: 7 } }, status: 200 },
      },
    })

    vi.unstubAllGlobals()
    mockFigma(200, { meta: { styles: [] } })
    const noCursor = await call('list_file_styles', { fileKey: FILE })
    await expect(noCursor.json()).resolves.toMatchObject({ content: { items: [], pagination: {} } })
  })

  it('render_images 的 err 总是给出来:缺席或空白都归一成 null', async () => {
    mockFigma(200, { images: { '1:2': 'https://cdn.example/a.png' } })
    await expect((await call('render_images', { fileKey: FILE, nodeIds: ['1:2'] })).json())
      .resolves.toMatchObject({ content: { err: null, images: { '1:2': 'https://cdn.example/a.png' } } })

    vi.unstubAllGlobals()
    mockFigma(200, { images: {}, err: 'Rendering failed' })
    await expect((await call('render_images', { fileKey: FILE, nodeIds: ['1:2'] })).json())
      .resolves.toMatchObject({ content: { err: 'Rendering failed' } })
  })

  it('create 只填 linksCreated、update 只填 linksUpdated,另一族恒为空数组', async () => {
    mockFigma(200, { links_created: [{ id: 'd1' }], links_updated: [{ id: 'zzz' }], errors: [{ e: 1 }] })
    await expect((await call('create_dev_resources', {
      devResources: [{ name: 'Spec', url: 'https://example.com/spec', fileKey: FILE, nodeId: '1:2' }],
    })).json()).resolves.toMatchObject({
      content: { linksCreated: [{ id: 'd1' }], linksUpdated: [], errors: [{ e: 1 }] },
    })

    vi.unstubAllGlobals()
    mockFigma(200, { links_updated: [{ id: 'd1' }] })
    // errors 不是数组(这里是缺席)就当没有,不让附带信息拖垮主结果。
    await expect((await call('update_dev_resources', { devResources: [{ id: 'd1', url: 'https://e.example/x' }] })).json())
      .resolves.toMatchObject({ content: { linksCreated: [], linksUpdated: [{ id: 'd1' }], errors: [] } })
  })

  it('删除类 action 回一个明确的确认,不透传上游空体', async () => {
    mockRaw(200, '')
    await expect((await call('delete_comment', { fileKey: FILE, commentId: 'c1' })).json())
      .resolves.toEqual({ content: { deleted: true } })
  })
})

describe('校验与错误', () => {
  it('update_dev_resources 的元素级 refine:只带 id 的那条在本地就拦下', async () => {
    const mock = mockFigma(200, { links_updated: [] })
    const res = await call('update_dev_resources', { devResources: [{ id: 'd1' }] })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()

    // 约束在**每个元素**上:合规的那条不能替不合规的那条背书。
    vi.unstubAllGlobals()
    const mixed = mockFigma(200, { links_updated: [] })
    const partial = await call('update_dev_resources', {
      devResources: [{ id: 'd1', name: 'ok' }, { id: 'd2' }],
    })
    expect(partial.status).toBe(400)
    expect(mixed).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:非法 URL / 越界 scale → 400 且不打上游', async () => {
    const badUrl = mockFigma(200, {})
    const res = await call('create_dev_resources', {
      devResources: [{ name: 'Spec', url: 'not a url', fileKey: FILE, nodeId: '1:2' }],
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(badUrl).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const badScale = mockFigma(200, {})
    expect((await call('render_images', { fileKey: FILE, nodeIds: ['1:2'], scale: 9 })).status).toBe(400)
    expect(badScale).not.toHaveBeenCalled()
  })

  it('上游 4xx → invalid_argument / not_found / permission_denied;5xx → unavailable + retryable', async () => {
    mockFigma(404, { status: 404, err: 'Not found' })
    const missing = await call('get_file', { fileKey: FILE })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'Not found' })

    vi.unstubAllGlobals()
    mockFigma(403, { status: 403, err: 'Invalid token' })
    await expect((await call('get_file', { fileKey: FILE })).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'Invalid token' })

    vi.unstubAllGlobals()
    mockFigma(400, { message: 'Invalid parameter' })
    await expect((await call('get_file', { fileKey: FILE })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'Invalid parameter' })

    vi.unstubAllGlobals()
    mockFigma(429, { err: 'Too many requests' })
    await expect((await call('get_file', { fileKey: FILE })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockFigma(500, { err: 'Figma is down' })
    await expect((await call('get_file', { fileKey: FILE })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('错误体是纯文本时它本身就是消息(丢掉它错误就只剩一个状态码)', async () => {
    mockRaw(400, 'invalid file key')
    await expect((await call('get_file', { fileKey: FILE })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'invalid file key' })

    vi.unstubAllGlobals()
    mockRaw(400, '')
    await expect((await call('get_file', { fileKey: FILE })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'Figma 返回 HTTP 400' })
  })

  it('响应形状不合契约(不是对象 / 该是数组的不是)→ unavailable,不是调用方的错', async () => {
    mockFigma(200, ['not', 'an', 'object'])
    await expect((await call('get_current_user', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockFigma(200, { comments: { not: 'an array' } })
    await expect((await call('list_comments', { fileKey: FILE })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockFigma(200, { meta: null })
    await expect((await call('list_file_styles', { fileKey: FILE })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockFigma(200, {})
    const res = await call('get_current_user', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
