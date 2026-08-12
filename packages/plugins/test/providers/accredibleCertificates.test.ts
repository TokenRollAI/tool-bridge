import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAccredibleCertificatesPlugin } from '../../src/accredible_certificates/index'
import { accredibleCertificatesActions } from '../../src/accredible_certificates/schema'

/**
 * Accredible Certificates 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * `Token token=` 认证头、带点的 body 键名不做展开、snake_case → camelCase 整形
 * 同时保留 raw、以及 nullable 字段缺失时必须回 null 而不是省略键。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'accredible_key_deadbeef'
const plugin = createAccredibleCertificatesPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'edu/accredible',
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

function mockAccredible(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(payload === null ? null : JSON.stringify(payload), {
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

const RAW_CREDENTIAL = {
  id: 987,
  name: 'Course Certificate',
  issued_on: '2026-01-15',
  group_id: 42,
  group_name: 'Intro',
  encoded_id: 'abc123',
  complete: true,
  recipient: { id: 5, name: 'Ada', email: 'ada@example.com', meta_data: { cohort: '2026' } },
  extra_field_we_do_not_map: 'kept in raw',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 8 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(accredibleCertificatesActions).length)
    expect(tools).toHaveLength(8)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_groups')).toBe('read')
    expect(effectOf('create_credential')).toBe('write')
    expect(effectOf('delete_credential')).toBe('destructive')
  })
})

describe('请求拼装', () => {
  it('认证头是 Token token=,GET 列表参数进 query', async () => {
    const mock = mockAccredible(200, { credentials: [], meta: {} })
    await call('list_credentials', { group_id: 42, email: 'ada@example.com', page: 2, page_size: 50 })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.accredible.com/v1/all_credentials')
    expect(request.method).toBe('GET')
    // Bearer 会被 Accredible 拒掉。
    expect(request.headers.get('authorization')).toBe(`Token token=${API_KEY}`)
    expect(url.searchParams.get('group_id')).toBe('42')
    expect(url.searchParams.get('email')).toBe('ada@example.com')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('50')
    expect(url.searchParams.has('license_id')).toBe(false)
  })

  it('create_credential:带点的键名原样进 body,不展开成嵌套对象', async () => {
    const mock = mockAccredible(200, { credential: RAW_CREDENTIAL })
    await call('create_credential', {
      'group_id': 42,
      'recipient.name': 'Ada',
      'recipient.email': 'ada@example.com',
      'recipient.meta_data': { cohort: '2026' },
      'name': 'Course Certificate',
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.accredible.com/v1/credentials')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    // 这是 Accredible 自己的扁平化约定 —— 展开成 {recipient:{name}} 会被上游拒掉。
    await expect(request.json()).resolves.toEqual({
      'group_id': 42,
      'recipient.name': 'Ada',
      'recipient.email': 'ada@example.com',
      'recipient.meta_data': { cohort: '2026' },
      'name': 'Course Certificate',
    })
  })

  it('路径参数被 URL 编码', async () => {
    const mock = mockAccredible(200, { credential: RAW_CREDENTIAL })
    await call('get_credential', { id: 'a/b' })
    expect(new URL(sent(mock).url).pathname).toBe('/v1/credentials/a%2Fb')
  })
})

describe('响应整形', () => {
  it('snake_case 拍成 camelCase,raw 保留完整上游对象', async () => {
    mockAccredible(200, { credential: RAW_CREDENTIAL })
    const res = await call('get_credential', { id: '987' })
    await expect(res.json()).resolves.toEqual({
      content: {
        credential: {
          // 上游 id 是数字,出参统一成字符串。
          id: '987',
          name: 'Course Certificate',
          description: null,
          complete: true,
          issuedOn: '2026-01-15',
          expiredOn: null,
          groupId: 42,
          groupName: 'Intro',
          url: null,
          encodedId: 'abc123',
          private: null,
          recipient: { id: '5', name: 'Ada', email: 'ada@example.com', metaData: { cohort: '2026' } },
          raw: RAW_CREDENTIAL,
        },
      },
    })
  })

  it('列表键缺失时回空数组、meta 各字段回 null(不报错)', async () => {
    mockAccredible(200, {})
    const res = await call('list_groups', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        groups: [],
        meta: { currentPage: null, nextPage: null, prevPage: null, totalPages: null, totalCount: null, raw: {} },
      },
    })
  })

  it('delete 回空体时 credential 是 null', async () => {
    mockAccredible(200, null)
    const res = await call('delete_credential', { id: '987' })
    await expect(res.json()).resolves.toEqual({ content: { deleted: true, credential: null } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:create_credential 缺必填的 recipient.email → 400 且不打上游', async () => {
    const mock = mockAccredible(200, {})
    const res = await call('create_credential', { 'group_id': 42, 'recipient.name': 'Ada' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_credential 缺 id 在本地就挡下(schema 标 optional,上游其实必填)', async () => {
    const mock = mockAccredible(200, {})
    const res = await call('get_credential', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,四种错误体形状都能取到消息', async () => {
    mockAccredible(401, { error: 'Invalid API key' })
    const unauthorized = await call('list_groups', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockAccredible(404, { error: { message: 'Credential not found' } })
    await expect((await call('get_credential', { id: 'missing' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Credential not found' })

    mockAccredible(429, { errors: ['Rate limit exceeded'] })
    await expect((await call('list_groups', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'Rate limit exceeded', retryable: true })

    mockAccredible(500, { message: 'Accredible is down' })
    await expect((await call('list_groups', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('group 缺 id → unavailable(上游破契约,不是调用方的错)', async () => {
    mockAccredible(200, { group: { name: 'No ID' } })
    const res = await call('get_group', { group_id: 1 })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockAccredible(200, { groups: [] })
    const res = await call('list_groups', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
