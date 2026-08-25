import {
  type CallContext,
} from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createMetabasePlugin } from '../../src/metabase/index'
import { metabaseActions } from '../../src/metabase/schema'

/**
 * Metabase 迁移产物的 wire 级验收。Metabase 是自建实例类 provider,重点在两处:
 * 一是 `instanceUrl` 的规范化(必填、必须 https、不许带 userinfo、结尾 `/api` 要剥掉、
 * 不许指向内网),二是入参 camelCase → 线上 kebab-case/缩写参数名的映射。
 * 再加上列表端点"裸数组 or {data:[]}"两种形状都要认。
 */

const API_KEY = 'mb_testdeadbeef'
const INSTANCE_URL = 'https://metabase.example.com'
const plugin = createMetabasePlugin()

function caller(mountConfig: Record<string, unknown> | undefined): CallContext {
  return {
    keyId: 'k1',
    owner: 'agent:tester',
    scopes: [],
    traceId: 't1',
    mountPath: 'data/metabase',
    exportId: 'actions',
    ...(mountConfig === undefined ? {} : { mountConfig }),
  }
}

interface CallOptions {
  auth?: string | null
  config?: Record<string, unknown> | undefined
}

const { call, envelope, sent, mockJson: mockMetabase, env: ENV, stubFetch } = createProviderHarness<CallOptions>({
  caller: opts => caller('config' in opts ? opts.config : { instanceUrl: INSTANCE_URL }),
  mountPath: 'data/metabase',
  plugin,
  upstreamAuth: API_KEY,
})

/** 直接给一段原始 body(测空体与非 JSON 响应)。 */
function mockRaw(status: number, body: string | null): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(new Response(body, { status })))
}

describe('契约面', () => {
  it('List 出全部 10 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(metabaseActions).length)
    expect(tools).toHaveLength(10)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'get_card',
      'get_collection',
      'get_current_user',
      'get_dashboard',
      'get_database',
      'list_cards',
      'list_collections',
      'list_dashboards',
      'list_databases',
      'search',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报单个 tools/v1 export,凭证探针是 get_current_user,不声明多字段凭证', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as { exports: Array<Record<string, unknown> & { profile: string }> }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.profile).toBe('tools/v1')
    expect(body.exports[0]?.credentialProbe).toBe('get_current_user')
    // instanceUrl 是配置不是密钥,不该占 secret 通道 —— 它走 mountConfigFields。
    expect('credentials' in body.exports[0]!).toBe(false)
    expect(body.exports[0]?.mountConfigFields).toEqual([{
      key: 'instanceUrl',
      label: '实例地址',
      description: '你的 Metabase 实例地址,如 https://x.metabaseapp.com',
      required: true,
    }])
  })
})

