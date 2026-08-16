import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createGrafanaPlugin } from '../../src/grafana/index'
import { grafanaActions } from '../../src/grafana/schema'

/**
 * Grafana 迁移产物的 wire 级验收。重点钉住几个"迁移最容易迁丢"的地方:
 * App Platform 的**版本协商**(问 `/apis/<group>`、按 v1 → v1beta1 → v0alpha1 取、结果缓存、
 * 探测失败退回 v1)、哪些 action **不**参与协商(`/api/search` 与 datasources / 告警)、
 * 父子关系写进 `grafana.app/folder` annotation、`/api/search` 的重复同名多值参数、
 * 以及自建实例 `baseUrl` 的归一与拒绝(http / 内网 / 缺配)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'glsa_deadbeef'
const plugin = createGrafanaPlugin()

/**
 * 每个用例用一个**新的实例地址**:版本协商结果按 `baseUrl|group` 缓存在模块级 Map 里,
 * 复用同一个地址会让用例之间互相影响(先跑的那个把版本填进缓存,后跑的就看不到探测请求了)。
 * 想验缓存本身的用例自己复用同一个地址。
 */
let instances = 0
function nextBase(): string {
  instances += 1
  return `https://g${instances}.grafana.net`
}

function caller(mountConfig?: Record<string, unknown>): CallContext {
  return {
    keyId: 'k1',
    owner: 'agent:tester',
    scopes: [],
    traceId: 't1',
    mountPath: 'obs/grafana',
    exportId: 'actions',
    ...(mountConfig === undefined ? {} : { mountConfig }),
  }
}

interface CallOptions {
  auth?: string | null
  config?: Record<string, unknown>
}

