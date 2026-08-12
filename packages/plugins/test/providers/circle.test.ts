import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCirclePlugin } from '../../src/circle/index'
import { circleActions } from '../../src/circle/schema'

/**
 * Circle 迁移产物的 wire 级验收。重点在 records 平铺信封的拆解、分页字段缺失时的
 * 保守回退,以及 member_tag_ids 的逗号拼接(Circle 不认重复同名参数)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'circle_test_token'
const plugin = createCirclePlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'community/circle',
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

function mockCircle(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 8 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(circleActions).length)
    expect(tools).toHaveLength(8)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('Circle Admin API 全部只读,effect 应当都是 read', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string }>
    expect(tools.every(tool => tool.effect === 'read')).toBe(true)
  })
})

describe('请求构造', () => {
  it('list_community_members 把 tag id 拼成逗号串,凭证走 Bearer', async () => {
    const mock = mockCircle(200, { records: [] })
    await call('list_community_members', {
      page: 2,
      per_page: 30,
      status: 'active',
      member_tag_ids: [7, 9],
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://app.circle.so/api/admin/v2/community_members')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('per_page')).toBe('30')
    expect(url.searchParams.get('status')).toBe('active')
    expect(url.searchParams.get('member_tag_ids')).toBe('7,9')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
  })

  it('list_space_members 的必填 space_id 一定进 query', async () => {
    const mock = mockCircle(200, { records: [] })
    await call('list_space_members', { space_id: 42, status: 'all' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/admin/v2/space_members')
    expect(url.searchParams.get('space_id')).toBe('42')
    expect(url.searchParams.get('status')).toBe('all')
  })

  it('get_post 的 id 拼进路径', async () => {
    const mock = mockCircle(200, { id: 5 })
    await call('get_post', { id: 5 })
    expect(sent(mock).url).toBe('https://app.circle.so/api/admin/v2/posts/5')
  })
})

describe('响应归一', () => {
  it('records 被逐项归一,pagination 从同层字段读出', async () => {
    mockCircle(200, {
      page: 2,
      per_page: 30,
      has_next_page: true,
      count: 61,
      page_count: 3,
      records: [{ id: 11, name: 'Ada', email: 'ada@example.com', extra: 'kept-in-raw' }],
    })
    const body = (await (await call('list_community_members', {})).json()) as {
      content: { members: Array<Record<string, unknown>>, pagination: Record<string, unknown> }
    }
    expect(body.content.pagination).toEqual({
      page: 2,
      per_page: 30,
      has_next_page: true,
      count: 61,
      page_count: 3,
    })
    const member = body.content.members[0]!
    expect(member.id).toBe(11)
    expect(member.name).toBe('Ada')
    expect(member.headline).toBeNull()
    expect(member.raw).toMatchObject({ extra: 'kept-in-raw' })
  })

  it('分页字段缺失时按 records 长度保守回退(上游既有行为)', async () => {
    mockCircle(200, { records: [{ id: 1 }, { id: 2 }] })
    await expect((await call('list_posts', {})).json()).resolves.toMatchObject({
      content: {
        pagination: { page: 1, per_page: 2, has_next_page: false, count: 2, page_count: 1 },
      },
    })
  })

  it('space_member 的嵌套 community_member 原样透出并补 raw', async () => {
    mockCircle(200, {
      records: [{ id: 3, space_id: 42, community_member: { id: 11, name: 'Ada' } }],
    })
    const body = (await (await call('list_space_members', { space_id: 42 })).json()) as {
      content: { space_members: Array<Record<string, unknown>> }
    }
    expect(body.content.space_members[0]!.community_member).toEqual({
      id: 11,
      name: 'Ada',
      raw: { id: 11, name: 'Ada' },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:page 给 0 → 400 且不打上游', async () => {
    const mock = mockCircle(200, { records: [] })
    const res = await call('list_posts', { page: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺必填 space_id → 400 且不打上游', async () => {
    const mock = mockCircle(200, { records: [] })
    expect((await call('list_space_members', {})).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error_details.message', async () => {
    mockCircle(401, { error_details: { message: 'Invalid API token' } })
    const denied = await call('get_community', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API token',
    })
    vi.unstubAllGlobals()

    mockCircle(429, { message: 'Rate limit exceeded' })
    await expect((await call('get_community', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'Rate limit exceeded', retryable: true })
    vi.unstubAllGlobals()

    mockCircle(404, { message: 'Post not found' })
    await expect((await call('get_post', { id: 99 })).json())
      .resolves.toMatchObject({ code: 'not_found' })
    vi.unstubAllGlobals()

    mockCircle(500, {})
    await expect((await call('get_community', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockCircle(200, { records: [] })
    const res = await call('get_community', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
