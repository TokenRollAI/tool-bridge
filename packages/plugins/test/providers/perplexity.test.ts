import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createPerplexityPlugin } from '../../src/perplexity/index'
import { perplexityActions } from '../../src/perplexity/schema'

/**
 * Perplexity 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 四个 action 各自的端点(`/search` 不带 `/v1` 前缀)、请求体的原样透传、流式拦截、
 * **随模型变的** embeddings 维度上限,以及分散在四处的错误消息取值。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'pplx-deadbeef'
const plugin = createPerplexityPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ai/perplexity',
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

/** 用原始文本回应,便于钉住非 JSON 响应的处理。 */
function mockRaw(status: number, body: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function mockPerplexity(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  return mockRaw(status, JSON.stringify(payload))
}

/** 取上游收到的那个请求。 */
function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

const CHAT_ARGS = {
  model: 'sonar',
  messages: [{ role: 'user', content: 'hi' }],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('~describe 报成单个 tools/v1 export,并带上凭证探针', async () => {
    const res = await createPerplexityPlugin().fetch(new Request('https://plugin.test/~describe'), {} as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        id: 'actions',
        profile: 'tools/v1',
        description: 'Perplexity',
        credentialProbe: 'list_models',
      }],
    })
  })

  it('探针 list_models 只读且无必填入参(平台挂载时会空参调它)', () => {
    const spec = perplexityActions.list_models
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })

  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(perplexityActions).length)
    expect(tools).toHaveLength(4)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_chat_completion',
      'create_embeddings',
      'list_models',
      'search',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求拼装', () => {
  it('list_models:GET /v1/models,凭证走 Authorization Bearer,无请求体', async () => {
    const mock = mockPerplexity(200, { object: 'list', data: [{ id: 'sonar' }] })
    const res = await call('list_models', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(new URL(request.url).origin).toBe('https://api.perplexity.ai')
    expect(new URL(request.url).pathname).toBe('/v1/models')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
    expect(await request.text()).toBe('')
    await expect(res.json()).resolves.toEqual({ content: { object: 'list', data: [{ id: 'sonar' }] } })
  })

  it('search 打 /search(注意没有 /v1 前缀),入参整体当 JSON body 原样透传', async () => {
    const mock = mockPerplexity(200, { results: [{ title: 'A', url: 'https://a.example' }] })
    const args = {
      query: ['tool bridge', 'mcp'],
      country: 'US',
      max_results: 5,
      search_domain_filter: ['example.com'],
    }
    const res = await call('search', args)

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/search')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual(args)
    await expect(res.json()).resolves.toEqual({
      content: { results: [{ title: 'A', url: 'https://a.example' }] },
    })
  })

  it('create_chat_completion 打 /v1/sonar,不是 OpenAI 那套 /chat/completions', async () => {
    const mock = mockPerplexity(200, { id: 'c1', choices: [{ index: 0, message: { role: 'assistant', content: 'hey' } }] })
    await call('create_chat_completion', CHAT_ARGS)

    const request = sent(mock)
    expect(new URL(request.url).pathname).toBe('/v1/sonar')
    await expect(request.json()).resolves.toEqual(CHAT_ARGS)
  })

  it('create_embeddings 打 /v1/embeddings', async () => {
    const mock = mockPerplexity(200, { object: 'list', data: [{ index: 0, embedding: [0.1] }] })
    await call('create_embeddings', { model: 'pplx-embed-v1-4b', input: 'hello' })
    expect(new URL(sent(mock).url).pathname).toBe('/v1/embeddings')
  })

  it('没给的可选参数不出现在 body 里(免得把默认值写死成显式值)', async () => {
    const mock = mockPerplexity(200, { results: [] })
    await call('search', { query: 'x' })
    await expect(sent(mock).json()).resolves.toEqual({ query: 'x' })
  })
})

describe('本地断言', () => {
  it('stream=true 在本地就拦下(连接器消费不了 SSE),不打上游', async () => {
    const mock = mockPerplexity(200, {})
    const res = await call('create_chat_completion', { ...CHAT_ARGS, stream: true })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('stream=false 放行(只拦 true)', async () => {
    const mock = mockPerplexity(200, { id: 'c1', choices: [] })
    await call('create_chat_completion', { ...CHAT_ARGS, stream: false })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('embeddings 的 dimensions 上限随 model 变:0.6b 封顶 1024,4b 封顶 2560', async () => {
    const rejected = mockPerplexity(200, {})
    const tooLarge = await call('create_embeddings', {
      model: 'pplx-embed-v1-0.6b',
      input: 'x',
      dimensions: 2048,
    })
    expect(tooLarge.status).toBe(400)
    await expect(tooLarge.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'pplx-embed-v1-0.6b dimensions must be between 128 and 1024',
    })
    expect(rejected).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const accepted = mockPerplexity(200, { object: 'list', data: [] })
    await call('create_embeddings', { model: 'pplx-embed-v1-4b', input: 'x', dimensions: 2048 })
    expect(accepted).toHaveBeenCalledTimes(1)
  })

  it('dimensions 低于 128 一律拒;不给 dimensions 则不校验', async () => {
    const rejected = mockPerplexity(200, {})
    const res = await call('create_embeddings', { model: 'pplx-embed-v1-4b', input: 'x', dimensions: 64 })
    expect(res.status).toBe(400)
    expect(rejected).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const accepted = mockPerplexity(200, { object: 'list', data: [] })
    await call('create_embeddings', { model: 'pplx-embed-v1-4b', input: 'x' })
    expect(accepted).toHaveBeenCalledTimes(1)
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:max_results 越界 → 400 且不打上游', async () => {
    const mock = mockPerplexity(200, {})
    const res = await call('search', { query: 'x', max_results: 99 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 4xx → invalid_argument,401 → permission_denied,5xx → unavailable + retryable', async () => {
    mockPerplexity(400, { error: { type: 'invalid_request', message: 'model not found' } })
    const bad = await call('create_chat_completion', CHAT_ARGS)
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'model not found',
    })

    vi.unstubAllGlobals()
    mockPerplexity(401, { error: { message: 'Invalid API key' } })
    const unauthorized = await call('list_models', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    vi.unstubAllGlobals()
    mockPerplexity(500, { error: { message: 'upstream exploded' } })
    const down = await call('list_models', {})
    await expect(down.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('429 → rate_limited + retryable', async () => {
    mockPerplexity(429, { error: { message: 'too many requests' } })
    const res = await call('list_models', {})
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('错误消息在四处之一:嵌套 message → 嵌套 detail → 顶层 message → 顶层 detail', async () => {
    mockPerplexity(400, { error: { detail: '来自 error.detail' } })
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ message: '来自 error.detail' })

    vi.unstubAllGlobals()
    mockPerplexity(400, { message: '来自顶层 message' })
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ message: '来自顶层 message' })

    vi.unstubAllGlobals()
    mockPerplexity(400, { detail: '来自顶层 detail' })
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ message: '来自顶层 detail' })
  })

  it('错误体不是 JSON 时退回原文,原文也空则退回状态码', async () => {
    mockRaw(502, '<html>bad gateway</html>')
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: '<html>bad gateway</html>' })

    vi.unstubAllGlobals()
    mockRaw(404, '')
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'perplexity request failed with 404' })
  })

  it('2xx 上回非 JSON → unavailable + retryable(是上游坏了,不是插件崩了)', async () => {
    mockRaw(200, 'not json at all')
    const res = await call('list_models', {})
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockPerplexity(200, {})
    const res = await call('list_models', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