function envelope(body: unknown, opts: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(caller(opts.config)),
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

function call(name: string, args: unknown, opts: CallOptions): Promise<Response> {
  return envelope({ tool: 'Call', arguments: { name, args } }, opts)
}

interface Reply {
  /** 原始体;传 `null` 表示无体(204 必须这么给,`''` 在 undici 下直接 TypeError)。 */
  body?: null | string
  payload?: unknown
  status?: number
}

/** 按顺序回应出站请求(folders / dashboards 的第一发是版本探测,第二发才是业务请求)。 */
function mockReplies(...replies: Reply[]): ReturnType<typeof vi.fn> {
  const queue = [...replies]
  const fn = vi.fn(() => {
    const reply = queue.shift() ?? { payload: {} }
    const body = reply.body === undefined ? JSON.stringify(reply.payload ?? {}) : reply.body
    return Promise.resolve(new Response(body, {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }))
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** `/apis/<group>` 的探测响应。 */
function discovery(...versions: string[]): Reply {
  return { payload: { versions: versions.map(version => ({ version, groupVersion: `x/${version}` })) } }
}

function sent(mock: ReturnType<typeof vi.fn>, index = 0): Request {
  return (mock.mock.calls[index] as [Request])[0]
}

function sentUrl(mock: ReturnType<typeof vi.fn>, index = 0): URL {
  return new URL(sent(mock, index).url)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('~describe 报成单个 tools/v1 export,并带上凭证探针', async () => {
    const res = await createGrafanaPlugin().fetch(new Request('https://plugin.test/~describe'), {} as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'single', required: true },
        id: 'actions',
        profile: 'tools/v1',
        description: 'Grafana',
        credentialProbe: 'search_dashboards',
        mountConfigFields: [{
          key: 'baseUrl',
          label: '实例地址',
          description: 'Grafana 实例根地址(Cloud 或自建),如 https://x.grafana.net',
          required: true,
        }],
      }],
    })
  })

  it('探针 search_dashboards 只读且无必填入参(平台挂载时会空参调它)', () => {
    const spec = grafanaActions.search_dashboards
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })

  it('List 出全部 19 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(grafanaActions).length)
    expect(tools).toHaveLength(19)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_dashboard',
      'create_data_source',
      'create_folder',
      'delete_dashboard',
      'delete_data_source',
      'delete_folder',
      'get_alert_rule',
      'get_dashboard',
      'get_data_source',
      'get_folder',
      'list_alert_instances',
      'list_alert_rules',
      'list_contact_points',
      'list_data_sources',
      'list_folders',
      'search_dashboards',
      'update_dashboard',
      'update_data_source',
      'update_folder',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('App Platform 的版本协商', () => {
  it('先问 /apis/<group>,再按 v1 → v1beta1 → v0alpha1 取第一个服务端真的服务的版本', async () => {
    const baseUrl = nextBase()
    // 典型的 Grafana 12.x:没有 v1,v2 血统不能用,只能落到 v1beta1。
    const mock = mockReplies(discovery('v2beta1', 'v1beta1', 'v0alpha1'), { payload: { items: [] } })
    await call('list_folders', {}, { config: { baseUrl } })

    expect(mock).toHaveBeenCalledTimes(2)
    expect(sentUrl(mock, 0).pathname).toBe('/apis/folder.grafana.app')
    expect(sentUrl(mock, 1).pathname).toBe('/apis/folder.grafana.app/v1beta1/namespaces/default/folders')
    expect(sent(mock, 0).headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
  })

  it('服务端服务 v1 时就用 v1(偏好表按顺序取,不是取最后一个)', async () => {
    const baseUrl = nextBase()
    const mock = mockReplies(discovery('v1', 'v1beta1', 'v2alpha1'), { payload: { items: [] } })
    await call('list_folders', {}, { config: { baseUrl } })
    expect(sentUrl(mock, 1).pathname).toBe('/apis/folder.grafana.app/v1/namespaces/default/folders')
  })

  it('协商结果按 baseUrl|group 缓存:同一实例的第二次调用不再探测', async () => {
    const baseUrl = nextBase()
    const mock = mockReplies(discovery('v1beta1'), { payload: { items: [] } }, { payload: { items: [] } })
    await call('list_folders', {}, { config: { baseUrl } })
    await call('list_folders', {}, { config: { baseUrl } })

    expect(mock).toHaveBeenCalledTimes(3)
    expect(sentUrl(mock, 2).pathname).toBe('/apis/folder.grafana.app/v1beta1/namespaces/default/folders')
  })

  it('folders 与 dashboards 各自协商(缓存键带 group,不共用一个版本)', async () => {
    const baseUrl = nextBase()
    const mock = mockReplies(
      discovery('v1beta1'),
      { payload: { items: [] } },
      discovery('v0alpha1'),
      { payload: {} },
    )
    await call('list_folders', {}, { config: { baseUrl } })
    await call('get_dashboard', { uid: 'abc' }, { config: { baseUrl } })

    expect(sentUrl(mock, 2).pathname).toBe('/apis/dashboard.grafana.app')
    expect(sentUrl(mock, 3).pathname).toBe('/apis/dashboard.grafana.app/v0alpha1/namespaces/default/dashboards/abc')
  })

  it('探测失败(老实例没有这组端点)静默退回 v1,业务请求照样发出', async () => {
    const baseUrl = nextBase()
    const mock = mockReplies({ status: 404, payload: { message: 'not found' } }, { payload: { items: [] } })
    const res = await call('list_folders', {}, { config: { baseUrl } })

    expect(res.status).toBe(200)
    expect(sentUrl(mock, 1).pathname).toBe('/apis/folder.grafana.app/v1/namespaces/default/folders')
  })

  it('探测回的版本都不在偏好表里(只有 v2 血统)也退回 v1,不去用 v2', async () => {
    const baseUrl = nextBase()
    const mock = mockReplies(discovery('v2beta1', 'v2alpha1'), { payload: { items: [] } })
    await call('list_folders', {}, { config: { baseUrl } })
    expect(sentUrl(mock, 1).pathname).toBe('/apis/folder.grafana.app/v1/namespaces/default/folders')
  })

  it('/api/search 与 datasources / 告警不参与协商:第一发就是业务请求', async () => {
    const search = mockReplies({ payload: [] })
    await call('search_dashboards', { query: 'cpu' }, { config: { baseUrl: nextBase() } })
    expect(search).toHaveBeenCalledTimes(1)
    expect(sentUrl(search).pathname).toBe('/api/search')

    vi.unstubAllGlobals()
    const sources = mockReplies({ payload: [] })
    await call('list_data_sources', {}, { config: { baseUrl: nextBase() } })
    expect(sources).toHaveBeenCalledTimes(1)
    expect(sentUrl(sources).pathname).toBe('/api/datasources')

    vi.unstubAllGlobals()
    const rules = mockReplies({ payload: [] })
    await call('list_alert_rules', {}, { config: { baseUrl: nextBase() } })
    expect(sentUrl(rules).pathname).toBe('/api/v1/provisioning/alert-rules')

    vi.unstubAllGlobals()
    const instancesMock = mockReplies({ payload: [] })
    await call('list_alert_instances', { active: true, silenced: false }, { config: { baseUrl: nextBase() } })
    expect(sentUrl(instancesMock).pathname).toBe('/api/alertmanager/grafana/api/v2/alerts')
    expect(Object.fromEntries(sentUrl(instancesMock).searchParams)).toEqual({ active: 'true', silenced: 'false' })
  })
})

describe('请求拼装', () => {
  it('list_folders:limit 与 continueToken 进 query,游标的 query 名是 continue', async () => {
    const mock = mockReplies(discovery('v1'), { payload: { items: [] } })
    await call('list_folders', { limit: 10, continueToken: 'tok', namespace: 'stacks-42' }, {
      config: { baseUrl: nextBase() },
    })
    const url = sentUrl(mock, 1)
    expect(url.pathname).toBe('/apis/folder.grafana.app/v1/namespaces/stacks-42/folders')
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '10', continue: 'tok' })
  })

  it('create_folder:uid 进 metadata.name,parentUid 进 grafana.app/folder annotation', async () => {
    const mock = mockReplies(discovery('v1'), { payload: {} })
    await call('create_folder', { title: 'Team', uid: 'team-1', parentUid: 'root' }, {
      config: { baseUrl: nextBase() },
    })

    const request = sent(mock, 1)
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      metadata: { name: 'team-1', annotations: { 'grafana.app/folder': 'root' } },
      spec: { title: 'Team' },
    })
  })

  it('create_folder:不给 uid / parentUid 时 metadata 里不出现这两个键', async () => {
    const mock = mockReplies(discovery('v1'), { payload: {} })
    await call('create_folder', { title: 'Team', generateName: 'team-' }, { config: { baseUrl: nextBase() } })
    await expect(sent(mock, 1).json()).resolves.toEqual({
      metadata: { generateName: 'team-' },
      spec: { title: 'Team' },
    })
  })

  it('update_dashboard:PUT,metadata.name 等于路径上的 uid,spec 原样转发', async () => {
    const mock = mockReplies(discovery('v1beta1'), { payload: {} })
    await call('update_dashboard', {
      uid: 'dash-1',
      folderUid: 'team-1',
      resourceVersion: '42',
      spec: { title: 'CPU', panels: [{ type: 'timeseries' }] },
    }, { config: { baseUrl: nextBase() } })

    const request = sent(mock, 1)
    expect(request.method).toBe('PUT')
    expect(new URL(request.url).pathname)
      .toBe('/apis/dashboard.grafana.app/v1beta1/namespaces/default/dashboards/dash-1')
    await expect(request.json()).resolves.toEqual({
      metadata: {
        name: 'dash-1',
        resourceVersion: '42',
        annotations: { 'grafana.app/folder': 'team-1' },
      },
      spec: { title: 'CPU', panels: [{ type: 'timeseries' }] },
    })
  })

  it('search_dashboards:多值参数是重复的同名 query,不是逗号串;空白项丢掉', async () => {
    const mock = mockReplies({ payload: [] })
    await call('search_dashboards', {
      query: 'cpu',
      tags: ['prod', 'db'],
      dashboardUids: ['d1', 'd2'],
      folderUids: ['f1'],
      type: 'dash-db',
      starred: true,
      limit: 20,
      page: 2,
    }, { config: { baseUrl: nextBase() } })

    const url = sentUrl(mock)
    expect(url.searchParams.getAll('tag')).toEqual(['prod', 'db'])
    expect(url.searchParams.getAll('dashboardUIDs')).toEqual(['d1', 'd2'])
    expect(url.searchParams.getAll('folderUIDs')).toEqual(['f1'])
    expect(url.searchParams.get('query')).toBe('cpu')
    expect(url.searchParams.get('type')).toBe('dash-db')
    expect(url.searchParams.get('starred')).toBe('true')
    expect(url.searchParams.get('limit')).toBe('20')
    expect(url.searchParams.get('page')).toBe('2')
  })

  it('search_dashboards:全是空白的 tags 一个都不发(不留下空的 tag= 参数)', async () => {
    const mock = mockReplies({ payload: [] })
    // 纯空白串能过 Zod 的 min(1),要靠 api.ts 这层去空白后丢空。
    await call('search_dashboards', { tags: ['  ', ' \t '], query: '  ' }, { config: { baseUrl: nextBase() } })
    expect([...sentUrl(mock).searchParams.keys()]).toEqual([])
  })

  it('路径段被 encodeURIComponent:uid 里的斜杠不会越出资源边界', async () => {
    const mock = mockReplies(discovery('v1'), { payload: {} })
    await call('get_folder', { uid: 'a/b', namespace: 'ns 1' }, { config: { baseUrl: nextBase() } })
    expect(sentUrl(mock, 1).pathname).toBe('/apis/folder.grafana.app/v1/namespaces/ns%201/folders/a%2Fb')
  })

  it('baseUrl 带部署上下文路径时不被吃掉,末尾斜杠与 query / hash 都归一掉', async () => {
    const mock = mockReplies({ payload: [] })
    await call('list_data_sources', {}, { config: { baseUrl: 'https://ops.example.com/grafana/?x=1#f' } })
    expect(sent(mock).url).toBe('https://ops.example.com/grafana/api/datasources')
  })

  it('delete_data_source:DELETE 打 uid 路径,空体也回 {deleted:true, raw:null}', async () => {
    // 204 的 body 必须传 null:`new Response('', {status:204})` 在 undici 下直接 TypeError。
    const mock = mockReplies({ status: 204, body: null })
    const res = await call('delete_data_source', { uid: 'ds-1' }, { config: { baseUrl: nextBase() } })
    expect(sent(mock).method).toBe('DELETE')
    expect(sentUrl(mock).pathname).toBe('/api/datasources/uid/ds-1')
    await expect(res.json()).resolves.toEqual({ content: { deleted: true, raw: null } })
  })

  it('GET 不带 content-type,POST 才带(空体请求带上它会被某些网关拒)', async () => {
    const mock = mockReplies({ payload: [] })
    await call('list_alert_rules', {}, { config: { baseUrl: nextBase() } })
    expect(sent(mock).headers.get('content-type')).toBeNull()
    expect(await sent(mock).text()).toBe('')
  })
})

