import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCompanycamPlugin } from '../../src/companycam/index'
import { companycamActions } from '../../src/companycam/schema'

/**
 * CompanyCam 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * camelCase → snake_case 的入参映射、响应归一(含 raw 透传)、归档/恢复的方法不对称、
 * X-CompanyCam-User 头。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'cc_test_token'
const plugin = createCompanycamPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'field/companycam',
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

function mockCompanycam(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 15 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(companycamActions).length)
    expect(tools).toHaveLength(15)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('get_company')).toBe('read')
    expect(effectOf('list_projects')).toBe('read')
    expect(effectOf('create_project')).toBe('write')
    expect(effectOf('delete_tag')).toBe('destructive')
  })
})

describe('请求构造', () => {
  it('list_projects 的分页与筛选进 query,凭证走 Bearer', async () => {
    const mock = mockCompanycam(200, [])
    await call('list_projects', {
      page: 2,
      perPage: 50,
      query: 'Maple',
      modifiedSince: '2024-01-02T03:04:05Z',
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.companycam.com/v2/projects')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('per_page')).toBe('50')
    expect(url.searchParams.get('query')).toBe('Maple')
    expect(url.searchParams.get('modified_since')).toBe('2024-01-02T03:04:05Z')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
  })

  it('create_project 把 camelCase 映射成 snake_case,并把 currentUserEmail 放进头而非 body', async () => {
    const mock = mockCompanycam(201, { id: 'p1' })
    await call('create_project', {
      name: 'Roof job',
      address: { streetAddress1: '1 Main St', postalCode: '94110' },
      coordinates: { lat: 37.7, lon: -122.4 },
      geofence: [{ lat: 37.7, lon: -122.4 }],
      primaryContact: { name: 'Ada', phoneNumber: '+15550000' },
      currentUserEmail: 'ada@example.com',
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.companycam.com/v2/projects')
    expect(request.method).toBe('POST')
    expect(request.headers.get('x-companycam-user')).toBe('ada@example.com')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      name: 'Roof job',
      address: { street_address_1: '1 Main St', postal_code: '94110' },
      coordinates: { lat: 37.7, lon: -122.4 },
      geofence: [{ lat: 37.7, lon: -122.4 }],
      primary_contact: { name: 'Ada', phone_number: '+15550000' },
    })
  })

  it('archive 用 PATCH、restore 用 PUT(上游 API 本身不对称)', async () => {
    const archive = mockCompanycam(200, { id: 'p1', archived: true })
    await call('archive_project', { projectId: 'p 1' })
    expect(sent(archive).method).toBe('PATCH')
    expect(sent(archive).url).toBe('https://api.companycam.com/v2/projects/p%201/archive')
    vi.unstubAllGlobals()

    const restore = mockCompanycam(200, { id: 'p1', archived: false })
    await call('restore_project', { projectId: 'p1' })
    expect(sent(restore).method).toBe('PUT')
    expect(sent(restore).url).toBe('https://api.companycam.com/v2/projects/p1/restore')
  })

  it('create_tag 把标签包在 tag 信封里', async () => {
    const mock = mockCompanycam(201, { id: 't1', display_value: 'Roof' })
    await call('create_tag', { displayValue: 'Roof' })
    await expect(sent(mock).json()).resolves.toEqual({ tag: { display_value: 'Roof' } })
  })
})

describe('响应归一', () => {
  it('list_projects 归一每一项且 raw 保留原始数组', async () => {
    mockCompanycam(200, [{
      id: 'p1',
      company_id: 'c1',
      name: 'Roof job',
      archived: false,
      created_at: 1700000000,
      address: { street_address_1: '1 Main St', city: 'SF' },
      coordinates: { lat: 37.7, lon: -122.4 },
      unexpected_field: 'kept-in-raw',
    }])
    const body = (await (await call('list_projects', {})).json()) as {
      content: { projects: Array<Record<string, unknown>>, raw: unknown[] }
    }
    const project = body.content.projects[0]!
    expect(project.id).toBe('p1')
    expect(project.companyId).toBe('c1')
    expect(project.archived).toBe(false)
    expect(project.createdAt).toBe(1700000000)
    expect(project.address).toEqual({
      streetAddress1: '1 Main St',
      streetAddress2: null,
      city: 'SF',
      state: null,
      postalCode: null,
      country: null,
    })
    expect(project.coordinates).toEqual({ lat: 37.7, lon: -122.4 })
    // 归一表没有的字段仍能从 raw 取到。
    expect(body.content.raw[0]).toMatchObject({ unexpected_field: 'kept-in-raw' })
  })

  it('get_company 缺字段落成 null 而不是消失', async () => {
    mockCompanycam(200, { id: 'c1' })
    await expect((await call('get_company', {})).json()).resolves.toMatchObject({
      content: { company: { id: 'c1', name: null, status: null, address: null, logo: [] } },
    })
  })

  it('delete_tag 空体也算成功', async () => {
    const fn = vi.fn((request: Request) => Promise.resolve(
      new Response(null, { status: request.method === 'DELETE' ? 204 : 200 }),
    ))
    vi.stubGlobal('fetch', fn)
    await expect((await call('delete_tag', { tagId: 't1' })).json()).resolves.toEqual({
      content: { deleted: true, raw: {} },
    })
    expect(fn.mock.calls[0]![0].method).toBe('DELETE')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:page 给字符串 → 400 且不打上游', async () => {
    const mock = mockCompanycam(200, [])
    const res = await call('list_projects', { page: 'two' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('schema 把 projectId 标成 optional,缺它时本地挡下而不是打出 /projects/undefined', async () => {
    const mock = mockCompanycam(200, {})
    const res = await call('get_project', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('projectId')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 errors 数组或 message', async () => {
    mockCompanycam(404, { errors: ['Project not found'] })
    const missing = await call('get_project', { projectId: 'nope' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'Project not found',
    })
    vi.unstubAllGlobals()

    mockCompanycam(401, { message: 'Invalid access token' })
    const denied = await call('list_projects', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({ code: 'permission_denied' })
    vi.unstubAllGlobals()

    mockCompanycam(429, { error: 'Rate limit exceeded' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
    vi.unstubAllGlobals()

    mockCompanycam(500, {})
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockCompanycam(200, [])
    const res = await call('list_projects', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
