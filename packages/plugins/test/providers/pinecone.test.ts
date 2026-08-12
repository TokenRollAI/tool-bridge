import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createPineconePlugin } from '../../src/pinecone/index'
import { pineconeActions } from '../../src/pinecone/schema'

/**
 * Pinecone 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 控制面/数据面两套 base URL(后者由调用方传入,要挡住 http 与内嵌凭证)、
 * camelCase 入参到 snake_case 请求体的换名、GET 的 ids 重复参数、
 * 翻页 token 的 null 语义,以及三个"多选一"断言。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'pcsk_deadbeef'
const INDEX_HOST = 'https://demo-abc123.svc.us-east-1-aws.pinecone.io'
const plugin = createPineconePlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ai/pinecone',
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

function mockRaw(status: number, body: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(body === '' ? null : body, {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function mockPinecone(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  return mockRaw(status, JSON.stringify(payload))
}

/** 取上游收到的那个请求。 */
function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('~describe 报成单个 tools/v1 export,并带上凭证探针', async () => {
    const res = await createPineconePlugin().fetch(new Request('https://plugin.test/~describe'), {} as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        id: 'actions',
        profile: 'tools/v1',
        description: 'Pinecone',
        credentialProbe: 'list_indexes',
      }],
    })
  })

  it('探针 list_indexes 只读且无必填入参(平台挂载时会空参调它)', () => {
    const spec = pineconeActions.list_indexes
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })

  it('List 出全部 12 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(pineconeActions).length)
    expect(tools).toHaveLength(12)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'configure_index',
      'create_index',
      'delete_index',
      'delete_vectors',
      'describe_index',
      'fetch_vectors',
      'get_index_stats',
      'list_indexes',
      'list_vector_ids',
      'query_vectors',
      'update_vector',
      'upsert_vectors',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('控制面', () => {
  it('list_indexes:打 api.pinecone.io,凭证走 api-key 头,带 API 版本头', async () => {
    const mock = mockPinecone(200, { indexes: [{ name: 'demo', host: 'demo.svc.pinecone.io' }] })
    const res = await call('list_indexes', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://api.pinecone.io/indexes')
    expect(request.headers.get('api-key')).toBe(API_KEY)
    expect(request.headers.get('x-pinecone-api-version')).toBe('2026-04')
    expect(request.headers.get('content-type')).toBeNull()
    await expect(res.json()).resolves.toEqual({
      content: { indexes: [{ name: 'demo', host: 'demo.svc.pinecone.io' }] },
    })
  })

  it('indexes 缺席时兜底成空数组而不是漏字段', async () => {
    mockPinecone(200, {})
    await expect((await call('list_indexes', {})).json()).resolves.toEqual({ content: { indexes: [] } })
  })

  it('create_index:camelCase 入参换成 snake_case 体,spec.serverless 恒存在', async () => {
    const mock = mockPinecone(200, { name: 'demo', status: { ready: false } })
    const res = await call('create_index', {
      name: 'demo',
      dimension: 1536,
      metric: 'cosine',
      cloud: 'aws',
      region: 'us-east-1',
      vectorType: 'dense',
      deletionProtection: 'enabled',
      tags: { env: 'prod' },
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.pinecone.io/indexes')
    await expect(request.json()).resolves.toEqual({
      name: 'demo',
      dimension: 1536,
      metric: 'cosine',
      vector_type: 'dense',
      deletion_protection: 'enabled',
      tags: { env: 'prod' },
      spec: { serverless: { cloud: 'aws', region: 'us-east-1' } },
    })
    await expect(res.json()).resolves.toEqual({
      content: { index: { name: 'demo', status: { ready: false } } },
    })
  })

  it('configure_index:没给 readCapacity 就整个不发 spec(空 spec 会被当成改成空配置)', async () => {
    const without = mockPinecone(200, { name: 'demo' })
    await call('configure_index', { name: 'demo', deletionProtection: 'disabled' })
    const request = sent(without)
    expect(request.method).toBe('PATCH')
    expect(request.url).toBe('https://api.pinecone.io/indexes/demo')
    await expect(request.json()).resolves.toEqual({ deletion_protection: 'disabled' })

    vi.unstubAllGlobals()
    const withCapacity = mockPinecone(200, { name: 'demo' })
    await call('configure_index', { name: 'demo', readCapacity: { mode: 'OnDemand' } })
    await expect(sent(withCapacity).json())
      .resolves.toEqual({ spec: { serverless: { read_capacity: { mode: 'OnDemand' } } } })
  })

  it('delete_index:204 空体也算成功,回固定的 {accepted:true}', async () => {
    const mock = mockRaw(204, '')
    const res = await call('delete_index', { name: 'demo' })
    const request = sent(mock)
    expect(request.method).toBe('DELETE')
    expect(request.url).toBe('https://api.pinecone.io/indexes/demo')
    await expect(res.json()).resolves.toEqual({ content: { accepted: true } })
  })
})

describe('数据面', () => {
  it('indexHost 决定 base URL,路径与凭证头照旧', async () => {
    const mock = mockPinecone(200, { namespaces: {}, totalVectorCount: 7 })
    const res = await call('get_index_stats', { indexHost: INDEX_HOST, filter: { genre: 'drama' } })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe(`${INDEX_HOST}/describe_index_stats`)
    expect(request.headers.get('api-key')).toBe(API_KEY)
    await expect(request.json()).resolves.toEqual({ filter: { genre: 'drama' } })
    await expect(res.json()).resolves.toEqual({
      content: { stats: { namespaces: {}, totalVectorCount: 7 } },
    })
  })

  it('query_vectors:values→vector、sparseValues→sparseVector,出参补齐 null 语义', async () => {
    const mock = mockPinecone(200, { matches: [{ id: 'v1', score: 0.9 }], usage: { readUnits: 5 } })
    const res = await call('query_vectors', {
      indexHost: INDEX_HOST,
      values: [0.1, 0.2],
      topK: 3,
      namespace: 'ns1',
      includeMetadata: true,
    })

    await expect(sent(mock).json()).resolves.toEqual({
      vector: [0.1, 0.2],
      topK: 3,
      namespace: 'ns1',
      includeMetadata: true,
    })
    await expect(res.json()).resolves.toEqual({
      content: {
        matches: [{ id: 'v1', score: 0.9 }],
        // 上游没回 namespace 时给 null,而不是把字段整个丢掉。
        namespace: null,
        usage: { readUnits: 5 },
        raw: { matches: [{ id: 'v1', score: 0.9 }], usage: { readUnits: 5 } },
      },
    })
  })

  it('fetch_vectors 是 GET:ids 展开成重复的同名 query 参数,不进请求体', async () => {
    const mock = mockPinecone(200, { vectors: { v1: { id: 'v1' } }, namespace: 'ns1' })
    const res = await call('fetch_vectors', { indexHost: INDEX_HOST, ids: ['v1', 'v2'], namespace: 'ns1' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.pathname).toBe('/vectors/fetch')
    expect(url.searchParams.getAll('ids')).toEqual(['v1', 'v2'])
    expect(url.searchParams.get('namespace')).toBe('ns1')
    expect(await request.text()).toBe('')
    await expect(res.json()).resolves.toMatchObject({
      content: { vectors: { v1: { id: 'v1' } }, namespace: 'ns1', usage: null },
    })
  })

  it('list_vector_ids:limit 转成字符串进 query,pagination 缺席时是 null(翻页靠它判到底)', async () => {
    const mock = mockPinecone(200, { vectors: [{ id: 'v1' }] })
    const res = await call('list_vector_ids', {
      indexHost: INDEX_HOST,
      prefix: 'doc#',
      limit: 100,
      paginationToken: 'tok1',
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/vectors/list')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      prefix: 'doc#',
      limit: '100',
      paginationToken: 'tok1',
    })
    await expect(res.json()).resolves.toMatchObject({
      content: { vectors: [{ id: 'v1' }], pagination: null },
    })
  })

  it('upsert_vectors:upsertedCount 缺席时兜底 0,原始响应留在 raw 里', async () => {
    mockPinecone(200, { warning: 'partial' })
    const res = await call('upsert_vectors', {
      indexHost: INDEX_HOST,
      vectors: [{ id: 'v1', values: [0.1] }],
    })
    await expect(res.json()).resolves.toEqual({
      content: { upsertedCount: 0, raw: { warning: 'partial' } },
    })
  })

  it('update_vector:matchedRecords 缺席时是 null(0 与"没回这个数"是两回事)', async () => {
    mockPinecone(200, {})
    const res = await call('update_vector', { indexHost: INDEX_HOST, id: 'v1', values: [0.5] })
    await expect(res.json()).resolves.toEqual({ content: { matchedRecords: null, raw: {} } })
  })
})

describe('indexHost 的出站校验', () => {
  it('http 的 indexHost 被拒 —— 明文会把 api-key 送上网', async () => {
    const mock = mockPinecone(200, {})
    const res = await call('get_index_stats', { indexHost: 'http://demo.svc.pinecone.io' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'indexHost must use https',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('带内嵌凭证的 indexHost 被拒 —— 那段用户名密码会进日志', async () => {
    const mock = mockPinecone(200, {})
    const res = await call('get_index_stats', { indexHost: 'https://user:pass@demo.svc.pinecone.io' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ message: 'indexHost must not include credentials' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('indexHost 上的 path/query/hash 被剥掉,拼不出别的端点', async () => {
    const mock = mockPinecone(200, {})
    await call('get_index_stats', { indexHost: `${INDEX_HOST}/evil?x=1#y` })
    expect(sent(mock).url).toBe(`${INDEX_HOST}/describe_index_stats`)
  })

  it('指向私网的 indexHost 被 guardedFetch 拦下,且报成 invalid_argument 而非插件崩溃', async () => {
    const mock = mockPinecone(200, {})
    const res = await call('get_index_stats', { indexHost: 'https://169.254.169.254' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:topK 越界 → 400 且不打上游', async () => {
    const mock = mockPinecone(200, {})
    const res = await call('query_vectors', { indexHost: INDEX_HOST, values: [0.1], topK: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('三个"多选一"约束 schema 表达不了,断言留在 api 层', async () => {
    const mock = mockPinecone(200, {})

    const query = await call('query_vectors', { indexHost: INDEX_HOST, topK: 3 })
    expect(query.status).toBe(400)
    await expect(query.json()).resolves.toMatchObject({
      message: 'query_vectors requires values, sparseValues, or id',
    })

    // 少了这道断言,一个空请求会把整个 namespace 删空。
    const remove = await call('delete_vectors', { indexHost: INDEX_HOST, namespace: 'ns1' })
    expect(remove.status).toBe(400)
    await expect(remove.json()).resolves.toMatchObject({
      message: 'delete_vectors requires ids, filter, or deleteAll',
    })

    const update = await call('update_vector', { indexHost: INDEX_HOST, values: [0.1] })
    expect(update.status).toBe(400)
    await expect(update.json()).resolves.toMatchObject({
      message: 'update_vector requires id or filter',
    })

    expect(mock).not.toHaveBeenCalled()
  })

  it('describe_index 的 name 在 schema 里是 optional(忠实反映上游),必填断言留在 api 层', async () => {
    expect(() => pineconeActions.describe_index.inputSchema.parse({})).not.toThrow()

    const mock = mockPinecone(200, {})
    const res = await call('describe_index', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('name'),
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息在 message 或 error.message 里找', async () => {
    mockPinecone(404, { error: { code: 'NOT_FOUND', message: 'index not found' } })
    const missing = await call('describe_index', { name: 'nope' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'index not found',
    })

    vi.unstubAllGlobals()
    mockPinecone(401, { message: 'Invalid API key' })
    const unauthorized = await call('list_indexes', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    vi.unstubAllGlobals()
    mockPinecone(429, {})
    const limited = await call('list_indexes', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({
      code: 'rate_limited',
      retryable: true,
      message: 'Pinecone request failed with status 429',
    })

    vi.unstubAllGlobals()
    mockPinecone(503, { message: 'temporarily unavailable' })
    await expect((await call('list_indexes', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('非 JSON 响应体一律 unavailable(Pinecone 的错误体是稳定 JSON,回 HTML 说明没到 Pinecone)', async () => {
    mockRaw(502, '<html>bad gateway</html>')
    await expect((await call('list_indexes', {})).json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Pinecone returned invalid JSON',
    })
  })

  it('2xx 上回数组而非对象 → unavailable(契约说好是对象)', async () => {
    mockPinecone(200, [])
    await expect((await call('list_indexes', {})).json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Pinecone indexes response must be a JSON object',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockPinecone(200, {})
    const res = await call('list_indexes', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
