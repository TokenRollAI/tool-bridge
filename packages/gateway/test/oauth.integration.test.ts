import { SELF } from 'cloudflare:test'
import { parseHelpDsl } from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ADMIN_SK } from './fixtures'

// mcp 托管 OAuth 全链路(默认离线,上游为 fetch mock):
// ~authorize 发起(discovery + DCR + PKCE,授权 URL 带加密 state)→ /~oauth/callback
// 兑换 code 落 token → 数据面带 Bearer 调上游;token 失效走 refresh 自愈;
// 未授权/state 伪造的拒绝路径。

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

async function mountOAuthMcp(path: string): Promise<void> {
  const res = await postJson(
    'system/registry',
    {
      tool: 'write',
      arguments: {
        path,
        kind: 'mcp',
        description: 'oauth mcp',
        config: { kind: 'mcp', url: 'https://mcp-oauth.test/mcp', auth: 'oauth' },
      },
    },
    admin(),
  )
  expect(res.status).toBe(200)
}

/**
 * 带 OAuth 的 MCP 上游 mock:
 * - PRM(.well-known/oauth-protected-resource)404 → SDK 落回 serverUrl 即 AS;
 * - AS metadata / DCR / token 端点齐备(PKCE S256);
 * - /mcp 端点要求 Bearer ∈ validTokens,否则 401(触发 SDK 刷新/授权)。
 */
function oauthUpstreamMock(tools: Array<{ name: string; description: string }>) {
  const validTokens = new Set(['at-1'])
  let tokenIssued = 0
  const grants: string[] = []
  const tokenRequests: URLSearchParams[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    const url = new URL(req.url)

    if (req.method === 'GET' && url.pathname.includes('.well-known/oauth-protected-resource')) {
      return new Response('not found', { status: 404 })
    }
    if (
      req.method === 'GET' &&
      (url.pathname.includes('.well-known/oauth-authorization-server') ||
        url.pathname.includes('.well-known/openid-configuration'))
    ) {
      return Response.json({
        issuer: 'https://mcp-oauth.test',
        authorization_endpoint: 'https://mcp-oauth.test/authorize',
        token_endpoint: 'https://mcp-oauth.test/token',
        registration_endpoint: 'https://mcp-oauth.test/register',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      })
    }
    if (req.method === 'POST' && url.pathname === '/register') {
      const body = (await req.json()) as { redirect_uris?: string[] }
      return Response.json(
        {
          client_id: 'dcr-client-1',
          redirect_uris: body.redirect_uris ?? [],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        },
        { status: 201 },
      )
    }
    if (req.method === 'POST' && url.pathname === '/token') {
      const params = new URLSearchParams(await req.text())
      grants.push(params.get('grant_type') ?? '')
      tokenRequests.push(params)
      if (params.get('grant_type') === 'authorization_code') {
        // PKCE:code_verifier 必须随兑换请求带上(state 加密载荷还原成功的证明)。
        if (!params.get('code_verifier') || params.get('code') !== 'code-ok') {
          return Response.json({ error: 'invalid_grant' }, { status: 400 })
        }
      } else if (params.get('grant_type') === 'refresh_token') {
        if (params.get('refresh_token') !== 'rt-1') {
          return Response.json({ error: 'invalid_grant' }, { status: 400 })
        }
      } else {
        return Response.json({ error: 'unsupported_grant_type' }, { status: 400 })
      }
      tokenIssued += 1
      const token = `at-${tokenIssued}`
      validTokens.add(token)
      return Response.json({
        access_token: token,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'rt-1',
      })
    }

    if (url.pathname === '/mcp') {
      const bearer = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
      if (!validTokens.has(bearer)) {
        return new Response('unauthorized', { status: 401 })
      }
      const body = (await req.json()) as { id?: number | string; method: string; params?: unknown }
      const rpc = (result: unknown, headers: Record<string, string> = {}) =>
        Response.json({ jsonrpc: '2.0', id: body.id, result }, { headers })
      if (body.method === 'initialize') {
        return rpc(
          {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-oauth-mcp', version: '0.0.0' },
          },
          { 'mcp-session-id': 'sess-oauth' },
        )
      }
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
      if (body.method === 'tools/list') {
        return rpc({ tools: tools.map((t) => ({ ...t, inputSchema: { type: 'object' } })) })
      }
      if (body.method === 'tools/call') {
        const params = body.params as { name?: string; arguments?: unknown }
        return rpc({
          content: [
            { type: 'text', text: `called:${params?.name}:${JSON.stringify(params?.arguments)}` },
          ],
        })
      }
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: `unknown method ${body.method}` },
      })
    }
    return new Response(`unexpected request: ${req.method} ${req.url}`, { status: 500 })
  })
  return {
    fetchMock,
    grants,
    tokenRequests,
    /** 作废现存 access token(refresh_token 仍有效)→ 下次调用走 401→refresh 自愈。 */
    revokeAccessTokens: () => validTokens.clear(),
  }
}