describe('响应整形', () => {
  it('folder 出参:annotation 提成 parentUid,缺的字段给 null(不是丢键),raw 原样留', async () => {
    mockReplies(discovery('v1'), {
      payload: {
        metadata: {
          name: 'team-1',
          namespace: 'default',
          resourceVersion: '7',
          annotations: { 'grafana.app/folder': 'root', 'other': 'keep' },
        },
        spec: { title: 'Team' },
      },
    })
    const res = await call('get_folder', { uid: 'team-1' }, { config: { baseUrl: nextBase() } })
    await expect(res.json()).resolves.toEqual({
      content: {
        folder: {
          uid: 'team-1',
          title: 'Team',
          namespace: 'default',
          resourceVersion: '7',
          parentUid: 'root',
          raw: {
            metadata: {
              name: 'team-1',
              namespace: 'default',
              resourceVersion: '7',
              annotations: { 'grafana.app/folder': 'root', 'other': 'keep' },
            },
            spec: { title: 'Team' },
          },
        },
      },
    })
  })

  it('dashboard 出参用 folderUid 这个键名(同一个 annotation,两种资源两个名字)', async () => {
    mockReplies(discovery('v1'), {
      payload: { metadata: { name: 'd1', annotations: { 'grafana.app/folder': 'team-1' } }, spec: {} },
    })
    const res = await call('get_dashboard', { uid: 'd1' }, { config: { baseUrl: nextBase() } })
    await expect(res.json()).resolves.toMatchObject({
      content: { dashboard: { uid: 'd1', folderUid: 'team-1', title: null, namespace: null } },
    })
  })

  it('list_folders:游标从 metadata.continue 取,没有则 null;原始体挂在 raw', async () => {
    mockReplies(discovery('v1'), {
      payload: { metadata: { continue: 'next-token' }, items: [{ metadata: { name: 'f1' }, spec: { title: 'F1' } }] },
    })
    const res = await call('list_folders', {}, { config: { baseUrl: nextBase() } })
    const body = (await res.json()) as { content: { continueToken: null | string, folders: unknown[], raw: unknown } }
    expect(body.content.continueToken).toBe('next-token')
    expect(body.content.folders).toHaveLength(1)
    expect(body.content.raw).toMatchObject({ metadata: { continue: 'next-token' } })

    vi.unstubAllGlobals()
    mockReplies(discovery('v1'), { payload: { items: [] } })
    const empty = await call('list_folders', {}, { config: { baseUrl: nextBase() } })
    await expect(empty.json()).resolves.toMatchObject({ content: { continueToken: null, folders: [] } })
  })

  it('search 结果原样透出并补齐六个常用字段(缺的给 null)', async () => {
    mockReplies({ payload: [{ uid: 'd1', title: 'CPU', tags: ['prod'] }, 'not-an-object'] })
    const res = await call('search_dashboards', {}, { config: { baseUrl: nextBase() } })
    await expect(res.json()).resolves.toEqual({
      content: {
        results: [{
          uid: 'd1',
          title: 'CPU',
          tags: ['prod'],
          id: null,
          type: null,
          url: null,
          isStarred: null,
        }],
        // 非对象项被丢掉,raw 里也只剩对象项。
        raw: [{ uid: 'd1', title: 'CPU', tags: ['prod'] }],
      },
    })
  })

  it('create_data_source:资源包在 datasource 信封里时从里面取,没信封就整个体当资源', async () => {
    mockReplies({ payload: { datasource: { uid: 'ds-1', name: 'Prom', type: 'prometheus' }, id: 3 } })
    const wrapped = await call('create_data_source', { dataSource: { name: 'Prom' } }, {
      config: { baseUrl: nextBase() },
    })
    await expect(wrapped.json()).resolves.toMatchObject({
      content: {
        dataSource: { uid: 'ds-1', name: 'Prom', type: 'prometheus', access: null, isDefault: null },
        raw: { datasource: { uid: 'ds-1', name: 'Prom', type: 'prometheus' }, id: 3 },
      },
    })

    vi.unstubAllGlobals()
    mockReplies({ payload: { uid: 'ds-2', name: 'Loki' } })
    const bare = await call('create_data_source', { dataSource: { name: 'Loki' } }, {
      config: { baseUrl: nextBase() },
    })
    await expect(bare.json()).resolves.toMatchObject({
      content: { dataSource: { uid: 'ds-2', name: 'Loki' } },
    })
  })

  it('get_alert_rule:空响应体归一成空对象,而不是 null', async () => {
    mockReplies({ status: 200, body: null })
    const res = await call('get_alert_rule', { uid: 'r1' }, { config: { baseUrl: nextBase() } })
    await expect(res.json()).resolves.toEqual({ content: { alertRule: {} } })
  })
})

