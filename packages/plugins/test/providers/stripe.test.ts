import { describe, expect, it } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createStripePlugin } from '../../src/stripe/index'
import { stripeActions } from '../../src/stripe/schema'

/**
 * Stripe 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * form-encoded 的方括号嵌套、空值语义、cursor 分页、路径参数注入、跨字段互斥校验。
 */

const API_KEY = 'sk_test_deadbeef'
const plugin = createStripePlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockStripe,
} = createProviderHarness({
  mountPath: 'billing/stripe',
  plugin,
  upstreamAuth: API_KEY,
})

describe('契约面', () => {
  it('List 出全部 18 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(stripeActions).length)
    expect(tools).toHaveLength(18)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_customers')).toBe('read')
    expect(effectOf('get_customer')).toBe('read')
    expect(effectOf('search_prices')).toBe('read')
    expect(effectOf('delete_customer')).toBe('destructive')
    expect(effectOf('create_customer')).toBe('write')
  })
})

describe('form 编码(Stripe 的方括号嵌套)', () => {
  it('嵌套对象展开成 a[b],凭证走 Bearer', async () => {
    const mock = mockStripe(200, { id: 'cus_1' })
    await call('create_customer', {
      name: 'Ada',
      address: { city: 'SF', postal_code: '94110' },
      metadata: { plan: 'pro', seats: 3 },
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.stripe.com/v1/customers')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('stripe-version')).toBe('2024-06-20')
    const body = new URLSearchParams(await request.text())
    expect(body.get('name')).toBe('Ada')
    expect(body.get('address[city]')).toBe('SF')
    expect(body.get('address[postal_code]')).toBe('94110')
    expect(body.get('metadata[plan]')).toBe('pro')
    expect(body.get('metadata[seats]')).toBe('3')
  })

  it('数组重复同名键(Stripe 的数组约定)', async () => {
    const mock = mockStripe(200, { id: 'prod_1' })
    await call('create_product', {
      name: 'Widget',
      images: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'],
    })
    const body = new URLSearchParams(await sent(mock).text())
    expect(body.getAll('images')).toEqual([
      'https://cdn.example.com/a.png',
      'https://cdn.example.com/b.png',
    ])
  })

  it('省略的可选字段不出现在 body 里(空串对 Stripe 是"清空",不能误发)', async () => {
    const mock = mockStripe(200, { id: 'cus_1' })
    await call('create_customer', { name: 'Ada' })
    const body = new URLSearchParams(await sent(mock).text())
    expect(body.has('email')).toBe(false)
    expect(body.has('description')).toBe(false)
    expect([...body.keys()]).toEqual(['name'])
  })
})

describe('分页与路径参数', () => {
  it('cursor 分页参数进 query,has_more 原样透出', async () => {
    const mock = mockStripe(200, {
      object: 'list',
      url: '/v1/customers',
      has_more: true,
      data: [{ id: 'cus_1' }],
    })
    const res = await call('list_customers', { limit: 2, starting_after: 'cus_0' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/customers')
    expect(url.searchParams.get('limit')).toBe('2')
    expect(url.searchParams.get('starting_after')).toBe('cus_0')
    await expect(res.json()).resolves.toMatchObject({
      content: { customers: { has_more: true } },
    })
  })

  it('路径参数被 URL 编码,且不重复出现在 body 里', async () => {
    const mock = mockStripe(200, { id: 'cus_a/b' })
    await call('update_customer', { customerId: 'cus_a/b', name: 'New' })
    const request = sent(mock)
    expect(request.url).toBe('https://api.stripe.com/v1/customers/cus_a%2Fb')
    const body = new URLSearchParams(await request.text())
    expect(body.has('customerId')).toBe(false)
    expect(body.get('name')).toBe('New')
  })

  it('delete 返回归一形状,raw 保留完整响应', async () => {
    mockStripe(200, { id: 'cus_1', object: 'customer', deleted: true, livemode: false })
    const res = await call('delete_customer', { customerId: 'cus_1' })
    await expect(res.json()).resolves.toEqual({
      content: {
        deleted: true,
        object: 'customer',
        id: 'cus_1',
        raw: { id: 'cus_1', object: 'customer', deleted: true, livemode: false },
      },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:email 给数字 → 400 且不打上游', async () => {
    const mock = mockStripe(200, {})
    const res = await call('create_customer', { email: 12345 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('create_price 的跨字段互斥在本地就挡下(Stripe 的服务端错误信息含糊)', async () => {
    const mock = mockStripe(200, {})
    const res = await call('create_price', {
      currency: 'usd',
      product: 'prod_1',
      unit_amount: 500,
      custom_unit_amount: { enabled: true },
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('custom_unit_amount')
    expect(mock).not.toHaveBeenCalled()
  })

  it('create_price 缺金额 → 400', async () => {
    mockStripe(200, {})
    const res = await call('create_price', { currency: 'usd', product: 'prod_1' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('unit_amount')
  })

  it('上游错误按状态归一,消息取自 Stripe 的 error.message', async () => {
    mockStripe(404, { error: { message: 'No such customer: cus_missing' } })
    const missing = await call('get_customer', { customerId: 'cus_missing' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'No such customer: cus_missing',
    })

    mockStripe(401, { error: { message: 'Invalid API Key provided' } })
    expect((await call('list_customers', {})).status).toBe(401)

    mockStripe(429, { error: { message: 'Too many requests' } })
    await expect((await call('list_customers', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockStripe(500, { error: { message: 'Stripe is down' } })
    await expect((await call('list_customers', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockStripe(200, {})
    const res = await call('list_customers', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
