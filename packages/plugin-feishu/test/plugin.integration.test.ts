import { SELF } from 'cloudflare:test'
import { base64urlEncode, HEADER_TB_UPSTREAM_AUTH } from '@tool-bridge/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSessionCache } from '../src/feishuMcp'
import { clearTatCache } from '../src/tat'

// plugin-feishu 集成测试:契约面 / envelope 鉴权 / 凭证经 X-TB-Upstream-Auth 传入 /
// TAT 换发缓存 / 401 强制重换发 / Allowed-Tools 头透传。飞书换发接口与 MCP 上游全部
// fetch mock,默认离线确定性。测试与 Worker 同 isolate(vitest-pool-workers):可直接清模块级缓存。

const AUTH_URL = 'https://feishu-auth.mock/tat'
const MCP_HOST = 'feishu-mcp.mock'
const PLUGIN_TOKEN = 'tbp_test_token'

/** 平台注入形态:base64url JSON {app_id,app_secret}。 */
function upstreamAuth(appId = 'cli_test_app', appSecret = 'test_secret'): string {
  return base64urlEncode(
    new TextEncoder().encode(JSON.stringify({ app_id: appId, app_secret: appSecret })),
  )
}

/**
 * 飞书侧 mock:换发接口(签发递增 token)+ Streamable HTTP MCP 上游(校验
 * X-Lark-MCP-TAT ∈ 有效集、X-Lark-MCP-Allowed-Tools 非空才宣告工具)。
 * `revokeAllTokens()` 模拟 TAT 被吊销/过期:老 token 请求一律 401。
 */