describe('baseUrl 的配置校验', () => {
  it('没配 providerConfig.baseUrl → invalid_argument,消息指向要配什么,且不打上游', async () => {
    const mock = mockReplies({ payload: [] })
    const res = await call('list_data_sources', {}, {})
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('providerConfig.baseUrl')
    expect(mock).not.toHaveBeenCalled()
  })

  it('http 的 baseUrl 被拒(token 走 Authorization 头,明文链路会泄)', async () => {
    const mock = mockReplies({ payload: [] })
    const res = await call('list_data_sources', {}, { config: { baseUrl: 'http://ops.example.com' } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('https')
    expect(mock).not.toHaveBeenCalled()
  })

  it('指向内网的 baseUrl 被出站校验拒下,消息说清"必须公网可达"而不是只报格式', async () => {
    const mock = mockReplies({ payload: [] })
    const res = await call('list_data_sources', {}, { config: { baseUrl: 'https://10.1.2.3:3000' } })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('公网可达')
    expect(mock).not.toHaveBeenCalled()
  })

  it('baseUrl 不是字符串 → invalid_argument', async () => {
    const res = await call('list_data_sources', {}, { config: { baseUrl: 42 } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('必须是字符串')
  })
})

describe('校验与错误', () => {
  it('schema 里 optional、runtime 里必填的字段照样被挡下(uid / dataSource)', async () => {
    const noUid = mockReplies({ payload: {} })
    const res = await call('get_data_source', {}, { config: { baseUrl: nextBase() } })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'uid is required' })
    expect(noUid).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const noBody = mockReplies({ payload: {} })
    const missing = await call('create_data_source', {}, { config: { baseUrl: nextBase() } })
    expect(missing.status).toBe(400)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'dataSource object is required',
    })
    expect(noBody).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:limit 越界 → 400 且不打上游', async () => {
    const mock = mockReplies({ payload: [] })
    const res = await call('search_dashboards', { limit: 99999 }, { config: { baseUrl: nextBase() } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('4xx 按原始状态归一:404 not_found、409 conflict、412 invalid_argument', async () => {
    mockReplies({ status: 404, payload: { message: 'data source not found' } })
    const missing = await call('get_data_source', { uid: 'ds-x' }, { config: { baseUrl: nextBase() } })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'data source not found' })

    vi.unstubAllGlobals()
    mockReplies({ status: 409, payload: { message: 'already exists' } })
    const conflict = await call('create_data_source', { dataSource: { name: 'Prom' } }, {
      config: { baseUrl: nextBase() },
    })
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({ code: 'conflict', message: 'already exists' })

    vi.unstubAllGlobals()
    mockReplies({ status: 412, payload: { message: 'resourceVersion mismatch' } })
    const stale = await call('get_alert_rule', { uid: 'r1' }, { config: { baseUrl: nextBase() } })
    expect(stale.status).toBe(400)
    await expect(stale.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'resourceVersion mismatch',
    })
  })

  it('401 → permission_denied,429 → rate_limited(可重试),5xx → unavailable(可重试)', async () => {
    mockReplies({ status: 401, payload: { message: 'Unauthorized' } })
    const denied = await call('list_data_sources', {}, { config: { baseUrl: nextBase() } })
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({ code: 'permission_denied', message: 'Unauthorized' })

    vi.unstubAllGlobals()
    mockReplies({ status: 429, payload: { message: 'too many requests' } })
    await expect((await call('list_data_sources', {}, { config: { baseUrl: nextBase() } })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockReplies({ status: 503, payload: { message: 'Grafana is down' } })
    await expect((await call('list_data_sources', {}, { config: { baseUrl: nextBase() } })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'Grafana is down' })
  })

  it('错误体不是 JSON 时原文当消息用', async () => {
    mockReplies({ status: 500, body: '<html>proxy error</html>' })
    await expect((await call('list_data_sources', {}, { config: { baseUrl: nextBase() } })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: '<html>proxy error</html>' })
  })

  it('传输层失败归一成 unavailable,而不是冒成 internal 500', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('socket hang up'))))
    const res = await call('list_data_sources', {}, { config: { baseUrl: nextBase() } })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Grafana request failed: socket hang up',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockReplies({ payload: [] })
    const res = await call('list_data_sources', {}, { auth: null, config: { baseUrl: nextBase() } })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
