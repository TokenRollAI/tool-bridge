import { MemoryStateStore, parseHelpDsl, SecretStoreImpl, type StateStore } from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMcpProvider } from '@tool-bridge/app'
import { env, SELF } from 'cloudflare:test'
import { D1StateStore } from '../src/d1StateStore'
import { TEST_ADMIN_SK } from './fixtures'

// Tool Layer 集成测试:mcp/http Provider、工具虚拟化、调用点 call 判定、
// remote 白名单 + X-TB-Via 环检测。上游真实网络仅用于 opt-in / 容错用例;其余用例
// 全部在网络之前分叉(https 强制、虚拟化反查、权限、白名单、环检测),确定性且离线。

const admin = (extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, ...(extra.headers ?? {}) },
})

async function postJson(path: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://tb.test/${path}`, {
    method: 'POST',
    ...init,
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

async function issueSk(input: unknown): Promise<string> {
  const res = await postJson('system/sk/write', input, admin())
  expect(res.status).toBe(200)
  return ((await res.json()) as { secret: string }).secret
}

/** 用 admin 挂一个 http 工具节点。 */
async function mountHttp(path: string, tools: unknown, virtualize?: unknown): Promise<void> {
  const res = await postJson('system/registry/write', {
    path,
    kind: 'http',
    description: 'http tools',
    config: { kind: 'http', endpoint: 'https://postman-echo.com', tools },
    ...(virtualize !== undefined ? { virtualize } : {}),
  },
  admin(),
  )
  expect(res.status).toBe(200)
}

const HTTP_TOOLS = [
  { name: 'get_thing', description: 'GET a thing', method: 'GET', pathTemplate: '/get' },
  { name: 'post_thing', description: 'POST a thing', method: 'POST', pathTemplate: '/post' },
]

const insecureAllowed
  = (env as { TB_ALLOW_INSECURE_HTTP?: string }).TB_ALLOW_INSECURE_HTTP === 'true'
const secureOnlyIt = insecureAllowed ? it.skip : it

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('http 节点 ~help(从 config 生成、DSL 完整、scope=call)', () => {
  it('~help DSL 列出全部工具 cmd(name/method/scope),effect 由 method 派生', async () => {
    await mountHttp('ext/echo', HTTP_TOOLS)
    const res = await SELF.fetch(
      'https://tb.test/ext/echo/~help',
      admin({ headers: { accept: 'text/plain' } }),
    )
    expect(res.status).toBe(200)
    const dsl = await res.text()
    const parsed = parseHelpDsl(dsl)
    const byName = new Map(parsed.cmds.map(c => [c.name, c]))
    expect([...byName.keys()].sort()).toEqual(['get_thing', 'post_thing'])
    for (const c of parsed.cmds) {
      expect(c.method).toBe('POST') // 工具调用形态恒 POST /<node>/<tool> 直连
      expect(c.path).toBe(`/ext/echo/${c.name}`)
      expect(c.scope).toBe('call') // scope 声明存在
    }
    // effect:GET→read、POST→write(HttpToolDef 缺省派生)。
    expect(dsl).toContain('effect read')
    expect(dsl).toContain('effect write')
  })

  it('~help JSON:cmds[].inputSchema/effect 语义等价', async () => {
    await mountHttp('ext/echo2', HTTP_TOOLS)
    const res = await SELF.fetch(
      'https://tb.test/ext/echo2/~help',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      cmds: Array<{ effect?: string, name: string, scope: string }>
    }
    const get = json.cmds.find(c => c.name === 'get_thing')
    expect(get?.scope).toBe('call')
    expect(get?.effect).toBe('read')
  })
})

describe('工具虚拟化(hide 不可见、rename 后原名不可调)', () => {
  const tools = [
    { name: 'secret_tool', description: 'hidden', method: 'GET', pathTemplate: '/get' },
    { name: 'real', description: 'renamed', method: 'GET', pathTemplate: '/get' },
  ]

  it('~help 只见虚拟名(shiny),不见 hidden(secret_tool)与原名(real)', async () => {
    await mountHttp('ext/v', tools, { hide: ['secret_tool'], rename: { real: 'shiny' } })
    const res = await SELF.fetch(
      'https://tb.test/ext/v/~help',
      admin({ headers: { accept: 'text/plain' } }),
    )
    const names = parseHelpDsl(await res.text()).cmds.map(c => c.name)
    expect(names).toContain('shiny')
    expect(names).not.toContain('secret_tool')
    expect(names).not.toContain('real')
  })

  it('call 原名(real)→ 404;call 隐藏名(secret_tool)→ 404(反查前不泄露)', async () => {
    await mountHttp('ext/v2', tools, { hide: ['secret_tool'], rename: { real: 'shiny' } })
    const a = await postJson('ext/v2/real', {}, admin())
    expect(a.status).toBe(404)
    const b = await postJson('ext/v2/secret_tool', {}, admin())
    expect(b.status).toBe(404)
  })
})

/**
 * 极简 Streamable HTTP MCP 上游 mock(2025 系有状态会话,JSON 应答面覆盖 SDK client 所需的
 * server/discover 探测 / initialize / notifications/initialized / tools/list)。未知方法回
 * JSON-RPC `-32601`,这也正是 2025 系上游对 modern 探测的合规回应,客户端据此保守回落。
 *
 * `expireAll()` 模拟上游空闲回收会话后的**不合规行为**(实测 MetaMCP):对过期会话不按
 * spec 回 404,而是当作空会话正常返回 200 + 空 tools。网关自 v2 起不再复用上游会话
 * (见 providers/mcp.ts 文件头),故这里用它验证的是"该情形已污染不到我们",而不再是
 * 迁移前那套失效重试防御。GET(standalone SSE)不会到达这里——provider 侧已拦成 405。
 */
function mcpUpstreamMock(tools: Array<{ description: string, name: string }>) {
  const sessions = new Set<string>()
  let issued = 0
  let initializeCount = 0
  let discoverCount = 0
  const headersSeen: Headers[] = []
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    headersSeen.push(new Headers(init?.headers))
    const body = JSON.parse(String(init?.body)) as {
      id?: number | string
      method: string
      params?: { protocolVersion?: string }
    }
    const rpc = (result: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
        status: 200,
        headers: { 'content-type': 'application/json', ...headers },
      })

    if (body.method === 'initialize') {
      initializeCount += 1
      issued += 1
      const sid = `sess-${issued}`
      sessions.add(sid)
      return rpc(
        {
          protocolVersion: body.params?.protocolVersion ?? '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-mcp', version: '0.0.0' },
        },
        { 'mcp-session-id': sid },
      )
    }
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    // 2025 系上游对 2026-07-28 的 server/discover 探测的合规回应:JSON-RPC -32601。
    // 客户端据此保守回落 initialize(实测 -32601 与 HTTP 400/404/405 都能正确回落)。
    if (body.method === 'server/discover') discoverCount += 1
    if (body.method === 'tools/list') {
      const sid = new Headers(init?.headers).get('mcp-session-id')
      const live = sid !== null && sessions.has(sid)
      return rpc({
        tools: live ? tools.map(t => ({ ...t, inputSchema: { type: 'object' } })) : [],
      })
    }
    if (body.method === 'tools/call') {
      const params = (body as { params?: { arguments?: unknown, name?: string } }).params
      return rpc({
        content: [
          { type: 'text', text: `called:${params?.name}:${JSON.stringify(params?.arguments)}` },
        ],
      })
    }
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: `unknown method ${body.method}` },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  })
  return {
    fetchMock,
    expireAll: () => sessions.clear(),
    initializeCalls: () => initializeCount,
    discoverCalls: () => discoverCount,
    headersSeen: () => headersSeen,
  }
}