describe('instanceUrl 的规范化', () => {
  it('API base 是 <instance>/api,凭证走 x-api-key 头', async () => {
    const mock = mockMetabase(200, { id: 1, email: 'a@b.c' })
    await call('get_current_user', {})
    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://metabase.example.com/api/user/current')
    expect(request.headers.get('x-api-key')).toBe(API_KEY)
    expect(request.headers.get('accept')).toBe('application/json')
  })

  it('结尾的 /api 先剥掉再统一补,不拼出 /api/api', async () => {
    for (const configured of ['https://metabase.example.com/api', 'https://metabase.example.com/api/']) {
      vi.unstubAllGlobals()
      const mock = mockMetabase(200, { id: 1 })
      await call('get_current_user', {}, { config: { instanceUrl: configured } })
      expect(sent(mock).url, configured).toBe('https://metabase.example.com/api/user/current')
    }
  })

  it('子路径部署保留前缀,结尾斜杠与 query/fragment 都被丢掉', async () => {
    const mock = mockMetabase(200, { id: 1 })
    await call('get_current_user', {}, {
      config: { instanceUrl: 'https://example.com/mb/?token=leak#frag' },
    })
    expect(sent(mock).url).toBe('https://example.com/mb/api/user/current')
  })

  it('裸主机名补 https', async () => {
    const mock = mockMetabase(200, { id: 1 })
    await call('get_current_user', {}, { config: { instanceUrl: 'metabase.example.com' } })
    expect(sent(mock).url).toBe('https://metabase.example.com/api/user/current')
  })

  it('缺 instanceUrl → invalid_argument 且不打上游(没有默认实例可兜底)', async () => {
    const mock = mockMetabase(200, {})
    const res = await call('get_current_user', {}, { config: undefined })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('instanceUrl')
    expect(mock).not.toHaveBeenCalled()
  })

  it('http 实例 → 拒(自建实例的 API key 不能走明文)', async () => {
    const mock = mockMetabase(200, {})
    const res = await call('get_current_user', {}, { config: { instanceUrl: 'http://metabase.example.com' } })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: /https/ })
    expect(mock).not.toHaveBeenCalled()
  })

  it('URL 里带 userinfo → 拒(等于第二套凭证藏在配置里)', async () => {
    const mock = mockMetabase(200, {})
    const res = await call('get_current_user', {}, {
      config: { instanceUrl: 'https://admin:hunter2@metabase.example.com' },
    })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('instanceUrl 指向内网/保留地址 → 拒(自建实例地址是租户填的,这是现成的 SSRF 入口)', async () => {
    for (const host of ['https://127.0.0.1:3000', 'https://169.254.169.254', 'https://10.0.0.5']) {
      vi.unstubAllGlobals()
      const mock = mockMetabase(200, {})
      const res = await call('get_current_user', {}, { config: { instanceUrl: host } })
      expect(res.status, host).toBe(400)
      expect(mock, host).not.toHaveBeenCalled()
    }
  })

  it('instanceUrl 不是字符串 → invalid_argument(不 String() 硬转)', async () => {
    const mock = mockMetabase(200, {})
    const res = await call('get_current_user', {}, { config: { instanceUrl: 42 } })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('请求拼装', () => {
  it('list_databases:camelCase 入参映射到 snake_case 与 kebab-case 两套线上参数名', async () => {
    const mock = mockMetabase(200, [])
    await call('list_databases', {
      include: 'tables',
      includeAnalytics: true,
      saved: false,
      includeEditableDataModel: true,
      excludeUneditableDetails: false,
      includeOnlyUploadable: true,
      routerDatabaseId: 7,
      canQuery: true,
      canWriteMetadata: false,
    })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/database')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'include': 'tables',
      'include_analytics': 'true',
      'saved': 'false',
      'include_editable_data_model': 'true',
      'exclude_uneditable_details': 'false',
      'include_only_uploadable': 'true',
      'router_database_id': '7',
      // 这两个是 kebab-case:写成 can_query 会被 Metabase 静默忽略。
      'can-query': 'true',
      'can-write-metadata': 'false',
    })
  })

  it('list_collections / get_card 的 kebab-case 参数名', async () => {
    const collections = mockMetabase(200, [])
    await call('list_collections', {
      archived: true,
      excludeOtherUserCollections: true,
      namespace: 'snippets',
      personalOnly: false,
    })
    expect(Object.fromEntries(new URL(sent(collections).url).searchParams)).toEqual({
      'archived': 'true',
      'exclude-other-user-collections': 'true',
      'namespace': 'snippets',
      'personal-only': 'false',
    })

    vi.unstubAllGlobals()
    const card = mockMetabase(200, { id: 3 })
    await call('get_card', { id: 3, legacyMbql: true })
    const cardUrl = new URL(sent(card).url)
    expect(cardUrl.pathname).toBe('/api/card/3')
    expect(Object.fromEntries(cardUrl.searchParams)).toEqual({ 'legacy-mbql': 'true' })
  })

  it('list_cards / list_dashboards 的 filter 在线上叫 `f`', async () => {
    const cards = mockMetabase(200, [])
    await call('list_cards', { filter: 'mine', modelId: 9 })
    expect(Object.fromEntries(new URL(sent(cards).url).searchParams)).toEqual({ f: 'mine', model_id: '9' })

    vi.unstubAllGlobals()
    const dashboards = mockMetabase(200, [])
    await call('list_dashboards', { filter: 'archived' })
    expect(Object.fromEntries(new URL(sent(dashboards).url).searchParams)).toEqual({ f: 'archived' })
  })

  it('search:query → q、collectionId → collection、tableDatabaseId → table_db_id,models 展开', async () => {
    const mock = mockMetabase(200, { data: [] })
    await call('search', {
      query: 'revenue',
      context: 'search-app',
      archived: false,
      collectionId: 4,
      tableDatabaseId: 2,
      models: ['card', 'dashboard'],
      includeDashboardQuestions: true,
      includeMetadata: false,
    })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/search')
    expect(url.searchParams.getAll('models')).toEqual(['card', 'dashboard'])
    expect(url.searchParams.get('q')).toBe('revenue')
    expect(url.searchParams.get('collection')).toBe('4')
    expect(url.searchParams.get('table_db_id')).toBe('2')
    expect(url.searchParams.get('context')).toBe('search-app')
    expect(url.searchParams.has('query')).toBe(false)
  })

  it('未给的可选参数不出现在 query 里', async () => {
    const mock = mockMetabase(200, [])
    await call('list_databases', {})
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual([])
  })

  it('id 支持数字与 entity id 字符串两种形态,都被转义进路径', async () => {
    const numeric = mockMetabase(200, { id: 12 })
    await call('get_database', { id: 12 })
    expect(new URL(sent(numeric).url).pathname).toBe('/api/database/12')

    vi.unstubAllGlobals()
    const entity = mockMetabase(200, { id: 'abc' })
    await call('get_collection', { id: 'aBc DeF' })
    expect(new URL(sent(entity).url).pathname).toBe('/api/collection/aBc%20DeF')
  })
})

describe('响应整形', () => {
  it('列表端点认裸数组', async () => {
    mockMetabase(200, [{ id: 1, name: 'db' }])
    const res = await call('list_databases', {})
    await expect(res.json()).resolves.toEqual({
      content: { databases: [{ id: 1, name: 'db' }], raw: { data: [{ id: 1, name: 'db' }] } },
    })
  })

  it('列表端点也认 {data: [...]} 信封,raw 保留整个信封', async () => {
    mockMetabase(200, { data: [{ id: 5, model: 'card' }], total: 1 })
    const res = await call('search', { query: 'x' })
    await expect(res.json()).resolves.toEqual({
      content: {
        results: [{ id: 5, model: 'card' }],
        raw: { data: [{ id: 5, model: 'card' }], total: 1 },
      },
    })
  })

  it('两种形状都拿不到时给空数组,而不是报错(无权限时 Metabase 回空信封)', async () => {
    mockMetabase(200, { data: null, message: 'nothing visible' })
    const res = await call('list_cards', {})
    await expect(res.json()).resolves.toMatchObject({ content: { cards: [] } })
  })

  it('列表项不是对象时包成 {value: ...},不把裸值塞进声明成对象数组的出参', async () => {
    mockMetabase(200, [1, 'two'])
    const res = await call('list_dashboards', {})
    await expect(res.json()).resolves.toMatchObject({
      content: { dashboards: [{ value: 1 }, { value: 'two' }] },
    })
  })

  it('单体端点回非对象 → unavailable + retryable(契约说好是对象)', async () => {
    mockMetabase(200, [1, 2, 3])
    const res = await call('get_dashboard', { id: 1 })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('2xx 回非 JSON → unavailable(上游坏了,不是调用方的错)', async () => {
    mockRaw(200, '<html>login</html>')
    const res = await call('get_current_user', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:list_cards 的 filter 不在枚举里 → 400 且不打上游', async () => {
    const mock = mockMetabase(200, [])
    const res = await call('list_cards', { filter: 'nope' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_dashboard 的 id 在 schema 里是 optional(忠实反映上游),缺它时本地挡下', async () => {
    // 上游 `String(input.id)` 会把 undefined 拼成字面量 "undefined";这里保留必填断言。
    const mock = mockMetabase(200, {})
    const res = await call('get_dashboard', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: /id/ })
    expect(mock).not.toHaveBeenCalled()
  })

  it('entity id 里带 / ? # → 拒,而不是转义后打过去(会改写请求语义)', async () => {
    for (const id of ['a/b', 'a?b', 'a#b']) {
      vi.unstubAllGlobals()
      const mock = mockMetabase(200, {})
      const res = await call('get_collection', { id }, undefined)
      expect(res.status, id).toBe(400)
      expect(mock, id).not.toHaveBeenCalled()
    }
  })

  it('上游错误按状态归一,消息取自 message / error / cause / errors', async () => {
    mockMetabase(401, { message: 'Unauthenticated' })
    const unauthorized = await call('get_current_user', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthenticated',
    })

    vi.unstubAllGlobals()
    mockMetabase(400, { errors: { id: 'must be positive' } })
    const invalid = await call('get_card', { id: 1 })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      // message / error / cause 都没有时把 errors 整个序列化(上游 readErrorMessage)。
      message: '{"id":"must be positive"}',
    })

    vi.unstubAllGlobals()
    mockMetabase(429, { error: 'Too many requests' })
    const limited = await call('list_cards', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockMetabase(500, { cause: 'Metabase is down' })
    const down = await call('list_cards', {})
    expect(down.status).toBe(503)
    await expect(down.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Metabase is down',
    })
  })

  it('403 → permission_denied、404 → not_found(上游把一切 4xx 压成 400)', async () => {
    mockMetabase(403, { message: 'Forbidden' })
    const forbidden = await call('get_card', { id: 1 })
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toMatchObject({ code: 'permission_denied' })

    vi.unstubAllGlobals()
    mockMetabase(404, { message: 'Not found.' })
    const missing = await call('get_dashboard', { id: 999 })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'Not found.' })
  })

  it('错误体不是 JSON 时用原文当消息(反代回的 HTML/纯文本错误页)', async () => {
    mockRaw(502, 'Bad Gateway')
    const res = await call('get_current_user', {})
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      message: 'Bad Gateway',
      retryable: true,
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockMetabase(200, {})
    const res = await call('get_current_user', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