/** 发起授权拿到授权 URL(断言 redirect 形态)。 */
async function startAuthorize(path: string): Promise<URL> {
  const res = await postJson(`${path}/~authorize`, {}, admin())
  expect(res.status).toBe(200)
  const body = (await res.json()) as { status: string; authorizationUrl?: string }
  expect(body.status).toBe('redirect')
  expect(body.authorizationUrl).toBeDefined()
  return new URL(body.authorizationUrl as string)
}

/** 模拟浏览器回跳网关 callback。 */
async function callback(query: Record<string, string>): Promise<Response> {
  const q = new URLSearchParams(query).toString()
  return SELF.fetch(`https://tb.test/~oauth/callback?${q}`)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mcp 托管 OAuth:授权全链路(默认离线,上游为 fetch mock)', () => {
  it('~authorize → callback 兑换 token → 数据面带 Bearer 调上游成功', async () => {
    const upstream = oauthUpstreamMock([{ name: 'query', description: 'run query' }])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountOAuthMcp('db/bb')

    // 发起:授权 URL 指向 AS,带 PKCE challenge 与加密 state,redirect_uri 指回网关 callback。
    const authUrl = await startAuthorize('db/bb')
    expect(authUrl.origin).toBe('https://mcp-oauth.test')
    expect(authUrl.searchParams.get('client_id')).toBe('dcr-client-1')
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authUrl.searchParams.get('redirect_uri')).toBe('https://tb.test/~oauth/callback')
    const state = authUrl.searchParams.get('state')
    expect(state).toBeTruthy()

    // 回调:code + state → 兑换 token,落 StateStore,回成功页。
    const cb = await callback({ code: 'code-ok', state: state as string })
    expect(cb.status).toBe(200)
    expect(await cb.text()).toContain('Authorization complete')
    expect(upstream.grants).toContain('authorization_code')

    // 数据面:~help 触发 tools/list,SDK 自动带 Bearer。
    const help = await SELF.fetch('https://tb.test/db/bb/~help', admin())
    expect(help.status).toBe(200)
    expect(parseHelpDsl(await help.text()).cmds.map((c) => c.name)).toContain('query')

    // 直连调用同样成功。
    const call = await postJson('db/bb/query', { sql: 'select 1' }, admin())
    expect(call.status).toBe(200)
  })

  it('access token 失效 → 401 触发 SDK 静默 refresh 自愈,不需重新交互授权', async () => {
    const upstream = oauthUpstreamMock([{ name: 'query', description: 'run query' }])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountOAuthMcp('db/bb-refresh')
    const authUrl = await startAuthorize('db/bb-refresh')
    const cb = await callback({ code: 'code-ok', state: authUrl.searchParams.get('state') ?? '' })
    expect(cb.status).toBe(200)

    upstream.revokeAccessTokens()

    const help = await SELF.fetch('https://tb.test/db/bb-refresh/~help?refresh=1', admin())
    expect(help.status).toBe(200)
    expect(parseHelpDsl(await help.text()).cmds.map((c) => c.name)).toContain('query')
    expect(upstream.grants).toContain('refresh_token')
  })

  it('已有 refresh_token 时重复 ~authorize → 静默刷新直接 authorized(免交互)', async () => {
    const upstream = oauthUpstreamMock([{ name: 'query', description: 'run query' }])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountOAuthMcp('db/bb-re')
    const authUrl = await startAuthorize('db/bb-re')
    await callback({ code: 'code-ok', state: authUrl.searchParams.get('state') ?? '' })

    const res = await postJson('db/bb-re/~authorize', {}, admin())
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: string }).status).toBe('authorized')
  })

  it('本地回调通道(body.redirectUri = loopback):授权/兑换均复用该 redirect_uri', async () => {
    const upstream = oauthUpstreamMock([{ name: 'query', description: 'run query' }])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountOAuthMcp('db/bb-local')

    const localUri = 'http://127.0.0.1:51234/callback'
    const res = await postJson(`db/bb-local/~authorize`, { redirectUri: localUri }, admin())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; authorizationUrl?: string }
    expect(body.status).toBe('redirect')
    const authUrl = new URL(body.authorizationUrl as string)
    // 授权 URL 与 DCR 注册的 redirect_uri 都是本地回调,而非网关 callback。
    expect(authUrl.searchParams.get('redirect_uri')).toBe(localUri)

    // CLI 把本地收到的 code+state 转交网关 callback;兑换用 state 内嵌的 redirect_uri。
    const cb = await callback({ code: 'code-ok', state: authUrl.searchParams.get('state') ?? '' })
    expect(cb.status).toBe(200)
    const tokenReq = upstream.tokenRequests.find(
      (p) => p.get('grant_type') === 'authorization_code',
    )
    expect(tokenReq?.get('redirect_uri')).toBe(localUri)

    const help = await SELF.fetch('https://tb.test/db/bb-local/~help', admin())
    expect(help.status).toBe(200)
    expect(parseHelpDsl(await help.text()).cmds.map((c) => c.name)).toContain('query')
  })

  it('非 loopback 的 redirectUri → invalid_argument 拒绝', async () => {
    const upstream = oauthUpstreamMock([])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountOAuthMcp('db/bb-evil')
    const res = await postJson(
      `db/bb-evil/~authorize`,
      { redirectUri: 'https://evil.example/callback' },
      admin(),
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
  })
})

