import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createProviderHarness } from '../support/providerHarness'
import { createSupabasePlugin } from '../../src/supabase/index'
import { supabaseActions } from '../../src/supabase/schema'

/**
 * Supabase(Management API)迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * 数组参数的两种编码(services 重复同名 / statuses 逗号串)、`reveal` 只发 true、
 * API key 列表的双形状(裸数组 / `{details}` 信封)、DELETE 带请求体、
 * 三个端点允许空响应体而其余端点空体即契约破了、以及出参的 snake→camel 重命名与必填校验。
 */

const API_KEY = 'sbp_deadbeefdeadbeef'
const API_BASE = 'https://api.supabase.com/v1'
const PROJECT_REF = 'abcdefghijklmnopqrst'
const plugin = createSupabasePlugin()

/** 一条通过全部必填校验的 API key 记录(上游对缺字段一律报 malformed)。 */
const API_KEY_RECORD = {
  id: 'key_1',
  name: 'service_key',
  type: 'secret',
  prefix: 'sb_secret_',
  hash: 'abc123',
  description: null,
  api_key: 'sb_secret_full_value',
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  secret_jwt_template: { role: 'service_role' },
}

const {
  call,
  envelope,
  sent,
  env: ENV,
  stubFetch,
} = createProviderHarness({
  mountPath: 'infra/supabase',
  plugin,
  upstreamAuth: API_KEY,
})

function mockSupabase(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return stubFetch(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })))
}

/** 空体响应:`new Response('', {status:204})` 在 undici 下会 TypeError,必须传 null。 */
function mockEmpty(status: number): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(new Response(null, { status })))
}

describe('契约面', () => {
  it('List 出全部 21 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(supabaseActions).length)
    expect(tools).toHaveLength(21)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_project_api_key',
      'delete_project_api_key',
      'delete_project_secrets',
      'generate_typescript_types',
      'get_edge_function',
      'get_organization',
      'get_project',
      'get_project_api_key',
      'get_project_health',
      'list_available_regions',
      'list_edge_functions',
      'list_organization_members',
      'list_organization_projects',
      'list_organizations',
      'list_project_api_keys',
      'list_project_secrets',
      'list_projects',
      'list_storage_buckets',
      'run_read_only_query',
      'update_project_api_key',
      'upsert_project_secrets',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报成单个 tools/v1 export,带探针工具名', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as { exports: Array<{ credentialProbe?: string, profile: string }> }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.profile).toBe('tools/v1')
    expect(body.exports[0]?.credentialProbe).toBe('list_organizations')
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', () => {
    const spec = supabaseActions.list_organizations
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })

  it('删除类 action 的 effect 是 destructive(平台按它做二次确认)', () => {
    expect(supabaseActions.delete_project_api_key.effect).toBe('destructive')
    expect(supabaseActions.delete_project_secrets.effect).toBe('destructive')
  })
})