async function mountMcp(path: string): Promise<void> {
  const res = await postJson('system/registry/write', {
    path,
    kind: 'mcp',
    description: 'mock mcp',
    config: { kind: 'mcp', url: 'https://mcp-mock.test/mcp' },
  },
  admin(),
  )
  expect(res.status).toBe(200)
}

describe('tool cache → SearchIndex 自动同步', () => {
  it('MCP 注册成功即 materialize tools/list，无需先访问 ~help 即可根搜索', async () => {
    const upstream = mcpUpstreamMock([
      { name: 'cache_search_probe', description: 'uniquecacheprobe tool' },
    ])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountMcp('ext/search-cache-sync')

    const response = await SELF.fetch('https://tb.test/~search', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${TEST_ADMIN_SK}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: 'uniquecacheprobe' }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [{
        path: 'ext/search-cache-sync',
        tool: {
          name: 'cache_search_probe',
          description: 'uniquecacheprobe tool',
          inputSchema: { type: 'object' },
        },
      }],
    })
    const dirty = await new D1StateStore((env as { TB_STATE: D1Database }).TB_STATE)
      .list('searchdirty:')
    expect(dirty.items.filter(item => (
      (item.value as { path?: unknown }).path === 'ext/search-cache-sync'
    ))).toEqual([])
  })

  it('indexes a Feishu-sized MCP catalog while returning complete canonical ToolSpecs', async () => {
    const description = `feishucatalogunique ${'长描述'.repeat(2_000)}`
    const tools = Array.from({ length: 8 }, (_, index) => ({
      name: `feishu_large_probe_${index}`,
      description,
    }))
    const upstream = mcpUpstreamMock(tools)
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountMcp('ext/search-large-cache')

    const response = await SELF.fetch('https://tb.test/~search', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${TEST_ADMIN_SK}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: 'feishucatalogunique', opts: { limit: 20 } }),
    })
    expect(response.status).toBe(200)
    const page = await response.json() as {
      items: Array<{ path: string, tool: { description?: string, name: string } }>
    }
    expect(page.items).toHaveLength(8)
    expect(page.items[0]).toMatchObject({
      path: 'ext/search-large-cache',
      tool: { description, name: 'feishu_large_probe_0' },
    })
  })
})

