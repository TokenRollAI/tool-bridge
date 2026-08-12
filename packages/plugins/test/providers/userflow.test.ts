import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUserflowPlugin } from '../../src/userflow/index'
import { userflowActions } from '../../src/userflow/schema'

/**
 * Userflow 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * userflow-version 头、expand[] 的重复键、delete 的归一形状、schema 标 optional 但
 * 上游必填的 id 兜底校验。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'ak_us1_deadbeef'
const plugin = createUserflowPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'growth/userflow',
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

function mockUserflow(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(payload), {
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
  it('List 出全部 8 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(userflowActions).length)
    expect(tools).toHaveLength(8)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_users')).toBe('read')
    expect(effectOf('upsert_user')).toBe('write')
    expect(effectOf('delete_user')).toBe('destructive')
  })
})

describe('请求拼装', () => {
  it('list_users:过滤器进 query,expand 走重复的 expand[] 键,版本走头', async () => {
    const mock = mockUserflow(200, { object: 'list', data: [], has_more: false, url: '/users' })
    await call('list_users', {
      limit: 25,
      starting_after: 'user_9',
      email: 'ada@example.com',
      expand: ['groups', 'memberships'],
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.userflow.com/users')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('userflow-version')).toBe('2020-01-03')
    expect(url.searchParams.get('limit')).toBe('25')
    expect(url.searchParams.get('starting_after')).toBe('user_9')
    expect(url.searchParams.get('email')).toBe('ada@example.com')
    expect(url.searchParams.getAll('expand[]')).toEqual(['groups', 'memberships'])
    // 省略的可选过滤器不该出现。
    expect(url.searchParams.has('ending_before')).toBe(false)
  })

  it('upsert_user:POST JSON,省略的可选字段不出现在 body 里', async () => {
    const mock = mockUserflow(200, { id: 'u1', object: 'user' })
    const res = await call('upsert_user', { user_id: 'u1', attributes: { plan: 'pro' } })

    const request = sent(mock)
    expect(request.url).toBe('https://api.userflow.com/users')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ user_id: 'u1', attributes: { plan: 'pro' } })

    await expect(res.json()).resolves.toEqual({ content: { user: { id: 'u1', object: 'user' } } })
  })

  it('get_user:路径参数被 URL 编码', async () => {
    const mock = mockUserflow(200, { id: 'a/b' })
    await call('get_user', { user_id: 'a/b', expand: ['groups'] })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/users/a%2Fb')
    expect(url.searchParams.getAll('expand[]')).toEqual(['groups'])
  })

  it('delete_user:DELETE 204 空体 → 归一成 {deleted,user_id,raw}', async () => {
    const mock = mockUserflow(204, null)
    const res = await call('delete_user', { user_id: 'u1' })
    expect(sent(mock).method).toBe('DELETE')
    await expect(res.json()).resolves.toEqual({
      content: { deleted: true, user_id: 'u1', raw: {} },
    })
  })

  it('track_event:POST /events,响应裹进 event', async () => {
    const mock = mockUserflow(200, { id: 'evt_1', object: 'event' })
    const res = await call('track_event', { name: 'signed_up', user_id: 'u1' })
    expect(sent(mock).url).toBe('https://api.userflow.com/events')
    await expect(res.json()).resolves.toEqual({ content: { event: { id: 'evt_1', object: 'event' } } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:email 非法 → 400 且不打上游', async () => {
    const mock = mockUserflow(200, {})
    const res = await call('upsert_user', { user_id: 'u1', email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('delete_user 缺 user_id 在本地就挡下(schema 标 optional,上游其实必填)', async () => {
    const mock = mockUserflow(200, {})
    const res = await call('delete_user', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('user_id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自嵌套的 error.message', async () => {
    mockUserflow(401, { error: { message: 'Invalid API key' } })
    const unauthorized = await call('list_users', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockUserflow(404, { error: { message: 'No such user' } })
    expect((await call('get_user', { user_id: 'missing' })).status).toBe(404)

    mockUserflow(429, { message: 'Too many requests' })
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'Too many requests', retryable: true })

    mockUserflow(500, { error: 'Userflow is down' })
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockUserflow(200, {})
    const res = await call('list_users', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
