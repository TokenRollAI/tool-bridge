import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLoyversePlugin } from '../../src/loyverse/index'
import { loyverseActions } from '../../src/loyverse/schema'

/**
 * Loyverse 迁移产物的 wire 级验收。重点在两个上游怪异:HTTP 200 里藏 errors,
 * 以及各资源 id 过滤参数名不统一(store_ids / items_ids / categories_ids / customer_ids)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'loyverse_test_token'
const plugin = createLoyversePlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'pos/loyverse',
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

function mockLoyverse(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 11 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(loyverseActions).length)
    expect(tools).toHaveLength(11)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('Loyverse 侧全部只读,effect 应当都是 read', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string }>
    expect(tools.every(tool => tool.effect === 'read')).toBe(true)
  })
})

describe('请求构造', () => {
  it('list_items 用 items_ids,时间筛选映射成 snake_case,凭证走 Bearer', async () => {
    const mock = mockLoyverse(200, { items: [], cursor: null })
    await call('list_items', {
      ids: ['i1', 'i2'],
      createdAtMin: '2024-01-01T00:00:00Z',
      updatedAtMax: '2024-02-01T00:00:00Z',
      limit: 100,
      cursor: 'c1',
      showDeleted: false,
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.loyverse.com/v1.0/items')
    expect(url.searchParams.get('items_ids')).toBe('i1,i2')
    expect(url.searchParams.get('created_at_min')).toBe('2024-01-01T00:00:00Z')
    expect(url.searchParams.get('updated_at_max')).toBe('2024-02-01T00:00:00Z')
    expect(url.searchParams.get('limit')).toBe('100')
    expect(url.searchParams.get('cursor')).toBe('c1')
    // showDeleted:false 要发出去,不能被"假值即省略"吞掉。
    expect(url.searchParams.get('show_deleted')).toBe('false')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
  })

  it('各资源的 id 过滤参数名不同,别当成通用名', async () => {
    const stores = mockLoyverse(200, { stores: [] })
    await call('list_stores', { ids: ['s1'] })
    expect(new URL(sent(stores).url).searchParams.get('store_ids')).toBe('s1')
    vi.unstubAllGlobals()

    const categories = mockLoyverse(200, { categories: [] })
    await call('list_categories', { ids: ['c1'] })
    expect(new URL(sent(categories).url).searchParams.get('categories_ids')).toBe('c1')
    vi.unstubAllGlobals()

    const customers = mockLoyverse(200, { customers: [] })
    await call('list_customers', { ids: ['cu1'], email: 'ada@example.com' })
    const url = new URL(sent(customers).url)
    expect(url.searchParams.get('customer_ids')).toBe('cu1')
    expect(url.searchParams.get('email')).toBe('ada@example.com')
  })

  it('get_receipt 的 receiptNumber 被 URL 编码进路径', async () => {
    const mock = mockLoyverse(200, { receipt_number: '1-1' })
    await call('get_receipt', { receiptNumber: '1 1' })
    expect(sent(mock).url).toBe('https://api.loyverse.com/v1.0/receipts/1%201')
  })
})

describe('响应形状', () => {
  it('list 拆出记录数组与 cursor,raw 保留整个响应', async () => {
    mockLoyverse(200, { stores: [{ id: 's1', name: 'Main' }], cursor: 'next_1', extra: 'kept' })
    await expect((await call('list_stores', {})).json()).resolves.toEqual({
      content: {
        stores: [{ id: 's1', name: 'Main' }],
        cursor: 'next_1',
        raw: { stores: [{ id: 's1', name: 'Main' }], cursor: 'next_1', extra: 'kept' },
      },
    })
  })

  it('get_merchant 原样透出上游对象(不做字段归一)', async () => {
    const mock = mockLoyverse(200, { id: 'm1', business_name: 'Cafe' })
    await expect((await call('get_merchant', {})).json()).resolves.toEqual({
      content: { merchant: { id: 'm1', business_name: 'Cafe' } },
    })
    expect(sent(mock).url).toBe('https://api.loyverse.com/v1.0/merchant/')
  })

  it('list 响应缺记录数组 → unavailable(上游契约破损)', async () => {
    mockLoyverse(200, { cursor: null })
    await expect((await call('list_items', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:limit 超上限 → 400 且不打上游', async () => {
    const mock = mockLoyverse(200, { items: [] })
    const res = await call('list_items', { limit: 999 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('schema 把 id 标成 optional,缺它时本地挡下而不是打出 /items/undefined', async () => {
    const mock = mockLoyverse(200, {})
    const res = await call('get_item', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 里的 errors 也算失败(Loyverse 的怪异行为)', async () => {
    mockLoyverse(200, { errors: [{ code: 'NOT_FOUND', field: 'id', details: 'no such item' }] })
    await expect((await call('get_item', { id: 'i9' })).json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'NOT_FOUND: id: no such item',
    })
  })

  it('上游错误按状态归一', async () => {
    mockLoyverse(401, { errors: [{ code: 'UNAUTHORIZED', details: 'bad token' }] })
    const denied = await call('list_stores', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'UNAUTHORIZED: bad token',
    })
    vi.unstubAllGlobals()

    mockLoyverse(429, { errors: [{ code: 'TOO_MANY_REQUESTS' }] })
    await expect((await call('list_stores', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
    vi.unstubAllGlobals()

    mockLoyverse(500, {})
    await expect((await call('list_stores', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockLoyverse(200, { stores: [] })
    const res = await call('list_stores', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