describe('直连工具调用(POST /<node>/<tool>,body 即 arguments)', () => {
  it('mcp 节点:直连调用命中工具,body 扁平传参;空 body 视为无参', async () => {
    const upstream = mcpUpstreamMock([{ name: 'echo', description: 'echo back' }])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountMcp('ext/direct')

    const res = await postJson('ext/direct/echo', { text: 'hi' }, admin())
    expect(res.status).toBe(200)
    expect(await res.json()).toBe('called:echo:{"text":"hi"}')

    // 空 body → arguments {}。
    const empty = await SELF.fetch('https://tb.test/ext/direct/echo', {
      method: 'POST',
      ...admin({ headers: { accept: 'application/json' } }),
    })
    expect(empty.status).toBe(200)
  })

  it('节点本身不可调用:POST /<node> + {tool,arguments} 不作为兼容入口', async () => {
    const upstream = mcpUpstreamMock([{ name: 'echo', description: 'echo back' }])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountMcp('ext/direct-legacy')

    const res = await postJson(
      'ext/direct-legacy',
      { tool: 'echo', arguments: { text: 'hi' } },
      admin(),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'not_found' })
  })

  it('直连虚拟化:rename 后新名可直连、原名与 hidden 404;未知工具 404', async () => {
    const upstream = mcpUpstreamMock([
      { name: 'real', description: 'renamed' },
      { name: 'secret_tool', description: 'hidden' },
    ])
    vi.stubGlobal('fetch', upstream.fetchMock)
    const res = await postJson('system/registry/write', {
      path: 'ext/direct-v',
      kind: 'mcp',
      description: 'mock mcp',
      config: { kind: 'mcp', url: 'https://mcp-mock.test/mcp' },
      virtualize: { hide: ['secret_tool'], rename: { real: 'shiny' } },
    },
    admin(),
    )
    expect(res.status).toBe(200)

    const ok = await postJson('ext/direct-v/shiny', {}, admin())
    expect(ok.status).toBe(200)
    expect(await ok.text()).toContain('called:real:') // 虚拟名反查上游真名

    for (const name of ['real', 'secret_tool', 'nope']) {
      const r = await postJson(`ext/direct-v/${name}`, {}, admin())
      expect(r.status).toBe(404)
    }
  })

  it('直连 body 非对象(数组/字符串)→ 400 invalid_argument', async () => {
    const upstream = mcpUpstreamMock([{ name: 'echo', description: 'echo back' }])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountMcp('ext/direct-bad')

    const arr = await postJson('ext/direct-bad/echo', [1, 2], admin())
    expect(arr.status).toBe(400)
    const str = await postJson('ext/direct-bad/echo', 'oops', admin())
    expect(str.status).toBe(400)
  })

  it('直连权限:read-only SK → 403;无关 SK → 404(不泄露);多余路径段 → 404', async () => {
    const upstream = mcpUpstreamMock([{ name: 'echo', description: 'echo back' }])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountMcp('ext/direct-perm')

    const roSk = await issueSk({
      owner: 'agent:ro-direct',
      scopes: [{ pattern: 'ext/**', actions: ['read'] }],
    })
    const denied = await postJson(
      'ext/direct-perm/echo',
      {},
      { headers: { authorization: `Bearer ${roSk}` } },
    )
    expect(denied.status).toBe(403)

    const otherSk = await issueSk({
      owner: 'agent:other-direct',
      scopes: [{ pattern: 'other/**', actions: ['read', 'call'] }],
    })
    const invisible = await postJson(
      'ext/direct-perm/echo',
      {},
      { headers: { authorization: `Bearer ${otherSk}` } },
    )
    expect(invisible.status).toBe(404)

    const deep = await postJson('ext/direct-perm/echo/extra', {}, admin())
    expect(deep.status).toBe(404)
  })
})

