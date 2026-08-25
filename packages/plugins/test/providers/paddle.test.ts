import { describe, expect, it } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createPaddlePlugin } from '../../src/paddle/index'
import { paddleActions } from '../../src/paddle/schema'

/**
 * Paddle 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 多值过滤器的逗号拼接、skipCount 走请求头而非查询参数、`{data,meta}` 剥壳、
 * 写入体去掉路径参数 id 但保留 null(Paddle 用 null 清空字段)。
 */

const API_KEY = 'pdl_test_key'
const plugin = createPaddlePlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockPaddle,
} = createProviderHarness({
  mountPath: 'billing/paddle',
  plugin,
  upstreamAuth: API_KEY,
})

describe('契约面', () => {
  it('List 出全部 12 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(paddleActions).length)
    expect(tools).toHaveLength(12)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_products')).toBe('read')
    expect(effectOf('get_customer')).toBe('read')
    expect(effectOf('create_price')).toBe('write')
    expect(effectOf('update_customer')).toBe('write')
  })
})

describe('查询参数与请求头', () => {
  it('多值过滤器逗号拼接,skipCount 走 Skip-Count 头,{data,meta} 剥壳', async () => {
    const mock = mockPaddle(200, {
      data: [{ id: 'pro_1' }],
      meta: { request_id: 'r1', pagination: { has_more: true } },
    })
    const res = await call('list_products', {
      after: 'pro_0',
      perPage: 50,
      orderBy: 'id[DESC]',
      skipCount: true,
      ids: ['pro_1', 'pro_2'],
      include: ['prices'],
      status: ['active', 'archived'],
      type: 'standard',
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('skip-count')).toBe('true')
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.paddle.com/products')
    expect(url.searchParams.get('after')).toBe('pro_0')
    expect(url.searchParams.get('per_page')).toBe('50')
    expect(url.searchParams.get('order_by')).toBe('id[DESC]')
    expect(url.searchParams.get('id')).toBe('pro_1,pro_2')
    expect(url.searchParams.get('status')).toBe('active,archived')
    expect(url.searchParams.get('include')).toBe('prices')
    expect(url.searchParams.get('type')).toBe('standard')

    await expect(res.json()).resolves.toMatchObject({
      content: { data: [{ id: 'pro_1' }], meta: { request_id: 'r1' } },
    })
  })

  it('list_prices 的点号参数名原样保留,布尔过滤器字符串化', async () => {
    const mock = mockPaddle(200, { data: [], meta: {} })
    await call('list_prices', {
      recurring: false,
      billingCycleInterval: 'month',
      billingCycleFrequency: 3,
      productIds: ['pro_1'],
    })
    const url = new URL(sent(mock).url)
    expect(url.searchParams.get('recurring')).toBe('false')
    expect(url.searchParams.get('billing_cycle.interval')).toBe('month')
    expect(url.searchParams.get('billing_cycle.frequency')).toBe('3')
    expect(url.searchParams.get('product_id')).toBe('pro_1')
    // 没传 skipCount 时不该出现这个头。
    expect(sent(mock).headers.get('skip-count')).toBeNull()
  })
})

describe('写入路径', () => {
  it('update_customer:PATCH + 路径参数编码,id 不进 body,null 保留', async () => {
    const mock = mockPaddle(200, { data: { id: 'ctm_1', status: 'archived' }, meta: {} })
    const res = await call('update_customer', {
      id: 'ctm/1',
      name: 'Ada',
      custom_data: null,
      status: 'archived',
    })

    const request = sent(mock)
    expect(request.method).toBe('PATCH')
    expect(request.url).toBe('https://api.paddle.com/customers/ctm%2F1')
    expect(request.headers.get('content-type')).toBe('application/json')
    // Paddle 用 null 表示"清空该字段",不能与"未提供"混为一谈。
    await expect(request.json()).resolves.toEqual({ name: 'Ada', custom_data: null, status: 'archived' })

    await expect(res.json()).resolves.toMatchObject({
      content: { customer: { id: 'ctm_1', status: 'archived' } },
    })
  })

  it('create_price:嵌套对象原样进 JSON 体', async () => {
    const mock = mockPaddle(200, { data: { id: 'pri_1' }, meta: {} })
    await call('create_price', {
      product_id: 'pro_1',
      description: 'Monthly',
      unit_price: { amount: '1000', currency_code: 'USD' },
      billing_cycle: { interval: 'month', frequency: 1 },
    })
    const request = sent(mock)
    expect(new URL(request.url).pathname).toBe('/prices')
    await expect(request.json()).resolves.toEqual({
      product_id: 'pro_1',
      description: 'Monthly',
      unit_price: { amount: '1000', currency_code: 'USD' },
      billing_cycle: { interval: 'month', frequency: 1 },
    })
  })

  it('detail 响应的 data 不是对象时归一成 null,不报错', async () => {
    mockPaddle(200, { data: null, meta: {} })
    await expect((await call('get_product', { id: 'pro_1' })).json())
      .resolves.toMatchObject({ content: { product: null } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:perPage 超上限 → 400 且不打上游', async () => {
    const mock = mockPaddle(200, {})
    const res = await call('list_products', { perPage: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('schema 标 optional 但拼 URL 必需的 id 缺失 → 400 且不打上游', async () => {
    const mock = mockPaddle(200, {})
    const res = await call('get_product', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息优先取 error.detail', async () => {
    mockPaddle(401, { error: { detail: 'Authentication failed', code: 'unauthorized' } })
    const denied = await call('list_products', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Authentication failed',
    })

    mockPaddle(404, { error: { detail: 'Entity not found' } })
    await expect((await call('get_product', { id: 'pro_x' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Entity not found' })

    mockPaddle(429, { error: { detail: 'Too many requests' } })
    await expect((await call('list_products', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockPaddle(500, { error: { detail: 'Paddle is down' } })
    await expect((await call('list_products', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockPaddle(200, {})
    const res = await call('list_products', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