function feishuMock(tools: Array<{ name: string; description: string }>) {
  const validTokens = new Set<string>()
  const sessions = new Set<string>()
  let tokenSeq = 0
  let sessionSeq = 0
  let authCalls = 0

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))

    if (url.href === AUTH_URL) {
      authCalls += 1
      const body = JSON.parse(String(init?.body)) as { app_id?: string; app_secret?: string }
      // 任意 app_id + 固定 secret 视为有效(多租户用例用不同 app_id)。
      if (!body.app_id || body.app_secret !== 'test_secret') {
        return new Response(JSON.stringify({ code: 10003, msg: 'invalid app credential' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      tokenSeq += 1
      const token = `tat-${body.app_id}-${tokenSeq}`
      validTokens.add(token)
      return new Response(
        JSON.stringify({ code: 0, msg: 'ok', tenant_access_token: token, expire: 7200 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    if (url.host === MCP_HOST) {
      const headers = new Headers(init?.headers)
      const tat = headers.get('X-Lark-MCP-TAT')
      if (tat === null || !validTokens.has(tat)) {
        return new Response('unauthorized', { status: 401 })
      }
      const allowed = (headers.get('X-Lark-MCP-Allowed-Tools') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const body = JSON.parse(String(init?.body)) as {
        id?: number | string
        method: string
        params?: { protocolVersion?: string; name?: string; arguments?: unknown }
      }
      const rpc = (result: unknown, extra: Record<string, string> = {}) =>
        new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
          status: 200,
          headers: { 'content-type': 'application/json', ...extra },
        })
      if (body.method === 'initialize') {
        sessionSeq += 1
        const sid = `sess-${sessionSeq}`
        sessions.add(sid)
        return rpc(
          {
            protocolVersion: body.params?.protocolVersion ?? '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-feishu-mcp', version: '0.0.0' },
          },
          { 'mcp-session-id': sid },
        )
      }
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
      if (body.method === 'tools/list') {
        return rpc({
          tools: tools
            .filter((t) => allowed.includes(t.name))
            .map((t) => ({
              ...t,
              inputSchema: { type: 'object' },
              annotations: { readOnlyHint: t.name.startsWith('fetch') },
            })),
        })
      }
      if (body.method === 'tools/call') {
        return rpc({
          content: [
            {
              type: 'text',
              text: `feishu:${body.params?.name}:${JSON.stringify(body.params?.arguments)}`,
            },
          ],
        })
      }
      return rpc({})
    }

    return new Response('unexpected upstream', { status: 500 })
  })

  return {
    fetchMock,
    authCalls: () => authCalls,
    revokeAllTokens: () => validTokens.clear(),
  }
}

const TOOLS = [
  { name: 'create-doc', description: 'Create a cloud doc' },
  { name: 'fetch-doc', description: 'Fetch a cloud doc' },
  { name: 'search-doc', description: 'UAT only, not in allowlist' },
]

async function envelope(
  tool: string,
  args: Record<string, unknown>,
  init: RequestInit = {},
): Promise<Response> {
  return SELF.fetch('https://plugin.test/', {
    method: 'POST',
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${PLUGIN_TOKEN}`,
      'x-tb-request-id': crypto.randomUUID(),
      [HEADER_TB_UPSTREAM_AUTH]: upstreamAuth(),
      ...(init.headers ?? {}),
    },
    body: JSON.stringify({ tool, arguments: args }),
  })
}

beforeEach(() => {
  clearTatCache()
  clearSessionCache()
})

describe('契约面(生命周期 GET,不鉴权)', () => {
  it('healthz / ~describe / ~help(DSL 与 HelpJson)形状符合 tool-provider/v1', async () => {
    const health = await SELF.fetch('https://plugin.test/healthz')
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ healthy: true })

    const describeRes = await SELF.fetch('https://plugin.test/~describe')
    expect(await describeRes.json()).toEqual({
      kind: 'tool-provider',
      interfaceVersion: 'tool-provider/v1',
    })

    const helpJson = await SELF.fetch('https://plugin.test/~help', {
      headers: { accept: 'application/json' },
    })
    const cmds = ((await helpJson.json()) as { cmds: Array<{ name: string }> }).cmds
    expect(cmds.map((c) => c.name).sort()).toEqual(['Call', 'Get', 'List'])

    const helpDsl = await SELF.fetch('https://plugin.test/~help')
    expect(await helpDsl.text()).toContain('cmd List')
  })
})

describe('envelope 鉴权与凭证传入', () => {
  it('无 / 错 Bearer → 401 TBError 形状', async () => {
    const none = await envelope('List', {}, { headers: { authorization: '' } })
    expect(none.status).toBe(401)
    const bad = await envelope('List', {}, { headers: { authorization: 'Bearer wrong' } })
    expect(bad.status).toBe(401)
    expect(((await bad.json()) as { code: string }).code).toBe('permission_denied')
  })

  it('缺 X-TB-Upstream-Auth → 503(挂载缺 authRef 是配置错误);坏形状 → 400', async () => {
    const upstream = feishuMock(TOOLS)
    vi.stubGlobal('fetch', upstream.fetchMock)

    const missing = await envelope('List', {}, { headers: { [HEADER_TB_UPSTREAM_AUTH]: '' } })
    expect(missing.status).toBe(503)
    expect(((await missing.json()) as { message: string }).message).toContain('authRef')
    expect(upstream.authCalls()).toBe(0) // 缺凭证不打飞书

    const garbage = await envelope(
      'List',
      {},
      { headers: { [HEADER_TB_UPSTREAM_AUTH]: 'not-base64url-json!!!' } },
    )
    expect(garbage.status).toBe(400)
  })
})

describe('List / Get / Call(TAT 自动换发)', () => {
  it('List:换发一次 TAT,白名单头透传上游,ToolSpec 含 effect;二次调用复用缓存不再换发', async () => {
    const upstream = feishuMock(TOOLS)
    vi.stubGlobal('fetch', upstream.fetchMock)

    const first = await envelope('List', {})
    expect(first.status).toBe(200)
    const specs = (await first.json()) as Array<{ name: string; effect?: string }>
    // 白名单 create-doc,fetch-doc(vitest.config)之外的 search-doc 不宣告。
    expect(specs.map((s) => s.name).sort()).toEqual(['create-doc', 'fetch-doc'])
    expect(specs.find((s) => s.name === 'fetch-doc')?.effect).toBe('read')
    expect(upstream.authCalls()).toBe(1)

    const second = await envelope('List', {})
    expect(second.status).toBe(200)
    expect(upstream.authCalls()).toBe(1) // TAT 缓存余量充足,不再换发
  })

  it('Get:按名取 spec;未知名 → 404', async () => {
    const upstream = feishuMock(TOOLS)
    vi.stubGlobal('fetch', upstream.fetchMock)

    const got = await envelope('Get', { name: 'create-doc' })
    expect(got.status).toBe(200)
    expect(((await got.json()) as { name: string }).name).toBe('create-doc')

    const missing = await envelope('Get', { name: 'nope' })
    expect(missing.status).toBe(404)
  })

  it('Call:结果 ToolResult 原样返回;同 X-TB-Request-Id 重放幂等(不重复打上游)', async () => {
    const upstream = feishuMock(TOOLS)
    vi.stubGlobal('fetch', upstream.fetchMock)

    const requestId = crypto.randomUUID()
    const call = await envelope(
      'Call',
      { name: 'create-doc', args: { title: 'T' } },
      { headers: { 'x-tb-request-id': requestId } },
    )
    expect(call.status).toBe(200)
    const result = (await call.json()) as { content: Array<{ text: string }> }
    expect(result.content[0]?.text).toBe('feishu:create-doc:{"title":"T"}')

    const callsBefore = upstream.fetchMock.mock.calls.length
    const replay = await envelope(
      'Call',
      { name: 'create-doc', args: { title: 'T' } },
      { headers: { 'x-tb-request-id': requestId } },
    )
    expect(replay.status).toBe(200)
    expect(upstream.fetchMock.mock.calls.length).toBe(callsBefore) // 重放,零上游请求
  })

  it('TAT 被吊销(上游 401)→ 强制重换发一次后成功;换发计数 +1', async () => {
    const upstream = feishuMock(TOOLS)
    vi.stubGlobal('fetch', upstream.fetchMock)

    expect((await envelope('List', {})).status).toBe(200)
    expect(upstream.authCalls()).toBe(1)

    upstream.revokeAllTokens()

    // 缓存的 TAT 仍在余量内但已被吊销:401 → 强制重换发 → 重试成功。
    const after = await envelope('List', {})
    expect(after.status).toBe(200)
    const specs = (await after.json()) as Array<{ name: string }>
    expect(specs.map((s) => s.name)).toContain('create-doc')
    expect(upstream.authCalls()).toBe(2)
  })

  it('多租户:不同 X-TB-Upstream-Auth 凭证各自换发 TAT,缓存不串号', async () => {
    const upstream = feishuMock(TOOLS)
    vi.stubGlobal('fetch', upstream.fetchMock)

    expect((await envelope('List', {})).status).toBe(200) // app A
    expect(
      (
        await envelope(
          'List',
          {},
          { headers: { [HEADER_TB_UPSTREAM_AUTH]: upstreamAuth('cli_other_app') } },
        )
      ).status,
    ).toBe(200) // app B:不复用 A 的缓存,自己换发
    expect(upstream.authCalls()).toBe(2)

    // 各自二次调用均命中各自缓存,无新增换发。
    expect((await envelope('List', {})).status).toBe(200)
    expect(
      (
        await envelope(
          'List',
          {},
          { headers: { [HEADER_TB_UPSTREAM_AUTH]: upstreamAuth('cli_other_app') } },
        )
      ).status,
    ).toBe(200)
    expect(upstream.authCalls()).toBe(2)
  })
})