describe('调用点 call 判定(无 call → 403;不可见 → 404)', () => {
  it('可见但无 call 的 SK → POST 403;不可见的 SK → POST 404 且 ~help 404', async () => {
    await mountHttp('ext/perm', HTTP_TOOLS)

    // 可见(read)但无 call。
    const roSk = await issueSk({
      owner: 'agent:ro',
      scopes: [{ pattern: 'ext/**', actions: ['read'] }],
    })
    const ro = { authorization: `Bearer ${roSk}` }
    const denied = await postJson('ext/perm/get_thing', {}, { headers: ro })
    expect(denied.status).toBe(403)
    const parent = await SELF.fetch('https://tb.test/ext/~help', {
      headers: { ...ro, accept: 'application/json' },
    })
    expect(parent.status).toBe(200)
    const parentJson = (await parent.json()) as { children?: Array<{ path: string }> }
    expect(parentJson.children?.map(c => c.path) ?? []).not.toContain('ext/perm')

    // 完全不可见(scope 在别处)。
    const otherSk = await issueSk({
      owner: 'agent:other',
      scopes: [{ pattern: 'other/**', actions: ['read', 'call'] }],
    })
    const other = { authorization: `Bearer ${otherSk}` }
    const invisible = await postJson('ext/perm/get_thing', {},
      { headers: other },
    )
    expect(invisible.status).toBe(404)
    const help = await SELF.fetch('https://tb.test/ext/perm/~help', { headers: other })
    expect(help.status).toBe(404)
  })
})

describe('两级披露(节点级索引 + 工具级全量)', () => {
  const SCHEMA_TOOLS = [
    {
      name: 'lookup',
      description: '查一个东西',
      method: 'GET',
      pathTemplate: '/get',
      inputSchema: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } },
    },
    { name: 'other', description: '另一个', method: 'GET', pathTemplate: '/get' },
  ]

  it('节点级 ~help 是索引形态:cmd 无 inputSchema,工具级下钻指引在 hint 字段', async () => {
    await mountHttp('ext/two-level', SCHEMA_TOOLS)
    const res = await SELF.fetch(
      'https://tb.test/ext/two-level/~help',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      cmds: Array<{ h?: string, inputSchema?: unknown, name: string }>
      hint?: string
      node: { description: string }
    }
    const lookup = json.cmds.find(c => c.name === 'lookup')
    expect(lookup?.h).toBe('查一个东西')
    expect(lookup?.inputSchema).toBeUndefined()
    expect(json.hint).toContain('GET /ext/two-level/<tool>/~help')
  })

  it('工具级 ~help 返回单工具全量 spec(inputSchema 在,cmd path 指向节点)', async () => {
    await mountHttp('ext/two-level2', SCHEMA_TOOLS)
    const res = await SELF.fetch(
      'https://tb.test/ext/two-level2/lookup/~help',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      cmds: Array<{ inputSchema?: unknown, name: string, path: string }>
      node: { description: string, path: string }
    }
    expect(json.node.path).toBe('ext/two-level2/lookup')
    expect(json.cmds).toHaveLength(1)
    expect(json.cmds[0]?.name).toBe('lookup')
    expect(json.cmds[0]?.path).toBe('/ext/two-level2/lookup')
    expect(json.cmds[0]?.inputSchema).toEqual(SCHEMA_TOOLS[0]?.inputSchema)
  })

  it('工具级 ~help 尊重虚拟化:虚拟名可查,hidden/原名 404', async () => {
    await mountHttp('ext/two-level3', SCHEMA_TOOLS, {
      hide: ['other'],
      rename: { lookup: 'shiny-lookup' },
    })
    const virtual = await SELF.fetch('https://tb.test/ext/two-level3/shiny-lookup/~help', admin())
    expect(virtual.status).toBe(200)
    const original = await SELF.fetch('https://tb.test/ext/two-level3/lookup/~help', admin())
    expect(original.status).toBe(404)
    const hidden = await SELF.fetch('https://tb.test/ext/two-level3/other/~help', admin())
    expect(hidden.status).toBe(404)
  })

  it('不存在的工具名 → 404;深于一段的子路径 → 404', async () => {
    await mountHttp('ext/two-level4', SCHEMA_TOOLS)
    const missing = await SELF.fetch('https://tb.test/ext/two-level4/nope/~help', admin())
    expect(missing.status).toBe(404)
    const deep = await SELF.fetch('https://tb.test/ext/two-level4/lookup/extra/~help', admin())
    expect(deep.status).toBe(404)
  })

  it('无 call 权限的 SK:工具级 ~help 一律 404(不泄露存在性)', async () => {
    await mountHttp('ext/two-level5', SCHEMA_TOOLS)
    const roSk = await issueSk({
      owner: 'agent:ro-tool-help',
      scopes: [{ pattern: 'ext/**', actions: ['read'] }],
    })
    const res = await SELF.fetch('https://tb.test/ext/two-level5/lookup/~help', {
      headers: { authorization: `Bearer ${roSk}` },
    })
    expect(res.status).toBe(404)
  })
})

