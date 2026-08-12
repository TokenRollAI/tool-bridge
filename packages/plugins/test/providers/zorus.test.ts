import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createZorusPlugin } from '../../src/zorus/index'
import { zorusActions } from '../../src/zorus/schema'

/**
 * Zorus 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * Impersonation 认证头(不是 Bearer)、Zorus-Api-Version 头、
 * 整个 input 直接当 body、以及裸数组响应裹成 {items}。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'zorus_token_deadbeef'
const plugin = createZorusPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'security/zorus',
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

function mockZorus(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

const CUSTOMER_UUID = '3f1a2b4c-5d6e-4f80-9a1b-2c3d4e5f6071'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 5 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(zorusActions).length)
    expect(tools).toHaveLength(5)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('全部 action 都是只读', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    for (const tool of tools) expect(tool.effect, tool.name).toBe('read')
  })
})

describe('请求拼装', () => {
  it('search_customers:POST 整个 input 当 body,认证头是 Impersonation', async () => {
    const mock = mockZorus(200, [{ uuid: CUSTOMER_UUID, name: 'Acme', isEnabled: true }])
    const res = await call('search_customers', {
      page: 1,
      pageSize: 50,
      nameContains: 'Acme',
      isEnabled: true,
      sortProperty: 'Name',
      sortAscending: true,
    })

    const request = sent(mock)
    expect(request.url).toBe('https://developer.zorustech.com/api/customers/search')
    expect(request.method).toBe('POST')
    // Bearer 会被 Zorus 拒掉 —— 这个头的方案名是迁移最容易改错的地方。
    expect(request.headers.get('authorization')).toBe(`Impersonation ${API_KEY}`)
    expect(request.headers.get('zorus-api-version')).toBe('1.0')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      page: 1,
      pageSize: 50,
      nameContains: 'Acme',
      isEnabled: true,
      sortProperty: 'Name',
      sortAscending: true,
    })

    // 上游回裸数组,统一裹成 {items}。
    await expect(res.json()).resolves.toEqual({
      content: { items: [{ uuid: CUSTOMER_UUID, name: 'Acme', isEnabled: true }] },
    })
  })

  it('空入参也照发,body 是空对象', async () => {
    const mock = mockZorus(200, [])
    const res = await call('search_policies', {})
    expect(sent(mock).url).toBe('https://developer.zorustech.com/api/policies/search')
    await expect(sent(mock).json()).resolves.toEqual({})
    await expect(res.json()).resolves.toEqual({ content: { items: [] } })
  })

  it('五个 action 各自打到自己的路径', async () => {
    const cases: Array<[string, string]> = [
      ['search_endpoints', '/api/endpoints/search'],
      ['search_groups', '/api/groups/search'],
      ['search_active_unblock_requests', '/api/unblock-requests/active/search'],
    ]
    for (const [action, path] of cases) {
      const mock = mockZorus(200, [])
      await call(action, {})
      expect(new URL(sent(mock).url).pathname, action).toBe(path)
      vi.unstubAllGlobals()
    }
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:uuidEquals 不是 UUID → 400 且不打上游', async () => {
    const mock = mockZorus(200, [])
    const res = await call('search_customers', { uuidEquals: 'not-a-uuid' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('sortProperty 不在枚举内 → 400 且不打上游', async () => {
    const mock = mockZorus(200, [])
    const res = await call('search_groups', { sortProperty: 'Nope' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,.NET 的大小写键名都认', async () => {
    mockZorus(401, { Message: 'Invalid impersonation token' })
    const unauthorized = await call('search_customers', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid impersonation token',
    })

    mockZorus(429, { message: 'Too many requests' })
    await expect((await call('search_customers', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockZorus(500, { Title: 'Zorus is down' })
    await expect((await call('search_customers', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'Zorus is down', retryable: true })
  })

  it('响应不是数组 → unavailable(上游破契约,不是调用方的错)', async () => {
    mockZorus(200, { items: [] })
    const res = await call('search_endpoints', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockZorus(200, [])
    const res = await call('search_customers', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
