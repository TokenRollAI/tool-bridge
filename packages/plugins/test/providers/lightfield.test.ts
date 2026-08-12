import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLightfieldPlugin } from '../../src/lightfield/index'
import { lightfieldActions } from '../../src/lightfield/schema'

/**
 * Lightfield 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * filters 的原始字段表达式直接当 query 键、列表响应的 data→records 摊平、
 * 路径参数编码、key 元数据的形状校验、错误状态归一。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'sk_lf_deadbeef'
const plugin = createLightfieldPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'crm/lightfield',
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

function mockLightfield(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

const RECORD = {
  id: 'rec_1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: null,
  externalId: null,
  httpLink: 'https://crm.lightfield.app/records/rec_1',
  fields: { email: { value: 'ada@example.com', valueType: 'email' } },
  relationships: { owner: { cardinality: 'has_one', objectType: 'user', values: ['usr_1'] } },
}

const LIST_PAYLOAD = { data: [RECORD], object: 'list', totalCount: 1 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 10 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(lightfieldActions).length)
    expect(tools).toHaveLength(10)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('十个 action 全是只读,effect 都是 read', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    expect(tools.map(t => t.effect)).toEqual(Array.from({ length: 10 }, () => 'read'))
  })
})

describe('列表:分页、filters 与响应摊平', () => {
  it('limit/offset 进 query,凭证与版本头齐全', async () => {
    const mock = mockLightfield(200, LIST_PAYLOAD)
    const res = await call('list_accounts', { limit: 5, offset: 10 })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin).toBe('https://api.lightfield.app')
    expect(url.pathname).toBe('/v1/accounts')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('offset')).toBe('10')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('lightfield-version')).toBe('2026-03-01')
    expect(request.headers.get('accept')).toBe('application/json')

    // 上游的 data 摊平成 records,object/totalCount 原样透出。
    await expect(res.json()).resolves.toEqual({
      content: { records: [RECORD], object: 'list', totalCount: 1 },
    })
  })

  it('filters 的原始字段表达式直接当 query 键(不做重命名/转义)', async () => {
    const mock = mockLightfield(200, LIST_PAYLOAD)
    await call('list_contacts', {
      filters: { '$email[contains]': 'example.com', '$score[gte]': 80, '$active': true },
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/contacts')
    expect(url.searchParams.get('$email[contains]')).toBe('example.com')
    // 数字/布尔一律 String() 成 query 值。
    expect(url.searchParams.get('$score[gte]')).toBe('80')
    expect(url.searchParams.get('$active')).toBe('true')
  })

  it('省略的分页参数不出现在 query 里', async () => {
    const mock = mockLightfield(200, LIST_PAYLOAD)
    await call('list_opportunities', {})
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/opportunities')
    expect([...url.searchParams.keys()]).toEqual([])
  })

  it('列表响应缺 totalCount → unavailable(不假装成功)', async () => {
    mockLightfield(200, { data: [], object: 'list' })
    expect((await call('list_accounts', {})).status).toBe(503)
  })
})

describe('单条读取与自定义对象', () => {
  it('路径参数被 URL 编码', async () => {
    const mock = mockLightfield(200, RECORD)
    const res = await call('get_contact', { id: 'rec a/b' })
    expect(sent(mock).url).toBe('https://api.lightfield.app/v1/contacts/rec%20a%2Fb')
    await expect(res.json()).resolves.toEqual({ content: { record: RECORD } })
  })

  it('自定义对象记录走 /v1/objects/{slug}/values/{id}', async () => {
    const mock = mockLightfield(200, RECORD)
    await call('get_custom_object_record', { entitySlug: 'deal_note', id: 'rec_9' })
    expect(sent(mock).url).toBe('https://api.lightfield.app/v1/objects/deal_note/values/rec_9')
  })

  it('自定义对象列表用 slug 做路径而非 query', async () => {
    const mock = mockLightfield(200, LIST_PAYLOAD)
    await call('list_custom_object_records', { entitySlug: 'deal_note', limit: 3 })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/objects/deal_note')
    expect(url.searchParams.get('limit')).toBe('3')
    expect(url.searchParams.has('entitySlug')).toBe(false)
  })

  it('对象定义列表把 data 摊平成 definitions', async () => {
    const definitions = [{ label: 'Deal Note', objectType: 'deal_note' }]
    const mock = mockLightfield(200, { data: definitions, object: 'list' })
    const res = await call('list_object_definitions', {})
    expect(new URL(sent(mock).url).pathname).toBe('/v1/objects')
    await expect(res.json()).resolves.toEqual({ content: { definitions } })
  })
})

describe('API key 元数据', () => {
  const METADATA = {
    active: true,
    scopes: ['accounts:read', 'contacts:read'],
    subjectType: 'workspace',
    tokenType: 'api_key',
  }

  it('走 /v1/auth/validate 并原样返回四个字段', async () => {
    const mock = mockLightfield(200, { ...METADATA, internalHint: 'ignored' })
    const res = await call('get_api_key_metadata', {})
    expect(new URL(sent(mock).url).pathname).toBe('/v1/auth/validate')
    await expect(res.json()).resolves.toEqual({ content: METADATA })
  })

  it('key 未激活 → unavailable(配置问题,不是入参错)', async () => {
    mockLightfield(200, { ...METADATA, active: false })
    const res = await call('get_api_key_metadata', {})
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('未激活')
  })

  it('subjectType 不在枚举内 → unavailable(上游契约破了)', async () => {
    mockLightfield(200, { ...METADATA, subjectType: 'robot' })
    expect((await call('get_api_key_metadata', {})).status).toBe(503)
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:limit 超过 25 → 400 且不打上游', async () => {
    const mock = mockLightfield(200, LIST_PAYLOAD)
    const res = await call('list_accounts', { limit: 100 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('必填 id 缺失 → 400 且不打上游', async () => {
    const mock = mockLightfield(200, RECORD)
    const res = await call('get_account', {})
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('全空白的路径参数 → 400 且不打上游(schema 的 min(1) 拦不住)', async () => {
    const mock = mockLightfield(200, RECORD)
    const res = await call('get_opportunity', { id: '   ' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按原始状态归一,消息取自 Lightfield 的错误体', async () => {
    mockLightfield(401, { message: 'Lightfield credential expired' })
    const expired = await call('list_accounts', {})
    expect(expired.status).toBe(401)
    await expect(expired.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Lightfield credential expired',
    })

    mockLightfield(429, { error: 'Rate limit exceeded' })
    const limited = await call('list_contacts', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({
      code: 'rate_limited',
      message: 'Rate limit exceeded',
      retryable: true,
    })

    // 上游把 404 压成 400,这里保留 404 —— 归一交给共享的 upstreamError。
    mockLightfield(404, { detail: 'Record not found' })
    const missing = await call('get_account', { id: 'rec_missing' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found' })

    mockLightfield(500, { title: 'Lightfield is down' })
    await expect((await call('list_accounts', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('错误体是纯文本时也能取到消息', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('upstream exploded', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    }))))
    await expect((await call('list_accounts', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'upstream exploded' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockLightfield(200, LIST_PAYLOAD)
    const res = await call('list_accounts', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
