import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGumroadPlugin } from '../../src/gumroad/index'
import { gumroadActions } from '../../src/gumroad/schema'

/**
 * Gumroad 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 凭证走 access_token 参数(GET 进 query、写入进 form body)、
 * HTTP 200 但 `success:false` 也算失败、分页游标缺失时补 null。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'gum_test_token'
const plugin = createGumroadPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'commerce/gumroad',
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

function mockGumroad(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 9 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(gumroadActions).length)
    expect(tools).toHaveLength(9)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('get_current_user')).toBe('read')
    expect(effectOf('list_sales')).toBe('read')
    expect(effectOf('refund_sale')).toBe('write')
    expect(effectOf('mark_sale_as_shipped')).toBe('write')
  })
})

describe('凭证与参数编码', () => {
  it('GET:access_token 与过滤器都进 query,分页游标缺失时补 null', async () => {
    const mock = mockGumroad(200, { success: true, sales: [{ id: 's1' }] })
    const res = await call('list_sales', {
      after: '2024-01-01',
      productId: 'prod_1',
      email: 'buyer@example.com',
      pageKey: 'pk-1',
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.gumroad.com/v2/sales')
    // Gumroad 不认 Authorization 头,凭证只能走参数。
    expect(url.searchParams.get('access_token')).toBe(API_KEY)
    expect(request.headers.get('authorization')).toBeNull()
    expect(url.searchParams.get('after')).toBe('2024-01-01')
    expect(url.searchParams.get('product_id')).toBe('prod_1')
    expect(url.searchParams.get('email')).toBe('buyer@example.com')
    expect(url.searchParams.get('page_key')).toBe('pk-1')
    expect(url.searchParams.has('before')).toBe(false)

    await expect(res.json()).resolves.toMatchObject({
      content: { success: true, next_page_url: null, next_page_key: null },
    })
  })

  it('PUT:凭证与参数进 form body,不进 query', async () => {
    const mock = mockGumroad(200, { success: true, sale: { id: 'sale_1', refunded: true } })
    const res = await call('refund_sale', { saleId: 'sale/1', amountCents: 250 })

    const request = sent(mock)
    expect(request.method).toBe('PUT')
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.gumroad.com/v2/sales/sale%2F1/refund')
    expect(url.searchParams.has('access_token')).toBe(false)
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded;charset=UTF-8')

    const body = new URLSearchParams(await request.text())
    expect(body.get('access_token')).toBe(API_KEY)
    expect(body.get('amount_cents')).toBe('250')

    await expect(res.json()).resolves.toMatchObject({ content: { sale: { refunded: true } } })
  })

  it('list_product_subscribers:布尔 paginated 字符串化后进 query', async () => {
    const mock = mockGumroad(200, { success: true, subscribers: [], next_page_key: 'pk-2' })
    const res = await call('list_product_subscribers', { productId: 'prod_1', paginated: true })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v2/products/prod_1/subscribers')
    expect(url.searchParams.get('paginated')).toBe('true')
    // 上游给了 next_page_key 就原样透出,只有缺的那个补 null。
    await expect(res.json()).resolves.toMatchObject({
      content: { next_page_key: 'pk-2', next_page_url: null },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:amountCents 给 0 → 400 且不打上游', async () => {
    const mock = mockGumroad(200, {})
    const res = await call('refund_sale', { saleId: 's1', amountCents: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺必填 productId → 400 且不打上游', async () => {
    const mock = mockGumroad(200, {})
    const res = await call('get_product', {})
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 但 success:false 也算失败,归到 unavailable', async () => {
    mockGumroad(200, { success: false, message: 'The product was not found.' })
    await expect((await call('get_product', { productId: 'nope' })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'The product was not found.' })
  })

  it('上游错误按状态归一,消息取自 Gumroad 的 message', async () => {
    mockGumroad(401, { success: false, message: 'Unauthorized' })
    const denied = await call('list_products', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthorized',
    })

    mockGumroad(429, { success: false, message: 'Rate limited' })
    await expect((await call('list_products', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockGumroad(500, { success: false, message: 'Gumroad is down' })
    await expect((await call('list_products', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockGumroad(200, {})
    const res = await call('list_products', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
