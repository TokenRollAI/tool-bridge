import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKernelPlugin } from '../../src/kernel/index'
import { kernelActions } from '../../src/kernel/schema'

/**
 * Kernel 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 分页来自响应头、tags 展开成 `tags[key]` query、PATCH 时剥掉路径参数、delete 的空体成功。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'sk_kernel_deadbeef'
const plugin = createKernelPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'browser/kernel',
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

function mockKernel(
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
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
  it('List 出全部 5 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(kernelActions).length)
    expect(tools).toHaveLength(5)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_browser_sessions')).toBe('read')
    expect(effectOf('create_browser_session')).toBe('write')
    expect(effectOf('delete_browser_session')).toBe('destructive')
  })
})

describe('请求成形与响应整形', () => {
  it('list:tags 展开成 tags[key],分页取自响应头', async () => {
    const mock = mockKernel(200, [{ session_id: 's1' }], {
      'x-limit': '25',
      'x-offset': '50',
      'x-has-more': 'true',
      'x-next-offset': '75',
    })
    const res = await call('list_browser_sessions', {
      status: 'active',
      limit: 25,
      offset: 50,
      tags: { env: 'prod', team: 'infra' },
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.onkernel.com/browsers')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(url.searchParams.get('tags[env]')).toBe('prod')
    expect(url.searchParams.get('tags[team]')).toBe('infra')
    expect(url.searchParams.get('status')).toBe('active')

    await expect(res.json()).resolves.toEqual({
      content: {
        browser_sessions: [{ session_id: 's1' }],
        pagination: { limit: 25, offset: 50, has_more: true, next_offset: 75 },
      },
    })
  })

  it('分页头缺失时按 0 / false 兜底', async () => {
    mockKernel(200, [])
    const res = await call('list_browser_sessions', {})
    await expect(res.json()).resolves.toMatchObject({
      content: { pagination: { limit: 0, offset: 0, has_more: false, next_offset: 0 } },
    })
  })

  it('create:入参原样进 JSON body', async () => {
    const mock = mockKernel(200, { session_id: 's1' })
    await call('create_browser_session', { name: 'my-session', headless: true })
    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ name: 'my-session', headless: true })
  })

  it('update:PATCH,路径参数被编码且不重复出现在 body 里', async () => {
    const mock = mockKernel(200, { session_id: 's/1' })
    await call('update_browser_session', { id_or_name: 's/1', name: 'renamed', proxy_id: null })
    const request = sent(mock)
    expect(request.url).toBe('https://api.onkernel.com/browsers/s%2F1')
    expect(request.method).toBe('PATCH')
    const body = (await request.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('id_or_name')
    expect(body).toEqual({ name: 'renamed', proxy_id: null })
  })

  it('delete:空体也算成功,结果由本地合成', async () => {
    const mock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    vi.stubGlobal('fetch', mock)
    const res = await call('delete_browser_session', { id_or_name: 's1' })
    expect(sent(mock).method).toBe('DELETE')
    await expect(res.json()).resolves.toEqual({ content: { deleted: true } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:limit 越界 → 400 且不打上游', async () => {
    const mock = mockKernel(200, [])
    const res = await call('list_browser_sessions', { limit: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('delete 的 id_or_name 在 schema 里是 optional,由运行时补上必填校验', async () => {
    const mock = mockKernel(200, {})
    const res = await call('delete_browser_session', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('id_or_name is required')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息可从嵌套 details / inner_error 里挖出来', async () => {
    mockKernel(401, { message: 'invalid api key' })
    const unauthorized = await call('list_browser_sessions', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'invalid api key',
    })

    vi.unstubAllGlobals()
    mockKernel(429, { details: [{ inner_error: { error: 'slow down' } }] })
    await expect((await call('list_browser_sessions', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true, message: 'slow down' })

    vi.unstubAllGlobals()
    // 上游把 4xx 全压成 400;迁移后交回 upstreamError,404 仍是 not_found。
    mockKernel(404, { message: 'browser not found' })
    await expect((await call('get_browser_session', { id_or_name: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found' })

    vi.unstubAllGlobals()
    mockKernel(503, {})
    await expect((await call('list_browser_sessions', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockKernel(200, [])
    const res = await call('list_browser_sessions', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
