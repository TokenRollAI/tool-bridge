import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLangbasePlugin } from '../../src/langbase/index'
import { langbaseActions } from '../../src/langbase/schema'

/**
 * Langbase 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * memory 名进路径时的 URL 编码、snake_case/camelCase 双写法的响应归一、
 * 省略的可选参数不进请求体、以及 401/429 的状态归一。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'lb_test_deadbeef'
const plugin = createLangbasePlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ai/langbase',
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

function mockLangbase(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(langbaseActions).length)
    expect(tools).toHaveLength(4)
    expect(tools.map(t => t.name).sort()).toEqual([
      'create_memory',
      'delete_memory',
      'list_memories',
      'retrieve_memory',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_memories')).toBe('read')
    expect(effectOf('retrieve_memory')).toBe('read')
    expect(effectOf('create_memory')).toBe('write')
    expect(effectOf('delete_memory')).toBe('destructive')
  })
})

describe('create_memory', () => {
  it('POST JSON 到 /v1/memory,凭证走 Bearer', async () => {
    const mock = mockLangbase(200, {
      name: 'docs',
      description: 'Product docs',
      owner_login: 'ada',
      url: 'https://studio.langbase.com/ada/memory/docs',
      chunk_size: 1024,
      embedding_model: 'openai:text-embedding-3-large',
    })
    const res = await call('create_memory', {
      name: 'docs',
      description: 'Product docs',
      embedding_model: 'openai:text-embedding-3-large',
      chunk_size: 1024,
      chunk_overlap: 128,
      top_k: 5,
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.langbase.com/v1/memory')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
    expect(request.headers.get('content-type')).toBe('application/json')
    // 平台不注入 UA:上游那个 providerUserAgent 头在迁移时删掉了。
    expect(request.headers.get('user-agent')).toBeNull()
    await expect(request.json()).resolves.toEqual({
      name: 'docs',
      description: 'Product docs',
      embedding_model: 'openai:text-embedding-3-large',
      chunk_size: 1024,
      chunk_overlap: 128,
      top_k: 5,
    })

    // 响应归一:snake_case 收成 camelCase,缺的可选字段整个键省掉而不是填 null。
    await expect(res.json()).resolves.toEqual({
      content: {
        memory: {
          name: 'docs',
          description: 'Product docs',
          ownerLogin: 'ada',
          url: 'https://studio.langbase.com/ada/memory/docs',
          chunkSize: 1024,
          embeddingModel: 'openai:text-embedding-3-large',
        },
      },
    })
  })

  it('省略的可选字段不出现在 body 里', async () => {
    const mock = mockLangbase(200, { name: 'docs' })
    await call('create_memory', { name: 'docs' })
    await expect(sent(mock).json()).resolves.toEqual({ name: 'docs' })
  })
})

describe('list_memories 与 retrieve_memory', () => {
  it('list 走 GET,camelCase 写法的响应也能归一,缺失必填字段补空串', async () => {
    const mock = mockLangbase(200, [
      { name: 'a', description: 'A', ownerLogin: 'ada', url: 'https://x/a', chunkOverlap: 64 },
      { name: 'b' },
    ])
    const res = await call('list_memories', {})

    const request = sent(mock)
    expect(request.url).toBe('https://api.langbase.com/v1/memory')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    await expect(res.json()).resolves.toEqual({
      content: {
        memories: [
          { name: 'a', description: 'A', ownerLogin: 'ada', url: 'https://x/a', chunkOverlap: 64 },
          { name: 'b', description: '', ownerLogin: '', url: '' },
        ],
      },
    })
  })

  it('retrieve 原样转发 memory 里的 filters DSL,meta 里的非字符串值被丢掉', async () => {
    const mock = mockLangbase(200, [
      { text: 'hit', similarity: 0.91, meta: { docId: 'd1', page: 3 } },
      {},
    ])
    const res = await call('retrieve_memory', {
      query: 'refund policy',
      memory: [{ name: 'docs', filters: ['And', [['lang', 'Eq', 'en']]] }],
      topK: 3,
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.langbase.com/v1/memory/retrieve')
    expect(request.method).toBe('POST')
    await expect(request.json()).resolves.toEqual({
      query: 'refund policy',
      memory: [{ name: 'docs', filters: ['And', [['lang', 'Eq', 'en']]] }],
      topK: 3,
    })
    await expect(res.json()).resolves.toEqual({
      content: {
        matches: [
          { text: 'hit', similarity: 0.91, meta: { docId: 'd1' } },
          { text: '', similarity: 0, meta: {} },
        ],
      },
    })
  })

  it('上游回的不是数组 → unavailable(契约破在上游,不是调用方的错)', async () => {
    mockLangbase(200, { memories: [] })
    const res = await call('list_memories', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('delete_memory', () => {
  it('memory 名进路径时被 URL 编码,success 只认严格 true', async () => {
    const mock = mockLangbase(200, { success: true })
    const res = await call('delete_memory', { memoryName: 'my docs/v2' })
    expect(sent(mock).url).toBe('https://api.langbase.com/v1/memory/my%20docs%2Fv2')
    expect(sent(mock).method).toBe('DELETE')
    await expect(res.json()).resolves.toEqual({ content: { success: true } })

    mockLangbase(200, { success: 'true' })
    await expect((await call('delete_memory', { memoryName: 'docs' })).json())
      .resolves.toEqual({ content: { success: false } })
  })

  it('生成的 schema 漏了 memoryName 的 required,handler 补挡 → 400 且不打上游', async () => {
    const mock = mockLangbase(200, { success: true })
    const res = await call('delete_memory', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'delete_memory 需要 memoryName',
    })
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:topK 超上限 → 400 且不打上游', async () => {
    const mock = mockLangbase(200, [])
    const res = await call('retrieve_memory', {
      query: 'hi',
      memory: [{ name: 'docs' }],
      topK: 999,
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:memory 空数组 → 400 且不打上游', async () => {
    const mock = mockLangbase(200, [])
    const res = await call('retrieve_memory', { query: 'hi', memory: [] })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息从 Langbase 的多种错误体形状里取', async () => {
    mockLangbase(401, { error: { message: 'Invalid API key' } })
    const denied = await call('list_memories', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockLangbase(429, { message: 'Too many requests' })
    const limited = await call('list_memories', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({
      code: 'rate_limited',
      message: 'Too many requests',
      retryable: true,
    })

    mockLangbase(404, { detail: 'memory not found' })
    const missing = await call('delete_memory', { memoryName: 'gone' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'memory not found',
    })

    mockLangbase(500, {})
    const down = await call('list_memories', {})
    expect(down.status).toBe(503)
    await expect(down.json()).resolves.toMatchObject({
      code: 'unavailable',
      message: 'Langbase 返回 HTTP 500',
      retryable: true,
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockLangbase(200, [])
    const res = await call('list_memories', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
