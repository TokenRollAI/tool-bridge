import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSlabPlugin } from '../../src/slab/index'
import { slabActions } from '../../src/slab/schema'

/**
 * Slab 迁移产物的 wire 级验收。重点:GraphQL 请求体的形状(query/variables/operationName)、
 * 200 上的 `errors` 也算失败、`UNAUTHENTICATED` 码优先于 HTTP 状态、search 的联合类型摊平。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'slab_test_deadbeef'
const plugin = createSlabPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'docs/slab',
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

function mockSlab(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

async function sentBody(mock: ReturnType<typeof vi.fn>): Promise<{
  operationName: string
  query: string
  variables?: Record<string, unknown>
}> {
  return (await sent(mock).json()) as { operationName: string, query: string, variables?: Record<string, unknown> }
}

const POST = { id: 'p1', title: 'Doc', linkAccess: 'INTERNAL' }
const TOPIC = { id: 't1', name: 'Eng', privacy: 'OPEN' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 17 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(slabActions).length)
    expect(tools).toHaveLength(17)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('get_organization')).toBe('read')
    expect(effectOf('create_post')).toBe('write')
    expect(effectOf('delete_post')).toBe('destructive')
    expect(effectOf('delete_topic')).toBe('destructive')
  })
})

describe('GraphQL 请求整形', () => {
  it('get_organization 打单一 GraphQL 端点,凭证走 Bearer', async () => {
    const mock = mockSlab(200, { data: { organization: { id: 'org1', name: 'Acme' } } })
    const res = await call('get_organization', {})

    const request = sent(mock)
    expect(request.url).toBe('https://api.slab.com/graphql')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')

    const body = await sentBody(mock)
    expect(body.operationName).toBe('GetOrganization')
    expect(body.query).toContain('query GetOrganization')

    await expect(res.json()).resolves.toEqual({
      content: { organization: { id: 'org1', name: 'Acme' } },
    })
  })

  it('未给的可选 variables 不出现(GraphQL 里 null 与"没传"语义不同)', async () => {
    const mock = mockSlab(200, { data: { createPost: POST } })
    await call('create_post', { title: 'Doc' })
    const body = await sentBody(mock)
    expect(body.variables).toEqual({ title: 'Doc' })
  })

  it('update_post 的布尔 false 要发出去,空白串则视为没给', async () => {
    const mock = mockSlab(200, { data: { updatePost: POST } })
    await call('update_post', { id: 'p1', archived: false, published: false, ownerId: '   ' })
    const body = await sentBody(mock)
    expect(body.variables).toEqual({ id: 'p1', archived: false, published: false })
  })

  it('create_topic 的 description 是 Slab 的 Json 标量,原样转发', async () => {
    const mock = mockSlab(200, { data: { createTopic: TOPIC } })
    const description = { type: 'doc', content: [{ type: 'paragraph' }] }
    await call('create_topic', { name: 'Eng', description, privacy: 'PRIVATE' })
    const body = await sentBody(mock)
    expect(body.variables).toEqual({ name: 'Eng', description, privacy: 'PRIVATE' })
  })

  it('get_posts 的 ids 数组进 variables', async () => {
    const mock = mockSlab(200, { data: { posts: [POST] } })
    const res = await call('get_posts', { ids: ['p1', 'p2'] })
    expect((await sentBody(mock)).variables).toEqual({ ids: ['p1', 'p2'] })
    await expect(res.json()).resolves.toEqual({ content: { posts: [POST] } })
  })

  it('add_topic_to_post 两个 ID 都进 variables', async () => {
    const mock = mockSlab(200, { data: { addTopicToPost: TOPIC } })
    await call('add_topic_to_post', { postId: 'p1', topicId: 't1' })
    expect((await sentBody(mock)).variables).toEqual({ postId: 'p1', topicId: 't1' })
  })
})

describe('search 的联合类型摊平', () => {
  it('四种 node 各自摊成 type + title + content + 实体', async () => {
    mockSlab(200, {
      data: {
        search: {
          pageInfo: { hasNextPage: true, endCursor: 'c4' },
          edges: [
            {
              cursor: 'c1',
              node: {
                __typename: 'PostSearchResult',
                title: 'Runbook',
                highlight: 'run<em>book</em>',
                content: 'body',
                post: POST,
              },
            },
            {
              cursor: 'c2',
              node: { __typename: 'TopicSearchResult', name: 'Eng', description: 'desc', topic: TOPIC },
            },
            {
              cursor: 'c3',
              node: {
                __typename: 'UserSearchResult',
                name: 'Ada',
                description: 'about',
                user: { id: 'u1', name: 'Ada' },
              },
            },
            {
              cursor: 'c4',
              node: { __typename: 'CommentSearchResult', content: 'nice', comment: { id: 'cm1' } },
            },
          ],
        },
      },
    })

    const res = await call('search', { query: 'runbook', types: ['POST'], first: 4 })
    await expect(res.json()).resolves.toEqual({
      content: {
        pageInfo: { hasNextPage: true, endCursor: 'c4' },
        results: [
          { cursor: 'c1', highlight: 'run<em>book</em>', type: 'POST', title: 'Runbook', content: 'body', post: POST },
          { cursor: 'c2', type: 'TOPIC', title: 'Eng', content: 'desc', topic: TOPIC },
          { cursor: 'c3', type: 'USER', title: 'Ada', content: 'about', user: { id: 'u1', name: 'Ada' } },
          { cursor: 'c4', type: 'COMMENT', content: 'nice', comment: { id: 'cm1' } },
        ],
      },
    })
  })

  it('未知 __typename 报错而非静默丢弃(上游加了新结果种类时要能发现)', async () => {
    mockSlab(200, {
      data: {
        search: {
          pageInfo: {},
          edges: [{ cursor: 'c1', node: { __typename: 'FileSearchResult', file: {} } }],
        },
      },
    })
    await expect((await call('search', { query: 'x' })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'slab search returned an unknown result type' })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:linkAccess 给未知枚举 → 400 且不打上游', async () => {
    const mock = mockSlab(200, { data: {} })
    const res = await call('update_post', { id: 'p1', linkAccess: 'SEMI_PUBLIC' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('被生成器误标成 optional 的必填 id,缺失时在打上游前挡下', async () => {
    const mock = mockSlab(200, { data: {} })
    const res = await call('get_post', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('GraphQL 在 HTTP 200 上回 errors 也算失败', async () => {
    mockSlab(200, { errors: [{ message: 'Post not found' }] })
    await expect((await call('get_post', { id: 'p_missing' })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'Post not found' })
  })

  it('UNAUTHENTICATED / FORBIDDEN 码优先于 HTTP 状态', async () => {
    mockSlab(200, {
      errors: [{ message: 'invalid token', extensions: { code: 'UNAUTHENTICATED' } }],
    })
    const res = await call('get_organization', {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ code: 'permission_denied' })

    mockSlab(200, { errors: [{ message: 'no access', extensions: { code: 'FORBIDDEN' } }] })
    await expect((await call('get_organization', {})).json())
      .resolves.toMatchObject({ code: 'permission_denied' })
  })

  it('HTTP 层的错误按状态归一', async () => {
    mockSlab(401, { message: 'unauthorized' })
    expect((await call('get_organization', {})).status).toBe(401)

    mockSlab(429, { message: 'slow down' })
    await expect((await call('get_organization', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockSlab(500, { message: 'slab is down' })
    await expect((await call('get_organization', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('响应缺 data 或 data 里缺字段 → unavailable', async () => {
    mockSlab(200, { extensions: {} })
    await expect((await call('get_organization', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'slab response did not include data' })

    mockSlab(200, { data: {} })
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockSlab(200, { data: { organization: {} } })
    const res = await call('get_organization', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