describe('remote 节点(白名单、X-TB-Via 环检测)', () => {
  secureOnlyIt('http:// baseUrl 默认被拒(即使 host 在白名单内)', async () => {
    const res = await postJson('system/registry/write', {
      path: 'srv/insecure',
      kind: 'remote',
      description: 'insecure',
      config: { kind: 'remote', baseUrl: 'http://api.example.com/htbp' },
    },
    admin(),
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
  })

  it('白名单外 baseUrl → 注册被拒(invalid_argument 400)', async () => {
    const res = await postJson('system/registry/write', {
      path: 'srv/bad',
      kind: 'remote',
      description: 'not allowed',
      config: { kind: 'remote', baseUrl: 'https://api.notallowed.io' },
    },
    admin(),
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
  })

  it('白名单内 baseUrl → 注册成功', async () => {
    const res = await postJson('system/registry/write', {
      path: 'srv/ok',
      kind: 'remote',
      description: 'allowed',
      config: { kind: 'remote', baseUrl: 'https://api.example.com/htbp' },
    },
    admin(),
    )
    expect(res.status).toBe(200)
  })

  it('入站 X-TB-Via 含自身标识 → ~help 透传前被判环 → 503 unavailable(retryable:false)', async () => {
    await postJson('system/registry/write', {
      path: 'srv/loop',
      kind: 'remote',
      description: 'loop',
      config: { kind: 'remote', baseUrl: 'https://api.example.com/htbp' },
    },
    admin(),
    )
    // TB_INSTANCE_ID 绑定为 'tb-test-instance';入站链已含它 → 环。
    const res = await SELF.fetch(
      'https://tb.test/srv/loop/~help',
      admin({ headers: { 'x-tb-via': 'tb-test-instance' } }),
    )
    expect(res.status).toBe(503)
    const body = (await res.json()) as { code: string, retryable: boolean }
    expect(body.code).toBe('unavailable')
    expect(body.retryable).toBe(false)
  })

  it('remote 调用不转发本地 SK,仅用 skRef 换发出站 Authorization', async () => {
    const setSecret = await postJson('system/secret/set', { name: 'remote-sk', value: 'tbk_remote_secret' },
      admin(),
    )
    expect(setSecret.status).toBe(200)
    const registered = await postJson('system/registry/write', {
      path: 'srv/peer-auth',
      kind: 'remote',
      description: 'peer with skRef',
      config: {
        kind: 'remote',
        baseUrl: 'https://peer.example.com/htbp',
        skRef: 'remote-sk',
      },
    },
    admin(),
    )
    expect(registered.status).toBe(200)

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer tbk_remote_secret')
      expect(headers.get('authorization')).not.toBe(`Bearer ${TEST_ADMIN_SK}`)
      expect(headers.get('x-tb-via')).toBe('tb-test-instance')
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const auditLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    const res = await postJson('srv/peer-auth/anything', { x: 1 }, admin())
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const event = auditLog.mock.calls
      .map(([line]) => {
        try {
          return JSON.parse(String(line)) as Record<string, unknown>
        } catch {
          return null
        }
      })
      .find(item => item?.event === 'remote_skref_proxy')
    expect(event).toMatchObject({
      actorOwner: 'user:admin',
      method: 'POST',
      nodePath: 'srv/peer-auth',
      skRef: 'remote-sk',
      target: 'https://peer.example.com/htbp/anything',
    })
    expect(event?.actorKeyId).toEqual(expect.any(String))
    expect(event?.traceId).toEqual(expect.any(String))
    auditLog.mockRestore()
  })

  it('根 ~tree 聚合 remote 子树并把远端路径映射到本地挂载前缀', async () => {
    const registered = await postJson('system/registry/write', {
      path: 'srv/peer-tree',
      kind: 'remote',
      description: 'peer tree',
      config: { kind: 'remote', baseUrl: 'https://peer.example.com/htbp' },
    },
    admin(),
    )
    expect(registered.status).toBe(200)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/alpha/~tree')) {
          return new Response(
            JSON.stringify({ path: 'alpha', kind: 'http', description: 'remote alpha' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(
          JSON.stringify({
            path: '',
            kind: 'directory',
            description: 'remote root',
            children: [{ path: 'alpha', kind: 'http', description: 'remote alpha' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }) as unknown as typeof fetch,
    )

    const res = await SELF.fetch(
      'https://tb.test/~tree?depth=4',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(res.status).toBe(200)
    const tree = (await res.json()) as {
      children?: Array<{
        children?: Array<{ children?: Array<{ path: string }>, path: string }>
        path: string
      }>
    }
    const srv = tree.children?.find(n => n.path === 'srv')
    const peer = srv?.children?.find(n => n.path === 'srv/peer-tree')
    expect(peer?.children?.map(n => n.path)).toContain('srv/peer-tree/alpha')
  })
})

/**
 * v2 起网关**不再复用上游会话**(providers/mcp.ts 文件头有取证:跳过握手会让客户端
 * 不知道服务端能力,`listTools()` 被能力门挡下静默回空且零网络请求)。因此原先那组
 * "过期会话空列表防御"用例的前提已不存在——它们会因为"每请求都完整握手"而恰好通过,
 * 变成空过的绿灯。这里改成断言**新契约**。
 */
describe('mcp era 判定与无会话复用(默认离线,上游为 fetch mock)', () => {
  it('不复用会话:上游回收全部会话也污染不到工具列表(每趟都重新握手)', async () => {
    const upstream = mcpUpstreamMock([{ name: 'echo', description: 'echo back' }])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountMcp('ext/mcp-expiry')

    const first = await SELF.fetch(
      'https://tb.test/ext/mcp-expiry/~help',
      admin({ headers: { accept: 'text/plain' } }),
    )
    expect(first.status).toBe(200)
    expect(parseHelpDsl(await first.text()).cmds.map(c => c.name)).toContain('echo')
    expect(upstream.initializeCalls()).toBe(1)

    // 上游回收全部会话。迁移前这会让复用旧会话的下一趟拿到 200+空列表(不合规上游的
    // 无信号失效),需要专门的防御;现在我们压根不带旧会话,该情形结构上不可能发生。
    upstream.expireAll()

    const second = await SELF.fetch(
      'https://tb.test/ext/mcp-expiry/~help?refresh=1',
      admin({ headers: { accept: 'text/plain' } }),
    )
    expect(second.status).toBe(200)
    expect(parseHelpDsl(await second.text()).cmds.map(c => c.name)).toContain('echo')
    // 第二趟是又一次完整握手(而非复用会话 + 失效重试),故恰好 2 次。
    expect(upstream.initializeCalls()).toBe(2)
  })

  it('真空列表上游:空列表原样相信,不触发重试', async () => {
    const upstream = mcpUpstreamMock([])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountMcp('ext/mcp-empty')

    const first = await SELF.fetch(
      'https://tb.test/ext/mcp-empty/~help',
      admin({ headers: { accept: 'text/plain' } }),
    )
    expect(first.status).toBe(200)
    expect(parseHelpDsl(await first.text()).cmds).toHaveLength(0)
    // 每次请求恰好一次握手:没有"空列表 → 再试一次"的额外往返了。
    expect(upstream.initializeCalls()).toBe(1)

    const second = await SELF.fetch(
      'https://tb.test/ext/mcp-empty/~help?refresh=1',
      admin({ headers: { accept: 'text/plain' } }),
    )
    expect(second.status).toBe(200)
    expect(parseHelpDsl(await second.text()).cmds).toHaveLength(0)
    expect(upstream.initializeCalls()).toBe(2)
  })

  it('era 判定按节点缓存:只在首趟探测 server/discover,时限内后续请求不再重探', async () => {
    const upstream = mcpUpstreamMock([{ name: 'echo', description: 'echo back' }])
    vi.stubGlobal('fetch', upstream.fetchMock)

    const backing = new MemoryStateStore()
    const provider = createMcpProvider(
      { url: 'https://mcp-mock.test/mcp' },
      new SecretStoreImpl(backing, undefined),
      { allowInsecure: false, session: { store: backing, nodePath: 'ext/mcp-era' } },
    )

    // 首趟:mode:'auto' 探测 server/discover,上游回 -32601 → 保守回落 legacy 并记住判定。
    expect((await provider.list()).map(t => t.name)).toContain('echo')
    expect(upstream.discoverCalls()).toBe(1)
    expect(upstream.initializeCalls()).toBe(1)

    // 第二趟:命中缓存的 legacy 判定 → 跳过探测(prior:legacy),但仍完整握手。
    expect((await provider.list()).map(t => t.name)).toContain('echo')
    expect(upstream.discoverCalls()).toBe(1)
    expect(upstream.initializeCalls()).toBe(2)
  })

  it('era 判定缓存不可用(store 的 delete 被吞)时仍不影响正确性', async () => {
    const upstream = mcpUpstreamMock([{ name: 'echo', description: 'echo back' }])
    vi.stubGlobal('fetch', upstream.fetchMock)

    // Cloudflare KV 边缘读缓存的最坏情况:delete 无效、刚删的 key 仍回旧值
    // (2026-07-08 生产复发根因)。判定作废后的重探路径**不回读缓存**,故不受影响。
    const backing = new MemoryStateStore()
    const staleStore: StateStore = {
      get: key => backing.get(key),
      getMany: keys => backing.getMany(keys),
      put: (key, value) => backing.put(key, value),
      delete: async () => {},
      list: (prefix, opts) => backing.list(prefix, opts),
    }
    const provider = createMcpProvider(
      { url: 'https://mcp-mock.test/mcp' },
      new SecretStoreImpl(backing, undefined),
      { allowInsecure: false, session: { store: staleStore, nodePath: 'ext/mcp-stale' } },
    )

    expect((await provider.list()).map(t => t.name)).toContain('echo')
    upstream.expireAll()
    expect((await provider.list()).map(t => t.name)).toContain('echo')
    expect(upstream.initializeCalls()).toBe(2)
  })
})

describe('mcp 自定义请求头(飞书形态:凭证进自定义头 + 静态白名单头)', () => {
  it('authHeader + 空 authScheme 原样注入凭证;静态 headers 随每趟上游请求发出', async () => {
    const upstream = mcpUpstreamMock([{ name: 'search-doc', description: 'search cloud docs' }])
    vi.stubGlobal('fetch', upstream.fetchMock)

    const setSecret = await postJson('system/secret/set', { name: 'lark-tat', value: 't-tat-secret' },
      admin(),
    )
    expect(setSecret.status).toBe(200)
    const mounted = await postJson('system/registry/write', {
      path: 'ext/lark',
      kind: 'mcp',
      description: 'feishu mcp',
      config: {
        kind: 'mcp',
        url: 'https://mcp-mock.test/mcp',
        authRef: 'lark-tat',
        authHeader: 'X-Lark-MCP-TAT',
        authScheme: '',
        headers: { 'X-Lark-MCP-Allowed-Tools': 'search-doc,fetch-doc' },
      },
    },
    admin(),
    )
    expect(mounted.status).toBe(200)

    const help = await SELF.fetch(
      'https://tb.test/ext/lark/~help',
      admin({ headers: { accept: 'text/plain' } }),
    )
    expect(help.status).toBe(200)
    expect(parseHelpDsl(await help.text()).cmds.map(c => c.name)).toContain('search-doc')

    // initialize / notifications/initialized / tools/list 每趟都须带两个头;
    // 空 scheme = 凭证原样注入(无 "Bearer " 前缀),且不再发默认 Authorization。
    const seen = upstream.headersSeen()
    expect(seen.length).toBeGreaterThan(0)
    for (const h of seen) {
      expect(h.get('X-Lark-MCP-TAT')).toBe('t-tat-secret')
      expect(h.get('X-Lark-MCP-Allowed-Tools')).toBe('search-doc,fetch-doc')
      expect(h.get('Authorization')).toBeNull()
    }
  })
})

// opt-in:仅当 TB_TEST_MCP_URL 注入(pnpm echo-mcp 起在 127.0.0.1:39001)时运行真实 mcp E2E。
const mcpUrl = (env as { TB_TEST_MCP_URL?: string }).TB_TEST_MCP_URL
const mcpIt = mcpUrl !== undefined ? it : it.skip
// opt-in:真实外部资源(postman-echo)每轮最多一次;默认离线跳过(沙盒无网络)。
const liveHttp = (env as { TB_TEST_LIVE_HTTP?: string }).TB_TEST_LIVE_HTTP !== undefined
const liveIt = liveHttp ? it : it.skip

describe('http 上游真实调用(opt-in via TB_TEST_LIVE_HTTP)', () => {
  liveIt(
    'POST get_thing → postman-echo 回显 query',
    async () => {
      await mountHttp('ext/live', HTTP_TOOLS)
      const res = await postJson('ext/live/get_thing', { foo: 'bar' },
        admin(),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { args?: Record<string, string> }
      expect(body.args?.foo).toBe('bar')
    },
    15000,
  )
})

describe('mcp 真实上游 E2E(opt-in via TB_TEST_MCP_URL)', () => {
  mcpIt('mount mcp → ~help 见 echo 工具 → call echo 回显', async () => {
    const mk = await postJson('system/registry/write', {
      path: 'ext/mcp',
      kind: 'mcp',
      description: 'echo mcp',
      config: { kind: 'mcp', url: mcpUrl },
    },
    admin(),
    )
    expect(mk.status).toBe(200)

    const help = await SELF.fetch(
      'https://tb.test/ext/mcp/~help',
      admin({ headers: { accept: 'text/plain' } }),
    )
    expect(help.status).toBe(200)
    const names = parseHelpDsl(await help.text()).cmds.map(c => c.name)
    expect(names).toContain('echo')

    const call = await postJson('ext/mcp/echo', { text: 'hello-tb' },
      admin(),
    )
    expect(call.status).toBe(200)
    expect(JSON.stringify(await call.json())).toContain('hello-tb')
  })

  mcpIt('era 协商:连真实 echo-mcp 上游,whoami 回报协商到的 era 且两次一致', async () => {
    const mk = await postJson('system/registry/write', {
      path: 'ext/mcp-session',
      kind: 'mcp',
      description: 'echo mcp(era negotiation)',
      config: { kind: 'mcp', url: mcpUrl },
    },
    admin(),
    )
    expect(mk.status).toBe(200)

    // echo-mcp 的 whoami 回显本次连接的协议 era。迁移前这里断言的是「两次调用落在同一
    // 上游会话」——v2 起网关不再复用会话(见 providers/mcp.ts 文件头),该契约已不存在。
    // 现在断言的是 era 协商结果稳定:同一节点两次调用协商到同一个 era(第二次走
    // mcpera:<path> 缓存的判定,不重探 server/discover)。
    const whoami = async (): Promise<string> => {
      const res = await postJson('ext/mcp-session/whoami', {}, admin())
      expect(res.status).toBe(200)
      return JSON.stringify(await res.json())
    }
    const first = await whoami()
    expect(first).toMatch(/modern|legacy/)
    const second = await whoami()
    expect(second).toBe(first)
  })
})

describe('system/federation 运行时白名单(env 基线 ∪ 运行时叠加)', () => {
  const mountRemote = (path: string, host: string): Promise<Response> =>
    postJson('system/registry/write', {
      path,
      kind: 'remote',
      description: 'runtime allowlisted',
      config: { kind: 'remote', baseUrl: `https://${host}/htbp` },
    },
    admin(),
    )

  it('运行时 add 后,原本白名单外的 baseUrl 可挂载', async () => {
    // env 基线只含 example.com;api.newpeer.io 初始被拒。
    const before = await mountRemote('srv/rt-before', 'api.newpeer.io')
    expect(before.status).toBe(400)
    expect(((await before.json()) as { code: string }).code).toBe('invalid_argument')

    const add = await postJson('system/federation/add', { host: 'newpeer.io' },
      admin(),
    )
    expect(add.status).toBe(200)

    // 叠加生效后,后缀匹配 newpeer.io 的 host 放行(env base ∪ 运行时)。
    const after = await mountRemote('srv/rt-after', 'api.newpeer.io')
    expect(after.status).toBe(200)
  })

  it('list 合并视图:env 基线不可删、运行时条目可删;remove env 基线 → 400', async () => {
    await postJson('system/federation/add', { host: 'newpeer.io' }, admin())

    const listRes = await postJson('system/federation/list', {}, admin())
    expect(listRes.status).toBe(200)
    const items = (
      (await listRes.json()) as {
        items: Array<{ host: string, removable: boolean, source: string }>
      }
    ).items
    expect(items).toContainEqual({ host: 'example.com', source: 'env', removable: false })
    expect(items).toContainEqual(
      expect.objectContaining({ host: 'newpeer.io', source: 'store', removable: true }),
    )

    // env 基线条目不可经管理面删除(须改 TB_REMOTE_ALLOWLIST 重新部署)。
    const rm = await postJson('system/federation/remove', { host: 'example.com' },
      admin(),
    )
    expect(rm.status).toBe(400)
    expect(((await rm.json()) as { code: string }).code).toBe('invalid_argument')
  })

  it('非 admin SK 调 system/federation → 权限拒绝(白名单是 SSRF 闸门)', async () => {
    // 只读 SK:无 admin scope。
    const roSk = await issueSk({
      owner: 'agent:ro',
      scopes: [{ pattern: '**', actions: ['read'] }],
    })
    const res = await postJson('system/federation/add', { host: 'evil.io' },
      { headers: { authorization: `Bearer ${roSk}` } },
    )
    expect(res.status).toBe(403)
  })
})
