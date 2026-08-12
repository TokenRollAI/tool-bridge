import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFidelApiPlugin } from '../../src/fidel_api/index'
import { fidelApiActions } from '../../src/fidel_api/schema'

/**
 * Fidel API 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 凭证走 Fidel-Key 头、`{items,count,last}` 信封(单条查询也走 items[0])、
 * 逐字段定型成 null 而不是省略、logoUrl/logoURL 这类大小写变体、以及对象型游标的序列化。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'fidel_sk_test'
const plugin = createFidelApiPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'payments/fidel',
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

function mockFidel(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
    const tools = (await res.json()) as Array<{ effect?: string, inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(fidelApiActions).length)
    expect(tools).toHaveLength(6)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
      expect(tool.effect, `${tool.name} 的 effect`).toBe('read')
    }
  })
})

describe('请求组装', () => {
  it('list_brands:凭证走 Fidel-Key 头,分页与过滤进 query', async () => {
    const mock = mockFidel(200, {
      count: 42,
      items: [{ id: 'brand_1', name: 'Acme', logoURL: 'https://cdn.example.com/a.png', live: true }],
      last: 'cursor_2',
      resource: '/v1/brands',
      status: 200,
      execution: 12.5,
    })
    const res = await call('list_brands', { limit: 10, start: 'cursor_1', order: 'desc', name: 'Acme' })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin).toBe('https://api.fidel.uk')
    expect(url.pathname).toBe('/v1/brands')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('start')).toBe('cursor_1')
    expect(url.searchParams.get('order')).toBe('desc')
    expect(url.searchParams.get('name')).toBe('Acme')
    expect(request.headers.get('fidel-key')).toBe(API_KEY)
    expect(request.headers.get('accept')).toBe('application/json')
    // 凭证只走 Fidel-Key,不该另外冒出 authorization 头。
    expect(request.headers.get('authorization')).toBeNull()

    await expect(res.json()).resolves.toEqual({
      content: {
        // count 是上游给的总数,不是本页条数。
        count: 42,
        brands: [{
          id: 'brand_1',
          accountId: null,
          created: null,
          updated: null,
          name: 'Acme',
          metadata: null,
          // 上游用的是 logoURL 变体。
          logoUrl: 'https://cdn.example.com/a.png',
          live: true,
          consent: null,
          websiteUrl: null,
        }],
        nextCursor: 'cursor_2',
        resource: '/v1/brands',
        status: 200,
        executionMs: 12.5,
      },
    })
  })

  it('省略的可选参数不出现在 query 里', async () => {
    const mock = mockFidel(200, { items: [] })
    await call('list_brands', {})
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual([])
  })

  it('信封缺 count/resource/status/execution 时各自退回缺省值', async () => {
    mockFidel(200, { items: [{ id: 'card_1' }] })
    const res = await call('list_cards', { programId: 'prog_1' })
    await expect(res.json()).resolves.toMatchObject({
      content: {
        // count 缺失就退回本页条数;resource 缺失就用请求路径补成 /v1 开头。
        count: 1,
        nextCursor: null,
        resource: '/v1/programs/prog_1/cards',
        status: 200,
        executionMs: null,
      },
    })
  })

  it('对象型游标被序列化成字符串原样回传', async () => {
    mockFidel(200, { items: [], last: { id: 'x', created: '2024-01-01' } })
    const res = await call('list_brands', {})
    await expect(res.json()).resolves.toMatchObject({
      content: { nextCursor: '{"id":"x","created":"2024-01-01"}' },
    })
  })

  it('get_brand:单条查询也走 items[0]', async () => {
    const mock = mockFidel(200, { items: [{ id: 'brand_1', name: 'Acme' }], resource: '/v1/brands' })
    const res = await call('get_brand', { brandId: 'brand/1' })
    expect(new URL(sent(mock).url).pathname).toBe('/v1/brands/brand%2F1')
    await expect(res.json()).resolves.toMatchObject({
      content: { brand: { id: 'brand_1', name: 'Acme', metadata: null } },
    })
  })

  it('list_transactions:时间窗进 query,嵌套结构逐层定型', async () => {
    const mock = mockFidel(200, {
      count: 1,
      items: [{
        id: 'tx_1',
        amount: 12.34,
        approvalCode: 'A1B2C3',
        card: { id: 'card_1', lastNumbers: '4242' },
        location: { city: 'London', geolocation: { latitude: 51.5 } },
        brand: { id: 'brand_1', logoURL: 'https://cdn.example.com/b.png' },
        identifiers: { MID: 'mid_1' },
      }],
    })
    const res = await call('list_transactions', {
      programId: 'prog_1',
      from: '2024-01-01T00:00:00+00:00',
      to: '2024-02-01T00:00:00+00:00',
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/programs/prog_1/transactions')
    expect(url.searchParams.get('from')).toBe('2024-01-01T00:00:00+00:00')
    expect(url.searchParams.get('to')).toBe('2024-02-01T00:00:00+00:00')

    const body = (await res.json()) as { content: { transactions: Array<Record<string, unknown>> } }
    const tx = body.content.transactions[0]!
    expect(tx.id).toBe('tx_1')
    expect(tx.amount).toBe(12.34)
    // approvalCode / authCode 归一成 authorizationCode。
    expect(tx.authorizationCode).toBe('A1B2C3')
    expect(tx.card).toEqual({ id: 'card_1', firstNumbers: null, lastNumbers: '4242', scheme: null })
    expect(tx.location).toMatchObject({
      city: 'London',
      geolocation: { latitude: 51.5, longitude: null },
      timezone: null,
    })
    expect(tx.brand).toMatchObject({ id: 'brand_1', logoUrl: 'https://cdn.example.com/b.png' })
    // 上游用的是大写的 MID 变体。
    expect(tx.identifiers).toMatchObject({ mid: 'mid_1', visaAuthCode: null })
    expect(tx.cardPresent).toBeNull()
  })

  it('嵌套 location 整个缺失时 geolocation 归一成 null', async () => {
    mockFidel(200, { items: [{ id: 'tx_1' }] })
    const res = await call('get_transaction', { transactionId: 'tx_1' })
    const body = (await res.json()) as { content: { transaction: Record<string, Record<string, unknown>> } }
    expect(body.content.transaction.location!.geolocation).toBeNull()
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:limit 为 0 → 400 且不打上游', async () => {
    const mock = mockFidel(200, { items: [] })
    const res = await call('list_brands', { limit: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('order 不是 asc/desc → 400 且不打上游', async () => {
    const mock = mockFidel(200, { items: [] })
    const res = await call('list_cards', { programId: 'prog_1', order: 'random' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('brandId 缺失 → 400 且不打上游', async () => {
    const mock = mockFidel(200, { items: [] })
    const res = await call('get_brand', {})
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息从嵌套的 body 里逐层剥出来', async () => {
    mockFidel(401, { error: { message: 'Invalid Fidel key' } })
    const denied = await call('list_brands', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid Fidel key',
    })

    // Fidel 会把真正的错误再套一层 JSON 字符串塞进 body。
    mockFidel(400, { body: JSON.stringify({ error: { message: 'limit must be positive' } }) })
    await expect((await call('list_brands', {})).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'limit must be positive' })

    mockFidel(429, { error: { message: 'Too many requests' } })
    await expect((await call('list_brands', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    // 上游把 404 压成 400,这里保留 not_found。
    mockFidel(404, { error: { title: 'Brand not found' } })
    const missing = await call('get_brand', { brandId: 'nope' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'Brand not found' })

    mockFidel(500, { error: { message: 'Fidel is down' } })
    await expect((await call('list_brands', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('响应缺 items 数组 → unavailable(上游契约破了,不是调用方的错)', async () => {
    mockFidel(200, { count: 0 })
    const res = await call('list_brands', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('单条查询拿到空 items → unavailable', async () => {
    mockFidel(200, { items: [] })
    const res = await call('get_card', { cardId: 'card_1' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockFidel(200, { items: [] })
    const res = await call('list_brands', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
