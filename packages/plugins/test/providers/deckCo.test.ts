import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeckCoPlugin } from '../../src/deck_co/index'
import { deckCoActions } from '../../src/deck_co/schema'

/**
 * Deck.co 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * base URL 带 /v2 前缀的相对拼接、list 端点 snake_case → camelCase 的信封整形、
 * create_source 那个写死的 type:website、以及可选的 Idempotency-Key 头。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'deck_sk_test'
const plugin = createDeckCoPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'data/deck',
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

function mockDeck(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 6 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(deckCoActions).length)
    expect(tools).toHaveLength(6)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求组装', () => {
  it('list_agents:/v2 前缀保留,分页进 query,响应整形成 camelCase', async () => {
    const mock = mockDeck(200, {
      data: [{ id: 'agt_1', name: 'Ada' }],
      has_more: true,
      next_cursor: 'cur_2',
      request_id: 'req_9',
    })
    const res = await call('list_agents', { limit: 25, cursor: 'cur_1' })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin).toBe('https://api.deck.co')
    expect(url.pathname).toBe('/v2/agents')
    expect(url.searchParams.get('limit')).toBe('25')
    expect(url.searchParams.get('cursor')).toBe('cur_1')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')

    await expect(res.json()).resolves.toEqual({
      content: {
        agents: [{ id: 'agt_1', name: 'Ada' }],
        hasMore: true,
        nextCursor: 'cur_2',
        requestId: 'req_9',
      },
    })
  })

  it('list_sources:上游没给 next_cursor / request_id 时归一成 null', async () => {
    mockDeck(200, { data: [] })
    const res = await call('list_sources', {})
    await expect(res.json()).resolves.toEqual({
      content: { sources: [], hasMore: false, nextCursor: null, requestId: null },
    })
  })

  it('create_source:type 写死 website,website_url 进 website.url', async () => {
    const mock = mockDeck(200, { id: 'src_1', type: 'website' })
    await call('create_source', {
      website_url: 'https://example.com',
      name: 'Docs',
      idempotencyKey: 'idem-1',
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/v2/sources')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(request.headers.get('idempotency-key')).toBe('idem-1')
    await expect(request.json()).resolves.toEqual({
      type: 'website',
      website: { url: 'https://example.com' },
      name: 'Docs',
    })
  })

  it('create_source:省略 name / idempotencyKey 时既不进 body 也不进头', async () => {
    const mock = mockDeck(200, { id: 'src_1' })
    await call('create_source', { website_url: 'https://example.com' })
    const request = sent(mock)
    expect(request.headers.get('idempotency-key')).toBeNull()
    await expect(request.json()).resolves.toEqual({
      type: 'website',
      website: { url: 'https://example.com' },
    })
  })

  it('get_source:路径参数被 URL 编码', async () => {
    const mock = mockDeck(200, { id: 'src/1' })
    await call('get_source', { source_id: 'src/1' })
    expect(new URL(sent(mock).url).pathname).toBe('/v2/sources/src%2F1')
  })

  it('test_api_key 打 /test 且不带 body', async () => {
    const mock = mockDeck(200, { status: 'ok', environment: 'test' })
    await call('test_api_key', {})
    const request = sent(mock)
    expect(new URL(request.url).pathname).toBe('/v2/test')
    expect(request.headers.get('content-type')).toBeNull()
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:website_url 不是 URL → 400 且不打上游', async () => {
    const mock = mockDeck(200, {})
    const res = await call('create_source', { website_url: 'not-a-url' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('limit 超出 1..100 → 400 且不打上游', async () => {
    const mock = mockDeck(200, {})
    const res = await call('list_agents', { limit: 500 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('agent_id 缺失 → 400 且不打上游(schema 把它标成了 optional)', async () => {
    const mock = mockDeck(200, {})
    const res = await call('get_agent', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('agent_id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message 或 errors[0].message', async () => {
    mockDeck(401, { message: 'Invalid API key' })
    const denied = await call('list_agents', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockDeck(429, { message: 'Too many requests' })
    await expect((await call('list_agents', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockDeck(422, { errors: [{ message: 'website_url is not reachable' }] })
    await expect((await call('create_source', { website_url: 'https://example.com' })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'website_url is not reachable' })

    mockDeck(500, { message: 'Deck.co is down' })
    await expect((await call('list_agents', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockDeck(200, {})
    const res = await call('list_agents', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
