import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTavilyPlugin } from '../../src/tavily/index'
import { tavilyActions } from '../../src/tavily/schema'

/**
 * Tavily 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * POST body 是校验后入参的原样转发、GET 路径参数的转义、2xx 空 body 归一成 `{}`、
 * 以及 Tavily 自有状态码 432/433 的归一。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'tvly-testdeadbeef'
const plugin = createTavilyPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'search/tavily',
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

function mockTavily(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 直接给一段原始 body(测非 JSON 响应与空 body)。 */
function mockRaw(status: number, body: string | null): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(body, { status })))
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
  it('List 出全部 7 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(tavilyActions).length)
    expect(tools).toHaveLength(7)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'crawl',
      'create_research',
      'extract',
      'get_research',
      'get_usage',
      'map',
      'search',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报单个 tools/v1 export,并把 get_usage 声明成凭证探针', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as {
      exports: Array<{ credentialProbe?: unknown, profile: string }>
    }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.profile).toBe('tools/v1')
    expect(body.exports[0]?.credentialProbe).toBe('get_usage')
  })
})

describe('请求拼装', () => {
  it('search:入参原样进 JSON body,凭证走 Authorization: Bearer 头', async () => {
    const mock = mockTavily(200, { query: 'tool bridge', results: [] })
    await call('search', {
      query: 'tool bridge',
      search_depth: 'advanced',
      max_results: 5,
      topic: 'news',
      include_answer: 'basic',
      include_domains: ['example.com'],
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.tavily.com/search')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      query: 'tool bridge',
      search_depth: 'advanced',
      max_results: 5,
      topic: 'news',
      include_answer: 'basic',
      include_domains: ['example.com'],
    })
  })

  it('未给的可选参数不出现在 body 里(免得把默认值写死成显式 null)', async () => {
    const mock = mockTavily(200, { query: 'x', results: [] })
    await call('search', { query: 'x' })
    await expect(sent(mock).json()).resolves.toEqual({ query: 'x' })
  })

  it('extract / map / crawl / create_research 各打自己的端点,body 原样转发', async () => {
    const cases: Array<[string, string, Record<string, unknown>]> = [
      ['extract', '/extract', { urls: ['https://example.com/a'], format: 'text' }],
      ['map', '/map', { url: 'https://example.com', max_depth: 2 }],
      ['crawl', '/crawl', { url: 'https://example.com', extract_depth: 'advanced' }],
      ['create_research', '/research', { input: '调研 tool-bridge', model: 'pro' }],
    ]
    for (const [name, path, args] of cases) {
      vi.unstubAllGlobals()
      const mock = mockTavily(200, { results: [] })
      await call(name, args)
      const request = sent(mock)
      expect(request.url, name).toBe(`https://api.tavily.com${path}`)
      expect(request.method, name).toBe('POST')
      await expect(request.json(), name).resolves.toEqual(args)
    }
  })

  it('get_research 是 GET + 路径参数,id 被转义且不带请求体', async () => {
    const mock = mockTavily(200, { request_id: 'a/b?c', status: 'completed' })
    await call('get_research', { request_id: 'a/b?c' })
    const request = sent(mock)
    expect(request.method).toBe('GET')
    // 未转义会把 id 拆成路径段 + query,打到一个不存在的端点上。
    expect(request.url).toBe('https://api.tavily.com/research/a%2Fb%3Fc')
    expect(await request.text()).toBe('')
    expect(request.headers.get('content-type')).toBeNull()
  })

  it('get_usage 是无参 GET', async () => {
    const mock = mockTavily(200, { key: { usage: 3 }, account: { current_plan: 'dev' } })
    const res = await call('get_usage', {})
    expect(sent(mock).url).toBe('https://api.tavily.com/usage')
    expect(sent(mock).method).toBe('GET')
    await expect(res.json()).resolves.toEqual({
      content: { key: { usage: 3 }, account: { current_plan: 'dev' } },
    })
  })
})

describe('响应处理', () => {
  it('2xx 响应原样透出(生成的 outputSchema 是 looseObject,不裁剪)', async () => {
    mockTavily(200, {
      query: 'x',
      results: [{ title: 'A', url: 'https://a.example', score: 0.9 }],
      response_time: 1.2,
      request_id: 'req_1',
      vendor_specific_extra: true,
    })
    const res = await call('search', { query: 'x' })
    await expect(res.json()).resolves.toEqual({
      content: {
        query: 'x',
        results: [{ title: 'A', url: 'https://a.example', score: 0.9 }],
        response_time: 1.2,
        request_id: 'req_1',
        vendor_specific_extra: true,
      },
    })
  })

  it('2xx 空 body 归一成 {} 而不是报错(上游 `if (!text) return {}`)', async () => {
    mockRaw(202, null)
    const res = await call('create_research', { input: '调研' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ content: {} })
  })

  it('2xx 回非 JSON → unavailable + retryable(上游坏了,不是调用方的错)', async () => {
    mockRaw(200, '<html>maintenance</html>')
    const res = await call('search', { query: 'x' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('2xx 回数组(顶层不是对象)→ unavailable,不当成功透出', async () => {
    mockTavily(200, [{ url: 'https://a.example' }])
    const res = await call('map', { url: 'https://example.com' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:max_results 越界 → 400 且不打上游', async () => {
    const mock = mockTavily(200, {})
    const res = await call('search', { query: 'x', max_results: 99 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('strictObject 拒未声明的键:不把调用方塞的垃圾原样转发给上游', async () => {
    const mock = mockTavily(200, {})
    const res = await call('search', { query: 'x', not_a_tavily_param: 1 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 detail → error → message', async () => {
    mockTavily(401, { detail: 'Invalid API key' })
    const unauthorized = await call('search', { query: 'x' })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    vi.unstubAllGlobals()
    mockTavily(429, { error: 'Too many requests' })
    const limited = await call('search', { query: 'x' })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({
      code: 'rate_limited',
      retryable: true,
      message: 'Too many requests',
    })

    vi.unstubAllGlobals()
    mockTavily(500, { message: 'Tavily is down' })
    const down = await call('search', { query: 'x' })
    expect(down.status).toBe(503)
    await expect(down.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Tavily is down',
    })
  })

  it('Tavily 自有状态码 432/433(额度用尽)→ invalid_argument,不标可重试', async () => {
    for (const status of [432, 433]) {
      vi.unstubAllGlobals()
      mockTavily(status, { detail: 'Usage limit exceeded' })
      const res = await call('search', { query: 'x' })
      expect(res.status, String(status)).toBe(400)
      await expect(res.json(), String(status)).resolves.toMatchObject({
        code: 'invalid_argument',
        message: 'Usage limit exceeded',
      })
    }
  })

  it('研究任务 id 不存在 → not_found(上游把 404 压成 400,这里保留区分度)', async () => {
    mockTavily(404, { detail: 'Research task not found' })
    const res = await call('get_research', { request_id: 'nope' })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'Research task not found',
    })
  })

  it('错误体不是 JSON 时用原始文本当消息(网关回的 HTML/纯文本错误页)', async () => {
    mockRaw(502, 'Bad Gateway')
    const res = await call('search', { query: 'x' })
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      message: 'Bad Gateway',
      retryable: true,
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockTavily(200, {})
    const res = await call('search', { query: 'x' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
