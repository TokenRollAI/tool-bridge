import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCoherePlugin } from '../../src/cohere/index'
import { cohereActions } from '../../src/cohere/schema'

/**
 * Cohere 迁移产物的 wire 级验收。重点:入参原样转发(不重映射字段)、strictObject 把
 * 上游那两处手写断言(stream / images)挡在 handler 之前、498 覆盖成 401。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'co_test_deadbeef'
const plugin = createCoherePlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ai/cohere',
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

function mockCohere(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    { status, headers: { 'content-type': 'application/json' } },
  )))
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

const CHAT_ARGS = { model: 'command-r-plus', messages: [{ role: 'user', content: 'hi' }] }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 3 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(cohereActions).length)
    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求整形', () => {
  it('chat 打 /v2/chat,凭证走 Bearer,入参原样进 body', async () => {
    const mock = mockCohere(200, { id: 'r1', finish_reason: 'complete', message: {}, usage: {} })
    const res = await call('chat', { ...CHAT_ARGS, temperature: 0.3, stop_sequences: ['END'] })

    const request = sent(mock)
    expect(request.url).toBe('https://api.cohere.com/v2/chat')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      model: 'command-r-plus',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.3,
      stop_sequences: ['END'],
    })
    await expect(res.json()).resolves.toMatchObject({ content: { id: 'r1' } })
  })

  it('embed_texts 打 /v2/embed,未给的可选字段不出现在 body 里', async () => {
    const mock = mockCohere(200, { id: 'r2', embeddings: {}, texts: ['a'], meta: {} })
    await call('embed_texts', { model: 'embed-v4.0', input_type: 'search_query', texts: ['a'] })

    const request = sent(mock)
    expect(request.url).toBe('https://api.cohere.com/v2/embed')
    const body = (await request.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['input_type', 'model', 'texts'])
  })

  it('rerank_documents 打 /v2/rerank', async () => {
    const mock = mockCohere(200, { id: 'r3', results: [], meta: {} })
    await call('rerank_documents', { model: 'rerank-v3.5', query: 'q', documents: ['d1', 'd2'] })
    expect(sent(mock).url).toBe('https://api.cohere.com/v2/rerank')
  })
})

describe('校验与错误', () => {
  it('入参校验生效:messages 给空数组 → 400 且不打上游', async () => {
    const mock = mockCohere(200, {})
    const res = await call('chat', { model: 'command-r-plus', messages: [] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('strictObject 顶掉上游手写的两处断言:stream 与 images 都进不来', async () => {
    const mock = mockCohere(200, {})
    expect((await call('chat', { ...CHAT_ARGS, stream: true })).status).toBe(400)
    expect((await call('embed_texts', {
      model: 'embed-v4.0',
      input_type: 'search_query',
      texts: ['a'],
      images: ['x'],
    })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error.message', async () => {
    mockCohere(401, { message: 'invalid api token' })
    await expect((await call('chat', CHAT_ARGS)).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'invalid api token' })

    mockCohere(429, { error: { message: 'too many requests' } })
    await expect((await call('chat', CHAT_ARGS)).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'too many requests', retryable: true })

    mockCohere(500, { message: 'cohere is down' })
    await expect((await call('chat', CHAT_ARGS)).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('Cohere 专有的 498(token 无效)不落进 invalid_argument', async () => {
    mockCohere(498, { message: 'invalid token' })
    await expect((await call('chat', CHAT_ARGS)).json())
      .resolves.toMatchObject({ code: 'permission_denied' })
  })

  it('非 JSON 的错误体退回原文,2xx 上的非 JSON 归 unavailable', async () => {
    mockCohere(503, '<html>gateway</html>')
    await expect((await call('chat', CHAT_ARGS)).json())
      .resolves.toMatchObject({ code: 'unavailable', message: '<html>gateway</html>' })

    mockCohere(200, 'not json')
    await expect((await call('chat', CHAT_ARGS)).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockCohere(200, {})
    const res = await call('chat', CHAT_ARGS, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
