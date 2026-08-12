import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createL2sPlugin } from '../../src/l2s/index'
import { l2sActions } from '../../src/l2s/schema'

/**
 * L2S 迁移产物的 wire 级验收。重点在:JSON body 里省略未给的可选字段、空 tags 数组不发、
 * PUT 更新的路径参数、schema 标可选但实际必填的 `id`、错误信封里的消息提取。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'l2s_test_key'
const plugin = createL2sPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'links/l2s',
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

function mockL2s(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 3 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(l2sActions).length)
    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求形状', () => {
  it('shorten_url:POST /url,凭证走 Bearer,未给的可选字段不出现在 body', async () => {
    const mock = mockL2s(200, { ok: true, response: { message: 'created', data: { id: 'u_1' } } })
    const res = await call('shorten_url', { url: 'https://example.com', title: 'Demo', tags: ['a', 'b'] })

    const request = sent(mock)
    expect(request.url).toBe('https://api.l2s.is/url')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      url: 'https://example.com',
      title: 'Demo',
      tags: ['a', 'b'],
    })
    await expect(res.json()).resolves.toMatchObject({ content: { ok: true } })
  })

  it('空 tags 数组不发(上游 normalizeTagArray 会把它折成缺失)', async () => {
    const mock = mockL2s(200, { ok: true, response: { message: 'created' } })
    await call('shorten_url', { url: 'https://example.com', tags: [] })
    await expect(sent(mock).json()).resolves.toEqual({ url: 'https://example.com' })
  })

  it('update_url_details:PUT + 路径参数被 URL 编码,id 不进 body', async () => {
    const mock = mockL2s(200, { ok: true, response: { message: 'updated' } })
    await call('update_url_details', { id: 'a/b', url: 'https://example.com/new' })

    const request = sent(mock)
    expect(request.url).toBe('https://api.l2s.is/url/a%2Fb')
    expect(request.method).toBe('PUT')
    await expect(request.json()).resolves.toEqual({ url: 'https://example.com/new' })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:shorten_url 缺 url → 400 且不打上游', async () => {
    const mock = mockL2s(200, {})
    const res = await call('shorten_url', { title: 'Demo' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_url_details 缺 id → 400 且不打上游(schema 标它可选,只能在 handler 里挡)', async () => {
    const mock = mockL2s(200, {})
    const res = await call('get_url_details', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 response.message 信封', async () => {
    mockL2s(401, { ok: false, response: { message: 'invalid token' } })
    const denied = await call('get_url_details', { id: 'u_1' })
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'invalid token',
    })

    mockL2s(429, { ok: false, response: { message: 'slow down' } })
    await expect((await call('get_url_details', { id: 'u_1' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'slow down', retryable: true })

    mockL2s(404, { ok: false, response: { message: 'url not found' } })
    await expect((await call('get_url_details', { id: 'u_1' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'url not found' })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockL2s(200, {})
    const res = await call('get_url_details', { id: 'u_1' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
