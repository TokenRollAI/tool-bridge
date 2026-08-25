import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createSentryPlugin } from '../../src/sentry/index'
import { sentryActions } from '../../src/sentry/schema'

/**
 * Sentry 迁移产物的 wire 级验收。Sentry 是**平台托管的 provider 型 OAuth2**,
 * 所以额外钉住 `~describe` 报出的 oauth 声明与上游端点/scope 一致。
 *
 * 其余重点都在"迁移最容易迁丢"的地方:base URL 的尾斜杠与相对 path、只在 content-type
 * 是 JSON 时才解析响应体、`Link` 头里的分页游标(含 `results="false"` 要跳过)、
 * `shortIdLookup` 的 1/0 形态、release health 把版本号拼成搜索子句、
 * 以及 alerts 的 `{data}` 信封。
 */

/** 平台换来并按需刷新的 access token —— 插件侧与 api_key 型取法完全一样。 */
const ACCESS_TOKEN = 'sntrys_accesstokendeadbeef'
const ORG = 'acme'
const plugin = createSentryPlugin()

const {
  call,
  envelope,
  sent,
  env: ENV,
  stubFetch,
} = createProviderHarness({
  mountPath: 'dev/sentry',
  plugin,
  upstreamAuth: ACCESS_TOKEN,
})

/** JSON 响应(带 content-type,否则 api.ts 会刻意不解析)。 */
function mockSentry(
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  })))
}

/** 不带 JSON content-type 的响应(测"只在 JSON 时才解析")。 */
function mockNonJson(status: number, body: string | null, contentType = 'text/html'): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': contentType },
  })))
}

describe('契约面', () => {
  it('List 出全部 19 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(sentryActions).length)
    expect(tools).toHaveLength(19)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报单个 tools/v1 export,oauth 字段与上游 definition.ts 逐字一致', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as {
      exports: Array<Record<string, unknown> & { oauth?: unknown, profile: string }>
    }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.profile).toBe('tools/v1')
    expect(body.exports[0]?.oauth).toEqual({
      // 末尾斜杠是上游的原值:Sentry 对无斜杠形式会 301。
      authorizationUrl: 'https://sentry.io/oauth/authorize/',
      tokenUrl: 'https://sentry.io/oauth/token/',
      // 上游 scopes.ts 的全量五项,顺序一致。
      scopes: ['org:read', 'project:read', 'project:releases', 'event:read', 'event:write'],
    })
  })

  it('声明了 oauth 的 export 不带 credentialProbe / credentials(SDK 侧互斥)', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as { exports: Array<Record<string, unknown>> }
    expect('credentialProbe' in body.exports[0]!).toBe(false)
    expect('credentials' in body.exports[0]!).toBe(false)
  })
})

