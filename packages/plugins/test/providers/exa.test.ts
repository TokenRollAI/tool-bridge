import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExaPlugin } from '../../src/exa/index'
import { exaActions } from '../../src/exa/schema'

/**
 * Exa 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * includeDomains/excludeDomains 的互斥约束(Zod 表达不了,只活在 api.ts 里)、
 * 按 outputSchema 裁剪的出参、2xx 空体/非 JSON 的分别处置,以及错误消息的三处取法。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'exa_testdeadbeef'
const plugin = createExaPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'search/exa',
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

function mockExa(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
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
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(exaActions).length)
    expect(tools).toHaveLength(4)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'answer',
      'find_similar',
      'get_contents',
      'search',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报成单个 tools/v1 export', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{ id: 'actions', profile: 'tools/v1', description: 'Exa' }],
    })
  })
})

describe('请求拼装', () => {
  it('search:整个入参当 JSON body 发给 /search,凭证走 x-api-key 头', async () => {
    const mock = mockExa(200, { requestId: 'req_1', results: [] })
    await call('search', {
      query: 'best vector databases',
      type: 'neural',
      category: 'company',
      numResults: 5,
      contents: { text: { maxCharacters: 500 }, extras: { links: 2 } },
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.exa.ai/search')
    expect(request.headers.get('x-api-key')).toBe(API_KEY)
    expect(request.headers.get('content-type')).toBe('application/json')
    // 凭证只在头上,URL 上不该出现它(部署侧的日志脱敏据此定策)。
    expect(request.url).not.toContain(API_KEY)
    await expect(request.json()).resolves.toEqual({
      query: 'best vector databases',
      type: 'neural',
      category: 'company',
      numResults: 5,
      contents: { text: { maxCharacters: 500 }, extras: { links: 2 } },
    })
  })

  it('四个 action 各打各的端点(findSimilar 是驼峰路径,不是下划线)', async () => {
    const contents = mockExa(200, { requestId: 'r', results: [] })
    await call('get_contents', { urls: ['https://example.com'] })
    expect(sent(contents).url).toBe('https://api.exa.ai/contents')

    vi.unstubAllGlobals()
    const answered = mockExa(200, { citations: [] })
    await call('answer', { query: 'who founded Exa?' })
    expect(sent(answered).url).toBe('https://api.exa.ai/answer')

    vi.unstubAllGlobals()
    const similar = mockExa(200, { requestId: 'r', results: [] })
    await call('find_similar', { url: 'https://example.com' })
    expect(sent(similar).url).toBe('https://api.exa.ai/findSimilar')
  })

  it('未给的可选参数不进 body(免得把默认值写死成显式 null)', async () => {
    const mock = mockExa(200, { citations: [] })
    await call('answer', { query: 'x' })
    await expect(sent(mock).json()).resolves.toEqual({ query: 'x' })
  })
})

describe('响应整形', () => {
  it('search 按 outputSchema 裁剪:未声明的字段丢掉,结果项原样透出', async () => {
    mockExa(200, {
      requestId: 'req_42',
      results: [{ id: 'doc1', url: 'https://a.example', title: 'A', score: 0.9, extra_field: 'kept' }],
      searchType: 'neural',
      output: { summary: 'x' },
      costDollars: { total: 0.005, breakdown: [] },
      undeclared_family: { nope: true },
    })
    const res = await call('search', { query: 'x' })
    await expect(res.json()).resolves.toEqual({
      content: {
        requestId: 'req_42',
        // looseObject 的结果项:上游多给的字段留着,裁剪只发生在顶层。
        results: [{ id: 'doc1', url: 'https://a.example', title: 'A', score: 0.9, extra_field: 'kept' }],
        searchType: 'neural',
        output: { summary: 'x' },
        costDollars: { total: 0.005, breakdown: [] },
      },
    })
  })

  it('find_similar 不透出 searchType / output(它的 outputSchema 里没有这两个字段)', async () => {
    mockExa(200, {
      requestId: 'req_7',
      results: [{ url: 'https://b.example' }],
      searchType: 'neural',
      output: { should: 'be dropped' },
    })
    const res = await call('find_similar', { url: 'https://example.com' })
    await expect(res.json()).resolves.toEqual({
      content: { requestId: 'req_7', results: [{ url: 'https://b.example' }] },
    })
  })

  it('answer 的 answer 既收文本也收结构化对象', async () => {
    mockExa(200, { answer: 'Exa was founded in 2021.', citations: [{ url: 'https://c.example' }] })
    const text = await call('answer', { query: 'x' })
    await expect(text.json()).resolves.toEqual({
      content: { answer: 'Exa was founded in 2021.', citations: [{ url: 'https://c.example' }] },
    })

    vi.unstubAllGlobals()
    mockExa(200, { answer: { founded: 2021 }, citations: [] })
    const structured = await call('answer', { query: 'x' })
    await expect(structured.json()).resolves.toEqual({
      content: { answer: { founded: 2021 }, citations: [] },
    })
  })

  it('get_contents 的 statuses 缺席时不伪造成空数组', async () => {
    mockExa(200, { requestId: 'r1', results: [{ url: 'https://a.example' }] })
    const absent = await call('get_contents', { urls: ['https://a.example'] })
    await expect(absent.json()).resolves.toEqual({
      content: { requestId: 'r1', results: [{ url: 'https://a.example' }] },
    })

    vi.unstubAllGlobals()
    mockExa(200, { requestId: 'r1', results: [], statuses: [{ id: 'https://a.example', status: 'error' }] })
    const present = await call('get_contents', { urls: ['https://a.example'] })
    await expect(present.json()).resolves.toEqual({
      content: {
        requestId: 'r1',
        results: [],
        statuses: [{ id: 'https://a.example', status: 'error' }],
      },
    })
  })

  it('上游少了契约要求的 requestId → unavailable(是上游破契约,不是调用方的错)', async () => {
    mockExa(200, { results: [] })
    const res = await call('search', { query: 'x' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('includeDomains 与 excludeDomains 同时给 → invalid_argument 且不打上游', async () => {
    const mock = mockExa(200, {})
    const res = await call('search', {
      query: 'x',
      includeDomains: ['a.example'],
      excludeDomains: ['b.example'],
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()

    // find_similar 有同一条约束,别只在 search 上挡。
    vi.unstubAllGlobals()
    const similar = mockExa(200, {})
    const similarRes = await call('find_similar', {
      url: 'https://example.com',
      includeDomains: ['a.example'],
      excludeDomains: ['b.example'],
    })
    expect(similarRes.status).toBe(400)
    expect(similar).not.toHaveBeenCalled()
  })

  it('只给其中一个域名过滤器则放行', async () => {
    const mock = mockExa(200, { requestId: 'r', results: [] })
    const res = await call('search', { query: 'x', includeDomains: ['a.example'] })
    expect(res.status).toBe(200)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('入参校验真的生效:numResults 越界 → 400 且不打上游', async () => {
    const mock = mockExa(200, {})
    const res = await call('search', { query: 'x', numResults: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 4xx → invalid_argument;5xx → unavailable + retryable', async () => {
    mockExa(400, { error: 'query is required' })
    const bad = await call('search', { query: 'x' })
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'query is required',
    })

    vi.unstubAllGlobals()
    mockExa(500, { message: 'Exa is down' })
    const down = await call('search', { query: 'x' })
    expect(down.status).toBe(503)
    await expect(down.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Exa is down',
    })
  })

  it('401 → permission_denied,429 → rate_limited', async () => {
    mockExa(401, { error: 'invalid api key' })
    const unauthorized = await call('search', { query: 'x' })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({ code: 'permission_denied' })

    vi.unstubAllGlobals()
    mockExa(429, { message: 'slow down' })
    const limited = await call('search', { query: 'x' })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('错误体是纯文本(网关错误页)时消息取整段文本,不报"响应不是 JSON"', async () => {
    mockExa(502, '<html>Bad Gateway</html>')
    const res = await call('search', { query: 'x' })
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: '<html>Bad Gateway</html>',
    })
  })

  it('2xx 回非 JSON → unavailable(上游破了契约,不能当成功)', async () => {
    mockExa(200, 'not json at all')
    const res = await call('search', { query: 'x' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockExa(200, {})
    const res = await call('search', { query: 'x' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
