import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRechargePlugin } from '../../src/recharge/index'
import { rechargeActions } from '../../src/recharge/schema'

/**
 * Recharge 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * `x-recharge-access-token` + 必带的版本头、驼峰入参 → 下划线 query 的改名、
 * 数组逗号拼接、cursor 分页的两个游标。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'recharge_token_deadbeef'
const plugin = createRechargePlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'commerce/recharge',
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

function mockRecharge(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 10 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(rechargeActions).length)
    expect(tools).toHaveLength(10)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('十个 action 全是只读', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    for (const tool of tools) {
      expect(tool.effect, `${tool.name} 不是 read`).toBe('read')
    }
  })
})

describe('请求成形', () => {
  it('凭证走 x-recharge-access-token,并带上必需的版本头', async () => {
    const mock = mockRecharge(200, { customers: [] })
    await call('list_customers', {})
    const request = sent(mock)
    expect(request.url).toBe('https://api.rechargeapps.com/customers')
    expect(request.headers.get('x-recharge-access-token')).toBe(API_KEY)
    expect(request.headers.get('x-recharge-version')).toBe('2021-11')
    expect(request.headers.get('authorization')).toBeNull()
  })

  it('驼峰入参改成下划线 query,数组逗号拼接', async () => {
    const mock = mockRecharge(200, { charges: [] })
    await call('list_charges', {
      limit: 50,
      sortBy: 'id-desc',
      createdAtMin: '2024-01-01',
      customerId: 'cus_1',
      ids: ['1', '2'],
      include: ['address', 'customer'],
    })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/charges')
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.get('sort_by')).toBe('id-desc')
    expect(url.searchParams.get('created_at_min')).toBe('2024-01-01')
    expect(url.searchParams.get('customer_id')).toBe('cus_1')
    expect(url.searchParams.get('ids')).toBe('1,2')
    expect(url.searchParams.get('include')).toBe('address,customer')
    // 没给的过滤项一律不出现。
    expect(url.searchParams.has('status')).toBe(false)
    expect(url.searchParams.has('cursor')).toBe(false)
  })

  it('get 用路径参数,include 仍走 query', async () => {
    const mock = mockRecharge(200, { subscription: { id: 1 } })
    await call('get_subscription', { id: 'sub/1', include: ['address'] })
    const url = new URL(sent(mock).url)
    expect(url.origin + url.pathname).toBe('https://api.rechargeapps.com/subscriptions/sub%2F1')
    expect(url.searchParams.get('include')).toBe('address')
  })
})

describe('响应归一', () => {
  it('列表拆出两个游标,raw 原样保留', async () => {
    mockRecharge(200, {
      orders: [{ id: 1 }],
      next_cursor: 'c2',
      previous_cursor: null,
    })
    await expect((await call('list_orders', {})).json()).resolves.toEqual({
      content: {
        orders: [{ id: 1 }],
        nextCursor: 'c2',
        previousCursor: null,
        raw: { orders: [{ id: 1 }], next_cursor: 'c2', previous_cursor: null },
      },
    })
  })

  it('列表键不是数组 → unavailable(不把坏数据当空结果吞掉)', async () => {
    mockRecharge(200, { products: { unexpected: true } })
    await expect((await call('list_products', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('get 剥掉单数键的外壳,raw 保留完整响应', async () => {
    mockRecharge(200, { product: { id: 7, title: 'Widget' } })
    await expect((await call('get_product', { id: '7' })).json()).resolves.toEqual({
      content: {
        product: { id: 7, title: 'Widget' },
        raw: { product: { id: 7, title: 'Widget' } },
      },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:limit 超 250 → 400 且不打上游', async () => {
    const mock = mockRecharge(200, {})
    const res = await call('list_customers', { limit: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:get 缺 id → 400 且不打上游', async () => {
    const mock = mockRecharge(200, {})
    const res = await call('get_customer', {})
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一', async () => {
    mockRecharge(401, { error: 'Invalid access token' })
    const denied = await call('list_customers', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid access token',
    })

    mockRecharge(429, { error: 'Too many requests' })
    await expect((await call('list_customers', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockRecharge(404, { errors: 'Not Found', message: 'customer not found' })
    await expect((await call('get_customer', { id: 'missing' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'customer not found' })

    mockRecharge(500, { error: 'Recharge is down' })
    await expect((await call('list_customers', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockRecharge(200, {})
    const res = await call('list_customers', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