describe('请求拼装', () => {
  it('base URL 的 /api/0/ 前缀不被吃掉,凭证走 Authorization: Bearer 头', async () => {
    const mock = mockSentry(200, [])
    await call('list_organization_projects', { organizationIdOrSlug: ORG })
    const request = sent(mock)
    expect(request.method).toBe('GET')
    // path 写成 `/organizations/...` 会拼出 https://sentry.io/organizations/...,丢掉 /api/0。
    expect(request.url).toBe('https://sentry.io/api/0/organizations/acme/projects/')
    expect(request.headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(request.headers.get('accept')).toBe('application/json')
    expect(request.headers.get('content-type')).toBeNull()
  })

  it('路径都以斜杠结尾(Sentry 对缺尾斜杠的路径会 301)', async () => {
    const cases: Array<[string, unknown, string]> = [
      ['get_issue', { organizationIdOrSlug: ORG, issueId: '42' }, '/api/0/organizations/acme/issues/42/'],
      ['get_project', { organizationIdOrSlug: ORG, projectIdOrSlug: 'web' }, '/api/0/projects/acme/web/'],
      ['get_sentry_app', { sentryAppIdOrSlug: 'my-app' }, '/api/0/sentry-apps/my-app/'],
      ['get_alert', { organizationIdOrSlug: ORG, alertId: 'w1' }, '/api/0/organizations/acme/workflows/w1/'],
      [
        'get_organization_integration',
        { organizationIdOrSlug: ORG, integrationId: 'i1' },
        '/api/0/organizations/acme/integrations/i1/',
      ],
    ]
    for (const [name, args, pathname] of cases) {
      vi.unstubAllGlobals()
      const mock = mockSentry(200, name.startsWith('list') ? [] : { id: 'x' })
      await call(name, args)
      expect(new URL(sent(mock).url).pathname, name).toBe(pathname)
    }
  })

  it('路径段被转义:org slug 与 release version 都可能带 /', async () => {
    const mock = mockSentry(200, { version: 'a/b' })
    await call('get_organization_release', { organizationIdOrSlug: ORG, version: 'app@1.0/rc1' })
    expect(new URL(sent(mock).url).pathname).toBe('/api/0/organizations/acme/releases/app%401.0%2Frc1/')
  })

  it('list_organization_issues:复数入参映射到单数线上参数,多值展开成重复同名参数', async () => {
    const mock = mockSentry(200, [])
    await call('list_organization_issues', {
      organizationIdOrSlug: ORG,
      query: 'is:unresolved',
      limit: 25,
      environments: ['prod', 'staging'],
      projectIds: [1, 2],
      expand: ['owners'],
      collapse: ['stats'],
      statsPeriod: '24h',
    })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/0/organizations/acme/issues/')
    expect(url.searchParams.getAll('environment')).toEqual(['prod', 'staging'])
    expect(url.searchParams.getAll('project')).toEqual(['1', '2'])
    expect(url.searchParams.getAll('expand')).toEqual(['owners'])
    expect(url.searchParams.get('query')).toBe('is:unresolved')
    expect(url.searchParams.get('limit')).toBe('25')
    // 入参名不该原样出现在 query 上。
    expect(url.searchParams.has('environments')).toBe(false)
    expect(url.searchParams.has('projectIds')).toBe(false)
  })

  it('shortIdLookup 是 1/0 而不是 true/false(Sentry 只认数字串)', async () => {
    const on = mockSentry(200, [])
    await call('list_organization_issues', { organizationIdOrSlug: ORG, shortIdLookup: true })
    expect(new URL(sent(on).url).searchParams.get('shortIdLookup')).toBe('1')

    vi.unstubAllGlobals()
    const off = mockSentry(200, [])
    await call('list_organization_issues', { organizationIdOrSlug: ORG, shortIdLookup: false })
    expect(new URL(sent(off).url).searchParams.get('shortIdLookup')).toBe('0')

    vi.unstubAllGlobals()
    const absent = mockSentry(200, [])
    await call('list_organization_issues', { organizationIdOrSlug: ORG })
    expect(new URL(sent(absent).url).searchParams.has('shortIdLookup')).toBe(false)
  })

  it('未给的可选参数不出现在 query 里', async () => {
    const mock = mockSentry(200, [])
    await call('list_organization_integrations', { organizationIdOrSlug: ORG })
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual([])
  })

  it('get_release_health_stats:version 不进路径,拼成 release: 搜索子句与 query 用空格连起来', async () => {
    const mock = mockSentry(200, { groups: [] })
    await call('get_release_health_stats', {
      organizationIdOrSlug: ORG,
      version: '1.2.3',
      fields: ['sum(session)', 'count_unique(user)'],
      groupBy: ['release'],
      query: 'environment:prod',
      perPage: 50,
    })
    const url = new URL(sent(mock).url)
    // 端点是 sessions/,不是 releases/<version>/。
    expect(url.pathname).toBe('/api/0/organizations/acme/sessions/')
    expect(url.searchParams.get('query')).toBe('release:1.2.3 environment:prod')
    expect(url.searchParams.getAll('field')).toEqual(['sum(session)', 'count_unique(user)'])
    // per_page 是 snake_case,与同一端点上的 camelCase 参数混用。
    expect(url.searchParams.get('per_page')).toBe('50')
  })

  it('get_release_health_stats:没给 query 时只有 release 子句', async () => {
    const mock = mockSentry(200, { groups: [] })
    await call('get_release_health_stats', {
      organizationIdOrSlug: ORG,
      version: '1.2.3',
      fields: ['sum(session)'],
    })
    expect(new URL(sent(mock).url).searchParams.get('query')).toBe('release:1.2.3')
  })

  it('update_issue 是 PUT + JSON body;空串 assignedTo 要发出去(那是取消指派)', async () => {
    const mock = mockSentry(200, { id: '42', status: 'resolved' })
    await call('update_issue', {
      organizationIdOrSlug: ORG,
      issueId: '42',
      status: 'resolved',
      assignedTo: '',
      hasSeen: true,
      statusDetails: { inRelease: '1.2.3' },
    })
    const request = sent(mock)
    expect(request.method).toBe('PUT')
    expect(request.url).toBe('https://sentry.io/api/0/organizations/acme/issues/42/')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      status: 'resolved',
      // 空串保留:过滤掉它就没法通过这个工具取消指派了。
      assignedTo: '',
      hasSeen: true,
      statusDetails: { inRelease: '1.2.3' },
    })
  })

  it('update_issue 只发给了值的字段(不把未给的项写成 null)', async () => {
    const mock = mockSentry(200, { id: '42' })
    await call('update_issue', { organizationIdOrSlug: ORG, issueId: '42', isPublic: false })
    await expect(sent(mock).json()).resolves.toEqual({ isPublic: false })
  })

  it('list_alerts:ids → 单数 id(可重复)、projectIds → project', async () => {
    const mock = mockSentry(200, [])
    await call('list_alerts', { organizationIdOrSlug: ORG, ids: ['w1', 'w2'], projectIds: [3], sortBy: '-name' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/0/organizations/acme/workflows/')
    expect(url.searchParams.getAll('id')).toEqual(['w1', 'w2'])
    expect(url.searchParams.getAll('project')).toEqual(['3'])
    expect(url.searchParams.get('sortBy')).toBe('-name')
  })
})

describe('分页游标(藏在 Link 头里,不在 body)', () => {
  it('解出 next / previous 游标', async () => {
    mockSentry(200, [], {
      link: '<https://sentry.io/api/0/organizations/acme/issues/?cursor=c1>; rel="previous"; results="true";'
        + ' cursor="c1", <https://sentry.io/api/0/organizations/acme/issues/?cursor=c2>; rel="next";'
        + ' results="true"; cursor="c2"',
    })
    const res = await call('list_organization_issues', { organizationIdOrSlug: ORG })
    await expect(res.json()).resolves.toEqual({
      content: { issues: [], nextCursor: 'c2', previousCursor: 'c1' },
    })
  })

  it('results="false" 的那一节跳过(否则调用方会无限翻页)', async () => {
    mockSentry(200, [], {
      link: '<https://sentry.io/x?cursor=c1>; rel="previous"; results="false"; cursor="c1",'
        + ' <https://sentry.io/x?cursor=c2>; rel="next"; results="false"; cursor="c2"',
    })
    const res = await call('list_organization_projects', { organizationIdOrSlug: ORG })
    await expect(res.json()).resolves.toMatchObject({
      content: { nextCursor: null, previousCursor: null },
    })
  })

  it('没有 cursor="" 属性时从 <url> 的 query 里取游标', async () => {
    mockSentry(200, [], {
      link: '<https://sentry.io/api/0/organizations/acme/replays/?cursor=0%3A100%3A0>; rel="next"; results="true"',
    })
    const res = await call('list_organization_replays', { organizationIdOrSlug: ORG })
    await expect(res.json()).resolves.toMatchObject({ content: { nextCursor: '0:100:0' } })
  })

  it('URL 里带逗号也切得对(split(",") 会切坏 Link 头)', async () => {
    mockSentry(200, [], {
      link: '<https://sentry.io/x?query=a%2Cb&cursor=c1>; rel="next"; results="true"',
    })
    const res = await call('list_organization_projects', { organizationIdOrSlug: ORG })
    await expect(res.json()).resolves.toMatchObject({ content: { nextCursor: 'c1' } })
  })

  it('没有 Link 头时两个游标都是 null(不是缺席)', async () => {
    mockSentry(200, [])
    const res = await call('list_organization_replays', { organizationIdOrSlug: ORG })
    await expect(res.json()).resolves.toEqual({
      content: { replays: [], nextCursor: null, previousCursor: null },
    })
  })

  it('get_replay 这个详情端点也透出游标(内嵌数据的分页)', async () => {
    mockSentry(200, { id: 'r1' }, { link: '<https://sentry.io/x?cursor=c9>; rel="next"; results="true"' })
    const res = await call('get_replay', { organizationIdOrSlug: ORG, replayId: 'r1' })
    await expect(res.json()).resolves.toMatchObject({
      content: { nextCursor: 'c9', previousCursor: null, replay: { id: 'r1' } },
    })
  })
})

describe('响应整形', () => {
  it('issue 按声明裁剪:count 保持字符串、缺席的 nullable 字段归 null、未声明字段丢掉', async () => {
    mockSentry(200, {
      id: '42',
      title: 'TypeError',
      count: '137',
      userCount: 9,
      isBookmarked: 'yes',
      project: { id: '1', slug: 'web', name: 'Web' },
      tags: [{ key: 'browser', value: 'Chrome' }, { name: '没有 key,整条丢掉' }],
      undeclared_field: 'dropped',
    })
    const res = await call('get_issue', { organizationIdOrSlug: ORG, issueId: '42' })
    const issue = ((await res.json()) as { content: { issue: Record<string, unknown> } }).content.issue
    // Sentry 回的 count 就是字符串,别顺手转成数字。
    expect(issue.count).toBe('137')
    expect(issue.userCount).toBe(9)
    // 只有严格 true 算真:字符串 'yes' 归 false。
    expect(issue.isBookmarked).toBe(false)
    expect(issue.shortId).toBeNull()
    expect(issue.statusDetails).toBeNull()
    expect(issue.tags).toEqual([{ key: 'browser', name: null, value: 'Chrome' }])
    expect(issue.project).toEqual({ id: '1', slug: 'web', name: 'Web', platform: null })
    expect('undeclared_field' in issue).toBe(false)
  })

  it('event 的 id 在列表与详情上分别叫 id 与 eventID,两种都收', async () => {
    mockSentry(200, { eventID: 'e1', groupID: '42', tags: [{ key: 'k', value: 'v' }, { key: 'no-value' }] })
    const res = await call('get_issue_event', { organizationIdOrSlug: ORG, issueId: '42', eventId: 'latest' })
    await expect(res.json()).resolves.toMatchObject({
      content: {
        event: {
          id: 'e1',
          eventId: 'e1',
          issueId: '42',
          // key 与 value 都得有,少一个整条丢掉。
          tags: [{ key: 'k', value: 'v' }],
        },
      },
    })
  })

  it('sentry app 只透出 hasClientSecret,不透出 clientSecret 本身', async () => {
    mockSentry(200, { name: 'App', slug: 'app', uuid: 'u1', clientSecret: 'sntrys_supersecret' })
    const res = await call('get_sentry_app', { sentryAppIdOrSlug: 'app' })
    const text = await res.text()
    expect(text).not.toContain('sntrys_supersecret')
    expect((JSON.parse(text) as { content: { sentryApp: Record<string, unknown> } }).content.sentryApp)
      .toMatchObject({ hasClientSecret: true })
  })

  it('alerts 认裸数组也认 {data: [...]} 信封', async () => {
    const bare = mockSentry(200, [{ id: 'w1', name: 'High errors' }])
    const fromArray = await call('list_alerts', { organizationIdOrSlug: ORG })
    expect(bare).toHaveBeenCalled()
    await expect(fromArray.json()).resolves.toMatchObject({ content: { alerts: [{ id: 'w1', name: 'High errors' }] } })

    vi.unstubAllGlobals()
    mockSentry(200, { data: [{ id: 'w2', name: 'Latency' }] })
    const fromEnvelope = await call('list_alerts', { organizationIdOrSlug: ORG })
    await expect(fromEnvelope.json()).resolves.toMatchObject({ content: { alerts: [{ id: 'w2' }] } })
  })

  it('get_alert 也解 {data: {...}} 信封;createdBy 既收裸串也收 actor 对象', async () => {
    mockSentry(200, { data: { id: 'w1', name: 'High errors', createdBy: { email: 'a@b.c' } } })
    const nested = await call('get_alert', { organizationIdOrSlug: ORG, alertId: 'w1' })
    await expect(nested.json()).resolves.toMatchObject({
      content: { alert: { id: 'w1', createdBy: 'a@b.c' } },
    })

    vi.unstubAllGlobals()
    mockSentry(200, { id: 'w1', name: 'x', createdBy: 'someone' })
    const plain = await call('get_alert', { organizationIdOrSlug: ORG, alertId: 'w1' })
    await expect(plain.json()).resolves.toMatchObject({ content: { alert: { createdBy: 'someone' } } })
  })

  it('replay 的 releases 既收版本号字符串也收 {version} 对象', async () => {
    mockSentry(200, { id: 'r1', releases: ['1.0', { version: '2.0' }, { nope: true }] })
    const res = await call('get_replay', { organizationIdOrSlug: ORG, replayId: 'r1' })
    await expect(res.json()).resolves.toMatchObject({ content: { replay: { releases: ['1.0', '2.0'] } } })
  })

  it('integration config 的 {providers} 信封缺 providers → unavailable', async () => {
    mockSentry(200, { not_providers: [] })
    const res = await call('get_organization_integration_config', { organizationIdOrSlug: ORG })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('列表端点回对象而不是数组 → unavailable + retryable', async () => {
    mockSentry(200, { detail: 'not a list' })
    const res = await call('list_organization_projects', { organizationIdOrSlug: ORG })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('scopes 的显式 null 保留(与"字段缺席"是两回事)', async () => {
    mockSentry(200, [{ id: 'i1', name: 'Slack', scopes: null, provider: { key: 'slack' } }])
    const withNull = await call('list_organization_integrations', { organizationIdOrSlug: ORG })
    await expect(withNull.json()).resolves.toMatchObject({
      content: { integrations: [{ scopes: null }] },
    })

    vi.unstubAllGlobals()
    mockSentry(200, [{ id: 'i1', name: 'Slack', provider: { key: 'slack' } }])
    const absent = await call('list_organization_integrations', { organizationIdOrSlug: ORG })
    await expect(absent.json()).resolves.toMatchObject({
      content: { integrations: [{ scopes: [] }] },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:limit 越界 → 400 且不打上游', async () => {
    const mock = mockSentry(200, [])
    const res = await call('list_organization_issues', { organizationIdOrSlug: ORG, limit: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('必填入参缺失 → 400 且不打上游', async () => {
    const mock = mockSentry(200, [])
    const res = await call('get_issue', { organizationIdOrSlug: ORG })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 detail / error / message / error_description', async () => {
    mockSentry(401, { detail: 'Invalid token' })
    const unauthorized = await call('get_issue', { organizationIdOrSlug: ORG, issueId: '1' })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid token',
    })

    vi.unstubAllGlobals()
    mockSentry(400, { error_description: 'bad query' })
    const bad = await call('list_organization_issues', { organizationIdOrSlug: ORG })
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'bad query' })

    vi.unstubAllGlobals()
    mockSentry(429, { message: 'Rate limited' })
    const limited = await call('list_organization_issues', { organizationIdOrSlug: ORG })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockSentry(500, { detail: 'Internal error' })
    const down = await call('list_organization_issues', { organizationIdOrSlug: ORG })
    expect(down.status).toBe(503)
    await expect(down.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('403 → permission_denied、404 → not_found(上游把 401/403 都压成 401)', async () => {
    // scope 不够是 403:调用方要重走授权、拿更大的 scope,不是换 token。
    mockSentry(403, { detail: 'You do not have permission' })
    const forbidden = await call('list_organization_replays', { organizationIdOrSlug: ORG })
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toMatchObject({ code: 'permission_denied' })

    vi.unstubAllGlobals()
    mockSentry(404, { detail: 'The requested resource does not exist' })
    const missing = await call('get_issue', { organizationIdOrSlug: ORG, issueId: '404' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found' })
  })

  it('错误消息也认嵌套的 detail.message 形态', async () => {
    mockSentry(400, { detail: { message: 'invalid cursor' } })
    const res = await call('list_organization_issues', { organizationIdOrSlug: ORG, cursor: 'x' })
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'invalid cursor' })
  })

  it('错误体不是 JSON(HTML 错误页)→ 不硬解,按状态归一并给兜底消息', async () => {
    mockNonJson(502, '<html><body>Bad Gateway</body></html>')
    const res = await call('get_issue', { organizationIdOrSlug: ORG, issueId: '1' })
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('unavailable')
    // 硬解 HTML 会编出一个假消息;这里明确回退到状态说明。
    expect(body.message).toContain('502')
    expect(body.message).not.toContain('<html>')
  })

  it('2xx 但 content-type 不是 JSON → payload 当 null,单体端点归 unavailable', async () => {
    mockNonJson(200, 'not json at all', 'text/plain')
    const res = await call('get_issue', { organizationIdOrSlug: ORG, issueId: '1' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没有 access token → unavailable 且不打上游', async () => {
    const mock = mockSentry(200, [])
    const res = await call('list_organization_projects', { organizationIdOrSlug: ORG }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
