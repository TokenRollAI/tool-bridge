import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPosthogPlugin } from '../../src/posthog/index'
import { posthogActions } from '../../src/posthog/schema'

/**
 * PostHog 迁移产物的 wire 级验收。57 个 action 不逐个跑,只钉住"迁移最容易迁丢"的几处:
 * baseUrl 走 providerConfig 且必须存在、organization_id 的三级回退(会多打一次
 * `/api/users/@me/`)、软删除 vs 真删除、dashboard 族的 `/api/environments/` 前缀、
 * 批量打标签的体不做 compact,以及 404 的归一口径(与上游有意不同)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'phx_testdeadbeef'
const BASE_URL = 'https://us.posthog.com'
const plugin = createPosthogPlugin()

function caller(mountConfig: Record<string, unknown> | undefined): CallContext {
  return {
    keyId: 'k1',
    owner: 'agent:tester',
    scopes: [],
    traceId: 't1',
    mountPath: 'analytics/posthog',
    exportId: 'actions',
    ...(mountConfig === undefined ? {} : { mountConfig }),
  }
}

interface CallOptions {
  auth?: string | null
  config?: Record<string, unknown> | undefined
}

function envelope(body: unknown, opts: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(caller('config' in opts ? opts.config : { baseUrl: BASE_URL })),
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

function call(name: string, args: unknown, opts?: CallOptions): Promise<Response> {
  return envelope({ tool: 'Call', arguments: { name, args } }, opts)
}

/** 单次响应的打桩。 */
function mockPosthog(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 按调用顺序依次返回;organization_id 回退会打两次上游,靠它区分。 */
function mockSequence(...responses: Array<[number, unknown]>): ReturnType<typeof vi.fn> {
  let index = 0
  const fn = vi.fn(() => {
    const [status, payload] = responses[Math.min(index, responses.length - 1)]!
    index += 1
    return Promise.resolve(new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    }))
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>, index = 0): Request {
  return (mock.mock.calls[index] as [Request])[0]
}

async function sentBody(mock: ReturnType<typeof vi.fn>, index = 0): Promise<unknown> {
  return JSON.parse(await sent(mock, index).text())
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 57 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(posthogActions).length)
    expect(tools).toHaveLength(57)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报单个 tools/v1 export,并声明 get_current_user 为凭证探针', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as {
      exports: Array<{ credentialProbe?: string, id: string, profile: string }>
    }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.profile).toBe('tools/v1')
    expect(body.exports[0]?.credentialProbe).toBe('get_current_user')
  })

  it('探针满足"无必填入参 + effect:read"(平台会空参真调它)', () => {
    const probe = posthogActions.get_current_user
    expect(probe.effect).toBe('read')
    expect(Object.keys(probe.inputSchema.shape)).toEqual([])
  })
})

