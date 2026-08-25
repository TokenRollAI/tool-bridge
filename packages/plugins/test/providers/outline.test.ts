import {
  type CallContext,
} from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createProviderHarness } from '../support/providerHarness'
import { createOutlinePlugin } from '../../src/outline/index'
import { outlineActions } from '../../src/outline/schema'

/**
 * Outline 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 自建实例的 `baseUrl` 归一(补 `/api`、去 query、拒 http 与内网)、纯空白串在 Zod 之后
 * 仍要被当成"没给"、`get_document` 的二选一约束、空 `statusFilter` 不发,
 * 以及从 `data` 里取值再裁剪的出参。
 */

const API_KEY = 'ol_api_deadbeef'
const COLLECTION_ID = '11111111-1111-4111-8111-111111111111'
const plugin = createOutlinePlugin()

function caller(mountConfig?: Record<string, unknown>): CallContext {
  return {
    keyId: 'k1',
    owner: 'agent:tester',
    scopes: [],
    traceId: 't1',
    mountPath: 'docs/outline',
    exportId: 'actions',
    ...(mountConfig === undefined ? {} : { mountConfig }),
  }
}

interface CallOptions {
  auth?: string | null
  config?: Record<string, unknown>
}

const { call, envelope, sent, stubFetch } = createProviderHarness<CallOptions>({
  caller: opts => caller(opts.config),
  mountPath: 'docs/outline',
  plugin,
  upstreamAuth: API_KEY,
})

/** 用原始文本回应,便于钉住非 JSON 响应的处理。 */
function mockRaw(status: number, body: string): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })))
}

function mockOutline(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  return mockRaw(status, JSON.stringify(payload))
}

const COLLECTION = {
  id: COLLECTION_ID,
  name: 'Handbook',
  description: null,
  sort: { field: 'index', direction: 'asc' },
  sharing: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
  somethingNew: 'from a newer self-hosted build',
}