describe('mcp 托管 OAuth:拒绝路径', () => {
  it('未授权就调用 → permission_denied,指引 tb tool auth', async () => {
    const upstream = oauthUpstreamMock([{ name: 'query', description: 'run query' }])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountOAuthMcp('db/bb-cold')
    const help = await SELF.fetch('https://tb.test/db/bb-cold/~help', admin())
    expect(help.status).toBe(403)
    const body = (await help.json()) as { code: string; message: string }
    expect(body.code).toBe('permission_denied')
    expect(body.message).toContain('tb tool auth db/bb-cold')
  })

  it('伪造/篡改 state → 拒绝(400 页),不兑换 code', async () => {
    const upstream = oauthUpstreamMock([])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountOAuthMcp('db/bb-forge')
    const cb = await callback({ code: 'code-ok', state: 'forged.state' })
    expect(cb.status).toBe(400)
    expect(upstream.grants).not.toContain('authorization_code')
  })

  it('AS 回跳 error(用户拒绝授权)→ 失败页,不兑换 code', async () => {
    const upstream = oauthUpstreamMock([])
    vi.stubGlobal('fetch', upstream.fetchMock)
    const cb = await callback({ error: 'access_denied', state: 'whatever' })
    expect(cb.status).toBe(400)
    expect(upstream.grants).toHaveLength(0)
  })

  it('对非 oauth 挂载 ~authorize → invalid_argument', async () => {
    const upstream = oauthUpstreamMock([])
    vi.stubGlobal('fetch', upstream.fetchMock)
    const res = await postJson(
      'system/registry',
      {
        tool: 'write',
        arguments: {
          path: 'db/plain',
          kind: 'mcp',
          description: 'plain mcp',
          config: { kind: 'mcp', url: 'https://mcp-oauth.test/mcp' },
        },
      },
      admin(),
    )
    expect(res.status).toBe(200)
    const auth = await postJson('db/plain/~authorize', {}, admin())
    expect(auth.status).toBe(400)
    expect(((await auth.json()) as { code: string }).code).toBe('invalid_argument')
  })

  it('节点重挂载(registry write)→ OAuth 凭证失效,须重新授权', async () => {
    const upstream = oauthUpstreamMock([{ name: 'query', description: 'run query' }])
    vi.stubGlobal('fetch', upstream.fetchMock)
    await mountOAuthMcp('db/bb-rewrite')
    const authUrl = await startAuthorize('db/bb-rewrite')
    await callback({ code: 'code-ok', state: authUrl.searchParams.get('state') ?? '' })

    // 重挂载(URL 变更场景)→ mcpoauth:* 全部清除。
    await mountOAuthMcp('db/bb-rewrite')
    const help = await SELF.fetch('https://tb.test/db/bb-rewrite/~help', admin())
    expect(help.status).toBe(403)
    expect(((await help.json()) as { message: string }).message).toContain('tb tool auth')
  })
})
