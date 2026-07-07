import { SELF } from 'cloudflare:test'
import { parseHelpDsl } from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ADMIN_SK } from './fixtures'

// Plugin 面集成测试:system/plugin 注册全流程、envelope 挂载消费、
// Request-Id 重试、health cmd、admin-only。外部 Provider 用 vi.stubGlobal('fetch')
// 在 workerd 内 mock 出站(Q13;先例:tool.integration.test.ts 的 remote 用例)。

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

const ENDPOINT = 'https://plugin.example.test'

function manifest(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    kind: 'context-provider',
    interfaceVersion: 'context-provider/v1',
    endpoint: ENDPOINT,
    auth: { kind: 'platform-token' },
    healthPath: '/healthz',
    enabled: true,
    ...overrides,
  }
}

const CONTEXT_HELP = {
  cmds: ['List', 'Get', 'Update', 'Write', 'Search'].map((name) => ({ name })),
}
const CONTEXT_DESCRIBE = {
  kind: 'context-provider',
  interfaceVersion: 'context-provider/v1',
  capabilities: ['search'],
}
const TOOL_HELP = { cmds: ['List', 'Get', 'Call'].map((name) => ({ name })) }
const TOOL_DESCRIBE = { kind: 'tool-provider', interfaceVersion: 'tool-provider/v1' }

interface SeenEnvelope {
  url: string
  headers: Headers
  body: { tool: string; arguments: Record<string, unknown> }
}

/**
 * stub 外部 Provider:GET healthz/~describe/~help 按 opts 应答;POST(envelope)交给
 * opts.invoke(缺省 501),并把每次 envelope 请求记入 seen。
 */
function stubProvider(opts: {
  healthy?: unknown
  describe?: unknown
  help?: unknown
  invoke?: (seen: SeenEnvelope, n: number) => Response
}): { seen: SeenEnvelope[] } {
  const seen: SeenEnvelope[] = []
  const json = (v: unknown, status = 200): Response =>
    new Response(JSON.stringify(v), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      if (method === 'GET') {
        if (url.endsWith('/healthz')) return json(opts.healthy ?? { healthy: true })
        if (url.endsWith('/~describe')) return json(opts.describe ?? CONTEXT_DESCRIBE)
        if (url.endsWith('/~help')) return json(opts.help ?? CONTEXT_HELP)
        return json({ code: 'not_found', message: 'no such path', retryable: false }, 404)
      }
      const entry: SeenEnvelope = {
        url,
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as SeenEnvelope['body'],
      }
      seen.push(entry)
      if (opts.invoke) return opts.invoke(entry, seen.length)
      return json({ code: 'unavailable', message: 'no invoke stub', retryable: false }, 503)
    }) as unknown as typeof fetch,
  )
  return { seen }
}

async function registerPlugin(m: Record<string, unknown>): Promise<{ pluginToken?: string }> {
  const res = await postJson('system/plugin', { tool: 'write', arguments: m }, admin())
  expect(res.status).toBe(200)
  return (await res.json()) as { pluginToken?: string }
}

