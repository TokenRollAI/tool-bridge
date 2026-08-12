import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createTursoPlugin } from '../../src/turso/index'
import { tursoActions } from '../../src/turso/schema'

/**
 * Turso 迁移产物的 wire 级验收。重点钉住几个"迁移最容易迁丢"的地方:
 * 列表响应外层键的候选顺序(`regions` 别名、`data` 退路)、单资源响应无信封时的兜底、
 * `raw` 与归一字段的双份出参、`extensions` 的双形态与空白项、以及 DELETE 的空体。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'eyJhbGciOiJFZERTQSJ9.test'
const plugin = createTursoPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'data/turso',
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

/** 打桩上游:JSON 体。 */
function mockTurso(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 打桩上游:原始体(用来验非 JSON / 空体的处理)。 */
function mockRaw(status: number, body: null | string): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(body, { status })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

const ORG = { slug: 'acme', name: 'Acme', type: 'team', plan: 'scaler' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('~describe 报成单个 tools/v1 export,并带上凭证探针', async () => {
    const res = await createTursoPlugin().fetch(new Request('https://plugin.test/~describe'), {} as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        id: 'actions',
        profile: 'tools/v1',
        description: 'Turso',
        credentialProbe: 'list_organizations',
      }],
    })
  })

  it('探针 list_organizations 只读且无必填入参(平台挂载时会空参调它)', () => {
    const spec = tursoActions.list_organizations
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })

  it('List 出全部 10 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(tursoActions).length)
    expect(tools).toHaveLength(10)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_database',
      'create_group',
      'delete_database',
      'get_database',
      'get_group',
      'get_organization',
      'list_databases',
      'list_groups',
      'list_locations',
      'list_organizations',
    ])
  })
})