describe('契约面', () => {
  it('~describe 报成单个 tools/v1 export,并带上凭证探针', async () => {
    const res = await createOutlinePlugin().fetch(new Request('https://plugin.test/~describe'), {} as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'single', required: true },
        id: 'actions',
        profile: 'tools/v1',
        description: 'Outline',
        credentialProbe: 'list_collections',
        mountConfigFields: [{
          key: 'baseUrl',
          label: '实例地址',
          description: '自建 Outline 的根地址;留空用云端 app.getoutline.com',
        }],
      }],
    })
  })

  it('探针 list_collections 只读且无必填入参(平台挂载时会空参调它)', () => {
    const spec = outlineActions.list_collections
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })

  it('List 出全部 6 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(outlineActions).length)
    expect(tools).toHaveLength(6)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'get_collection',
      'get_document',
      'list_collection_documents',
      'list_collections',
      'list_documents',
      'search_documents',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('baseUrl 归一', () => {
  it('不配 providerConfig 就打云端 app.getoutline.com/api,凭证走 Authorization Bearer', async () => {
    const mock = mockOutline(200, { data: [] })
    await call('list_collections', {})

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://app.getoutline.com/api/collections.list')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
  })

  it('自建实例只填了站点根地址时自动补 /api(否则每个请求都 404)', async () => {
    const mock = mockOutline(200, { data: [] })
    await call('list_collections', {}, { config: { baseUrl: 'https://wiki.example.com' } })
    expect(sent(mock).url).toBe('https://wiki.example.com/api/collections.list')
  })

  it('已经带 /api 的 baseUrl 不再重复补;末尾斜杠、query、hash 都去掉', async () => {
    const mock = mockOutline(200, { data: [] })
    await call('list_collections', {}, { config: { baseUrl: '  https://wiki.example.com/api/?x=1#f  ' } })
    expect(sent(mock).url).toBe('https://wiki.example.com/api/collections.list')
  })

  it('http 的 baseUrl 被拒(API key 走 Authorization 头,明文链路会泄它)', async () => {
    const mock = mockOutline(200, { data: [] })
    const res = await call('list_collections', {}, { config: { baseUrl: 'http://wiki.example.com' } })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'outline 的 baseUrl 必须用 https',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('指向内网的 baseUrl 被拒,且消息说清是"必须公网可达"而不是含糊的出站失败', async () => {
    const mock = mockOutline(200, { data: [] })
    const res = await call('list_collections', {}, { config: { baseUrl: 'https://10.0.0.5/api' } })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('baseUrl')
    expect(body.message).toContain('公网可达')
    expect(mock).not.toHaveBeenCalled()
  })

  it('baseUrl 不是字符串 → invalid_argument(配置错误,不是服务故障)', async () => {
    const mock = mockOutline(200, { data: [] })
    const res = await call('list_collections', {}, { config: { baseUrl: 42 } })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('请求拼装', () => {
  it('list_collections:参数进 JSON body,未给的不出现', async () => {
    const mock = mockOutline(200, { data: [], pagination: { offset: 10, limit: 5 } })
    await call('list_collections', { offset: 10, limit: 5, query: 'hand' })
    await expect(sent(mock).json()).resolves.toEqual({ offset: 10, limit: 5, query: 'hand' })
  })

  it('空的 statusFilter 整个不发(空数组会被 Outline 当成"过滤到零个状态")', async () => {
    const mock = mockOutline(200, { data: [] })
    await call('list_documents', { statusFilter: [], limit: 3 })
    await expect(sent(mock).json()).resolves.toEqual({ limit: 3 })

    vi.unstubAllGlobals()
    const withFilter = mockOutline(200, { data: [] })
    await call('list_documents', { statusFilter: ['draft', 'published'] })
    await expect(sent(withFilter).json()).resolves.toEqual({ statusFilter: ['draft', 'published'] })
  })

  it('每个 action 打自己的 RPC 路径', async () => {
    const paths: Array<[string, unknown, string]> = [
      ['get_collection', { id: COLLECTION_ID }, '/api/collections.info'],
      ['list_collection_documents', { id: COLLECTION_ID }, '/api/collections.documents'],
      ['list_documents', {}, '/api/documents.list'],
      ['search_documents', { query: 'x' }, '/api/documents.search'],
      ['get_document', { id: 'doc-1' }, '/api/documents.info'],
    ]
    for (const [name, args, pathname] of paths) {
      vi.unstubAllGlobals()
      const mock = mockOutline(200, { data: name === 'list_collection_documents' || name === 'list_documents' || name === 'search_documents' ? [] : { id: COLLECTION_ID, name: 'x', title: 'x' } })
      await call(name, args)
      expect(new URL(sent(mock).url).pathname, name).toBe(pathname)
    }
  })
})

describe('本地必填断言', () => {
  it('纯空白的 query 能过 Zod 的 min(1),但对 Outline 等于没给 → 本地拦下', async () => {
    const mock = mockOutline(200, { data: [] })
    const res = await call('search_documents', { query: '   ' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'query is required.',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_document 两个都不给 → schema 的 refine 就拦下,不打上游', async () => {
    const mock = mockOutline(200, { data: {} })
    const res = await call('get_document', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_document 的 id 是纯空白且没有 shareId → refine 放行但运行期再判一次', async () => {
    const mock = mockOutline(200, { data: {} })
    const res = await call('get_document', { id: '   ' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Provide at least one of id or shareId.',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_document 只给 shareId 也成立;空白的 id 不进 body', async () => {
    const mock = mockOutline(200, { data: { id: COLLECTION_ID, title: 'Shared doc' } })
    const res = await call('get_document', { id: '  ', shareId: 'share-123' })
    await expect(sent(mock).json()).resolves.toEqual({ shareId: 'share-123' })
    await expect(res.json()).resolves.toMatchObject({
      content: { document: { id: COLLECTION_ID, title: 'Shared doc' } },
    })
  })
})

describe('响应整形', () => {
  it('collections 从 data 里取并裁剪,未声明的字段仍从 raw 可得,null 保留', async () => {
    mockOutline(200, { data: [COLLECTION], pagination: { offset: 0, limit: 25 } })
    const res = await call('list_collections', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        collections: [{
          id: COLLECTION_ID,
          name: 'Handbook',
          description: null,
          sort: { field: 'index', direction: 'asc' },
          sharing: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
          raw: COLLECTION,
        }],
        pagination: { offset: 0, limit: 25 },
      },
    })
  })

  it('上游略掉 pagination 时补 0(outputSchema 里它是必填)', async () => {
    mockOutline(200, { data: [] })
    const res = await call('list_collections', {})
    await expect(res.json()).resolves.toMatchObject({
      content: { collections: [], pagination: { offset: 0, limit: 0 } },
    })
  })

  it('collection.sort 缺 field 或 direction 就整份丢掉(半份排序元数据没意义)', async () => {
    mockOutline(200, { data: [{ ...COLLECTION, sort: { field: 'index' } }] })
    const res = await call('list_collections', {})
    const body = (await res.json()) as { content: { collections: Array<Record<string, unknown>> } }
    expect(body.content.collections[0]).not.toHaveProperty('sort')
  })

  it('文档树按层递归归一,children 缺席时补空数组', async () => {
    mockOutline(200, {
      data: [{
        id: COLLECTION_ID,
        title: 'Root',
        url: '/doc/root',
        children: [
          { id: '22222222-2222-4222-8222-222222222222', title: 'Child', url: '/doc/child' },
          'not an object',
        ],
      }],
    })
    const res = await call('list_collection_documents', { id: COLLECTION_ID })
    await expect(res.json()).resolves.toEqual({
      content: {
        tree: [{
          id: COLLECTION_ID,
          title: 'Root',
          url: '/doc/root',
          children: [{
            id: '22222222-2222-4222-8222-222222222222',
            title: 'Child',
            url: '/doc/child',
            children: [],
          }],
        }],
      },
    })
  })

  it('document.createdBy 既无 id 也无 name 就整份丢掉', async () => {
    mockOutline(200, {
      data: [{ id: COLLECTION_ID, title: 'Doc', createdBy: { avatarUrl: 'https://a.example/x.png' } }],
    })
    const res = await call('list_documents', {})
    const body = (await res.json()) as { content: { documents: Array<Record<string, unknown>> } }
    expect(body.content.documents[0]).not.toHaveProperty('createdBy')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:get_collection 的 id 不是 UUID → 400 且不打上游', async () => {
    const mock = mockOutline(200, {})
    const res = await call('get_collection', { id: 'not-a-uuid' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 4xx → invalid_argument / not_found / permission_denied,5xx → unavailable + retryable', async () => {
    mockOutline(400, { message: 'collectionId is invalid' })
    await expect((await call('list_documents', {})).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'collectionId is invalid' })

    vi.unstubAllGlobals()
    mockOutline(404, { message: 'Collection not found' })
    const missing = await call('get_collection', { id: COLLECTION_ID })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found' })

    vi.unstubAllGlobals()
    mockOutline(401, { error: 'authentication_required' })
    const unauthorized = await call('list_documents', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'authentication_required' })

    vi.unstubAllGlobals()
    mockOutline(429, { message: 'Too many requests' })
    await expect((await call('list_documents', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockOutline(503, { message: 'Outline is restarting' })
    await expect((await call('list_documents', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('错误体不是 JSON 时把原文当消息(自建实例前面挂反代时很常见)', async () => {
    mockRaw(502, '<html>502 Bad Gateway</html>')
    await expect((await call('list_documents', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: '<html>502 Bad Gateway</html>' })
  })

  it('2xx 上回非 JSON、或响应里没有 data → unavailable + retryable(上游坏了,不是插件崩了)', async () => {
    mockRaw(200, 'not json at all')
    await expect((await call('list_documents', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockOutline(200, { ok: true })
    await expect((await call('list_documents', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'outline 响应里没有 data' })

    vi.unstubAllGlobals()
    mockOutline(200, { data: 'not an array' })
    await expect((await call('list_documents', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockOutline(200, {})
    const res = await call('list_collections', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
