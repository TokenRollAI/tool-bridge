import { env, SELF } from 'cloudflare:test'
import { parseHelpDsl } from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ADMIN_SK } from './fixtures'

// Phase 2(Tool Layer)集成测试:mcp/http Provider、工具虚拟化、调用点 call 判定、
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

describe('http 节点 ~help(DOD 66/71:从 config 生成、DSL 完整、scope=call)', () => {
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
      expect(c.scope).toBe('call') // DOD 71:scope 声明存在
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

describe('工具虚拟化(DOD 66:hide 不可见、rename 后原名不可调)', () => {
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

describe('调用点 call 判定(DOD 70:无 call → 403;不可见 → 404)', () => {
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

describe('remote 节点(DOD 67/69:白名单、X-TB-Via 环检测)', () => {
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

// opt-in:仅当 TB_TEST_MCP_URL 注入(pnpm echo-mcp 起在 127.0.0.1:39001)时运行真实 mcp E2E。
const mcpUrl = (env as { TB_TEST_MCP_URL?: string }).TB_TEST_MCP_URL
const mcpIt = mcpUrl !== undefined ? it : it.skip
// opt-in:真实外部资源(postman-echo)每轮最多一次;默认离线跳过(沙盒无网络)。
const liveHttp = (env as { TB_TEST_LIVE_HTTP?: string }).TB_TEST_LIVE_HTTP !== undefined
const liveIt = liveHttp ? it : it.skip

describe('http 上游真实调用(DOD 68,opt-in via TB_TEST_LIVE_HTTP)', () => {
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
})