describe('请求拼装', () => {
  it('list_organizations:GET /v1/organizations,凭证走 authorization 头,无请求体', async () => {
    const mock = mockTurso(200, { organizations: [ORG] })
    await call('list_organizations', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(new URL(request.url).origin).toBe('https://api.turso.tech')
    expect(new URL(request.url).pathname).toBe('/v1/organizations')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
    // GET 不带 content-type:上游只在有体时才发,空体请求带上它会让某些网关拒。
    expect(request.headers.get('content-type')).toBeNull()
    expect(await request.text()).toBe('')
  })

  it('create_database:POST 到组织路径,body 是 {name, group},带 content-type', async () => {
    const mock = mockTurso(200, { database: { name: 'logs', group: 'default', hostname: 'logs-acme.turso.io' } })
    const res = await call('create_database', { organizationSlug: 'acme', name: 'logs', group: 'default' })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/v1/organizations/acme/databases')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ name: 'logs', group: 'default' })
    await expect(res.json()).resolves.toMatchObject({
      content: { database: { name: 'logs', group: 'default', hostname: 'logs-acme.turso.io' } },
    })
  })

  it('路径段被 encodeURIComponent:斜杠不会越出资源边界', async () => {
    const mock = mockTurso(200, { database: { name: 'a/b' } })
    await call('get_database', { organizationSlug: 'ac me', name: 'a/b' })
    expect(new URL(sent(mock).url).pathname).toBe('/v1/organizations/ac%20me/databases/a%2Fb')
  })

  it('入参里的前后空白被去掉后才进路径(上游 requiredString 的语义)', async () => {
    const mock = mockTurso(200, { group: { name: 'default' } })
    await call('get_group', { organizationSlug: '  acme  ', name: ' default ' })
    expect(new URL(sent(mock).url).pathname).toBe('/v1/organizations/acme/groups/default')
  })

  it('create_group:extensions 给 "all" 原样发,给数组则逐项去空白', async () => {
    const all = mockTurso(200, { group: { name: 'g1' } })
    await call('create_group', { organizationSlug: 'acme', name: 'g1', location: 'nrt', extensions: 'all' })
    await expect(sent(all).json()).resolves.toEqual({
      name: 'g1',
      location: 'nrt',
      extensions: 'all',
    })

    vi.unstubAllGlobals()
    const list = mockTurso(200, { group: { name: 'g1' } })
    await call('create_group', {
      organizationSlug: 'acme',
      name: 'g1',
      location: 'nrt',
      extensions: [' vector ', 'fts5'],
    })
    await expect(sent(list).json()).resolves.toEqual({
      name: 'g1',
      location: 'nrt',
      extensions: ['vector', 'fts5'],
    })
  })

  it('create_group:不给 extensions 时这个键不出现在 body 里', async () => {
    const mock = mockTurso(200, { group: { name: 'g1' } })
    await call('create_group', { organizationSlug: 'acme', name: 'g1', location: 'nrt' })
    await expect(sent(mock).json()).resolves.toEqual({ name: 'g1', location: 'nrt' })
  })

  it('delete_database:DELETE 后固定回 {deleted:true},即便上游回空体', async () => {
    // 204 的 body 必须传 null:`new Response('', {status:204})` 在 undici 下直接 TypeError。
    const mock = mockRaw(204, null)
    const res = await call('delete_database', { organizationSlug: 'acme', name: 'logs' })
    expect(sent(mock).method).toBe('DELETE')
    expect(new URL(sent(mock).url).pathname).toBe('/v1/organizations/acme/databases/logs')
    await expect(res.json()).resolves.toEqual({ content: { deleted: true } })
  })
})

describe('响应整形', () => {
  it('资源归一成"选定字段 + raw":未声明的字段只在 raw 里,空字段整键丢掉', async () => {
    mockTurso(200, { organizations: [{ slug: 'acme', name: '  Acme  ', type: '', plan: 'scaler' }] })
    const res = await call('list_organizations', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        organizations: [{
          slug: 'acme',
          // 去空白后取值,与上游 optionalString 一致。
          name: 'Acme',
          // type 是空串 → 整键丢掉,而不是留一个 ''。
          raw: { slug: 'acme', name: '  Acme  ', type: '', plan: 'scaler' },
        }],
      },
    })
  })

  it('list_locations 认 regions 别名(Turso 早期响应用的键)', async () => {
    mockTurso(200, { regions: [{ code: 'nrt', name: 'Tokyo' }] })
    const res = await call('list_locations', {})
    await expect(res.json()).resolves.toMatchObject({
      content: { locations: [{ code: 'nrt', name: 'Tokyo' }] },
    })
  })

  it('列表键都不命中时退到 data,裸数组响应也能吃下', async () => {
    mockTurso(200, { data: [{ name: 'g1' }] })
    await expect((await call('list_groups', { organizationSlug: 'acme' })).json())
      .resolves.toMatchObject({ content: { groups: [{ name: 'g1' }] } })

    vi.unstubAllGlobals()
    mockTurso(200, [{ name: 'db1' }])
    await expect((await call('list_databases', { organizationSlug: 'acme' })).json())
      .resolves.toMatchObject({ content: { databases: [{ name: 'db1' }] } })
  })

  it('单资源响应没有外层信封时,整个响应体就是那个资源', async () => {
    mockTurso(200, { slug: 'acme', name: 'Acme' })
    await expect((await call('get_organization', { organizationSlug: 'acme' })).json())
      .resolves.toMatchObject({ content: { organization: { slug: 'acme', name: 'Acme' } } })
  })

  it('列表响应里一个键都不命中 → unavailable + retryable(不能静默回空数组)', async () => {
    mockTurso(200, { total: 0 })
    const res = await call('list_databases', { organizationSlug: 'acme' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('缺必填入参 → invalid_argument 且不打上游', async () => {
    const mock = mockTurso(200, {})
    const res = await call('get_database', { organizationSlug: 'acme' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的必填串能过 Zod 的 min(1),但在本地就挡下', async () => {
    const mock = mockTurso(200, {})
    const res = await call('get_database', { organizationSlug: 'acme', name: '   ' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'name is required.' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('4xx → invalid_argument / not_found / conflict(不像上游那样一律压成 400)', async () => {
    mockTurso(422, { error: 'group already exists' })
    await expect((await call('create_group', { organizationSlug: 'acme', name: 'g1', location: 'nrt' })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'group already exists' })

    vi.unstubAllGlobals()
    mockTurso(404, { message: 'database not found' })
    const missing = await call('get_database', { organizationSlug: 'acme', name: 'nope' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'database not found' })

    vi.unstubAllGlobals()
    mockTurso(409, { error: { message: 'name taken' } })
    const conflict = await call('create_database', { organizationSlug: 'acme', name: 'logs', group: 'default' })
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({ code: 'conflict', message: 'name taken' })
  })

  it('401 → permission_denied,429 → rate_limited(可重试),5xx → unavailable(可重试)', async () => {
    mockTurso(401, { message: 'invalid token' })
    const denied = await call('list_organizations', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({ code: 'permission_denied', message: 'invalid token' })

    vi.unstubAllGlobals()
    mockTurso(429, { message: 'slow down' })
    await expect((await call('list_organizations', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockTurso(503, { message: 'turso is down' })
    await expect((await call('list_organizations', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'turso is down' })
  })

  it('错误体不是 JSON 时,原文当消息用(上游 readTursoPayload 的退化路径)', async () => {
    mockRaw(502, '<html>bad gateway</html>')
    const res = await call('list_organizations', {})
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      message: '<html>bad gateway</html>',
    })
  })

  it('传输层失败归一成 unavailable,而不是冒成 internal 500', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('socket hang up'))))
    const res = await call('list_organizations', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Turso request failed: socket hang up',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockTurso(200, {})
    const res = await call('list_organizations', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
