import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppstleSubscriptionsPlugin } from '../../src/appstle_subscriptions/index'
import { appstleSubscriptionsActions } from '../../src/appstle_subscriptions/schema'

/**
 * Appstle Subscriptions 迁移产物的 wire 级验收。重点在 `X-API-Key` 头、
 * Spring 分页参数(page/size 恒发、sort 可重复)、以及非数组响应降级成空数组。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'apst_test_key'
const plugin = createAppstleSubscriptionsPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'commerce/appstle',
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

function mockAppstle(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(appstleSubscriptionsActions).length)
    expect(tools).toHaveLength(4)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('全部 action 都是 read', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string }>
    expect(tools.every(tool => tool.effect === 'read')).toBe(true)
  })
})

describe('list_customers_with_subscriptions', () => {
  it('凭证走 X-API-Key,page/size 恒发,sort 重复同名键', async () => {
    const mock = mockAppstle(200, [{ customerId: 1, email: 'a@example.com' }])
    const res = await call('list_customers_with_subscriptions', {
      email: 'a@example.com',
      activeMoreThanOneSubscription: true,
      sort: ['id,desc', 'name,asc'],
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('x-api-key')).toBe(API_KEY)
    const url = new URL(request.url)
    expect(url.origin).toBe('https://subscription-admin.appstle.com')
    expect(url.pathname).toBe('/api/external/v2/subscription-contract-details/customers')
    expect(url.searchParams.get('email')).toBe('a@example.com')
    expect(url.searchParams.get('activeMoreThanOneSubscription')).toBe('true')
    // 省略时补上游写死的默认值,而非不传。
    expect(url.searchParams.get('page')).toBe('0')
    expect(url.searchParams.get('size')).toBe('25')
    expect(url.searchParams.getAll('sort')).toEqual(['id,desc', 'name,asc'])
    expect(url.searchParams.has('name')).toBe(false)

    await expect(res.json()).resolves.toEqual({
      content: { customers: [{ customerId: 1, email: 'a@example.com' }] },
    })
  })

  it('显式 page/size 覆盖默认值', async () => {
    const mock = mockAppstle(200, [])
    await call('list_customers_with_subscriptions', { page: 3, size: 100 })
    const url = new URL(sent(mock).url)
    expect(url.searchParams.get('page')).toBe('3')
    expect(url.searchParams.get('size')).toBe('100')
  })

  it('上游回 null 时降级成空数组', async () => {
    mockAppstle(200, null)
    await expect((await call('list_customers_with_subscriptions', {})).json())
      .resolves.toEqual({ content: { customers: [] } })
  })
})

describe('按客户查询的三个 action', () => {
  it('customerId 拼进路径,cursor 进 query', async () => {
    const mock = mockAppstle(200, { id: 42 })
    const res = await call('get_customer_with_subscriptions', { customerId: 42, cursor: 'c1' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/external/v2/subscription-customers/42')
    expect(url.searchParams.get('cursor')).toBe('c1')
    await expect(res.json()).resolves.toEqual({ content: { customer: { id: 42 } } })
  })

  it('get_valid_subscription_contract_ids 只留整数项', async () => {
    const mock = mockAppstle(200, [11, '12', 13, null])
    const res = await call('get_valid_subscription_contract_ids', { customerId: 7 })
    expect(new URL(sent(mock).url).pathname).toBe('/api/external/v2/subscription-customers/valid/7')
    await expect(res.json()).resolves.toEqual({ content: { contractIds: [11, 13] } })
  })

  it('list_customer_subscription_details 打 detail 端点', async () => {
    const mock = mockAppstle(200, [{ contractId: 9 }])
    const res = await call('list_customer_subscription_details', { customerId: 7 })
    expect(new URL(sent(mock).url).pathname)
      .toBe('/api/external/v2/subscription-customers-detail/valid/7')
    await expect(res.json()).resolves.toEqual({ content: { subscriptions: [{ contractId: 9 }] } })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:customerId 是 0 → 400 且不打上游', async () => {
    const mock = mockAppstle(200, [])
    const res = await call('get_customer_with_subscriptions', { customerId: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('未声明的字段被 strictObject 挡下,且不打上游', async () => {
    const mock = mockAppstle(200, [])
    const res = await call('list_customers_with_subscriptions', { unknownFilter: 'x' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message 字段', async () => {
    mockAppstle(401, { message: 'Invalid API key' })
    await expect((await call('list_customers_with_subscriptions', {})).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'Invalid API key' })

    mockAppstle(429, { detail: 'Rate limit exceeded' })
    await expect((await call('list_customers_with_subscriptions', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true, message: 'Rate limit exceeded' })

    mockAppstle(404, { error: 'No such customer' })
    await expect((await call('get_customer_with_subscriptions', { customerId: 1 })).json())
      .resolves.toMatchObject({ code: 'not_found' })

    mockAppstle(500, { title: 'Internal error' })
    await expect((await call('list_customers_with_subscriptions', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockAppstle(200, [])
    const res = await call('list_customers_with_subscriptions', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
