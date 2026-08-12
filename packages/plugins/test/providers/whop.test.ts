import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWhopPlugin } from '../../src/whop/index'
import { whopActions } from '../../src/whop/schema'

/**
 * Whop 迁移产物的 wire 级验收。重点在:数组过滤器重复同名键(不是逗号串)、
 * `api-version-date` 头、schema 标可选但实际必填的路径参数、错误信封的消息提取。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'whop_test_key'
const plugin = createWhopPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'commerce/whop',
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

function mockWhop(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 8 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(whopActions).length)
    expect(tools).toHaveLength(8)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('全部 action 都是 read', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    for (const tool of tools) {
      expect(tool.effect, `${tool.name} 的 effect 不对`).toBe('read')
    }
  })
})

describe('请求形状', () => {
  it('list_memberships:数组过滤器重复同名键,标量走 set,凭证走 Bearer', async () => {
    const mock = mockWhop(200, { data: [{ id: 'mem_1' }], page_info: { has_next_page: false } })
    const res = await call('list_memberships', {
      company_id: 'biz_1',
      statuses: ['active', 'trialing'],
      product_ids: ['prod_1'],
      first: 10,
      direction: 'desc',
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin).toBe('https://api.whop.com')
    expect(url.pathname).toBe('/api/v1/memberships')
    expect(url.searchParams.getAll('statuses')).toEqual(['active', 'trialing'])
    expect(url.searchParams.getAll('product_ids')).toEqual(['prod_1'])
    expect(url.searchParams.get('company_id')).toBe('biz_1')
    expect(url.searchParams.get('first')).toBe('10')
    expect(url.searchParams.get('direction')).toBe('desc')
    // 省略的可选过滤器不该出现。
    expect(url.searchParams.has('plan_ids')).toBe(false)

    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('api-version-date')).toBe('2026-07-01')
    await expect(res.json()).resolves.toMatchObject({ content: { data: [{ id: 'mem_1' }] } })
  })

  it('get_company:路径参数被 URL 编码', async () => {
    const mock = mockWhop(200, { id: 'biz/1', title: 'Acme' })
    await call('get_company', { id: 'biz/1' })
    expect(sent(mock).url).toBe('https://api.whop.com/api/v1/companies/biz%2F1')
  })

  it('list_products:游标与排序参数进 query', async () => {
    const mock = mockWhop(200, { data: [], page_info: {} })
    await call('list_products', {
      company_id: 'biz_1',
      visibilities: ['visible', 'hidden'],
      after: 'cursor_1',
      order: 'created_at',
    })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v1/products')
    expect(url.searchParams.getAll('visibilities')).toEqual(['visible', 'hidden'])
    expect(url.searchParams.get('after')).toBe('cursor_1')
    expect(url.searchParams.get('order')).toBe('created_at')
  })
})

describe('校验与错误', () => {
  it('入参校验生效:statuses 给非法枚举值 → 400 且不打上游', async () => {
    const mock = mockWhop(200, { data: [] })
    const res = await call('list_memberships', { company_id: 'biz_1', statuses: ['nope'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_product 缺 id → 400 且不打上游(schema 标它可选,只能在 handler 里挡)', async () => {
    const mock = mockWhop(200, {})
    const res = await call('get_product', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error.message', async () => {
    mockWhop(401, { error: { message: 'Invalid API key' } })
    const denied = await call('list_companies', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockWhop(429, { error: { message: 'Too many requests' } })
    await expect((await call('list_companies', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'Too many requests', retryable: true })

    mockWhop(404, { message: 'Company not found' })
    await expect((await call('get_company', { id: 'biz_missing' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Company not found' })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockWhop(200, { data: [] })
    const res = await call('list_companies', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
