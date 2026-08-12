import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFrontPlugin } from '../../src/front/index'
import { frontActions } from '../../src/front/schema'

/**
 * Front 迁移产物的 wire 级验收。重点在几处"迁移最容易迁丢"的地方:
 * query 只收非空字符串与数字、`_results` 归一化、分页 token 从 next URL 里拆出来、
 * update_contact 不回上游响应而是恒 `{success:true}`。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'front_live_deadbeef'
const plugin = createFrontPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'inbox/front',
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

function mockFront(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

const CONTACT = {
  id: 'crd_1',
  name: 'Ada',
  description: null,
  avatar_url: null,
  links: ['https://example.com'],
  lists: [{ id: 'lst_1', name: 'VIP', is_private: false }],
  handles: [{ handle: 'ada@example.com', source: 'email' }],
  custom_fields: { tier: 'gold' },
  is_private: false,
}

const TEAMMATE = {
  id: 'tea_1',
  email: 'ada@example.com',
  username: 'ada',
  first_name: 'Ada',
  last_name: 'Lovelace',
  is_admin: true,
  is_available: true,
  is_blocked: false,
  type: 'user',
  custom_fields: {},
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 5 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(frontActions).length)
    expect(tools).toHaveLength(5)
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
    expect(effectOf('list_teammates')).toBe('read')
    expect(effectOf('create_contact')).toBe('write')
  })
})

describe('成功调用', () => {
  it('list_contacts:query 参数映射与分页 token 拆解', async () => {
    const mock = mockFront(200, {
      _results: [CONTACT],
      _pagination: { next: 'https://api2.frontapp.com/contacts?page_token=tok_2' },
    })
    const res = await call('list_contacts', {
      query: 'updated_after:1',
      limit: 25,
      pageToken: 'tok_1',
      sortBy: 'updated_at',
      sortOrder: 'desc',
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api2.frontapp.com/contacts')
    expect(url.searchParams.get('q')).toBe('updated_after:1')
    expect(url.searchParams.get('limit')).toBe('25')
    expect(url.searchParams.get('page_token')).toBe('tok_1')
    expect(url.searchParams.get('sort_by')).toBe('updated_at')
    expect(url.searchParams.get('sort_order')).toBe('desc')

    await expect(res.json()).resolves.toEqual({
      content: {
        contacts: [{
          id: 'crd_1',
          name: 'Ada',
          description: null,
          avatarUrl: null,
          links: ['https://example.com'],
          lists: [{ id: 'lst_1', name: 'VIP', isPrivate: false }],
          handles: [{ handle: 'ada@example.com', source: 'email' }],
          customFields: { tier: 'gold' },
          isPrivate: false,
        }],
        pagination: {
          next: 'https://api2.frontapp.com/contacts?page_token=tok_2',
          nextPageToken: 'tok_2',
        },
      },
    })
  })

  it('list_contacts:没有 next 时 pagination 两个字段都是 null', async () => {
    mockFront(200, { _results: [], _pagination: {} })
    await expect((await call('list_contacts', {})).json()).resolves.toEqual({
      content: { contacts: [], pagination: { next: null, nextPageToken: null } },
    })
  })

  it('create_contact:handles 与 contact 字段合并进同一个 JSON body', async () => {
    const mock = mockFront(200, CONTACT)
    await call('create_contact', {
      handles: [{ handle: 'ada@example.com', source: 'email' }],
      contact: { name: 'Ada', links: ['https://example.com'], listNames: ['VIP'] },
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api2.frontapp.com/contacts')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      name: 'Ada',
      links: ['https://example.com'],
      list_names: ['VIP'],
      handles: [{ handle: 'ada@example.com', source: 'email' }],
    })
  })

  it('create_contact:省略的可选字段不进 body(上游 compactObject 语义)', async () => {
    const mock = mockFront(200, CONTACT)
    await call('create_contact', {
      handles: [{ handle: 'ada@example.com', source: 'email' }],
      contact: {},
    })
    const body = (await sent(mock).json()) as Record<string, unknown>
    expect(Object.keys(body)).toEqual(['handles'])
  })

  it('get_contact:路径参数被 URL 编码', async () => {
    const mock = mockFront(200, CONTACT)
    await call('get_contact', { contactId: 'email:ada@example.com' })
    expect(sent(mock).url).toBe('https://api2.frontapp.com/contacts/email%3Aada%40example.com')
  })

  it('update_contact:PATCH 且不回上游响应,恒 success:true', async () => {
    const mock = mockFront(200, {})
    const res = await call('update_contact', { contactId: 'crd_1', contact: { name: 'Ada B' } })
    const request = sent(mock)
    expect(request.method).toBe('PATCH')
    expect(request.url).toBe('https://api2.frontapp.com/contacts/crd_1')
    await expect(request.json()).resolves.toEqual({ name: 'Ada B' })
    await expect(res.json()).resolves.toEqual({ content: { success: true } })
  })

  it('list_teammates:snake_case 字段全部归一成 camelCase', async () => {
    const mock = mockFront(200, { _results: [TEAMMATE] })
    const res = await call('list_teammates', {})
    expect(sent(mock).url).toBe('https://api2.frontapp.com/teammates')
    await expect(res.json()).resolves.toEqual({
      content: {
        teammates: [{
          id: 'tea_1',
          email: 'ada@example.com',
          username: 'ada',
          firstName: 'Ada',
          lastName: 'Lovelace',
          isAdmin: true,
          isAvailable: true,
          isBlocked: false,
          type: 'user',
          customFields: {},
        }],
      },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:limit 超出范围 → 400 且不打上游', async () => {
    const mock = mockFront(200, { _results: [] })
    const res = await call('list_contacts', { limit: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('create_contact 缺 handles → 400 且不打上游(Front 要求至少一个可达句柄)', async () => {
    const mock = mockFront(200, CONTACT)
    const res = await call('create_contact', { contact: { name: 'Ada' } })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 Front 的 _error / message', async () => {
    mockFront(401, { _error: { message: 'Unauthorized' }, message: 'Bad token' })
    await expect((await call('list_teammates', {})).json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Bad token',
    })

    mockFront(429, { message: 'Rate limit exceeded' })
    await expect((await call('list_teammates', {})).json()).resolves.toMatchObject({
      code: 'rate_limited',
      retryable: true,
    })

    mockFront(404, { message: 'Contact not found' })
    expect((await call('get_contact', { contactId: 'crd_x' })).status).toBe(404)
  })

  it('上游破契约(缺 _results)→ unavailable,而非把空列表当成功', async () => {
    mockFront(200, { data: [] })
    await expect((await call('list_teammates', {})).json()).resolves.toMatchObject({
      code: 'unavailable',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockFront(200, { _results: [] })
    const res = await call('list_teammates', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
