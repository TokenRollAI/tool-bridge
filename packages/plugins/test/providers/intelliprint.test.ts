import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIntelliprintPlugin } from '../../src/intelliprint/index'
import { intelliprintActions } from '../../src/intelliprint/schema'

/**
 * Intelliprint 迁移产物的 wire 级验收。重点在裸 key 授权头、点号 query 键、
 * fields 的重复同名键,以及 list 响应里 total_available/has_more 缺失即算上游破契约。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'ip_live_deadbeef'
const plugin = createIntelliprintPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'mail/intelliprint',
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

function mockIntelliprint(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

/** 一页空列表:list 归一要求 total_available/has_more 都在。 */
const EMPTY_PAGE = { data: [], total_available: 0, has_more: false }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 8 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(intelliprintActions).length)
    expect(tools).toHaveLength(8)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('全部 action 都是 read(这个 provider 只有查询能力)', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string }>
    expect(tools.every(t => t.effect === 'read')).toBe(true)
  })
})

describe('请求成形', () => {
  it('凭证是裸 key(无 Bearer 前缀),query 键用官方点号形式', async () => {
    const mock = mockIntelliprint(200, EMPTY_PAGE)
    await call('list_prints', {
      limit: 10,
      skip: 20,
      sortOrder: 'desc',
      sortField: 'created',
      testmode: false,
      letterStatus: 'printed',
      returnedAcknowledged: true,
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(API_KEY)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.intelliprint.net/v1/prints')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('skip')).toBe('20')
    expect(url.searchParams.get('sort_order')).toBe('desc')
    expect(url.searchParams.get('sort_field')).toBe('created')
    expect(url.searchParams.get('testmode')).toBe('false')
    expect(url.searchParams.get('letters.status')).toBe('printed')
    expect(url.searchParams.get('letters.returned.acknowledged')).toBe('true')
    expect(url.searchParams.has('confirmed')).toBe(false)
  })

  it('fields 是重复同名键,不是逗号拼接', async () => {
    const mock = mockIntelliprint(200, EMPTY_PAGE)
    await call('list_backgrounds', { fields: ['id', 'name'], team: 'team_1' })
    const url = new URL(sent(mock).url)
    expect(url.searchParams.getAll('fields')).toEqual(['id', 'name'])
    expect(url.searchParams.get('team')).toBe('team_1')
  })

  it('list 响应归一成 data/totalAvailable/hasMore,raw 保留完整原体', async () => {
    mockIntelliprint(200, { data: [{ id: 'p_1' }], total_available: 7, has_more: true, cursor: 'x' })
    const res = await call('list_mailing_lists', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        data: [{ id: 'p_1' }],
        totalAvailable: 7,
        hasMore: true,
        raw: { data: [{ id: 'p_1' }], total_available: 7, has_more: true, cursor: 'x' },
      },
    })
  })

  it('嵌套路径的 id 都被 URL 编码', async () => {
    const mock = mockIntelliprint(200, { id: 'r/1' })
    const res = await call('get_mailing_list_recipient', { mailingListId: 'ml/1', id: 'r/1' })
    expect(new URL(sent(mock).url).pathname).toBe('/v1/mailing_lists/ml%2F1/recipients/r%2F1')
    await expect(res.json()).resolves.toMatchObject({ content: { recipient: { id: 'r/1' } } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:limit 超上限 → 400 且不打上游', async () => {
    const mock = mockIntelliprint(200, EMPTY_PAGE)
    const res = await call('list_prints', { limit: 5000 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_print 缺 id → 400 且不打上游(schema 把它标成了可选)', async () => {
    const mock = mockIntelliprint(200, {})
    const res = await call('get_print', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error.message', async () => {
    mockIntelliprint(401, { error: { message: 'invalid api key' } })
    const denied = await call('list_prints', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'invalid api key',
    })

    mockIntelliprint(429, { message: 'rate limited' })
    await expect((await call('list_prints', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockIntelliprint(404, { error: 'no such print' })
    await expect((await call('get_print', { id: 'missing' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'no such print' })

    mockIntelliprint(503, {})
    await expect((await call('list_prints', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('list 响应缺 has_more → unavailable(上游破契约,不是入参错)', async () => {
    mockIntelliprint(200, { data: [], total_available: 0 })
    const res = await call('list_prints', {})
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockIntelliprint(200, EMPTY_PAGE)
    const res = await call('list_prints', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
