import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLoomioPlugin } from '../../src/loomio/index'
import { loomioActions } from '../../src/loomio/schema'

/**
 * Loomio 迁移产物的 wire 级验收。重点在凭证走 query 参数、snake/camel 双键归一,
 * 以及 `raw` 必须留住归一化丢掉的字段。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'loomio_key_deadbeef'
const plugin = createLoomioPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'collab/loomio',
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

function mockLoomio(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 2 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(loomioActions).length)
    expect(tools).toHaveLength(2)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
    expect(tools.every(t => (t as { effect?: string }).effect === 'read')).toBe(true)
  })
})

describe('请求成形与归一', () => {
  it('凭证走 query 参数,groupId 改名成 group_id', async () => {
    const mock = mockLoomio(200, { polls: [], meta: { total: 0 } })
    await call('list_polls', { groupId: 42, status: 'active', limit: 10, offset: 5 })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://www.loomio.com/api/b2/polls')
    expect(url.searchParams.get('api_key')).toBe(API_KEY)
    expect(url.searchParams.get('group_id')).toBe('42')
    expect(url.searchParams.get('status')).toBe('active')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('offset')).toBe('5')
    expect(request.headers.get('authorization')).toBeNull()
  })

  it('snake_case 归一成 camelCase,raw 留住完整原体', async () => {
    mockLoomio(200, {
      polls: [{ id: 7, title: 'Lunch', poll_type: 'proposal', group_id: 42, closed_at: null, extra: 'kept' }],
      meta: { total: 3 },
    })
    const res = await call('list_polls', { groupId: 42 })
    await expect(res.json()).resolves.toMatchObject({
      content: {
        total: 3,
        polls: [{
          id: 7,
          title: 'Lunch',
          pollType: 'proposal',
          groupId: 42,
          closedAt: null,
          authorId: null,
          raw: { poll_type: 'proposal', extra: 'kept' },
        }],
      },
    })
  })

  it('meta.total 读不出时按本页条数兜底', async () => {
    mockLoomio(200, { polls: [{ id: 1 }, { id: 2 }] })
    const res = await call('list_polls', { groupId: 42 })
    await expect(res.json()).resolves.toMatchObject({ content: { total: 2, rawMeta: null } })
  })

  it('get_poll 的 id/key 被 URL 编码,options 归一后带 raw', async () => {
    const mock = mockLoomio(200, {
      id: 9,
      title: 'Retro',
      status: 'closed',
      details: 'body',
      options: [{ id: 1, name: 'yes', priority: 0, extra: 1 }],
    })
    const res = await call('get_poll', { pollIdOrKey: 'a/b' })
    expect(sent(mock).url).toContain('/api/b2/polls/a%2Fb')
    await expect(res.json()).resolves.toMatchObject({
      content: {
        poll: {
          id: 9,
          status: 'closed',
          details: 'body',
          options: [{ id: 1, name: 'yes', priority: 0, raw: { extra: 1 } }],
        },
      },
    })
  })

  it('detail 没有 options 时归一成空数组', async () => {
    mockLoomio(200, { id: 9 })
    const res = await call('get_poll', { pollIdOrKey: '9' })
    await expect(res.json()).resolves.toMatchObject({ content: { poll: { options: [] } } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:groupId 给字符串 → 400 且不打上游', async () => {
    const mock = mockLoomio(200, { polls: [] })
    const res = await call('list_polls', { groupId: 'forty-two' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_poll 缺 pollIdOrKey → 400 且不打上游(schema 把它标成了可选)', async () => {
    const mock = mockLoomio(200, {})
    const res = await call('get_poll', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('pollIdOrKey')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error 数组的首条', async () => {
    mockLoomio(401, { error: ['invalid api key'] })
    const denied = await call('list_polls', { groupId: 1 })
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'invalid api key',
    })

    mockLoomio(429, { message: 'slow down' })
    await expect((await call('list_polls', { groupId: 1 })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockLoomio(404, { detail: 'poll not found' })
    await expect((await call('get_poll', { pollIdOrKey: '404' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'poll not found' })

    mockLoomio(500, {})
    await expect((await call('list_polls', { groupId: 1 })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游回了非对象 payload → unavailable(是上游破契约,不是入参错)', async () => {
    mockLoomio(200, [1, 2, 3])
    const res = await call('list_polls', { groupId: 1 })
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockLoomio(200, { polls: [] })
    const res = await call('list_polls', { groupId: 1 }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
