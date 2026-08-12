import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBookingmoodPlugin } from '../../src/bookingmood/index'
import { bookingmoodActions } from '../../src/bookingmood/schema'

/**
 * Bookingmood 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * PostgREST query 的 select 缺省、列表裸数组的整形、availability 三种形状的归一。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'bookingmood_live_key'
const plugin = createBookingmoodPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ops/bookingmood',
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

function mockBookingmood(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 3 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(bookingmoodActions).length)
    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('PostgREST query 拼装', () => {
  it('list_products 缺省 select=*,过滤器与分页原样进 query', async () => {
    const mock = mockBookingmood(200, [{ id: 'p1', name: { default: 'Cabin' } }])
    const res = await call('list_products', {
      limit: 5,
      offset: 10,
      order: 'created_at.desc',
      organization_id: 'org_1',
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.bookingmood.com/v1/products')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(url.searchParams.get('select')).toBe('*')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('offset')).toBe('10')
    expect(url.searchParams.get('order')).toBe('created_at.desc')
    expect(url.searchParams.get('organization_id')).toBe('org_1')
    // products 端点没有 product_id 过滤器,省略的键不该出现。
    expect(url.searchParams.has('product_id')).toBe(false)
    expect(url.searchParams.has('id')).toBe(false)

    await expect(res.json()).resolves.toEqual({
      content: { products: [{ id: 'p1', name: { default: 'Cabin' } }] },
    })
  })

  it('显式给的 select 覆盖缺省值', async () => {
    const mock = mockBookingmood(200, [])
    await call('list_bookings', { select: 'id,status', product_id: 'p1' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/bookings')
    expect(url.searchParams.get('select')).toBe('id,status')
    expect(url.searchParams.get('product_id')).toBe('p1')
  })
})

describe('availability 形状归一', () => {
  const PRODUCT = '3f1a2b4c-5d6e-4f80-9a1b-2c3d4e5f6071'

  it('裸数组直接透出,raw 保留原始 payload', async () => {
    const payload = [{ date: '2026-01-01', available: true }]
    const mock = mockBookingmood(200, payload)
    const res = await call('query_availability', { product_id: PRODUCT, start: '2026-01-01', end: '2026-01-31' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/availability')
    expect(url.searchParams.get('product_id')).toBe(PRODUCT)
    expect(url.searchParams.get('start')).toBe('2026-01-01')
    expect(url.searchParams.get('end')).toBe('2026-01-31')

    await expect(res.json()).resolves.toEqual({
      content: { availability: payload, raw: payload },
    })
  })

  it('数组被裹在任意键下时也能取出来', async () => {
    mockBookingmood(200, { data: [{ date: '2026-02-01', available: false }] })
    const res = await call('query_availability', { product_id: PRODUCT })
    await expect(res.json()).resolves.toMatchObject({
      content: { availability: [{ date: '2026-02-01', available: false }] },
    })
  })

  it('单条对象被包成单元素数组', async () => {
    mockBookingmood(200, { date: '2026-03-01', available: true })
    const res = await call('query_availability', { product_id: PRODUCT })
    await expect(res.json()).resolves.toMatchObject({
      content: { availability: [{ date: '2026-03-01', available: true }] },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:product_id 不是 UUID → 400 且不打上游', async () => {
    const mock = mockBookingmood(200, [])
    const res = await call('query_availability', { product_id: 'not-a-uuid' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('未声明的字段被 strictObject 挡下,不打上游', async () => {
    const mock = mockBookingmood(200, [])
    const res = await call('list_products', { nope: 1 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message/error/details', async () => {
    mockBookingmood(401, { message: 'Invalid API key' })
    const unauthorized = await call('list_products', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockBookingmood(429, { error: 'Too many requests' })
    await expect((await call('list_products', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'Too many requests', retryable: true })

    mockBookingmood(503, { details: 'Bookingmood is down' })
    await expect((await call('list_bookings', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'Bookingmood is down', retryable: true })
  })

  it('列表端点回非数组 → unavailable(上游破契约,不是调用方的错)', async () => {
    mockBookingmood(200, { products: [] })
    const res = await call('list_products', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockBookingmood(200, [])
    const res = await call('list_products', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