async function mountContext(path: string, provider: string): Promise<Response> {
  return postJson(
    'system/registry',
    {
      tool: 'write',
      arguments: {
        path,
        kind: 'context',
        description: 'plugin ctx',
        config: { kind: 'context', provider },
      },
    },
    admin(),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('system/plugin 注册全流程', () => {
  it('write:探活 + 契约校验通过 → PluginRegistration(pluginToken 仅此一次);list/get 不回显', async () => {
    stubProvider({})
    const reg = await registerPlugin(manifest('feishu-docs'))
    expect(reg.pluginToken).toMatch(/^tbk_/)

    const list = await postJson('system/plugin', { tool: 'list', arguments: {} }, admin())
    expect(list.status).toBe(200)
    const page = (await list.json()) as { items: Array<Record<string, unknown>> }
    const item = page.items.find((p) => p.id === 'feishu-docs')
    expect(item).toBeDefined()
    expect(item).not.toHaveProperty('pluginToken')
    expect(item).not.toHaveProperty('tokenSkId')

    const got = await postJson(
      'system/plugin',
      { tool: 'get', arguments: { id: 'feishu-docs' } },
      admin(),
    )
    expect(got.status).toBe(200)
    const gotBody = (await got.json()) as Record<string, unknown>
    expect(gotBody).not.toHaveProperty('pluginToken')
    expect(gotBody).not.toHaveProperty('tokenSkId')
  })

  it('探活失败({healthy:false})→ 503 unavailable 拒注册', async () => {
    stubProvider({ healthy: { healthy: false } })
    const res = await postJson(
      'system/plugin',
      { tool: 'write', arguments: manifest('down-plugin') },
      admin(),
    )
    expect(res.status).toBe(503)
    expect(((await res.json()) as { code: string }).code).toBe('unavailable')
  })

  it('契约缺必需方法(~help 无 Update)→ 400 invalid_argument 拒注册', async () => {
    stubProvider({ help: { cmds: [{ name: 'List' }, { name: 'Get' }, { name: 'Write' }] } })
    const res = await postJson(
      'system/plugin',
      { tool: 'write', arguments: manifest('bad-contract') },
      admin(),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string; message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('Update')
  })

  it('health cmd:按需探活,返回 { id, healthy, checkedAt };不健康如实反映', async () => {
    stubProvider({})
    await registerPlugin(manifest('health-plugin'))

    const up = await postJson(
      'system/plugin',
      { tool: 'health', arguments: { id: 'health-plugin' } },
      admin(),
    )
    expect(up.status).toBe(200)
    const upBody = (await up.json()) as { id: string; healthy: boolean; checkedAt: string }
    expect(upBody.id).toBe('health-plugin')
    expect(upBody.healthy).toBe(true)
    expect(typeof upBody.checkedAt).toBe('string')

    stubProvider({ healthy: { healthy: false } })
    const down = await postJson(
      'system/plugin',
      { tool: 'health', arguments: { id: 'health-plugin' } },
      admin(),
    )
    expect(down.status).toBe(200)
    expect(((await down.json()) as { healthy: boolean }).healthy).toBe(false)
  })

  it('admin-only:read+call 的 SK → 403;不可见的 SK → 404(deny==not_found)', async () => {
    stubProvider({})
    const roSk = await issueSk({
      owner: 'agent:plugin-ro',
      scopes: [{ pattern: 'system/**', actions: ['read', 'call'] }],
    })
    const denied = await postJson(
      'system/plugin',
      { tool: 'list', arguments: {} },
      { headers: { authorization: `Bearer ${roSk}` } },
    )
    expect(denied.status).toBe(403)

    const otherSk = await issueSk({
      owner: 'agent:plugin-other',
      scopes: [{ pattern: 'docs/**', actions: ['read', 'call'] }],
    })
    const invisible = await postJson(
      'system/plugin',
      { tool: 'list', arguments: {} },
      { headers: { authorization: `Bearer ${otherSk}` } },
    )
    expect(invisible.status).toBe(404)
  })

  it('Q15:已引导实例的 system/plugin 节点存在(~help 200 列全 cmd)', async () => {
    const res = await SELF.fetch(
      'https://tb.test/system/plugin/~help',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { cmds: Array<{ name: string; scope: string }> }
    expect(json.cmds.map((c) => c.name).sort()).toEqual([
      'delete',
      'get',
      'health',
      'list',
      'update',
      'write',
    ])
    expect(json.cmds.every((c) => c.scope === 'admin')).toBe(true)
  })
})

describe('plugin-backed context 挂载消费(envelope)', () => {
  it('四动词经树可用:envelope 带 Authorization/X-TB-Context/X-TB-Request-Id,响应原样透传', async () => {
    const { seen } = stubProvider({
      invoke: (entry) => {
        const { tool } = entry.body
        if (tool === 'Get') {
          return new Response(
            JSON.stringify({
              uri: 'node://docs/feishu/x',
              contentType: 'text/markdown',
              version: 'v1',
              updatedAt: '2026-07-07T00:00:00Z',
              metadata: {},
              content: 'hello from plugin',
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        if (tool === 'List' || tool === 'Search') {
          return new Response(JSON.stringify({ items: [] }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        // Write/Update → meta
        return new Response(
          JSON.stringify({
            uri: 'node://docs/feishu/x',
            contentType: 'text/markdown',
            version: 'v2',
            updatedAt: '2026-07-07T00:00:00Z',
            metadata: {},
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      },
    })
    const reg = await registerPlugin(manifest('feishu-live'))
    expect((await mountContext('docs/feishu', 'feishu-live')).status).toBe(200)

    const got = await postJson('docs/feishu', { tool: 'Get', arguments: { path: 'x' } }, admin())
    expect(got.status).toBe(200)
    expect(((await got.json()) as { content: string }).content).toBe('hello from plugin')

    const written = await postJson(
      'docs/feishu',
      {
        tool: 'Write',
        arguments: { path: 'x', entry: { contentType: 'text/markdown', content: 'v' } },
      },
      admin(),
    )
    expect(written.status).toBe(200)

    const updated = await postJson(
      'docs/feishu',
      { tool: 'Update', arguments: { path: 'x', patch: { content: 'v2' } } },
      admin(),
    )
    expect(updated.status).toBe(200)

    const listed = await postJson('docs/feishu', { tool: 'List', arguments: { path: '' } }, admin())
    expect(listed.status).toBe(200)

    // 已声明 capability 的可选方法(Search)可用。
    const searched = await postJson(
      'docs/feishu',
      { tool: 'Search', arguments: { query: 'q' } },
      admin(),
    )
    expect(searched.status).toBe(200)

    // envelope 契约:方法名 + 命名参数;三个 header 齐且 Authorization
    // 是注册时 mint 的 pluginToken(platform-token 语义)。
    expect(seen.length).toBe(5)
    const first = seen[0] as SeenEnvelope
    expect(first.url.startsWith(ENDPOINT)).toBe(true)
    expect(first.body).toEqual({ tool: 'Get', arguments: { path: 'x' } })
    expect(first.headers.get('authorization')).toBe(`Bearer ${reg.pluginToken}`)
    expect(first.headers.get('authorization')).not.toBe(`Bearer ${TEST_ADMIN_SK}`)
    const ctxHeader = first.headers.get('x-tb-context') as string
    expect(ctxHeader).toBeTruthy()
    const decoded = JSON.parse(atob(ctxHeader.replace(/-/g, '+').replace(/_/g, '/'))) as {
      owner: string
      traceId: string
    }
    expect(decoded.owner).toBe('user:admin')
    expect(decoded.traceId).toBeTruthy()
    expect(first.headers.get('x-tb-request-id')).toBeTruthy()
    // 每次逻辑调用 Request-Id 唯一。
    const ids = seen.map((s) => s.headers.get('x-tb-request-id'))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('未声明的可选方法(Delete)→ 400 unknown cmd,永不打到 plugin', async () => {
    const { seen } = stubProvider({})
    await registerPlugin(manifest('feishu-nodelete'))
    expect((await mountContext('docs/nodelete', 'feishu-nodelete')).status).toBe(200)
    const res = await postJson(
      'docs/nodelete',
      { tool: 'Delete', arguments: { path: 'x' } },
      admin(),
    )
    expect(res.status).toBe(400)
    expect(seen.length).toBe(0)
  })

  it('~describe 回 plugin 声明的 capabilities;~help 只列四动词 + Search(Q12)', async () => {
    stubProvider({})
    await registerPlugin(manifest('feishu-caps'))
    expect((await mountContext('docs/caps', 'feishu-caps')).status).toBe(200)

    const describe = await SELF.fetch('https://tb.test/docs/caps/~describe', admin())
    expect(describe.status).toBe(200)
    expect(await describe.json()).toEqual({ kind: 'context', capabilities: ['search'] })

    const help = await SELF.fetch('https://tb.test/docs/caps/~help', admin())
    expect(help.status).toBe(200)
    const names = parseHelpDsl(await help.text())
      .cmds.map((c) => c.name)
      .sort()
    expect(names).toEqual(['Get', 'List', 'Search', 'Update', 'Write'])
  })

  it('retryable 失败重试 1 次且 X-TB-Request-Id 不变(首次 503 → 重试成功)', async () => {
    const { seen } = stubProvider({
      invoke: (_entry, n) =>
        n === 1
          ? new Response(
              JSON.stringify({ code: 'unavailable', message: 'warming up', retryable: true }),
              { status: 503, headers: { 'content-type': 'application/json' } },
            )
          : new Response(JSON.stringify({ items: [] }), {
              headers: { 'content-type': 'application/json' },
            }),
    })
    await registerPlugin(manifest('feishu-retry'))
    expect((await mountContext('docs/retry', 'feishu-retry')).status).toBe(200)

    const res = await postJson('docs/retry', { tool: 'List', arguments: { path: '' } }, admin())
    expect(res.status).toBe(200)
    expect(seen.length).toBe(2)
    expect(seen[0]?.headers.get('x-tb-request-id')).toBe(seen[1]?.headers.get('x-tb-request-id'))
  })

  it('不可重试的 plugin TBError 原样归一透出,不重试', async () => {
    const { seen } = stubProvider({
      invoke: () =>
        new Response(
          JSON.stringify({ code: 'not_found', message: 'entry missing', retryable: false }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        ),
    })
    await registerPlugin(manifest('feishu-notfound'))
    expect((await mountContext('docs/notfound', 'feishu-notfound')).status).toBe(200)
    const res = await postJson(
      'docs/notfound',
      { tool: 'Get', arguments: { path: 'gone' } },
      admin(),
    )
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: string }).code).toBe('not_found')
    expect(seen.length).toBe(1)
  })

  it('挂载未注册/禁用的 plugin → 400 invalid_argument(注册时即拒)', async () => {
    stubProvider({})
    const missing = await mountContext('docs/missing', 'nope-plugin')
    expect(missing.status).toBe(400)

    await registerPlugin(manifest('feishu-disabled'))
    const upd = await postJson(
      'system/plugin',
      { tool: 'update', arguments: { id: 'feishu-disabled', patch: { enabled: false } } },
      admin(),
    )
    expect(upd.status).toBe(200)
    const disabled = await mountContext('docs/disabled', 'feishu-disabled')
    expect(disabled.status).toBe(400)
  })
})

describe("kind:'tool' 挂载消费(tool-provider plugin)", () => {
  const TOOLS = [
    { name: 'create_order', description: '下单', effect: 'write' },
    { name: 'get_order', description: '查单', effect: 'read' },
  ]

  function stubToolProvider(): { seen: SeenEnvelope[] } {
    return stubProvider({
      describe: TOOL_DESCRIBE,
      help: TOOL_HELP,
      invoke: (entry) => {
        if (entry.body.tool === 'List') {
          return new Response(JSON.stringify(TOOLS), {
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ content: { ok: true, echo: entry.body.arguments } }), {
          headers: { 'content-type': 'application/json' },
        })
      },
    })
  }

  async function mountTool(path: string, provider: string): Promise<Response> {
    return postJson(
      'system/registry',
      {
        tool: 'write',
        arguments: {
          path,
          kind: 'tool',
          description: 'plugin tools',
          config: { kind: 'tool', provider },
        },
      },
      admin(),
    )
  }

  it('注册 tool-provider → 挂载 kind:tool → ~help 列工具 → call 经 envelope Call', async () => {
    const { seen } = stubToolProvider()
    await registerPlugin(
      manifest('orders-plugin', {
        kind: 'tool-provider',
        interfaceVersion: 'tool-provider/v1',
      }),
    )
    expect((await mountTool('tools/orders', 'orders-plugin')).status).toBe(200)

    const help = await SELF.fetch('https://tb.test/tools/orders/~help', admin())
    expect(help.status).toBe(200)
    const names = parseHelpDsl(await help.text()).cmds.map((c) => c.name)
    expect(names.sort()).toEqual(['create_order', 'get_order'])

    const call = await postJson(
      'tools/orders',
      { tool: 'create_order', arguments: { sku: 'A1' } },
      admin(),
    )
    expect(call.status).toBe(200)
    expect(((await call.json()) as { echo: { args: { sku: string } } }).echo.args.sku).toBe('A1')

    // envelope 的 tool 是方法名(List/Call),工具名在 arguments.name。
    const callEnvelope = seen.find((s) => s.body.tool === 'Call') as SeenEnvelope
    expect(callEnvelope.body.arguments).toEqual({ name: 'create_order', args: { sku: 'A1' } })
  })

  it('挂载 kind:tool 但 provider 是 context-provider plugin → 400', async () => {
    stubProvider({})
    await registerPlugin(manifest('ctx-only'))
    const res = await mountTool('tools/bad', 'ctx-only')
    expect(res.status).toBe(400)
  })
})
