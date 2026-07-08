import { env, SELF } from 'cloudflare:test'
import { MemoryStateStore, parseHelpDsl, SecretStoreImpl, type StateStore } from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMcpProvider } from '../src/providers/mcp'
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
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

async function issueSk(input: unknown): Promise<string> {
  const res = await postJson('system/sk', { tool: 'write', arguments: input }, admin())
  expect(res.status).toBe(200)
  return ((await res.json()) as { secret: string }).secret
}

/** 用 admin 挂一个 http 工具节点。 */
async function mountHttp(path: string, tools: unknown, virtualize?: unknown): Promise<void> {
  const res = await postJson(
    'system/registry',
    {
      tool: 'write',
      arguments: {
        path,
        kind: 'http',
        description: 'http tools',
        config: { kind: 'http', endpoint: 'https://postman-echo.com', tools },
        ...(virtualize !== undefined ? { virtualize } : {}),
      },
    },
    admin(),
  )
  expect(res.status).toBe(200)
}

const HTTP_TOOLS = [
  { name: 'get_thing', description: 'GET a thing', method: 'GET', pathTemplate: '/get' },
  { name: 'post_thing', description: 'POST a thing', method: 'POST', pathTemplate: '/post' },
]

const insecureAllowed =
  (env as { TB_ALLOW_INSECURE_HTTP?: string }).TB_ALLOW_INSECURE_HTTP === 'true'
