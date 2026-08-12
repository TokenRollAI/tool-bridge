import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  encodeCredentialValues,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMattermostPlugin } from '../../src/mattermost/index'
import { mattermostActions } from '../../src/mattermost/schema'

/**
 * Mattermost 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * instanceUrl 归一(粘贴带 /api/v4 的地址不能双拼、http 与内网地址要被拦)、
 * 入参名与 query 名的重映射(perPage→per_page、beforePostId→before)、
 * `since` 与其他分页参数的互斥、以及帖子列表必须按 `order` 重排。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const TOKEN = 'pat_deadbeef'
const CREDENTIALS = { apiKey: TOKEN, instanceUrl: 'https://mm.example.com' }
const API_BASE = 'https://mm.example.com/api/v4'
const plugin = createMattermostPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'chat/mattermost',
  exportId: 'actions',
}

function envelope(body: unknown, opts: { credentials?: Record<string, string> | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(CALLER),
  }
  const credentials = opts.credentials === undefined ? CREDENTIALS : opts.credentials
  if (credentials !== null) {
    const encoded = encodeCredentialValues(credentials)
    headers[HEADER_TB_UPSTREAM_AUTH] = base64urlEncode(new TextEncoder().encode(encoded))
  }
  return Promise.resolve(plugin.fetch(
    new Request('https://plugin.test/', { method: 'POST', headers, body: JSON.stringify(body) }),
    ENV as never,
  ))
}

function call(
  name: string,
  args: unknown,
  opts?: { credentials?: Record<string, string> | null },
): Promise<Response> {
  return envelope({ tool: 'Call', arguments: { name, args } }, opts)
}

function mockMattermost(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(payload === null
    ? new Response(null, { status })
    : new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

async function content(res: Response): Promise<unknown> {
  return ((await res.json()) as { content: unknown }).content
}

async function message(res: Response): Promise<string> {
  return ((await res.json()) as { message: string }).message
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 7 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(mattermostActions).length)
    expect(tools).toHaveLength(7)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报出两个凭证字段与 get_current_user 探针', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const described = (await res.json()) as {
      exports: Array<{
        credentialFields?: Array<{ key: string, required?: boolean, secret?: boolean }>
        credentialProbe?: string
        id: string
        profile: string
      }>
    }
    expect(described.exports).toHaveLength(1)
    const [entry] = described.exports
    expect(entry).toMatchObject({ id: 'actions', profile: 'tools/v1', credentialProbe: 'get_current_user' })
    // instanceUrl 不是机密:它要能在挂载界面上原样显示出来供人核对。
    expect(entry?.credentialFields?.map(field => [field.key, field.secret === true])).toEqual([
      ['apiKey', true],
      ['instanceUrl', false],
    ])
  })
})

describe('instanceUrl 归一', () => {
  it('已经带 /api/v4 的地址不会被双拼,尾部斜杠与 query/fragment 都去掉', async () => {
    for (const instanceUrl of [
      'https://mm.example.com',
      'https://mm.example.com/',
      'https://mm.example.com/api/v4',
      'https://mm.example.com/api/v4/',
      'https://mm.example.com?tab=1#top',
      // 没写协议时补 https(上游同样的兜底)。
      'mm.example.com',
    ]) {
      vi.unstubAllGlobals()
      const mock = mockMattermost(200, { id: 'u1' })
      await call('get_current_user', {}, { credentials: { apiKey: TOKEN, instanceUrl } })
      expect(sent(mock).url, instanceUrl).toBe(`${API_BASE}/users/me`)
    }
  })

  it('实例挂在子路径下时,子路径要保留', async () => {
    const mock = mockMattermost(200, { id: 'u1' })
    await call('get_current_user', {}, {
      credentials: { apiKey: TOKEN, instanceUrl: 'https://intranet.example.com/chat/' },
    })
    expect(sent(mock).url).toBe('https://intranet.example.com/chat/api/v4/users/me')
  })

  it('http、内嵌凭证、内网地址都在出站之前被拒', async () => {
    for (const [instanceUrl, expected] of [
      ['http://mm.example.com', 'https'],
      ['https://user:pw@mm.example.com', '用户名'],
      ['https://10.0.0.5', '私有'],
      ['https://[::1]', '私有'],
    ] as const) {
      vi.unstubAllGlobals()
      const mock = mockMattermost(200, {})
      const res = await call('get_current_user', {}, { credentials: { apiKey: TOKEN, instanceUrl } })
      expect(res.status, instanceUrl).toBe(400)
      await expect(message(res), instanceUrl).resolves.toContain(expected)
      expect(mock, instanceUrl).not.toHaveBeenCalled()
    }
  })

  it('没配凭证 → unavailable 且不打上游', async () => {
    const mock = mockMattermost(200, {})
    const res = await call('get_current_user', {}, { credentials: null })
    expect(res.status).toBe(503)
    await expect(message(res)).resolves.toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('请求拼装', () => {
  it('get_current_user:PAT 走 Authorization Bearer 头,不进 URL', async () => {
    const mock = mockMattermost(200, { id: 'u1', username: 'alice' })
    const res = await call('get_current_user', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(request.headers.get('accept')).toBe('application/json')
    expect(new URL(request.url).search).toBe('')
    expect(await request.text()).toBe('')
    await expect(content(res)).resolves.toEqual({
      user: { id: 'u1', username: 'alice' },
      raw: { id: 'u1', username: 'alice' },
    })
  })

  it('list_team_channels:perPage 在 wire 上叫 per_page,page 为 0 也要发出去', async () => {
    const mock = mockMattermost(200, [])
    await call('list_team_channels', { teamId: 't1', page: 0, perPage: 50 })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v4/teams/t1/channels')
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: '0', per_page: '50' })
  })

  it('list_channel_posts:beforePostId / afterPostId 在 wire 上叫 before / after', async () => {
    const mock = mockMattermost(200, { order: [], posts: {} })
    await call('list_channel_posts', {
      channelId: 'c1',
      page: 1,
      perPage: 20,
      beforePostId: 'p9',
      afterPostId: 'p1',
    })
    expect(Object.fromEntries(new URL(sent(mock).url).searchParams)).toEqual({
      page: '1',
      per_page: '20',
      before: 'p9',
      after: 'p1',
    })
  })

  it('create_post:字段名转成 snake_case,没给的可选字段整个键不发', async () => {
    const mock = mockMattermost(200, { id: 'post1' })
    await call('create_post', { channelId: 'c1', message: 'hello' })
    expect(sent(mock).method).toBe('POST')
    expect(sent(mock).headers.get('content-type')).toBe('application/json')
    await expect(sent(mock).json()).resolves.toEqual({ channel_id: 'c1', message: 'hello' })

    vi.unstubAllGlobals()
    const threaded = mockMattermost(200, { id: 'post2' })
    await call('create_post', {
      channelId: 'c1',
      message: '回帖',
      rootId: 'post1',
      props: { attachments: [] },
    })
    await expect(sent(threaded).json()).resolves.toEqual({
      channel_id: 'c1',
      message: '回帖',
      root_id: 'post1',
      props: { attachments: [] },
    })
  })
})

describe('帖子列表整形', () => {
  it('按 order 重排,order 里有但 posts 里缺的补成 { id }', async () => {
    mockMattermost(200, {
      order: ['p3', 'p2', 'gone'],
      // 字典本身是无序的,而且这里故意与 order 顺序相反。
      posts: {
        p2: { id: 'p2', message: '第二条' },
        p3: { id: 'p3', message: '第三条' },
      },
    })
    const result = (await content(await call('list_channel_posts', { channelId: 'c1' }))) as {
      order: string[]
      posts: Array<{ id: string }>
    }
    expect(result.posts.map(post => post.id)).toEqual(['p3', 'p2', 'gone'])
    // 取不到内容的那条也要占位,否则 posts 与 order 长度不一致,翻页就错了。
    expect(result.posts[2]).toEqual({ id: 'gone' })
    expect(result.order).toEqual(['p3', 'p2', 'gone'])
  })

  it('没有 order 时退回原样列出 posts 的值', async () => {
    mockMattermost(200, { posts: { p1: { id: 'p1' } } })
    await expect(content(await call('list_channel_posts', { channelId: 'c1' }))).resolves.toEqual({
      posts: [{ id: 'p1' }],
      order: [],
      raw: { posts: { p1: { id: 'p1' } } },
    })
  })

  it('since 不能与 page / perPage / beforePostId / afterPostId 同时用,且不打上游', async () => {
    const mock = mockMattermost(200, { order: [], posts: {} })
    const res = await call('list_channel_posts', { channelId: 'c1', since: 1_700_000_000_000, page: 2 })
    expect(res.status).toBe(400)
    await expect(message(res)).resolves.toContain('since')
    expect(mock).not.toHaveBeenCalled()

    // 单独用 since 是合法的。
    vi.unstubAllGlobals()
    const ok = mockMattermost(200, { order: [], posts: {} })
    await call('list_channel_posts', { channelId: 'c1', since: 1_700_000_000_000 })
    expect(Object.fromEntries(new URL(sent(ok).url).searchParams)).toEqual({ since: '1700000000000' })
  })
})

describe('校验与错误', () => {
  it('schema 把 teamId 标成可选,但上游必填 —— 缺了就 invalid_argument,不打上游', async () => {
    const mock = mockMattermost(200, {})
    const res = await call('get_team', {})
    expect(res.status).toBe(400)
    await expect(message(res)).resolves.toContain('teamId')
    expect(mock).not.toHaveBeenCalled()
  })

  it('把整段路径当 id 传进来报参数错误,而不是变成一个查不出来的 404', async () => {
    const mock = mockMattermost(200, {})
    const res = await call('get_channel', { channelId: 'teams/t1/channels/c1' })
    expect(res.status).toBe(400)
    await expect(message(res)).resolves.toContain('路径段')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游状态各归各码:404 → not_found、403 → permission_denied、429 → rate_limited', async () => {
    mockMattermost(404, { id: 'store.sql_channel.get.existing.app_error', message: 'Unable to find the channel.' })
    const missing = await call('get_channel', { channelId: 'c1' })
    // 上游把 401/403 之外的 4xx 全压成 400;这里保留原状态,404 就是 not_found。
    expect(missing.status).toBe(404)
    await expect(missing.json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Unable to find the channel.' })

    vi.unstubAllGlobals()
    mockMattermost(403, { message: 'You do not have the appropriate permissions.' })
    await expect((await call('get_channel', { channelId: 'c1' })).json())
      .resolves.toMatchObject({ code: 'permission_denied', retryable: false })

    vi.unstubAllGlobals()
    mockMattermost(429, { message: 'Too many requests' })
    await expect((await call('get_channel', { channelId: 'c1' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockMattermost(500, { message: 'Internal error' })
    await expect((await call('get_channel', { channelId: 'c1' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('错误响应不是 JSON 时,原文当消息(反向代理返回的 HTML 错误页很常见)', async () => {
    mockMattermost(502, '<html>Bad Gateway</html>')
    const res = await call('get_current_user', {})
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: '<html>Bad Gateway</html>',
    })
  })

  it('响应形状不符契约(说好是数组却回了对象)→ unavailable,不是调用方的错', async () => {
    mockMattermost(200, { teams: [] })
    const res = await call('list_user_teams', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('成功响应不是 JSON → unavailable', async () => {
    const fn = vi.fn(() => Promise.resolve(new Response('not json', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })))
    vi.stubGlobal('fetch', fn)
    await expect((await call('get_current_user', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})
