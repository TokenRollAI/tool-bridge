import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPipedrivePlugin } from '../../src/pipedrive/index'
import { pipedriveActions } from '../../src/pipedrive/schema'

/**
 * Pipedrive 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 入参键的 camelCase → snake_case 转换(漏了不会报错,只会静默丢字段)、
 * GET query 与写操作 body 的取舍规则之别(null 的去留正好相反)、
 * `success: false` 的信封式失败(带着 HTTP 200 回来)、search 的 term 必填与别名回退、
 * 以及 `{id}` 路径段在 schema 全 optional 时的本地必填断言。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'pd_testdeadbeef'
const plugin = createPipedrivePlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'crm/pipedrive',
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

function mockPipedrive(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('~describe 报成单个 tools/v1 export,并把凭证探针一并声明出去', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        id: 'actions',
        profile: 'tools/v1',
        description: 'Pipedrive',
        credentialProbe: 'list_pipelines',
      }],
    })
  })

  it('List 出全部 27 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(pipedriveActions).length)
    expect(tools).toHaveLength(27)
    // 操作表与 schema 表的键集合必须完全吻合(装配期闸门盯的就是这个)。
    expect(tools.map(tool => tool.name).sort()).toEqual(Object.keys(pipedriveActions).sort())
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('探针指向的 list_pipelines 是 read,且空参能真的跑通', async () => {
    expect(pipedriveActions.list_pipelines.effect).toBe('read')
    const mock = mockPipedrive(200, { success: true, data: [] })
    const res = await call('list_pipelines', {})
    expect(res.status).toBe(200)
    expect(new URL(sent(mock).url).search).toBe('')
  })
})

describe('请求拼装', () => {
  it('list_persons:GET,凭证走 x-api-token 头,无请求体', async () => {
    const mock = mockPipedrive(200, { success: true, data: [] })
    await call('list_persons', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://api.pipedrive.com/api/v2/persons')
    expect(request.headers.get('x-api-token')).toBe(API_KEY)
    expect(request.headers.get('accept')).toBe('application/json')
    // 凭证只在头上,URL 上不该出现它(Pipedrive 也支持 ?api_token=,这里刻意不用)。
    expect(request.url).not.toContain(API_KEY)
    expect(request.url).not.toContain('api_token')
    expect(await request.text()).toBe('')
  })

  it('GET query 的键转成 snake_case,只收标量(数组/对象/null 都丢掉)', async () => {
    const mock = mockPipedrive(200, { success: true, data: [] })
    await call('list_deals', {
      ownerId: 42,
      updatedSince: '2026-01-01T00:00:00Z',
      includeFields: ['next_activity_id'],
      customFields: { foo: 'bar' },
      filterId: null,
      limit: 100,
      sortDirection: 'desc',
    })

    expect(Object.fromEntries(new URL(sent(mock).url).searchParams)).toEqual({
      owner_id: '42',
      updated_since: '2026-01-01T00:00:00Z',
      limit: '100',
      sort_direction: 'desc',
    })
  })

  it('写操作的 body 也转 snake_case,但 null 要留着(Pipedrive 用它清空字段)', async () => {
    const mock = mockPipedrive(200, { success: true, data: { id: 7 } })
    await call('create_person', {
      name: 'Ada Lovelace',
      ownerId: 42,
      orgId: null,
      emails: [{ value: 'ada@example.com', primary: true }],
      customFields: { deadbeef: 'x' },
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      name: 'Ada Lovelace',
      owner_id: 42,
      // GET 会把 null 丢掉,写操作必须留着 —— 两条规则正好相反。
      org_id: null,
      emails: [{ value: 'ada@example.com', primary: true }],
      custom_fields: { deadbeef: 'x' },
    })
  })

  it('update_person:id 进路径段而不进 body', async () => {
    const mock = mockPipedrive(200, { success: true, data: { id: 7 } })
    await call('update_person', { personId: 7, name: 'Ada' })

    const request = sent(mock)
    expect(request.method).toBe('PATCH')
    expect(request.url).toBe('https://api.pipedrive.com/api/v2/persons/7')
    await expect(request.json()).resolves.toEqual({ name: 'Ada' })
  })

  it('get_/delete_ 的 id 同样只进路径,不进 query', async () => {
    const get = mockPipedrive(200, { success: true, data: { id: 7 } })
    await call('get_person', { personId: 7 })
    const getUrl = new URL(sent(get).url)
    expect(getUrl.pathname).toBe('/api/v2/persons/7')
    expect(getUrl.search).toBe('')

    vi.unstubAllGlobals()
    const removed = mockPipedrive(200, { success: true, data: { id: 7 } })
    await call('delete_deal', { dealId: 7 })
    const deleteRequest = sent(removed)
    expect(deleteRequest.method).toBe('DELETE')
    expect(deleteRequest.url).toBe('https://api.pipedrive.com/api/v2/deals/7')
    // 没有请求体就不该发 content-type。
    expect(deleteRequest.headers.get('content-type')).toBeNull()
  })

  it('四类资源各打各的 v2 端点', async () => {
    for (const [action, args, pathname] of [
      ['get_organization', { organizationId: 3 }, '/api/v2/organizations/3'],
      ['get_activity', { activityId: 4 }, '/api/v2/activities/4'],
      ['get_pipeline', { pipelineId: 5 }, '/api/v2/pipelines/5'],
      ['get_stage', { stageId: 6 }, '/api/v2/stages/6'],
      ['list_stages', {}, '/api/v2/stages'],
    ] as const) {
      vi.unstubAllGlobals()
      const mock = mockPipedrive(200, { success: true, data: action.startsWith('list_') ? [] : { id: 1 } })
      await call(action, args)
      expect(new URL(sent(mock).url).pathname, action).toBe(pathname)
    }
  })
})

describe('search 的 term', () => {
  it('term 照常进 query', async () => {
    const mock = mockPipedrive(200, { success: true, data: { items: [] } })
    await call('search_persons', { term: 'ada', exactMatch: true })
    expect(Object.fromEntries(new URL(sent(mock).url).searchParams))
      .toEqual({ term: 'ada', exact_match: 'true' })
  })

  it('只给 query 时回退成 term,且两个键都发出去(保留上游行为)', async () => {
    const mock = mockPipedrive(200, { success: true, data: { items: [] } })
    await call('search_deals', { query: 'acme' })
    expect(Object.fromEntries(new URL(sent(mock).url).searchParams))
      .toEqual({ query: 'acme', term: 'acme' })
  })

  it('term 与 query 都没有 → invalid_argument 且不打上游', async () => {
    const mock = mockPipedrive(200, {})
    const res = await call('search_organizations', { fields: 'name' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'term 不能为空' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的 term 视同没给(trim 后为空)', async () => {
    const mock = mockPipedrive(200, {})
    const res = await call('search_persons', { term: '   ' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('响应整形', () => {
  it('list_* 平铺成 {listKey, nextCursor},游标取自 additional_data.pagination', async () => {
    mockPipedrive(200, {
      success: true,
      data: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }],
      additional_data: { pagination: { next_cursor: 'eyJpZCI6Mn0=', more_items_in_collection: true } },
    })
    const res = await call('list_persons', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        persons: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }],
        nextCursor: 'eyJpZCI6Mn0=',
      },
    })
  })

  it('没有下一页时 nextCursor 如实回 null;data 不是数组时回空列表', async () => {
    mockPipedrive(200, { success: true, data: null })
    const res = await call('list_stages', {})
    await expect(res.json()).resolves.toEqual({ content: { stages: [], nextCursor: null } })
  })

  it('get_/create_/update_ 包成 {itemKey: data}', async () => {
    mockPipedrive(200, { success: true, data: { id: 7, name: 'Ada', owner_id: 42 } })
    const res = await call('get_person', { personId: 7 })
    await expect(res.json()).resolves.toEqual({
      content: { person: { id: 7, name: 'Ada', owner_id: 42 } },
    })
  })

  it('search_* 从 data.items 取列表', async () => {
    mockPipedrive(200, {
      success: true,
      data: { items: [{ result_score: 1, item: { id: 7 } }] },
      additional_data: { pagination: { next_cursor: null } },
    })
    const res = await call('search_persons', { term: 'ada' })
    await expect(res.json()).resolves.toEqual({
      content: { items: [{ result_score: 1, item: { id: 7 } }], nextCursor: null },
    })
  })

  it('delete_* 回 {id, deleted, raw}', async () => {
    mockPipedrive(200, { success: true, data: { id: 7 } })
    const res = await call('delete_activity', { activityId: 7 })
    await expect(res.json()).resolves.toEqual({
      content: { id: 7, deleted: true, raw: { id: 7 } },
    })
  })

  it('delete_* 遇到空响应体也算删成功(id 未知则回 null)', async () => {
    const fn = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    vi.stubGlobal('fetch', fn)
    const res = await call('delete_person', { personId: 7 })
    await expect(res.json()).resolves.toEqual({ content: { id: null, deleted: true, raw: null } })
  })

  it('itemKey 的 data 不是对象 → unavailable(是上游破契约,不是调用方的错)', async () => {
    mockPipedrive(200, { success: true, data: [1, 2] })
    const res = await call('get_deal', { dealId: 7 })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('缺 id → invalid_argument 且不打上游(schema 里它是 optional,断言只能在这层)', async () => {
    const mock = mockPipedrive(200, {})
    const res = await call('get_person', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'personId 必须是正整数',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('id 是 0 / 负数 / 字符串都拒(不能拼出 /api/v2/persons/0)', async () => {
    for (const personId of [0, -1, '7', 1.5]) {
      vi.unstubAllGlobals()
      const mock = mockPipedrive(200, {})
      const res = await call('update_person', { personId, name: 'x' })
      expect(res.status, `personId=${String(personId)}`).toBe(400)
      expect(mock).not.toHaveBeenCalled()
    }
  })

  it('success: false 带着 HTTP 200 回来也算失败,不能当成功返回', async () => {
    const mock = mockPipedrive(200, { success: false, error: 'Scope unavailable', error_info: 'see docs' })
    const res = await call('list_persons', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Scope unavailable',
    })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('success: false 但没有 error 时退回 error_info', async () => {
    mockPipedrive(200, { success: false, error_info: 'Please check the API docs' })
    const res = await call('list_persons', {})
    await expect(res.json()).resolves.toMatchObject({ message: 'Please check the API docs' })
  })

  it('上游 4xx → invalid_argument;5xx → unavailable + retryable', async () => {
    mockPipedrive(400, { success: false, error: 'Bad request' })
    const bad = await call('create_deal', { title: 'x' })
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'Bad request' })

    vi.unstubAllGlobals()
    mockPipedrive(500, { success: false, error: 'Pipedrive is down' })
    const down = await call('create_deal', { title: 'x' })
    expect(down.status).toBe(503)
    await expect(down.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Pipedrive is down',
    })
  })

  it('401 → permission_denied,404 → not_found,429 → rate_limited', async () => {
    mockPipedrive(401, { success: false, error: 'Invalid API token' })
    const unauthorized = await call('list_persons', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({ code: 'permission_denied' })

    vi.unstubAllGlobals()
    // 上游把带 id 的 404 压成 400;这里如实回 not_found —— 状态码归一收在 upstreamError 一处。
    mockPipedrive(404, { success: false, error: 'Person not found' })
    const missing = await call('get_person', { personId: 999 })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'Person not found' })

    vi.unstubAllGlobals()
    mockPipedrive(429, { success: false, error: 'Rate limit exceeded' })
    const limited = await call('list_persons', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('错误体是纯文本(网关错误页)时消息取整段文本', async () => {
    mockPipedrive(502, '<html>Bad Gateway</html>')
    const res = await call('list_persons', {})
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: '<html>Bad Gateway</html>',
    })
  })

  it('2xx 回非 JSON → unavailable(上游破了契约,不能当成功)', async () => {
    mockPipedrive(200, 'not json at all')
    const res = await call('list_persons', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockPipedrive(200, {})
    const res = await call('list_persons', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
