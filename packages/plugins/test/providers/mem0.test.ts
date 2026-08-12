import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createMem0Plugin } from '../../src/mem0/index'
import { mem0Actions } from '../../src/mem0/schema'

/**
 * Mem0 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * `Token` 而非 `Bearer` 的认证头、路径末尾那个必需的斜杠、单数 `/v1/event/` 与复数
 * `/v1/events/` 的不对称、以及一批只存在于 executor 里的必填/跨字段断言。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'm0-deadbeef'
const plugin = createMem0Plugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'memory/mem0',
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

function mockMem0(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(
    payload === undefined ? null : JSON.stringify(payload),
    { status, headers: { 'content-type': 'application/json' } },
  )))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 取上游收到的那个请求。 */
function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

async function sentBody(mock: ReturnType<typeof vi.fn>): Promise<unknown> {
  return JSON.parse(await sent(mock).text())
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('~describe 报成单个 tools/v1 export,并报出凭证探针', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        id: 'actions',
        profile: 'tools/v1',
        description: 'Mem0',
        credentialProbe: 'get_events',
      }],
    })
  })

  it('探针指向的工具只读且无必填入参(平台挂载时会空参调它)', () => {
    const spec = mem0Actions.get_events
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })

  it('List 出全部 10 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(mem0Actions).length)
    expect(tools).toHaveLength(10)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求成形', () => {
  it('add_memories:POST /v1/memories/,认证头是 Token 不是 Bearer,未给的字段不进 body', async () => {
    const mock = mockMem0(200, [{ id: 'm1', event: 'ADD', memory: 'likes tea' }])
    const res = await call('add_memories', {
      messages: [{ role: 'user', content: 'I like tea' }],
      user_id: 'u1',
      metadata: { source: 'chat' },
      infer: true,
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('POST')
    expect(url.origin + url.pathname).toBe('https://api.mem0.ai/v1/memories/')
    expect(request.headers.get('authorization')).toBe(`Token ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(sentBody(mock)).resolves.toEqual({
      messages: [{ role: 'user', content: 'I like tea' }],
      user_id: 'u1',
      metadata: { source: 'chat' },
      infer: true,
    })
    await expect(res.json()).resolves.toEqual({
      content: [{ id: 'm1', event: 'ADD', memory: 'likes tea' }],
    })
  })

  it('get_memories:v2 的列举是 POST + body 里带 filters,不是 GET + query', async () => {
    const mock = mockMem0(200, [])
    await call('get_memories', { filters: { AND: [{ user_id: 'u1' }] }, page: 2, page_size: 50 })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/v2/memories/')
    expect([...new URL(request.url).searchParams.keys()]).toEqual([])
    await expect(sentBody(mock)).resolves.toEqual({
      filters: { AND: [{ user_id: 'u1' }] },
      page: 2,
      page_size: 50,
    })
  })

  it('search_memories:POST /v2/memories/search/', async () => {
    const mock = mockMem0(200, [{ id: 'm1', score: 0.9 }])
    await call('search_memories', { query: 'tea', top_k: 5, fields: ['id', 'memory'], rerank: false })
    expect(new URL(sent(mock).url).pathname).toBe('/v2/memories/search/')
    await expect(sentBody(mock)).resolves.toEqual({
      query: 'tea',
      top_k: 5,
      fields: ['id', 'memory'],
      rerank: false,
    })
  })

  it('单条记忆的三个端点各自带末尾斜杠,id 做 URL 编码', async () => {
    const get = mockMem0(200, { id: 'a/b' })
    await call('get_memory', { memory_id: 'a/b' })
    expect(new URL(sent(get).url).pathname).toBe('/v1/memories/a%2Fb/')

    vi.unstubAllGlobals()
    const history = mockMem0(200, [])
    await call('get_memory_history', { memory_id: 'm1' })
    expect(new URL(sent(history).url).pathname).toBe('/v1/memories/m1/history/')

    vi.unstubAllGlobals()
    const update = mockMem0(200, { id: 'm1', text: 'new' })
    await call('update_memory', { memory_id: 'm1', text: 'new' })
    expect(sent(update).method).toBe('PUT')
    expect(new URL(sent(update).url).pathname).toBe('/v1/memories/m1/')
    await expect(sentBody(update)).resolves.toEqual({ text: 'new' })
  })

  it('取单个事件走单数 /v1/event/,列事件走复数 /v1/events/', async () => {
    const one = mockMem0(200, { id: 'e1' })
    await call('get_event', { event_id: 'e1' })
    expect(new URL(sent(one).url).pathname).toBe('/v1/event/e1/')

    vi.unstubAllGlobals()
    const many = mockMem0(200, { count: 0, results: [] })
    await call('get_events', { event_type: 'ADD', page: 1, page_size: 10 })
    const url = new URL(sent(many).url)
    expect(url.pathname).toBe('/v1/events/')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      event_type: 'ADD',
      page: '1',
      page_size: '10',
    })
  })

  it('get_users 恒带 entity_type=user;不给作用域时 query 里只有它', async () => {
    const mock = mockMem0(200, { count: 0, results: [] })
    await call('get_users', {})
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/entities/')
    expect(Object.fromEntries(url.searchParams)).toEqual({ entity_type: 'user' })
  })
})

describe('响应整形', () => {
  it('delete_memory 回明确的删除回执,消息缺席时兜底', async () => {
    const mock = mockMem0(200, {})
    const res = await call('delete_memory', { memory_id: 'm1' })
    expect(sent(mock).method).toBe('DELETE')
    await expect(res.json()).resolves.toEqual({
      content: { memory_id: 'm1', deleted: true, message: 'Memory deleted successfully!' },
    })

    vi.unstubAllGlobals()
    mockMem0(200, { message: 'Gone' })
    await expect((await call('delete_memory', { memory_id: 'm1' })).json())
      .resolves.toEqual({ content: { memory_id: 'm1', deleted: true, message: 'Gone' } })
  })

  it('204 与空正文都按成功无内容处理', async () => {
    const fn = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    vi.stubGlobal('fetch', fn)
    await expect((await call('update_memory', { memory_id: 'm1', text: 'x' })).json())
      .resolves.toEqual({ content: {} })
  })

  it('2xx 但正文不是 JSON 时兜成 { raw },不当成故障', async () => {
    const fn = vi.fn(() => Promise.resolve(new Response('OK', { status: 200 })))
    vi.stubGlobal('fetch', fn)
    await expect((await call('get_memory', { memory_id: 'm1' })).json())
      .resolves.toEqual({ content: { raw: 'OK' } })
  })
})

describe('校验与错误', () => {
  it('add_memories 既没 memory 也没 messages → invalid_argument 且不打上游', async () => {
    const mock = mockMem0(200, [])
    const res = await call('add_memories', { user_id: 'u1' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的 memory 能过 Zod 的 min(1),但算作"没给" —— 与上游 optionalString 一致', async () => {
    const mock = mockMem0(200, [])
    const res = await call('add_memories', { memory: '   ' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('memory_id / event_id 在 schema 里是 optional,必填断言留在本层', async () => {
    const mock = mockMem0(200, {})
    for (const [name, args] of [
      ['get_memory', {}],
      ['delete_memory', {}],
      ['get_memory_history', {}],
      ['get_event', {}],
    ] as const) {
      const res = await call(name, args)
      expect(res.status, name).toBe(400)
      expect(((await res.json()) as { message: string }).message).toMatch(/memory_id|event_id/)
    }
    expect(mock).not.toHaveBeenCalled()
  })

  it('update_memory 既没 text 也没 metadata → invalid_argument', async () => {
    const mock = mockMem0(200, {})
    const res = await call('update_memory', { memory_id: 'm1' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_users 的 org_id / project_id 必须同进同出(只给一半会静默漏掉作用域)', async () => {
    const mock = mockMem0(200, { count: 0, results: [] })
    const half = await call('get_users', { org_id: 'org1' })
    expect(half.status).toBe(400)
    expect(((await half.json()) as { message: string }).message).toContain('project_id')
    expect(mock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const both = mockMem0(200, { count: 1, results: [] })
    await call('get_users', { org_id: 'org1', project_id: 'proj1' })
    expect(Object.fromEntries(new URL(sent(both).url).searchParams)).toEqual({
      entity_type: 'user',
      org_id: 'org1',
      project_id: 'proj1',
    })
  })

  it('入参校验真的生效:page_size 越界 → 400 且不打上游', async () => {
    const mock = mockMem0(200, { count: 0, results: [] })
    const res = await call('get_events', { page_size: 500 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 4xx → invalid_argument,5xx → unavailable + retryable', async () => {
    mockMem0(400, { detail: [{ msg: 'query is required' }, { msg: 'top_k too large' }] })
    const bad = await call('search_memories', { query: 'x' })
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      // FastAPI 的 detail 数组要拼成一条人能读的消息,不能原样丢 JSON 给调用方。
      message: 'query is required; top_k too large',
    })

    vi.unstubAllGlobals()
    mockMem0(404, { detail: 'Memory not found' })
    await expect((await call('get_memory', { memory_id: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Memory not found' })

    vi.unstubAllGlobals()
    mockMem0(401, { detail: 'Invalid token.' })
    const denied = await call('get_events', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({ code: 'permission_denied' })

    vi.unstubAllGlobals()
    mockMem0(502, { message: 'upstream boom' })
    await expect((await call('get_events', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'upstream boom' })
  })

  it('错误体不是 JSON 时原样当消息,空体退回状态码消息', async () => {
    const html = vi.fn(() => Promise.resolve(new Response('<html>502</html>', { status: 500 })))
    vi.stubGlobal('fetch', html)
    await expect((await call('get_events', {})).json())
      .resolves.toMatchObject({ message: '<html>502</html>' })

    vi.unstubAllGlobals()
    const empty = vi.fn(() => Promise.resolve(new Response(null, { status: 500 })))
    vi.stubGlobal('fetch', empty)
    await expect((await call('get_events', {})).json())
      .resolves.toMatchObject({ message: 'Mem0 返回 HTTP 500' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockMem0(200, {})
    const res = await call('get_events', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
