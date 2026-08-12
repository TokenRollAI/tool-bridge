import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createPolarPlugin } from '../../src/polar/index'
import { polarActions } from '../../src/polar/schema'

/**
 * Polar 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * list 的入参整份变 query(数组展开成重复参数、布尔编成字面量、metadata 走 deepObject)、
 * list 路径的尾斜杠、get 出参那层 `{payload}` 包装、以及 FastAPI 风格的 detail 错误体。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'polar_oat_deadbeef'
const API_BASE = 'https://api.polar.sh/v1'
const ORG_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
const plugin = createPolarPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'billing/polar',
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

function mockPolar(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
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
  it('List 出全部 13 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(polarActions).length)
    expect(tools).toHaveLength(13)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'get_customer',
      'get_customer_by_external_id',
      'get_customer_state',
      'get_customer_state_by_external_id',
      'get_order',
      'get_organization',
      'get_product',
      'get_subscription',
      'list_customers',
      'list_orders',
      'list_organizations',
      'list_products',
      'list_subscriptions',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报单个 tools/v1 export,带探针工具名(单值凭证不声明 credentialFields)', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as {
      exports: Array<{ credentialFields?: unknown, credentialProbe?: string, profile?: string }>
    }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.profile).toBe('tools/v1')
    expect(body.exports[0]?.credentialProbe).toBe('list_organizations')
    expect(body.exports[0]?.credentialFields).toBeUndefined()
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', () => {
    const spec = polarActions.list_organizations
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })
})

describe('请求拼装', () => {
  it('list_organizations:凭证走 Bearer 头,路径带尾斜杠,GET 无请求体', async () => {
    const mock = mockPolar(200, { items: [], pagination: { total_count: 0, max_page: 1 } })
    await call('list_organizations', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe(`${API_BASE}/organizations/`)
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
    expect(await request.text()).toBe('')
  })

  it('list 的入参整份变 query:数组展开成重复同名参数,布尔编成字面量', async () => {
    const mock = mockPolar(200, { items: [] })
    await call('list_products', {
      organization_id: [ORG_ID, '00000000-0000-4000-8000-000000000000'],
      is_archived: false,
      is_recurring: true,
      visibility: ['public', 'private'],
      page: 2,
      limit: 50,
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/products/')
    expect(url.searchParams.getAll('organization_id'))
      .toEqual([ORG_ID, '00000000-0000-4000-8000-000000000000'])
    expect(url.searchParams.getAll('visibility')).toEqual(['public', 'private'])
    // false 也要发出去 —— 它是"只看未归档"的筛选条件,漏了语义就反了。
    expect(url.searchParams.get('is_archived')).toBe('false')
    expect(url.searchParams.get('is_recurring')).toBe('true')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('limit')).toBe('50')
  })

  it('metadata 走 Polar 的 deepObject 形态(metadata[key]=value),多值同样展开', async () => {
    const mock = mockPolar(200, { items: [] })
    await call('list_orders', { metadata: { plan: 'pro', seats: 5, trial: false, tags: ['a', 'b'] } })

    const url = new URL(sent(mock).url)
    expect(url.searchParams.get('metadata[plan]')).toBe('pro')
    expect(url.searchParams.get('metadata[seats]')).toBe('5')
    expect(url.searchParams.get('metadata[trial]')).toBe('false')
    expect(url.searchParams.getAll('metadata[tags]')).toEqual(['a', 'b'])
    // 展开后 metadata 本身不作为一个参数出现。
    expect(url.searchParams.get('metadata')).toBeNull()
  })

  it('未给的可选参数不出现在 query 里', async () => {
    const mock = mockPolar(200, { items: [] })
    await call('list_customers', { limit: 1 })
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual(['limit'])
  })

  it('get 类:id 进路径(URL 编码),嵌套资源接在后面,且不带尾斜杠', async () => {
    const byId = mockPolar(200, { id: ORG_ID, name: 'Acme' })
    await call('get_organization', { id: ORG_ID })
    expect(sent(byId).url).toBe(`${API_BASE}/organizations/${ORG_ID}`)

    vi.unstubAllGlobals()
    const external = mockPolar(200, { id: 'c1' })
    await call('get_customer_state_by_external_id', { external_id: 'user/42 beta' })
    expect(sent(external).url).toBe(`${API_BASE}/customers/external/user%2F42%20beta/state`)

    vi.unstubAllGlobals()
    const state = mockPolar(200, { id: 'c1' })
    await call('get_customer_state', { id: ORG_ID })
    expect(sent(state).url).toBe(`${API_BASE}/customers/${ORG_ID}/state`)
  })
})

describe('响应整形', () => {
  it('list 出参就是上游那一页,原样透出', async () => {
    mockPolar(200, {
      items: [{ id: ORG_ID, name: 'Acme', slug: 'acme' }],
      pagination: { total_count: 1, max_page: 1 },
    })
    await expect((await call('list_organizations', {})).json()).resolves.toEqual({
      content: {
        items: [{ id: ORG_ID, name: 'Acme', slug: 'acme' }],
        pagination: { total_count: 1, max_page: 1 },
      },
    })
  })

  it('get 出参包一层 payload(资源对象与将来的元数据分层)', async () => {
    mockPolar(200, { id: ORG_ID, name: 'Acme' })
    await expect((await call('get_organization', { id: ORG_ID })).json()).resolves.toEqual({
      content: { payload: { id: ORG_ID, name: 'Acme' } },
    })
  })
})

describe('校验与错误', () => {
  it('schema 里是 optional 的路径 id,必填断言留在本层', async () => {
    const mock = mockPolar(200, {})
    const res = await call('get_organization', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'id 是必填的' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:非 uuid 的 id 与越界的 limit 都在本地拦下', async () => {
    const badId = mockPolar(200, {})
    expect((await call('get_organization', { id: 'not-a-uuid' })).status).toBe(400)
    expect(badId).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const badLimit = mockPolar(200, {})
    const res = await call('list_orders', { limit: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(badLimit).not.toHaveBeenCalled()
  })

  it('错误消息按 detail → message → error → title 的顺序取', async () => {
    mockPolar(401, { detail: 'Invalid token' })
    const unauthorized = await call('list_organizations', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid token',
    })

    vi.unstubAllGlobals()
    // FastAPI 的校验错误:detail 是数组,取第一条的 msg。
    mockPolar(422, { detail: [{ loc: ['query', 'limit'], msg: 'Input should be less than 100', type: 'less_than' }] })
    await expect((await call('list_organizations', {})).json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Input should be less than 100',
    })

    vi.unstubAllGlobals()
    mockPolar(404, { error: 'ResourceNotFound' })
    const missing = await call('get_order', { id: ORG_ID })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'ResourceNotFound' })
  })

  it('上游 429/5xx → 可重试;认不出错误体时退回按状态说话', async () => {
    mockPolar(429, {})
    const limited = await call('list_organizations', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({
      code: 'rate_limited',
      retryable: true,
      message: 'Polar 返回 HTTP 429',
    })

    vi.unstubAllGlobals()
    mockPolar(502, '<html>bad gateway</html>')
    await expect((await call('list_organizations', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游回的形状不符契约 → unavailable 且标 retryable', async () => {
    mockPolar(200, [{ id: ORG_ID }])
    const res = await call('list_organizations', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockPolar(200, '<html>maintenance</html>')
    await expect((await call('get_organization', { id: ORG_ID })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockPolar(200, {})
    const res = await call('list_organizations', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
