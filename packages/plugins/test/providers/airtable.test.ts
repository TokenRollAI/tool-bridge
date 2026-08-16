import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createAirtablePlugin } from '../../src/airtable/index'
import { airtableActions } from '../../src/airtable/schema'

/**
 * Airtable 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * PHP 风格的方括号 query(`fields[]`、`sort[0][field]`)、URL 过长时改打 POST 端点、
 * 写接口逐字段挑选请求体(路径参数不能混进去)、offset 的 null 语义,
 * 以及上游把 400 压成 502 的错误口径修正。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'patdeadbeef.cafef00d'
const plugin = createAirtablePlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'data/airtable',
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

function mockRaw(status: number, body: string, headers: Record<string, string> = {}): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(body === '' ? null : body, { status, headers })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function mockAirtable(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  return mockRaw(status, JSON.stringify(payload), { 'content-type': 'application/json' })
}

/** 取上游收到的那个请求。 */
function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

const TABLE = { baseId: 'appABC123', tableIdOrName: 'Tasks' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('~describe 报成单个 tools/v1 export,并带上凭证探针', async () => {
    const res = await createAirtablePlugin().fetch(new Request('https://plugin.test/~describe'), {} as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'single', required: true },
        id: 'actions',
        profile: 'tools/v1',
        description: 'Airtable',
        credentialProbe: 'list_bases',
      }],
    })
  })

  it('探针 list_bases 只读且无必填入参(平台挂载时会空参调它)', () => {
    const spec = airtableActions.list_bases
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })

  it('List 出全部 14 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(airtableActions).length)
    expect(tools).toHaveLength(14)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_base',
      'create_field',
      'create_records',
      'create_table',
      'delete_base',
      'delete_records',
      'get_base_collaborators',
      'get_base_schema',
      'get_record',
      'list_bases',
      'list_records',
      'update_field',
      'update_records',
      'update_table',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('元数据接口', () => {
  it('list_bases:打 /v0/meta/bases,凭证走 Bearer 头,offset 缺席时补 null', async () => {
    const mock = mockAirtable(200, { bases: [{ id: 'appABC123', name: 'Ops', permissionLevel: 'create' }] })
    const res = await call('list_bases', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://api.airtable.com/v0/meta/bases')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBeNull()
    await expect(res.json()).resolves.toEqual({
      content: {
        bases: [{ id: 'appABC123', name: 'Ops', permissionLevel: 'create' }],
        // 翻页靠它判"到底了",不能压成字段缺席。
        offset: null,
      },
    })
  })

  it('include 展开成重复的 include[] —— 不是逗号串', async () => {
    const mock = mockAirtable(200, { id: 'appABC123', name: 'Ops' })
    await call('get_base_collaborators', { baseId: 'appABC123', include: ['collaborators', 'inviteLinks'] })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v0/meta/bases/appABC123')
    expect(url.searchParams.getAll('include[]')).toEqual(['collaborators', 'inviteLinks'])
  })

  it('get_base_schema:tables 缺席时兜底空数组', async () => {
    mockAirtable(200, {})
    await expect((await call('get_base_schema', { baseId: 'appABC123' })).json())
      .resolves.toEqual({ content: { tables: [] } })
  })

  it('create_field:路径参数不进请求体(Airtable 会把 baseId 当成非法字段属性拒掉)', async () => {
    const mock = mockAirtable(200, { id: 'fld1', name: 'Status', type: 'singleSelect' })
    await call('create_field', {
      baseId: 'appABC123',
      tableId: 'tblXYZ',
      name: 'Status',
      type: 'singleSelect',
      options: { choices: [{ name: 'Todo' }] },
    })

    const request = sent(mock)
    expect(new URL(request.url).pathname).toBe('/v0/meta/bases/appABC123/tables/tblXYZ/fields')
    await expect(request.json()).resolves.toEqual({
      name: 'Status',
      type: 'singleSelect',
      options: { choices: [{ name: 'Todo' }] },
    })
  })

  it('create_base:tables 里的未知键透传,name/description/fields 逐个规整', async () => {
    const mock = mockAirtable(200, { id: 'appNEW', tables: [] })
    await call('create_base', {
      name: 'Ops',
      workspaceId: 'wspABC',
      tables: [{
        name: 'Tasks',
        description: '  todo list  ',
        fields: [{ name: 'Title', type: 'singleLineText' }],
        // looseObject:Airtable 未来新增的表级选项无须改代码就能用。
        extraTableOption: true,
      }],
    })

    await expect(sent(mock).json()).resolves.toEqual({
      name: 'Ops',
      workspaceId: 'wspABC',
      tables: [{
        name: 'Tasks',
        description: 'todo list',
        fields: [{ name: 'Title', type: 'singleLineText' }],
        extraTableOption: true,
      }],
    })
  })

  it('update_table 用 PATCH,只发给了的字段', async () => {
    const mock = mockAirtable(200, { id: 'tbl1', name: 'Done', fields: [] })
    await call('update_table', { ...TABLE, name: 'Done' })
    const request = sent(mock)
    expect(request.method).toBe('PATCH')
    expect(new URL(request.url).pathname).toBe('/v0/meta/bases/appABC123/tables/Tasks')
    await expect(request.json()).resolves.toEqual({ name: 'Done' })
  })
})

describe('记录接口', () => {
  it('list_records:fields[] 重复、sort 带下标、布尔转字符串', async () => {
    const mock = mockAirtable(200, { records: [], offset: 'itr123/rec456' })
    const res = await call('list_records', {
      ...TABLE,
      fields: ['Name', 'Status'],
      sort: [{ field: 'Name', direction: 'asc' }, { field: 'Created' }],
      returnFieldsByFieldId: false,
      pageSize: 50,
      view: 'Grid view',
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.pathname).toBe('/v0/appABC123/Tasks')
    expect(url.searchParams.getAll('fields[]')).toEqual(['Name', 'Status'])
    expect(url.searchParams.get('sort[0][field]')).toBe('Name')
    expect(url.searchParams.get('sort[0][direction]')).toBe('asc')
    expect(url.searchParams.get('sort[1][field]')).toBe('Created')
    // 没给 direction 的那条不该凭空补一个默认值。
    expect(url.searchParams.has('sort[1][direction]')).toBe(false)
    // false 也要发:它与"没给"在 Airtable 侧不等价。
    expect(url.searchParams.get('returnFieldsByFieldId')).toBe('false')
    expect(url.searchParams.get('pageSize')).toBe('50')
    expect(url.searchParams.get('view')).toBe('Grid view')
    await expect(res.json()).resolves.toEqual({ content: { records: [], offset: 'itr123/rec456' } })
  })

  it('URL 被长 filterByFormula 撑爆时改打 POST /listRecords,同一批参数换成 JSON 体', async () => {
    const shortMock = mockAirtable(200, { records: [] })
    await call('list_records', { ...TABLE, filterByFormula: '{Status}="Todo"' })
    expect(sent(shortMock).method).toBe('GET')

    vi.unstubAllGlobals()
    // 拼出的 URL 超过 15000 字符,GET 走不通。
    const formula = `{Notes}="${'x'.repeat(15_000)}"`
    const longMock = mockAirtable(200, { records: [{ id: 'rec1', fields: {} }], offset: 'next' })
    const res = await call('list_records', { ...TABLE, filterByFormula: formula, pageSize: 10 })

    const request = sent(longMock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/v0/appABC123/Tasks/listRecords')
    expect([...new URL(request.url).searchParams.keys()]).toEqual([])
    await expect(request.json()).resolves.toEqual({ filterByFormula: formula, pageSize: 10 })
    await expect(res.json()).resolves.toEqual({
      content: { records: [{ id: 'rec1', fields: {} }], offset: 'next' },
    })
  })

  it('create_records 只发 fields;update_records 额外带 id', async () => {
    const create = mockAirtable(200, { records: [{ id: 'rec1', fields: { Name: 'A' } }] })
    await call('create_records', { ...TABLE, records: [{ fields: { Name: 'A' } }], typecast: true })
    const createRequest = sent(create)
    expect(createRequest.method).toBe('POST')
    await expect(createRequest.json()).resolves.toEqual({
      records: [{ fields: { Name: 'A' } }],
      typecast: true,
    })

    vi.unstubAllGlobals()
    const update = mockAirtable(200, { records: [{ id: 'rec1', fields: { Name: 'B' } }] })
    await call('update_records', { ...TABLE, records: [{ id: 'rec1', fields: { Name: 'B' } }] })
    const updateRequest = sent(update)
    expect(updateRequest.method).toBe('PATCH')
    await expect(updateRequest.json()).resolves.toEqual({
      records: [{ id: 'rec1', fields: { Name: 'B' } }],
    })
  })

  it('delete_records:id 走 query 的重复 records[],不是请求体', async () => {
    const mock = mockAirtable(200, { records: [{ id: 'rec1', deleted: true }, { id: 'rec2', deleted: true }] })
    const res = await call('delete_records', { ...TABLE, recordIds: ['rec1', 'rec2'] })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('DELETE')
    expect(url.pathname).toBe('/v0/appABC123/Tasks')
    expect(url.searchParams.getAll('records[]')).toEqual(['rec1', 'rec2'])
    expect(await request.text()).toBe('')
    await expect(res.json()).resolves.toEqual({
      content: { records: [{ id: 'rec1', deleted: true }, { id: 'rec2', deleted: true }] },
    })
  })

  it('表名里的空格与斜杠被 URL 编码,不会改写路径结构', async () => {
    const mock = mockAirtable(200, { id: 'rec1', fields: {} })
    await call('get_record', { baseId: 'appABC123', tableIdOrName: 'My/Table Name', recordId: 'rec1' })
    expect(new URL(sent(mock).url).pathname).toBe('/v0/appABC123/My%2FTable%20Name/rec1')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:一次超过 10 条记录 → 400 且不打上游', async () => {
    const mock = mockAirtable(200, {})
    const res = await call('create_records', {
      ...TABLE,
      records: Array.from({ length: 11 }, () => ({ fields: { Name: 'A' } })),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的路径参数能过 Zod 的 min(1),但在本地就挡下', async () => {
    const mock = mockAirtable(200, {})
    const res = await call('get_record', { baseId: '   ', tableIdOrName: 'Tasks', recordId: 'rec1' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('baseId'),
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 400 归成 invalid_argument 而非可重试的 502 —— 参数写错重试多少次都一样', async () => {
    mockAirtable(400, { error: { type: 'INVALID_FILTER_BY_FORMULA', message: 'Invalid formula' } })
    const res = await call('list_records', { ...TABLE, filterByFormula: '{{' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      // 消息拼上错误类型,便于调用方对着 Airtable 文档查。
      message: 'Invalid formula (INVALID_FILTER_BY_FORMULA)',
    })
  })

  it('上游其余状态按公共表归一', async () => {
    mockAirtable(404, { error: { type: 'TABLE_NOT_FOUND', message: 'Table not found' } })
    const missing = await call('get_record', { ...TABLE, recordId: 'rec1' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found' })

    vi.unstubAllGlobals()
    mockAirtable(401, { error: 'UNAUTHORIZED' })
    const unauthorized = await call('list_bases', {})
    expect(unauthorized.status).toBe(401)
    // error 是字符串而非对象时拿不到 message,退回状态说明。
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'airtable request failed with 401',
    })

    vi.unstubAllGlobals()
    mockAirtable(429, { error: { type: 'RATE_LIMIT_REACHED' } })
    const limited = await call('list_bases', {})
    expect(limited.status).toBe(429)
    // 只有 type 没有 message 时,消息退回 type。
    await expect(limited.json()).resolves.toMatchObject({
      code: 'rate_limited',
      retryable: true,
      message: 'RATE_LIMIT_REACHED',
    })

    vi.unstubAllGlobals()
    mockAirtable(503, {})
    await expect((await call('list_bases', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('声明是 JSON 却解不出来 → unavailable + retryable', async () => {
    mockRaw(200, '<html>maintenance</html>', { 'content-type': 'application/json' })
    await expect((await call('list_bases', {})).json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: expect.stringContaining('airtable response parsing failed'),
    })
  })

  it('没声明 content-type 的纯文本错误体也能拿到消息', async () => {
    mockRaw(500, 'upstream boom')
    await expect((await call('list_bases', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'upstream boom' })
  })

  it('2xx 上回数组而非对象 → unavailable(契约说好是对象)', async () => {
    mockAirtable(200, [])
    await expect((await call('list_bases', {})).json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'airtable list bases response must be a plain object',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockAirtable(200, {})
    const res = await call('list_bases', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