const secureOnlyIt = insecureAllowed ? it.skip : it

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('http 节点 ~help(从 config 生成、DSL 完整、scope=call)', () => {
  it('~help DSL 列出全部工具 cmd(name/method/scope),effect 由 method 派生', async () => {
    await mountHttp('ext/echo', HTTP_TOOLS)
    const res = await SELF.fetch('https://tb.test/ext/echo/~help', admin())
    expect(res.status).toBe(200)
    const dsl = await res.text()
    const parsed = parseHelpDsl(dsl)
    const byName = new Map(parsed.cmds.map((c) => [c.name, c]))
    expect([...byName.keys()].sort()).toEqual(['get_thing', 'post_thing'])
    for (const c of parsed.cmds) {
      expect(c.method).toBe('POST') // 工具调用形态恒 POST /<path>
      expect(c.path).toBe('/ext/echo')
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
      cmds: Array<{ name: string; scope: string; effect?: string }>
    }
    const get = json.cmds.find((c) => c.name === 'get_thing')
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
    const res = await SELF.fetch('https://tb.test/ext/v/~help', admin())
    const names = parseHelpDsl(await res.text()).cmds.map((c) => c.name)
    expect(names).toContain('shiny')
    expect(names).not.toContain('secret_tool')
    expect(names).not.toContain('real')
  })

  it('call 原名(real)→ 404;call 隐藏名(secret_tool)→ 404(反查前不泄露)', async () => {
    await mountHttp('ext/v2', tools, { hide: ['secret_tool'], rename: { real: 'shiny' } })
    const a = await postJson('ext/v2', { tool: 'real', arguments: {} }, admin())
    expect(a.status).toBe(404)
    const b = await postJson('ext/v2', { tool: 'secret_tool', arguments: {} }, admin())
    expect(b.status).toBe(404)
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
    const denied = await postJson('ext/perm', { tool: 'get_thing', arguments: {} }, { headers: ro })
    expect(denied.status).toBe(403)
    const parent = await SELF.fetch('https://tb.test/ext/~help', {
      headers: { ...ro, accept: 'application/json' },
    })
    expect(parent.status).toBe(200)
    const parentJson = (await parent.json()) as { children?: Array<{ path: string }> }
    expect(parentJson.children?.map((c) => c.path) ?? []).not.toContain('ext/perm')

    // 完全不可见(scope 在别处)。
    const otherSk = await issueSk({
      owner: 'agent:other',
      scopes: [{ pattern: 'other/**', actions: ['read', 'call'] }],
    })
    const other = { authorization: `Bearer ${otherSk}` }
    const invisible = await postJson(
      'ext/perm',
      { tool: 'get_thing', arguments: {} },
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

  it('节点级 ~help 是索引形态:cmd 无 inputSchema,描述附工具级提示', async () => {
    await mountHttp('ext/two-level', SCHEMA_TOOLS)
    const res = await SELF.fetch(
      'https://tb.test/ext/two-level/~help',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      node: { description: string }
      cmds: Array<{ name: string; h?: string; inputSchema?: unknown }>
    }
    const lookup = json.cmds.find((c) => c.name === 'lookup')
    expect(lookup?.h).toBe('查一个东西')
    expect(lookup?.inputSchema).toBeUndefined()
    expect(json.node.description).toContain('GET /ext/two-level/<tool>/~help')
  })

  it('工具级 ~help 返回单工具全量 spec(inputSchema 在,cmd path 指向节点)', async () => {
    await mountHttp('ext/two-level2', SCHEMA_TOOLS)
    const res = await SELF.fetch(
      'https://tb.test/ext/two-level2/lookup/~help',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      node: { path: string; description: string }
      cmds: Array<{ name: string; path: string; inputSchema?: unknown }>
    }
    expect(json.node.path).toBe('ext/two-level2/lookup')
    expect(json.cmds).toHaveLength(1)
    expect(json.cmds[0]?.name).toBe('lookup')
    expect(json.cmds[0]?.path).toBe('/ext/two-level2')
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
    const res = await postJson(
      'system/registry',
      {
        tool: 'write',
        arguments: {
          path: 'srv/insecure',
          kind: 'remote',
          description: 'insecure',
          config: { kind: 'remote', baseUrl: 'http://api.example.com/htbp' },
        },
      },
      admin(),
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
  })

  it('白名单外 baseUrl → 注册被拒(invalid_argument 400)', async () => {
    const res = await postJson(
      'system/registry',
      {
        tool: 'write',
        arguments: {
          path: 'srv/bad',
          kind: 'remote',
          description: 'not allowed',
          config: { kind: 'remote', baseUrl: 'https://api.notallowed.io' },
        },
      },
      admin(),
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
  })

  it('白名单内 baseUrl → 注册成功', async () => {
    const res = await postJson(
      'system/registry',
      {
        tool: 'write',
        arguments: {
          path: 'srv/ok',
          kind: 'remote',
          description: 'allowed',
          config: { kind: 'remote', baseUrl: 'https://api.example.com/htbp' },
        },
      },
      admin(),
    )
    expect(res.status).toBe(200)
  })

  it('入站 X-TB-Via 含自身标识 → ~help 透传前被判环 → 503 unavailable(retryable:false)', async () => {
    await postJson(
      'system/registry',
      {
        tool: 'write',
        arguments: {
          path: 'srv/loop',
          kind: 'remote',
          description: 'loop',
          config: { kind: 'remote', baseUrl: 'https://api.example.com/htbp' },
        },
      },
      admin(),
    )
    // TB_INSTANCE_ID 绑定为 'tb-test-instance';入站链已含它 → 环。
    const res = await SELF.fetch(
      'https://tb.test/srv/loop/~help',
      admin({ headers: { 'x-tb-via': 'tb-test-instance' } }),
    )
    expect(res.status).toBe(503)
    const body = (await res.json()) as { code: string; retryable: boolean }
    expect(body.code).toBe('unavailable')
    expect(body.retryable).toBe(false)
  })

  it('remote 调用不转发本地 SK,仅用 skRef 换发出站 Authorization', async () => {
    const setSecret = await postJson(
      'system/secret',
      { tool: 'set', arguments: { name: 'remote-sk', value: 'tbk_remote_secret' } },
      admin(),
    )
    expect(setSecret.status).toBe(200)
    const registered = await postJson(
      'system/registry',
      {
        tool: 'write',
        arguments: {
          path: 'srv/peer-auth',
          kind: 'remote',
          description: 'peer with skRef',
          config: {
            kind: 'remote',
            baseUrl: 'https://peer.example.com/htbp',
            skRef: 'remote-sk',
          },
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

    const res = await postJson('srv/peer-auth', { tool: 'anything', arguments: { x: 1 } }, admin())
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('根 ~tree 聚合 remote 子树并把远端路径映射到本地挂载前缀', async () => {
    const registered = await postJson(
      'system/registry',
      {
        tool: 'write',
        arguments: {
          path: 'srv/peer-tree',
          kind: 'remote',
          description: 'peer tree',
          config: { kind: 'remote', baseUrl: 'https://peer.example.com/htbp' },
        },
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
        path: string
        children?: Array<{ path: string; children?: Array<{ path: string }> }>
      }>
    }
    const srv = tree.children?.find((n) => n.path === 'srv')
    const peer = srv?.children?.find((n) => n.path === 'srv/peer-tree')
    expect(peer?.children?.map((n) => n.path)).toContain('srv/peer-tree/alpha')
  })
})

/**
 * 极简 Streamable HTTP MCP 上游 mock(有状态会话,JSON 应答面覆盖 SDK client 所需的
 * initialize / notifications/initialized / tools/list)。`expireAll()` 模拟上游空闲回收
 * 会话后的**不合规行为**(实测 MetaMCP):对过期会话不按 spec 回 404,而是当作空会话
 * 正常返回 200 + 空 tools。GET(standalone SSE)不会到达这里——provider 侧已拦成 405。
 */
function mcpUpstreamMock(tools: Array<{ name: string; description: string }>) {
  const sessions = new Set<string>()
  let issued = 0
  let initializeCount = 0
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
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
    if (body.method === 'tools/list') {
      const sid = new Headers(init?.headers).get('mcp-session-id')
      const live = sid !== null && sessions.has(sid)
      return rpc({
        tools: live ? tools.map((t) => ({ ...t, inputSchema: { type: 'object' } })) : [],
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
  return { fetchMock, expireAll: () => sessions.clear(), initializeCalls: () => initializeCount }
}

async function mountMcp(path: string): Promise<void> {
  const res = await postJson(
    'system/registry',
    {
      tool: 'write',
      arguments: {
        path,
        kind: 'mcp',
        description: 'mock mcp',
        config: { kind: 'mcp', url: 'https://mcp-mock.test/mcp' },
      },
    },
    admin(),
  )
  expect(res.status).toBe(200)
}

describe('mcp 会话复用:过期会话空列表防御(默认离线,上游为 fetch mock)', () => {
  it('上游回收会话后回 200+空列表(不合规)→ 清会话重握手一次,工具列表恢复', async () => {
    const upstream = mcpUpstreamMock([{ name: 'echo', description: 'echo back' }])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountMcp('ext/mcp-expiry')

    // 首次 ~help:完整握手 + tools/list,见 echo;会话回填 mcpsession:<path>。
    const first = await SELF.fetch('https://tb.test/ext/mcp-expiry/~help', admin())
    expect(first.status).toBe(200)
    expect(parseHelpDsl(await first.text()).cmds.map((c) => c.name)).toContain('echo')
    expect(upstream.initializeCalls()).toBe(1)

    upstream.expireAll()

    // refresh=1 跳过 toolCache 强制打上游:复用的缓存会话拿到空列表 → 防御生效,
    // 清会话完整重握手(第二次 initialize)后恢复工具列表,而不是把空列表当真。
    const second = await SELF.fetch('https://tb.test/ext/mcp-expiry/~help?refresh=1', admin())
    expect(second.status).toBe(200)
    expect(parseHelpDsl(await second.text()).cmds.map((c) => c.name)).toContain('echo')
    expect(upstream.initializeCalls()).toBe(2)
  })

  it('真空列表上游:完整握手拿到的空列表原样相信;缓存会话空列表只重试一次不循环', async () => {
    const upstream = mcpUpstreamMock([])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountMcp('ext/mcp-empty')

    // 首次:完整握手(非缓存会话)拿到空列表 → 直接相信,不触发重试。
    const first = await SELF.fetch('https://tb.test/ext/mcp-empty/~help', admin())
    expect(first.status).toBe(200)
    expect(parseHelpDsl(await first.text()).cmds).toHaveLength(0)
    expect(upstream.initializeCalls()).toBe(1)

    // 再次(会话未过期):缓存会话拿到空列表 → 恰好一次重握手复核,仍空则相信。
    const second = await SELF.fetch('https://tb.test/ext/mcp-empty/~help?refresh=1', admin())
    expect(second.status).toBe(200)
    expect(parseHelpDsl(await second.text()).cmds).toHaveLength(0)
    expect(upstream.initializeCalls()).toBe(2)
  })

  it('KV 边缘读缓存吞掉 delete(删后 get 仍回旧值)时:重试强制重握手,工具列表仍恢复', async () => {
    const upstream = mcpUpstreamMock([{ name: 'echo', description: 'echo back' }])
    vi.stubGlobal('fetch', upstream.fetchMock)

    // 模拟 Cloudflare KV 边缘读缓存的最坏情况:同请求内刚读过的 key,delete 后 get
    // 在 ≥60s 窗口内仍返回旧值。防御若靠"清缓存后回读"取新会话,必被这层缓存击穿
    // (2026-07-08 生产复发根因)。
    const backing = new MemoryStateStore()
    const staleStore: StateStore = {
      get: (key) => backing.get(key),
      put: (key, value) => backing.put(key, value),
      delete: async () => {},
      list: (prefix, opts) => backing.list(prefix, opts),
    }
    const provider = createMcpProvider(
      { url: 'https://mcp-mock.test/mcp' },
      new SecretStoreImpl(backing, undefined),
      { allowInsecure: false, session: { store: staleStore, nodePath: 'ext/mcp-stale' } },
    )

    // 首次:完整握手,会话回填 staleStore。
    expect((await provider.list()).map((t) => t.name)).toContain('echo')
    expect(upstream.initializeCalls()).toBe(1)

    upstream.expireAll()

    // 复用的死会话拿到空列表 → 防御必须强制重握手恢复;若重试回读会话缓存,
    // 拿回的是删不掉的旧会话,这里将得到空列表。
    expect((await provider.list()).map((t) => t.name)).toContain('echo')
    expect(upstream.initializeCalls()).toBe(2)
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
      const res = await postJson(
        'ext/live',
        { tool: 'get_thing', arguments: { foo: 'bar' } },
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
    const mk = await postJson(
      'system/registry',
      {
        tool: 'write',
        arguments: {
          path: 'ext/mcp',
          kind: 'mcp',
          description: 'echo mcp',
          config: { kind: 'mcp', url: mcpUrl },
        },
      },
      admin(),
    )
    expect(mk.status).toBe(200)

    const help = await SELF.fetch('https://tb.test/ext/mcp/~help', admin())
    expect(help.status).toBe(200)
    const names = parseHelpDsl(await help.text()).cmds.map((c) => c.name)
    expect(names).toContain('echo')

    const call = await postJson(
      'ext/mcp',
      { tool: 'echo', arguments: { text: 'hello-tb' } },
      admin(),
    )
    expect(call.status).toBe(200)
    expect(JSON.stringify(await call.json())).toContain('hello-tb')
  })

  mcpIt('会话复用:两次调用落在同一上游会话(第二次跳过 initialize 握手)', async () => {
    const mk = await postJson(
      'system/registry',
      {
        tool: 'write',
        arguments: {
          path: 'ext/mcp-session',
          kind: 'mcp',
          description: 'echo mcp(session reuse)',
          config: { kind: 'mcp', url: mcpUrl },
        },
      },
      admin(),
    )
    expect(mk.status).toBe(200)

    // echo-mcp 默认有状态:whoami 回显当前会话 id。两次调用同一 id ⇔ 网关复用了
    // mcpsession:<path> 缓存的会话,而不是每次重新握手。
    const whoami = async (): Promise<string> => {
      const res = await postJson('ext/mcp-session', { tool: 'whoami', arguments: {} }, admin())
      expect(res.status).toBe(200)
      return JSON.stringify(await res.json())
    }
    const first = await whoami()
    expect(first).not.toContain('stateless') // 上游确实签发了会话(有状态模式)
    const second = await whoami()
    expect(second).toBe(first)
  })
})
