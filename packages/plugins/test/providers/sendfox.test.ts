import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSendfoxPlugin } from '../../src/sendfox/index'
import { sendfoxActions } from '../../src/sendfox/schema'

/**
 * SendFox 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * Laravel 扁平分页信封的整形、拿不到 data 时回空页而非报错、
 * schema 标 optional 但上游必填的 id 兜底校验。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'sendfox_pat_deadbeef'
const plugin = createSendfoxPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'marketing/sendfox',
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

function mockSendfox(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

const CONTACT = {
  id: 1,
  email: 'ada@example.com',
  first_name: 'Ada',
  last_name: null,
  ip_address: null,
  unsubscribed_at: null,
  created_at: '2026-01-01T00:00:00+00:00',
  updated_at: '2026-01-01T00:00:00+00:00',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 14 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(sendfoxActions).length)
    expect(tools).toHaveLength(14)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_contacts')).toBe('read')
    expect(effectOf('create_contact')).toBe('write')
    expect(effectOf('delete_contact')).toBe('destructive')
  })
})

describe('分页信封整形', () => {
  it('list_contacts:Laravel 扁平信封整成 {contacts, meta}', async () => {
    const mock = mockSendfox(200, {
      current_page: 2,
      total: 57,
      per_page: 25,
      data: [CONTACT],
    })
    const res = await call('list_contacts', { query: 'ada', page: 2, unsubscribed: false })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.sendfox.com/contacts')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(url.searchParams.get('query')).toBe('ada')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('unsubscribed')).toBe('false')
    expect(url.searchParams.has('email')).toBe(false)

    await expect(res.json()).resolves.toEqual({
      content: { contacts: [CONTACT], meta: { current_page: 2, total: 57, per_page: 25 } },
    })
  })

  it('拿不到 data 数组时回空页而非报错(照搬上游行为)', async () => {
    mockSendfox(200, { message: 'nothing here' })
    const res = await call('list_contact_lists', {})
    await expect(res.json()).resolves.toEqual({
      content: { lists: [], meta: { current_page: 1, total: 0, per_page: 0 } },
    })
  })

  it('分页字段缺失时用本页条数兜底', async () => {
    mockSendfox(200, { data: [CONTACT, { ...CONTACT, id: 2, email: 'bob@example.com' }] })
    const res = await call('list_contacts_in_list', { list_id: 9 })
    await expect(res.json()).resolves.toMatchObject({
      content: { meta: { current_page: 1, total: 2, per_page: 2 } },
    })
  })
})

describe('请求拼装', () => {
  it('create_contact:POST JSON,省略的可选字段不出现在 body 里', async () => {
    const mock = mockSendfox(200, CONTACT)
    await call('create_contact', { email: 'ada@example.com', lists: [3] })

    const request = sent(mock)
    expect(request.url).toBe('https://api.sendfox.com/contacts')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ email: 'ada@example.com', lists: [3] })
  })

  it('update_contact:PATCH,id 进路径而非 body', async () => {
    const mock = mockSendfox(200, CONTACT)
    await call('update_contact', { contact_id: 7, first_name: 'Ada' })
    const request = sent(mock)
    expect(request.url).toBe('https://api.sendfox.com/contacts/7')
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({ first_name: 'Ada' })
  })

  it('remove_contact_from_list:两个 id 都进路径,DELETE', async () => {
    const mock = mockSendfox(200, CONTACT)
    await call('remove_contact_from_list', { list_id: 3, contact_id: 7 })
    const request = sent(mock)
    expect(request.url).toBe('https://api.sendfox.com/lists/3/contacts/7')
    expect(request.method).toBe('DELETE')
  })

  it('unsubscribe_contact:PATCH /unsubscribe', async () => {
    const mock = mockSendfox(200, { ...CONTACT, unsubscribed_at: '2026-02-01T00:00:00+00:00' })
    await call('unsubscribe_contact', { email: 'ada@example.com' })
    const request = sent(mock)
    expect(request.url).toBe('https://api.sendfox.com/unsubscribe')
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({ email: 'ada@example.com' })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:email 非法 → 400 且不打上游', async () => {
    const mock = mockSendfox(200, {})
    const res = await call('create_contact', { email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_contact 缺 contact_id 在本地就挡下(schema 标 optional,上游其实必填)', async () => {
    const mock = mockSendfox(200, {})
    const res = await call('get_contact', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('contact_id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('create_contact_list 缺 name 在本地就挡下', async () => {
    const mock = mockSendfox(200, {})
    const res = await call('create_contact_list', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('name')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取 message 或 Laravel 的 errors.field[0]', async () => {
    mockSendfox(401, { message: 'Unauthenticated.' })
    const unauthorized = await call('list_contacts', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthenticated.',
    })

    mockSendfox(422, { errors: { email: ['The email field is required.'] } })
    await expect((await call('create_contact', { email: 'ada@example.com' })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'The email field is required.' })

    mockSendfox(429, { message: 'Too Many Attempts.' })
    await expect((await call('list_contacts', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockSendfox(500, { message: 'Server Error' })
    await expect((await call('list_contacts', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockSendfox(200, { data: [] })
    const res = await call('list_contacts', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
