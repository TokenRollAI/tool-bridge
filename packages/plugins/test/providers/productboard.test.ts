import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProductboardPlugin } from '../../src/productboard/index'
import { productboardActions } from '../../src/productboard/schema'

/**
 * Productboard 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 方括号嵌套的 query 键、数组走重复的 `type[]`、从 links.next 抽 pageCursor、
 * 单条端点 `{data}` 与裸对象两种形状。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'pb_token_deadbeef'
const plugin = createProductboardPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'pm/productboard',
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

function mockProductboard(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 13 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(productboardActions).length)
    expect(tools).toHaveLength(13)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('全部 action 都是只读', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    for (const tool of tools) expect(tool.effect, tool.name).toBe('read')
  })
})

describe('query 拼装', () => {
  it('list_entities:嵌套字段用方括号键,数组用重复的 type[]', async () => {
    const mock = mockProductboard(200, { data: [{ id: 'e1' }], links: {} })
    await call('list_entities', {
      types: ['feature', 'component'],
      fields: ['all'],
      ownerEmail: 'ada@example.com',
      statusId: 'st_1',
      archived: false,
      parentId: 'p_1',
      metadataSourceSystem: 'jira',
      metadataSourceRecordId: 'JIRA-1',
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.productboard.com/v2/entities')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(url.searchParams.getAll('type[]')).toEqual(['feature', 'component'])
    expect(url.searchParams.getAll('fields[]')).toEqual(['all'])
    expect(url.searchParams.get('owner[email]')).toBe('ada@example.com')
    expect(url.searchParams.get('status[id]')).toBe('st_1')
    expect(url.searchParams.get('archived')).toBe('false')
    expect(url.searchParams.get('parent[id]')).toBe('p_1')
    expect(url.searchParams.get('metadata[source][system]')).toBe('jira')
    expect(url.searchParams.get('metadata[source][recordId]')).toBe('JIRA-1')
    // 省略的可选过滤器不该出现。
    expect(url.searchParams.has('owner[id]')).toBe(false)
    expect(url.searchParams.has('pageCursor')).toBe(false)
  })

  it('路径参数被 URL 编码', async () => {
    const mock = mockProductboard(200, { data: { id: 'a/b' } })
    await call('get_entity', { id: 'a/b' })
    expect(new URL(sent(mock).url).pathname).toBe('/v2/entities/a%2Fb')
  })

  it('list_team_members:teamId 进路径,pageCursor 进 query', async () => {
    const mock = mockProductboard(200, { data: [], links: {} })
    await call('list_team_members', { teamId: 't1', pageCursor: 'cur_9' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v2/teams/t1/members')
    expect(url.searchParams.get('pageCursor')).toBe('cur_9')
  })
})

describe('响应整形', () => {
  it('列表:从 links.next 抽出 pageCursor,links 原样透出', async () => {
    mockProductboard(200, {
      data: [{ id: 'n1' }],
      links: { next: 'https://api.productboard.com/v2/notes?pageCursor=abc123', self: '/v2/notes' },
    })
    const res = await call('list_notes', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        notes: [{ id: 'n1' }],
        nextPageCursor: 'abc123',
        nextPageUrl: 'https://api.productboard.com/v2/notes?pageCursor=abc123',
        links: { next: 'https://api.productboard.com/v2/notes?pageCursor=abc123', self: '/v2/notes' },
      },
    })
  })

  it('没有下一页时两个游标字段都是 null', async () => {
    mockProductboard(200, { data: [], links: {} })
    const res = await call('list_teams', {})
    await expect(res.json()).resolves.toMatchObject({
      content: { teams: [], nextPageCursor: null, nextPageUrl: null },
    })
  })

  it('单条端点:{data} 信封与裸对象两种形状都收', async () => {
    mockProductboard(200, { data: { id: 'm1', email: 'ada@example.com' } })
    await expect((await call('get_member', { id: 'm1' })).json())
      .resolves.toEqual({ content: { member: { id: 'm1', email: 'ada@example.com' } } })
    vi.unstubAllGlobals()

    mockProductboard(200, { id: 'team_1', name: 'Core' })
    await expect((await call('get_team', { id: 'team_1' })).json())
      .resolves.toEqual({ content: { team: { id: 'team_1', name: 'Core' } } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:types 不在枚举内 → 400 且不打上游', async () => {
    const mock = mockProductboard(200, { data: [] })
    const res = await call('list_entities', { types: ['nope'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_member 缺 id 在本地就挡下(schema 标 optional,上游其实必填)', async () => {
    const mock = mockProductboard(200, {})
    const res = await call('get_member', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,errors[] 的 title 与 detail 被拼起来', async () => {
    mockProductboard(401, { errors: [{ title: 'Unauthorized', detail: 'Invalid token' }] })
    const unauthorized = await call('list_notes', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthorized: Invalid token',
    })

    mockProductboard(404, { error: { message: 'Entity not found' } })
    await expect((await call('get_entity', { id: 'missing' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Entity not found' })

    mockProductboard(429, { message: 'Rate limit exceeded' })
    await expect((await call('list_notes', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockProductboard(500, { message: 'Productboard is down' })
    await expect((await call('list_notes', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('列表响应 data 不是数组 → unavailable(上游破契约)', async () => {
    mockProductboard(200, { data: { id: 'oops' } })
    const res = await call('list_members', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockProductboard(200, { data: [] })
    const res = await call('list_entity_configurations', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