describe('baseUrl 走 providerConfig', () => {
  it('请求打在 providerConfig.baseUrl 上,凭证走 authorization 头(不进 URL)', async () => {
    const mock = mockPosthog(200, { count: 0, results: [] })
    await call('list_event_definitions', { project_id: 42, limit: 20 })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin).toBe(BASE_URL)
    expect(url.pathname).toBe('/api/projects/42/event_definitions/')
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '20' })
    expect(url.search).not.toContain(API_KEY)
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
  })

  it('自托管域名的尾部斜杠与路径前缀都保留下来(去掉尾斜杠,不吞路径)', async () => {
    const mock = mockPosthog(200, {})
    await call('list_cohorts', { project_id: 7 }, { config: { baseUrl: 'https://ph.example.com/analytics/' } })
    expect(sent(mock).url).toBe('https://ph.example.com/analytics/api/projects/7/cohorts/')
  })

  it('没配 baseUrl → invalid_argument 且不打上游(替调用方猜区域会静默打错云)', async () => {
    const mock = mockPosthog(200, {})
    const res = await call('list_cohorts', { project_id: 7 }, { config: undefined })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(((await (await call('list_cohorts', { project_id: 7 }, { config: undefined })).json()) as {
      message: string
    }).message).toContain('baseUrl')
    expect(mock).not.toHaveBeenCalled()
  })

  it('baseUrl 是 http 或带 userinfo → 当场拒(后者会把凭证塞进出站 URL)', async () => {
    const insecure = mockPosthog(200, {})
    const http = await call('list_cohorts', { project_id: 7 }, { config: { baseUrl: 'http://us.posthog.com' } })
    expect(http.status).toBe(400)
    await expect(http.json()).resolves.toMatchObject({ message: expect.stringContaining('https') })
    expect(insecure).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const withUser = mockPosthog(200, {})
    const res = await call('list_cohorts', { project_id: 7 }, { config: { baseUrl: 'https://u:p@us.posthog.com' } })
    expect(res.status).toBe(400)
    expect(withUser).not.toHaveBeenCalled()
  })

  it('baseUrl 指向内网 → 被出站防线拦下,且不打上游', async () => {
    const mock = mockPosthog(200, {})
    const res = await call('list_cohorts', { project_id: 7 }, { config: { baseUrl: 'https://169.254.169.254' } })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('没配 authRef → 报错且不打上游', async () => {
    const mock = mockPosthog(200, {})
    const res = await call('list_cohorts', { project_id: 7 }, { auth: null })
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('organization_id 的三级回退', () => {
  it('入参优先:不额外打 /api/users/@me/', async () => {
    const mock = mockPosthog(200, { results: [] })
    await call('list_projects', { organization_id: 'org-from-input', limit: 5 })
    expect(mock).toHaveBeenCalledTimes(1)
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/organizations/org-from-input/projects/')
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '5' })
  })

  it('入参缺席时退到 providerConfig.organizationId', async () => {
    const mock = mockPosthog(200, { results: [] })
    await call('list_projects', {}, { config: { baseUrl: BASE_URL, organizationId: 'org-from-config' } })
    expect(mock).toHaveBeenCalledTimes(1)
    expect(new URL(sent(mock).url).pathname).toBe('/api/organizations/org-from-config/projects/')
  })

  it('两处都没有时现调 /api/users/@me/ 推断当前组织', async () => {
    const mock = mockSequence(
      [200, { id: 1, organization: { id: 'org-current', name: 'Acme' } }],
      [200, { results: [] }],
    )
    await call('get_project', { id: 99 })
    expect(mock).toHaveBeenCalledTimes(2)
    expect(new URL(sent(mock, 0).url).pathname).toBe('/api/users/@me/')
    expect(new URL(sent(mock, 1).url).pathname).toBe('/api/organizations/org-current/projects/99/')
  })

  it('只属于一个组织时用那一个;属于多个又没指定 → invalid_argument', async () => {
    const single = mockSequence(
      [200, { id: 1, organizations: [{ id: 'only-org', name: 'Solo' }] }],
      [200, { results: [] }],
    )
    await call('list_projects', {})
    expect(new URL(sent(single, 1).url).pathname).toBe('/api/organizations/only-org/projects/')

    vi.unstubAllGlobals()
    const many = mockPosthog(200, { id: 1, organizations: [{ id: 'a' }, { id: 'b' }] })
    const res = await call('list_projects', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('organization_id'),
    })
    // 只打了探组织那一次,没有拿着空 organization 去拼路径。
    expect(many).toHaveBeenCalledTimes(1)
  })
})

describe('删除:软删除与真删除是两套语义', () => {
  it('annotation / cohort / dashboard / feature_flag 是 PATCH {deleted:true}', async () => {
    const annotation = mockPosthog(200, { id: 5, content: 'x', deleted: true })
    const res = await call('delete_annotation', { project_id: 1, id: 5 })
    expect(sent(annotation).method).toBe('PATCH')
    expect(await sentBody(annotation)).toEqual({ deleted: true })
    await expect(res.json()).resolves.toMatchObject({
      content: { deleted: true, id: '5', annotation: { id: 5, content: 'x' } },
    })

    vi.unstubAllGlobals()
    const flag = mockPosthog(200, { id: 8, key: 'k', deleted: true })
    await call('delete_feature_flag', { project_id: 1, id: 8 })
    expect(sent(flag).method).toBe('PATCH')
    expect(await sentBody(flag)).toEqual({ deleted: true })

    vi.unstubAllGlobals()
    const dashboard = mockPosthog(200, { id: 3, deleted: true })
    await call('delete_dashboard', { project_id: 1, id: 3, delete_insights: true })
    expect(sent(dashboard).method).toBe('PATCH')
    expect(await sentBody(dashboard)).toEqual({ deleted: true, delete_insights: true })
  })

  it('event definition 与 insight 才是真 DELETE', async () => {
    const definition = mockPosthog(204, null)
    const res = await call('delete_event_definition', { project_id: 1, id: 'uuid-1' })
    expect(sent(definition).method).toBe('DELETE')
    // 204 空体不该被当成"响应不是 JSON"报故障。
    await expect(res.json()).resolves.toEqual({ content: { deleted: true, id: 'uuid-1', raw: {} } })

    vi.unstubAllGlobals()
    const insight = mockPosthog(200, {})
    await call('delete_insight', { project_id: 1, id: 12 })
    expect(sent(insight).method).toBe('DELETE')
  })
})

describe('路径前缀与请求体', () => {
  it('dashboard 族走 /api/environments/,其余走 /api/projects/', async () => {
    const dashboards = mockPosthog(200, { count: 0, results: [] })
    await call('list_dashboards', { project_id: 42 })
    expect(new URL(sent(dashboards).url).pathname).toBe('/api/environments/42/dashboards/')

    vi.unstubAllGlobals()
    const flags = mockPosthog(200, { count: 0, results: [] })
    await call('list_feature_flags', { project_id: 42 })
    expect(new URL(sent(flags).url).pathname).toBe('/api/projects/42/feature_flags/')
  })

  it('对象型 query 参数序列化成 JSON 串,不是展开成多个键', async () => {
    const mock = mockPosthog(200, { id: 3 })
    await call('get_dashboard', { project_id: 1, id: 3, filters_override: { date_from: '-7d' } })
    const url = new URL(sent(mock).url)
    expect(url.searchParams.get('filters_override')).toBe('{"date_from":"-7d"}')
    expect(url.searchParams.get('variables_override')).toBeNull()
  })

  it('批量打标签的体不做 compact:缺席的 ids/tags 发空数组(action:set 靠它清空标签)', async () => {
    const mock = mockPosthog(200, { updated: [], skipped: [] })
    await call('bulk_update_event_definition_tags', { project_id: 1, action: 'set' })
    expect(await sentBody(mock)).toEqual({ ids: [], action: 'set', tags: [] })
  })

  it('写入体丢掉未给的字段,但把显式 null 留住(null 是"置空"的指令)', async () => {
    const mock = mockPosthog(200, { id: 4, name: null })
    await call('update_insight', { project_id: 1, id: 4, name: null, favorited: true })
    expect(await sentBody(mock)).toEqual({ name: null, favorited: true })
  })

  it('move_tile 的 tile 缺席时发 {} 而不是省略该键', async () => {
    const mock = mockPosthog(200, {})
    await call('move_dashboard_tile', { project_id: 1, id: 2, toDashboard: 9 })
    expect(await sentBody(mock)).toEqual({ tile: {}, toDashboard: 9 })
  })

  it('primary_properties 的 names 走逗号串,不是重复同名参数', async () => {
    const mock = mockPosthog(200, { $pageview: 'utm_source' })
    const res = await call('get_event_definition_primary_properties', {
      project_id: 1,
      names: ['$pageview', '$autocapture'],
    })
    expect(new URL(sent(mock).url).searchParams.get('names')).toBe('$pageview,$autocapture')
    await expect(res.json()).resolves.toMatchObject({ content: { results: { $pageview: 'utm_source' } } })
  })
})

describe('响应整形', () => {
  it('feature flag 列表按声明裁剪:未声明的字段丢掉,raw 里留全量', async () => {
    mockPosthog(200, {
      count: 1,
      next: null,
      results: [{ id: 8, key: 'beta', active: true, undocumented_field: 'nope' }],
    })
    const res = await call('list_feature_flags', { project_id: 1 })
    const body = (await res.json()) as { content: { results: Array<Record<string, unknown>> } }
    expect(body.content.results[0]).toMatchObject({ id: 8, key: 'beta', active: true, filters: {} })
    expect(body.content.results[0]).not.toHaveProperty('undocumented_field')
    expect(body.content.results[0]!.raw).toMatchObject({ undocumented_field: 'nope' })
  })

  it('dashboard 详情:tiles 缺席时是 null(与"空 tiles 数组"不是一回事)', async () => {
    mockPosthog(200, { id: 3, name: 'Ops' })
    const res = await call('get_dashboard', { project_id: 1, id: 3 })
    await expect(res.json()).resolves.toMatchObject({ content: { id: 3, name: 'Ops', tiles: null } })
  })

  it('collaborators 回的是裸数组,不是分页信封', async () => {
    mockPosthog(200, [{ id: 'c1', dashboard_id: 3, level: 21, user: { uuid: 'u1' } }])
    const res = await call('list_dashboard_collaborators', { project_id: 1, dashboard_id: 3 })
    await expect(res.json()).resolves.toMatchObject({
      content: { results: [{ id: 'c1', dashboard_id: 3, level: 21, user: { uuid: 'u1' } }] },
    })
  })

  it('上游成功却少了契约要求的 id → unavailable + retryable(是上游破约,不是调用方的错)', async () => {
    mockPosthog(200, { key: 'beta', active: true })
    const res = await call('get_feature_flag', { project_id: 1, id: 8 })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:未声明的字段被 strictObject 拒,且不打上游', async () => {
    const mock = mockPosthog(200, {})
    const res = await call('list_cohorts', { project_id: 1, nope: true })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('schema 说可选、上游要求必填的字段,在这一层拦下(34.3% 的 action 属于这种)', async () => {
    const missingId = mockPosthog(200, {})
    const res = await call('get_feature_flag', { project_id: 1 })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ message: expect.stringContaining('id') })
    expect(missingId).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const emptyPersons = mockPosthog(200, {})
    const persons = await call('add_persons_to_static_cohort', { project_id: 1, id: 2 })
    expect(persons.status).toBe(400)
    await expect(persons.json()).resolves.toMatchObject({ message: expect.stringContaining('person_ids') })
    expect(emptyPersons).not.toHaveBeenCalled()
  })

  it('纯空白的 project_id 能过 Zod 的 min(1),但拼进路径就是一次必然失败的调用', async () => {
    const mock = mockPosthog(200, {})
    const res = await call('list_cohorts', { project_id: '   ' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取 detail 并带上 attr', async () => {
    mockPosthog(400, { type: 'validation_error', code: 'invalid', detail: 'Enter a valid value', attr: 'name' })
    const bad = await call('create_feature_flag', { project_id: 1, key: 'k', name: 'n' })
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Enter a valid value (name)',
    })

    vi.unstubAllGlobals()
    mockPosthog(401, { detail: 'Incorrect authentication credentials.' })
    const unauthorized = await call('list_cohorts', { project_id: 1 })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({ code: 'permission_denied' })

    vi.unstubAllGlobals()
    mockPosthog(429, { detail: 'Request was throttled.' })
    const limited = await call('list_cohorts', { project_id: 1 })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockPosthog(500, { detail: 'PostHog is down' })
    const down = await call('list_cohorts', { project_id: 1 })
    expect(down.status).toBe(503)
    await expect(down.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('404 归 not_found —— 与上游有意不同(上游把它压成 400)', async () => {
    mockPosthog(404, { detail: 'Not found.' })
    const res = await call('get_cohort', { project_id: 1, id: 999 })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'not_found', message: 'Not found.' })
  })

  it('上游回非 JSON 错误页时,按 HTTP 状态归一而不是报"响应不是 JSON"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }))))
    const res = await call('list_cohorts', { project_id: 1 })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('网络故障归 unavailable + retryable,不是"插件崩了"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNRESET'))))
    const res = await call('list_cohorts', { project_id: 1 })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})