describe('请求拼装', () => {
  it('list_organizations:GET /v1/organizations,PAT 走 Bearer 头,无请求体', async () => {
    const mock = mockSupabase(200, [{ id: 'org1', name: 'Acme' }])
    await call('list_organizations', {})
    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe(`${API_BASE}/organizations`)
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
    expect(request.headers.get('content-type')).toBeNull()
    expect(await request.text()).toBe('')
  })

  it('slug 与 projectRef 进路径要 URL 编码', async () => {
    const mock = mockSupabase(200, { id: 'o', name: 'n' })
    await call('get_organization', { organizationSlug: 'a/b' })
    expect(new URL(sent(mock).url).pathname).toBe('/v1/organizations/a%2Fb')
  })

  it('get_project_health 的 services 是**重复的同名参数**', async () => {
    const mock = mockSupabase(200, [])
    await call('get_project_health', { projectRef: PROJECT_REF, services: ['auth', 'db'], timeoutMs: 5000 })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe(`/v1/projects/${PROJECT_REF}/health`)
    expect(url.searchParams.getAll('services')).toEqual(['auth', 'db'])
    expect(url.searchParams.get('timeout_ms')).toBe('5000')
  })

  it('list_organization_projects 的 statuses 是**逗号串**(与 services 的编码不同)', async () => {
    const mock = mockSupabase(200, { projects: [], pagination: { count: 0, limit: 10, offset: 0 } })
    await call('list_organization_projects', {
      organizationSlug: 'acme',
      statuses: ['ACTIVE_HEALTHY', 'INACTIVE'],
      offset: 10,
      limit: 20,
      search: 'api',
      sort: 'name_asc',
    })
    const params = new URL(sent(mock).url).searchParams
    expect(params.getAll('statuses')).toEqual(['ACTIVE_HEALTHY,INACTIVE'])
    expect(Object.fromEntries(params)).toEqual({
      offset: '10',
      limit: '20',
      search: 'api',
      sort: 'name_asc',
      statuses: 'ACTIVE_HEALTHY,INACTIVE',
    })
  })

  it('generate_typescript_types 的 includedSchemas 也是逗号串', async () => {
    const mock = mockSupabase(200, { types: 'export type X = 1' })
    await call('generate_typescript_types', { projectRef: PROJECT_REF, includedSchemas: ['public', 'auth'] })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe(`/v1/projects/${PROJECT_REF}/types/typescript`)
    expect(url.searchParams.get('included_schemas')).toBe('public,auth')
  })

  it('reveal 只在为 true 时发(reveal=false 与不发在上游不等价)', async () => {
    const on = mockSupabase(200, [API_KEY_RECORD])
    await call('list_project_api_keys', { projectRef: PROJECT_REF, reveal: true })
    expect(new URL(sent(on).url).searchParams.get('reveal')).toBe('true')

    vi.unstubAllGlobals()
    const off = mockSupabase(200, [API_KEY_RECORD])
    await call('list_project_api_keys', { projectRef: PROJECT_REF, reveal: false })
    expect(new URL(sent(off).url).searchParams.has('reveal')).toBe(false)
  })

  it('create_project_api_key:POST + JSON body,带 content-type', async () => {
    const mock = mockSupabase(201, API_KEY_RECORD)
    await call('create_project_api_key', {
      projectRef: PROJECT_REF,
      name: 'service_key',
      type: 'secret',
      description: 'for the worker',
      secretJwtTemplate: { role: 'service_role' },
      reveal: true,
    })
    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe(`/v1/projects/${PROJECT_REF}/api-keys`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      name: 'service_key',
      type: 'secret',
      description: 'for the worker',
      secret_jwt_template: { role: 'service_role' },
    })
  })

  it('update_project_api_key:PATCH,description/secretJwtTemplate 给 null 时原样发(清空)', async () => {
    const mock = mockSupabase(200, API_KEY_RECORD)
    await call('update_project_api_key', {
      projectRef: PROJECT_REF,
      apiKeyId: 'key_1',
      description: null,
      secretJwtTemplate: null,
    })
    const request = sent(mock)
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({ description: null, secret_jwt_template: null })
  })

  it('delete_project_api_key:DELETE,删除理由与 wasCompromised 走 query', async () => {
    const mock = mockSupabase(200, API_KEY_RECORD)
    await call('delete_project_api_key', {
      projectRef: PROJECT_REF,
      apiKeyId: 'key_1',
      wasCompromised: false,
      reason: 'rotated',
    })
    const request = sent(mock)
    expect(request.method).toBe('DELETE')
    expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual({
      was_compromised: 'false',
      reason: 'rotated',
    })
  })

  it('upsert_project_secrets:POST,请求体是**数组**而不是对象信封', async () => {
    const mock = mockEmpty(201)
    const res = await call('upsert_project_secrets', {
      projectRef: PROJECT_REF,
      secrets: [{ name: 'API_TOKEN', value: 'v1' }, { name: 'OTHER', value: 'v2' }],
    })
    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe(`/v1/projects/${PROJECT_REF}/secrets`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual([
      { name: 'API_TOKEN', value: 'v1' },
      { name: 'OTHER', value: 'v2' },
    ])
    await expect(res.json()).resolves.toEqual({ content: { success: true } })
  })

  it('secret 的 value 是空串时在本层就拒(Zod 放行,上游的必填断言不放行)', async () => {
    const mock = mockEmpty(201)
    const res = await call('upsert_project_secrets', {
      projectRef: PROJECT_REF,
      secrets: [{ name: 'API_TOKEN', value: '' }],
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'secret.value is required.',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('delete_project_secrets:**DELETE 带请求体**(要删的名字表是 JSON 数组)', async () => {
    const mock = mockEmpty(200)
    const res = await call('delete_project_secrets', { projectRef: PROJECT_REF, names: ['A', 'B'] })
    const request = sent(mock)
    expect(request.method).toBe('DELETE')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual(['A', 'B'])
    await expect(res.json()).resolves.toEqual({ content: { success: true } })
  })

  it('run_read_only_query:SQL 原样发(不去空白,缩进是语义的一部分)', async () => {
    const mock = mockSupabase(200, [{ count: 1 }])
    const sql = '  select count(*)\n  from public.users\n'
    await call('run_read_only_query', { projectRef: PROJECT_REF, query: sql, parameters: [1, 'x'] })
    const request = sent(mock)
    expect(new URL(request.url).pathname).toBe(`/v1/projects/${PROJECT_REF}/database/query/read-only`)
    await expect(request.json()).resolves.toEqual({ query: sql, parameters: [1, 'x'] })
  })
})

describe('响应整形', () => {
  it('organizations 裁剪成 {id,name,slug};slug 缺失时不出现,为 null 时保留', async () => {
    mockSupabase(200, [
      { id: 'o1', name: 'Acme', slug: 'acme', extra: 'dropped' },
      { id: 'o2', name: 'Beta', slug: null },
      { id: 'o3', name: 'Gamma' },
    ])
    await expect((await call('list_organizations', {})).json()).resolves.toEqual({
      content: {
        organizations: [
          { id: 'o1', name: 'Acme', slug: 'acme' },
          { id: 'o2', name: 'Beta', slug: null },
          { id: 'o3', name: 'Gamma' },
        ],
      },
    })
  })

  it('project 列表 snake_case → camelCase,未知 status 归一成 UNKNOWN', async () => {
    mockSupabase(200, [{
      id: 'p1',
      organization_id: 'o1',
      name: 'api',
      region: 'us-east-1',
      status: 'SOMETHING_NEW',
      created_at: '2026-01-01T00:00:00Z',
      database: { host: 'db.example.com', version: '15', postgres_engine: null },
    }])
    await expect((await call('list_projects', {})).json()).resolves.toEqual({
      content: {
        projects: [{
          id: 'p1',
          organizationId: 'o1',
          name: 'api',
          region: 'us-east-1',
          status: 'UNKNOWN',
          createdAt: '2026-01-01T00:00:00Z',
          database: { host: 'db.example.com', version: '15', postgresEngine: null },
        }],
      },
    })
  })

  it('members 保留原始键并补 camelCase 别名,mfa_enabled 缺失即 malformed', async () => {
    mockSupabase(200, [{
      user_id: 'u1',
      user_name: 'J Doe',
      email: 'j@example.com',
      role_name: 'Owner',
      mfa_enabled: true,
    }])
    await expect((await call('list_organization_members', { organizationSlug: 'acme' })).json())
      .resolves.toMatchObject({
        content: {
          members: [{
            user_id: 'u1',
            userId: 'u1',
            userName: 'J Doe',
            roleName: 'Owner',
            mfaEnabled: true,
          }],
        },
      })

    vi.unstubAllGlobals()
    mockSupabase(200, [{ user_id: 'u1', user_name: 'J', role_name: 'Owner' }])
    await expect((await call('list_organization_members', { organizationSlug: 'acme' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('organization projects 带 pagination;count 是数字串也认', async () => {
    mockSupabase(200, {
      projects: [{ ref: 'r1', name: 'api', region: 'us-east-1', status: 'ACTIVE_HEALTHY' }],
      pagination: { count: '3', limit: 10, offset: 0 },
    })
    await expect((await call('list_organization_projects', { organizationSlug: 'acme' })).json())
      .resolves.toMatchObject({
        content: {
          projects: [{ ref: 'r1', status: 'ACTIVE_HEALTHY' }],
          pagination: { count: 3, limit: 10, offset: 0 },
        },
      })
  })

  it('API key 列表两种形状都认:裸数组与 {details:[...]} 信封', async () => {
    mockSupabase(200, [API_KEY_RECORD])
    const asArray = await (await call('list_project_api_keys', { projectRef: PROJECT_REF })).json()
    expect(asArray).toMatchObject({ content: { apiKeys: [{ id: 'key_1', type: 'secret' }] } })

    vi.unstubAllGlobals()
    mockSupabase(200, { details: [API_KEY_RECORD] })
    const asEnvelope = await (await call('list_project_api_keys', { projectRef: PROJECT_REF })).json()
    expect(asEnvelope).toEqual(asArray)
  })

  it('API key 记录裁剪成声明的字段,未知 type 归一成 unknown', async () => {
    mockSupabase(200, { ...API_KEY_RECORD, type: 'brand_new_kind', extra: 'dropped' })
    await expect((await call('get_project_api_key', { projectRef: PROJECT_REF, apiKeyId: 'key_1' })).json())
      .resolves.toEqual({
        content: {
          apiKey: {
            id: 'key_1',
            name: 'service_key',
            type: 'unknown',
            prefix: 'sb_secret_',
            hash: 'abc123',
            description: null,
            apiKey: 'sb_secret_full_value',
            insertedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            secretJwtTemplate: { role: 'service_role' },
          },
        },
      })
  })

  it('generate_typescript_types 只透出 types 那个串;缺它即 malformed', async () => {
    mockSupabase(200, { types: 'export type Database = {}' })
    await expect((await call('generate_typescript_types', { projectRef: PROJECT_REF })).json())
      .resolves.toEqual({ content: { typescript: 'export type Database = {}' } })

    vi.unstubAllGlobals()
    mockSupabase(200, { other: 1 })
    await expect((await call('generate_typescript_types', { projectRef: PROJECT_REF })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('run_read_only_query 空响应体归一成 result:null(这个端点允许空体)', async () => {
    mockEmpty(200)
    await expect((await call('run_read_only_query', { projectRef: PROJECT_REF, query: 'select 1' })).json())
      .resolves.toEqual({ content: { result: null } })
  })

  it('其余端点空响应体 → unavailable(契约要求有 JSON 体)', async () => {
    mockEmpty(200)
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: expect.stringContaining('empty body') })
  })

  it('health 保留原始键并补裁剪字段,info 为 null 时留住', async () => {
    mockSupabase(200, [{ name: 'db', healthy: true, status: 'ACTIVE_HEALTHY', info: null }])
    await expect((await call('get_project_health', { projectRef: PROJECT_REF, services: ['db'] })).json())
      .resolves.toEqual({
        content: { services: [{ name: 'db', healthy: true, status: 'ACTIVE_HEALTHY', info: null }] },
      })
  })

  it('storage buckets / edge functions 原样透出对象列表', async () => {
    mockSupabase(200, [{ id: 'b1', name: 'avatars', public: true }])
    await expect((await call('list_storage_buckets', { projectRef: PROJECT_REF })).json())
      .resolves.toEqual({ content: { buckets: [{ id: 'b1', name: 'avatars', public: true }] } })

    vi.unstubAllGlobals()
    mockSupabase(200, { not: 'an array' })
    await expect((await call('list_edge_functions', { projectRef: PROJECT_REF })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('secretJwtTemplate 只允许配 secret 类型的 key → 否则 invalid_argument 且不打上游', async () => {
    const mock = mockSupabase(200, API_KEY_RECORD)
    const res = await call('create_project_api_key', {
      projectRef: PROJECT_REF,
      name: 'pub_key',
      type: 'publishable',
      secretJwtTemplate: { role: 'anon' },
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'secretJwtTemplate is only supported for secret API keys',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('update_project_api_key 一个可改字段都没给 → invalid_argument 且不打上游', async () => {
    const mock = mockSupabase(200, API_KEY_RECORD)
    const res = await call('update_project_api_key', { projectRef: PROJECT_REF, apiKeyId: 'key_1', reveal: true })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      message: 'Provide at least one field to update: name, description, or secretJwtTemplate.',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:key 名不合规范 / limit 越界 → 400 且不打上游', async () => {
    const mock = mockSupabase(200, {})
    expect((await call('create_project_api_key', {
      projectRef: PROJECT_REF,
      name: 'Bad-Name',
      type: 'secret',
    })).status).toBe(400)
    expect((await call('list_organization_projects', { organizationSlug: 'acme', limit: 500 })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('4xx 归 invalid_argument;404 保留成 not_found、409 保留成 conflict(上游把三者都压成 400)', async () => {
    mockSupabase(400, { message: 'Invalid project ref' })
    const bad = await call('get_project', { projectRef: PROJECT_REF })
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Invalid project ref',
    })

    vi.unstubAllGlobals()
    mockSupabase(404, { message: 'Project not found' })
    const missing = await call('get_project', { projectRef: PROJECT_REF })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found' })

    vi.unstubAllGlobals()
    mockSupabase(409, { message: 'Key name already exists' })
    const conflict = await call('create_project_api_key', {
      projectRef: PROJECT_REF,
      name: 'service_key',
      type: 'secret',
    })
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({ code: 'conflict' })
  })

  it('401 归 permission_denied;403 也归 permission_denied 但不带 401 状态', async () => {
    mockSupabase(401, { message: 'Unauthorized' })
    const unauthorized = await call('list_projects', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({ code: 'permission_denied' })

    vi.unstubAllGlobals()
    mockSupabase(403, { message: 'Insufficient scope' })
    const forbidden = await call('list_projects', {})
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toMatchObject({ code: 'permission_denied' })
  })

  it('invalid_grant 这个稳定错误码有专门文案(它比状态更准)', async () => {
    mockSupabase(400, { code: 'invalid_grant', message: 'whatever upstream says' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'supabase grant is invalid or expired' })
  })

  it('429 → rate_limited + retryable;5xx → unavailable + retryable', async () => {
    mockSupabase(429, { message: 'Too many requests' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockSupabase(503, { message: 'Supabase is down' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'Supabase is down' })
  })

  it('错误响应回 HTML 时原文进 message 并按状态归一(上游把它压成可重试的 502)', async () => {
    mockSupabase(403, '<html>Forbidden</html>')
    const res = await call('list_projects', {})
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: '<html>Forbidden</html>',
    })
  })

  it('2xx 上回非 JSON → unavailable + retryable', async () => {
    mockSupabase(200, 'not json')
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('该回数组的端点回了对象 → unavailable + retryable', async () => {
    mockSupabase(200, { organizations: [] })
    await expect((await call('list_organizations', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockSupabase(200, {})
    const res = await call('list_projects', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
