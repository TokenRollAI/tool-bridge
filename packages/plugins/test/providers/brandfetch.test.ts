import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrandfetchPlugin } from '../../src/brandfetch/index'
import { brandfetchActions } from '../../src/brandfetch/schema'

/**
 * Brandfetch 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 三种信封形状的 brand 提取、normalize 时丢掉全空条目、国家码强制大写、404 的兜底文案。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'bf_deadbeef'
const plugin = createBrandfetchPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'brand/brandfetch',
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

function mockBrandfetch(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

const BRAND = {
  id: 'id_1',
  name: 'Acme',
  domain: 'acme.com',
  claimed: true,
  qualityScore: 0.9,
  colors: [{ hex: '#ff0000', type: 'accent', brightness: 54 }],
  links: [{ name: 'twitter', url: 'https://x.com/acme' }],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 2 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(brandfetchActions).length)
    expect(tools).toHaveLength(2)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('两个 action 都是 read', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string }>
    expect(tools.every(t => t.effect === 'read')).toBe(true)
  })
})

describe('请求成形', () => {
  it('get_brand:标识符被 URL 编码进路径,凭证走 Bearer', async () => {
    const mock = mockBrandfetch(200, { data: BRAND })
    const res = await call('get_brand', { identifier: 'acme.com/x' })

    const request = sent(mock)
    expect(request.url).toBe('https://api.brandfetch.io/v2/brands/acme.com%2Fx')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)

    await expect(res.json()).resolves.toMatchObject({
      content: { id: 'id_1', name: 'Acme', domain: 'acme.com', claimed: true, qualityScore: 0.9 },
    })
  })

  it('get_transaction_info:POST,国家码被强制大写(小写 Brandfetch 回 400)', async () => {
    const mock = mockBrandfetch(200, { brand: BRAND })
    await call('get_transaction_info', { transactionLabel: 'ACME*STORE 123', countryCode: 'us' })

    const request = sent(mock)
    expect(request.url).toBe('https://api.brandfetch.io/v2/transactions')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      transactionLabel: 'ACME*STORE 123',
      countryCode: 'US',
    })
  })

  it('三种信封形状都能取出 brand(data / brand / 顶层裸对象)', async () => {
    for (const payload of [{ data: BRAND }, { brand: BRAND }, BRAND]) {
      mockBrandfetch(200, payload)
      await expect((await call('get_brand', { identifier: 'acme.com' })).json())
        .resolves.toMatchObject({ content: { id: 'id_1', name: 'Acme' } })
      vi.unstubAllGlobals()
    }
  })

  it('normalize 丢掉全空的数组条目,未返回的字段不出现在结果里', async () => {
    mockBrandfetch(200, {
      data: {
        name: 'Acme',
        // 第二个条目 normalize 后什么都不剩,该被丢掉。
        colors: [{ hex: '#fff', type: 'light' }, { unknownKey: 1 }],
      },
    })
    const body = (await (await call('get_brand', { identifier: 'acme.com' })).json()) as {
      content: Record<string, unknown>
    }
    expect(body.content.colors).toEqual([{ hex: '#fff', type: 'light' }])
    expect(body.content).not.toHaveProperty('logos')
    expect(body.content).not.toHaveProperty('domain')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:countryCode 长度不对 → 400 且不打上游', async () => {
    const mock = mockBrandfetch(200, {})
    const res = await call('get_transaction_info', { transactionLabel: 'X', countryCode: 'USA' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_brand 缺 identifier → 400 且不打上游(schema 里它是 optional)', async () => {
    const mock = mockBrandfetch(200, {})
    const res = await call('get_brand', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('identifier')
    expect(mock).not.toHaveBeenCalled()
  })

  it('404 空体时给兜底文案(Brandfetch 找不到品牌常常不给消息)', async () => {
    mockBrandfetch(404, {})
    const res = await call('get_brand', { identifier: 'nope.example' })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'Brandfetch 没有找到与输入匹配的品牌',
    })
  })

  it('上游错误按状态归一,消息取自 message', async () => {
    mockBrandfetch(401, { message: 'Invalid API key' })
    const unauth = await call('get_brand', { identifier: 'acme.com' })
    expect(unauth.status).toBe(401)
    await expect(unauth.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockBrandfetch(429, { message: 'Rate limit exceeded' })
    await expect((await call('get_brand', { identifier: 'acme.com' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockBrandfetch(500, { message: 'Brandfetch is down' })
    await expect((await call('get_brand', { identifier: 'acme.com' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockBrandfetch(200, { data: BRAND })
    const res = await call('get_brand', { identifier: 'acme.com' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
