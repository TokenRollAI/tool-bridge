import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJinaAiPlugin } from '../../src/jina_ai/index'
import { jinaAiActions } from '../../src/jina_ai/schema'

/**
 * Jina AI 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 端点分派、`Bearer ` 前缀、undefined 键不进 body、以及 2xx 上非 JSON 的归一。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'jina_testdeadbeef'
const plugin = createJinaAiPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ai/jina',
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

function mockJina(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 上游回非 JSON(网关错误页、被中间层截了之类)。 */
function mockJinaText(status: number, body: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'text/html' },
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
  it('List 出全部 2 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(jinaAiActions).length)
    expect(tools).toHaveLength(2)
    expect(tools.map(tool => tool.name).sort()).toEqual(['create_embeddings', 'rerank_documents'])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求拼装', () => {
  it('create_embeddings:整个入参就是 JSON body,凭证走 Bearer 头', async () => {
    const mock = mockJina(200, { model: 'jina-embeddings-v3', data: [{ index: 0, embedding: [0.1, 0.2] }] })
    const res = await call('create_embeddings', {
      model: 'jina-embeddings-v3',
      input: ['hello', { image: 'https://example.test/a.png' }],
      dimensions: 512,
      normalized: true,
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('POST')
    expect(url.origin).toBe('https://api.jina.ai')
    expect(url.pathname).toBe('/v1/embeddings')
    // 凭证只在头里,不在 URL 上 —— 别让它进访问日志。
    expect(url.search).toBe('')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      model: 'jina-embeddings-v3',
      input: ['hello', { image: 'https://example.test/a.png' }],
      dimensions: 512,
      normalized: true,
    })
    // 出参是 looseObject:上游 JSON 原样透出,不裁剪。
    await expect(res.json()).resolves.toEqual({
      content: { model: 'jina-embeddings-v3', data: [{ index: 0, embedding: [0.1, 0.2] }] },
    })
  })

  it('rerank_documents 打 /v1/rerank', async () => {
    const mock = mockJina(200, { results: [{ index: 0, relevance_score: 0.9 }] })
    const res = await call('rerank_documents', {
      model: 'jina-reranker-v2-base-multilingual',
      query: 'who wrote it',
      documents: ['a', 'b'],
      top_n: 1,
      return_documents: false,
    })

    expect(new URL(sent(mock).url).pathname).toBe('/v1/rerank')
    await expect(sent(mock).json()).resolves.toEqual({
      model: 'jina-reranker-v2-base-multilingual',
      query: 'who wrote it',
      documents: ['a', 'b'],
      top_n: 1,
      return_documents: false,
    })
    await expect(res.json()).resolves.toEqual({
      content: { results: [{ index: 0, relevance_score: 0.9 }] },
    })
  })

  it('未给的可选参数不出现在 body 里(免得把默认值写死成显式值)', async () => {
    const mock = mockJina(200, {})
    await call('rerank_documents', { model: 'm', query: 'q', documents: ['a'] })
    expect(Object.keys((await sent(mock).json()) as Record<string, unknown>).sort())
      .toEqual(['documents', 'model', 'query'])
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:documents 空数组 → 400 且不打上游', async () => {
    const mock = mockJina(200, {})
    const res = await call('rerank_documents', { model: 'm', query: 'q', documents: [] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺必填字段 → 400 且不打上游', async () => {
    const mock = mockJina(200, {})
    const res = await call('create_embeddings', { input: ['x'] })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 4xx → invalid_argument / permission_denied,消息取自 detail', async () => {
    mockJina(422, { detail: 'model not found' })
    const invalid = await call('rerank_documents', { model: 'nope', query: 'q', documents: ['a'] })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'model not found',
    })

    vi.unstubAllGlobals()
    mockJina(401, { detail: 'invalid api key' })
    const unauthorized = await call('rerank_documents', { model: 'm', query: 'q', documents: ['a'] })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'invalid api key',
    })

    vi.unstubAllGlobals()
    mockJina(429, { detail: 'rate limit exceeded' })
    const limited = await call('rerank_documents', { model: 'm', query: 'q', documents: ['a'] })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('上游 5xx → unavailable + retryable(上游把 5xx 压成 502,这里保留原始状态)', async () => {
    mockJina(503, { detail: 'Jina is down' })
    const res = await call('rerank_documents', { model: 'm', query: 'q', documents: ['a'] })
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Jina is down',
    })
  })

  it('错误体不是 JSON 时按 HTTP 状态归一,消息退回响应体原文', async () => {
    mockJinaText(502, '<html>Bad Gateway</html>')
    const res = await call('rerank_documents', { model: 'm', query: 'q', documents: ['a'] })
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: '<html>Bad Gateway</html>',
    })
  })

  it('2xx 上回非 JSON 是上游坏了,不是插件坏了 → unavailable 而非 internal 500', async () => {
    mockJinaText(200, 'not json at all')
    const res = await call('rerank_documents', { model: 'm', query: 'q', documents: ['a'] })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockJina(200, {})
    const res = await call('rerank_documents', { model: 'm', query: 'q', documents: ['a'] }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
