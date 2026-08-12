import { encodeCredentialValues, MemoryStateStore, SecretStoreImpl } from '@tool-bridge/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_ADMIN_SK, TEST_ENCRYPTION_KEY } from './fixtures'
import { createTbApp, runBootstrap } from '../src/index'

/**
 * provider 型 OAuth2 的托管流程,端到端。
 *
 * 要证的是这套东西真能把一个 oauth2 provider 挂起来用:发起 → 回调兑换 → 调用时注入
 * access token → 过期自动刷新。以及几条边界:令牌不出网关、未授权时给的是"去授权"
 * 而不是笼统的失败、刷新响应不带新 refresh token 时保留旧的。
 */

const AUTHORIZE_URL = 'https://accounts.example.com/authorize'
const TOKEN_URL = 'https://api.example.com/token'
let upstreamCalls: Request[]
let tokenResponses: Array<{ body: unknown, status?: number }>
/** 插件侧看到的 X-TB-Upstream-Auth 明文(证明注入的是 access token)。 */
let seenUpstreamAuth: string | undefined

/** 一个声明了 oauth 的最小 binding(不经 plugin-sdk:app 是宿主中立层)。 */
function oauthBinding(): (request: Request) => Promise<Response> {
  const json = (value: unknown): Response => new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  return async (request: Request) => {
    const url = new URL(request.url)
    if (url.pathname === '/healthz') return json({ healthy: true })
    if (url.pathname === '/~describe') {
      return json({
        protocolVersion: 'plugin/v2',
        exports: [{
          id: 'actions',
          profile: 'tools/v1',
          description: 'OAuth provider',
          oauth: {
            authorizationUrl: AUTHORIZE_URL,
            tokenUrl: TOKEN_URL,
            scopes: ['read'],
          },
        }],
      })
    }
    // 记下平台注入的凭证明文,再原样回一个成功结果。
    const raw = request.headers.get('x-tb-upstream-auth')
    if (raw !== null) {
      const b64 = raw.replaceAll('-', '+').replaceAll('_', '/')
      seenUpstreamAuth = new TextDecoder().decode(
        Uint8Array.from(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')), c => c.charCodeAt(0)),
      )
    }
    const body = (await request.json()) as { tool: string }
    if (body.tool === 'List') return json([{ name: 'whoami', description: 'who am i' }])
    return json({ content: { ok: true } })
  }
}

async function buildApp(): Promise<ReturnType<typeof createTbApp>> {
  const state = new MemoryStateStore()
  await runBootstrap(state, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
  return createTbApp({
    allowInsecureHttp: false,
    canonicalOrigin: 'https://tb.test',
    encryptionKey: TEST_ENCRYPTION_KEY,
    pluginBindings: new Map([['oauthp', oauthBinding()]]),
    remote: { allowlist: [], maxHops: 4, allowInsecure: false },
    secrets: new SecretStoreImpl(state, TEST_ENCRYPTION_KEY),
    state,
    version: 'test',
  })
}

async function postJson(
  app: ReturnType<typeof createTbApp>,
  path: string,
  body: unknown,
): Promise<Response> {
  return await app.request(new Request(`https://tb.test/${path}`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${TEST_ADMIN_SK}`,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify(body),
  }))
}

/** 存 client 凭证 + 注册 plugin + 挂载,返回就绪的 app。 */
async function mountedApp(): Promise<ReturnType<typeof createTbApp>> {
  const app = await buildApp()
  expect((await postJson(app, 'system/secret', {
    tool: 'set',
    arguments: {
      name: 'oauth-client',
      value: encodeCredentialValues({ clientId: 'cid', clientSecret: 'csecret' }),
    },
  })).status).toBe(200)

  const registered = await postJson(app, 'system/plugin', {
    tool: 'write',
    arguments: {
      id: 'oauthp',
      protocolVersion: 'plugin/v2',
      endpoint: 'binding:oauthp',
      auth: { kind: 'platform-token' },
      healthPath: '/healthz',
      enabled: true,
    },
  })
  expect(registered.status).toBe(200)

  expect((await postJson(app, 'system/registry', {
    tool: 'write',
    arguments: {
      path: 'svc/oauthp',
      kind: 'tool',
      description: 'oauth provider',
      config: { kind: 'tool', provider: 'oauthp', export: 'actions', authRef: 'oauth-client' },
    },
  })).status).toBe(200)
  return app
}

function authorize(app: ReturnType<typeof createTbApp>): Promise<Response> {
  return postJson(app, 'svc/oauthp/~authorize', {})
}

async function callback(
  app: ReturnType<typeof createTbApp>,
  state: string,
  code = 'the-code',
): Promise<Response> {
  return await app.request(new Request(
    `https://tb.test/~oauth/callback?code=${code}&state=${encodeURIComponent(state)}`,
  ))
}

beforeEach(() => {
  upstreamCalls = []
  seenUpstreamAuth = undefined
  tokenResponses = []
  vi.stubGlobal('fetch', vi.fn((input: Request | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    upstreamCalls.push(request)
    if (request.url === TOKEN_URL) {
      const next = tokenResponses.shift() ?? { body: { access_token: 'at-1', expires_in: 3600 } }
      return Promise.resolve(new Response(JSON.stringify(next.body), {
        status: next.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }))
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as unknown as typeof fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 从 ~authorize 的响应里取 state 参数。 */
function stateOf(authorizationUrl: string): string {
  const at = authorizationUrl.indexOf('?')
  const params = new URLSearchParams(authorizationUrl.slice(at + 1))
  return params.get('state')!
}

describe('发起授权', () => {
  it('产出跳转 URL,带 PKCE 与正确的 redirect_uri', async () => {
    const app = await mountedApp()
    const res = await authorize(app)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { authorizationUrl: string, status: string }
    expect(body.status).toBe('redirect')

    const url = new URL(body.authorizationUrl)
    expect(url.origin + url.pathname).toBe(AUTHORIZE_URL)
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://tb.test/~oauth/callback')
    expect(url.searchParams.get('scope')).toBe('read')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    // state 是密封的,不该能读出里面的 verifier。
    expect(url.searchParams.get('state')).not.toContain('code_verifier')
  })

  it('没配 authRef → 拒绝并说清要配什么', async () => {
    const app = await buildApp()
    await postJson(app, 'system/plugin', {
      tool: 'write',
      arguments: {
        id: 'oauthp',
        protocolVersion: 'plugin/v2',
        endpoint: 'binding:oauthp',
        auth: { kind: 'platform-token' },
        healthPath: '/healthz',
        enabled: true,
      },
    })
    await postJson(app, 'system/registry', {
      tool: 'write',
      arguments: {
        path: 'svc/noauth',
        kind: 'tool',
        description: 'x',
        config: { kind: 'tool', provider: 'oauthp', export: 'actions' },
      },
    })
    const res = await postJson(app, 'svc/noauth/~authorize', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
  })
})

describe('回调兑换', () => {
  it('兑换成功后页面提示已授权,且请求带齐 PKCE verifier 与 client 凭证', async () => {
    const app = await mountedApp()
    const started = (await (await authorize(app)).json()) as { authorizationUrl: string }
    const res = await callback(app, stateOf(started.authorizationUrl))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('已完成授权')

    const tokenRequest = upstreamCalls.find(r => r.url === TOKEN_URL)!
    const form = new URLSearchParams(await tokenRequest.text())
    expect(form.get('grant_type')).toBe('authorization_code')
    expect(form.get('code')).toBe('the-code')
    expect(form.get('redirect_uri')).toBe('https://tb.test/~oauth/callback')
    expect(form.get('code_verifier')).toBeTruthy()
    expect(form.get('client_id')).toBe('cid')
    expect(form.get('client_secret')).toBe('csecret')
  })

  it('state 被篡改 → 失败页,不兑换', async () => {
    const app = await mountedApp()
    const res = await callback(app, 'tampered-state')
    expect(await res.text()).toContain('state is invalid')
    expect(upstreamCalls.some(r => r.url === TOKEN_URL)).toBe(false)
  })

  it('令牌端点拒绝 → 失败页带出上游消息', async () => {
    const app = await mountedApp()
    const started = (await (await authorize(app)).json()) as { authorizationUrl: string }
    tokenResponses = [{ status: 400, body: { error_description: 'code already used' } }]
    const res = await callback(app, stateOf(started.authorizationUrl))
    expect(await res.text()).toContain('code already used')
  })
})

describe('调用时的令牌注入', () => {
  it('**注入的是 access token,不是 secret 里的 client 凭证**', async () => {
    const app = await mountedApp()
    const started = (await (await authorize(app)).json()) as { authorizationUrl: string }
    await callback(app, stateOf(started.authorizationUrl))

    const res = await postJson(app, 'svc/oauthp', { tool: 'whoami', arguments: {} })
    expect(res.status).toBe(200)
    expect(seenUpstreamAuth).toBe('at-1')
    expect(seenUpstreamAuth).not.toContain('csecret')
  })

  it('**未授权就调用 → permission_denied 并指引去授权**(不是笼统的 unavailable)', async () => {
    const app = await mountedApp()
    const res = await postJson(app, 'svc/oauthp', { tool: 'whoami', arguments: {} })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('permission_denied')
    expect(body.message).toContain('tb tool auth')
  })

  it('令牌快过期 → 调用前自动刷新,用新 token', async () => {
    const app = await mountedApp()
    const started = (await (await authorize(app)).json()) as { authorizationUrl: string }
    // 首次兑换给一个 10 秒就过期的 token(< 60s 余量 → 下次调用必刷新)。
    tokenResponses = [{ body: { access_token: 'at-old', expires_in: 10, refresh_token: 'rt-1' } }]
    await callback(app, stateOf(started.authorizationUrl))

    tokenResponses = [{ body: { access_token: 'at-new', expires_in: 3600 } }]
    await postJson(app, 'svc/oauthp', { tool: 'whoami', arguments: {} })
    expect(seenUpstreamAuth).toBe('at-new')

    const refresh = upstreamCalls.filter(r => r.url === TOKEN_URL).at(-1)!
    const form = new URLSearchParams(await refresh.text())
    expect(form.get('grant_type')).toBe('refresh_token')
    expect(form.get('refresh_token')).toBe('rt-1')
  })

  it('**刷新响应不带新 refresh token 时保留旧的**(否则下次就没得刷)', async () => {
    const app = await mountedApp()
    const started = (await (await authorize(app)).json()) as { authorizationUrl: string }
    // 兑换给一个短过期的 token + refresh token;之后每次调用都会触发刷新。
    tokenResponses = [{ body: { access_token: 'at-old', expires_in: 10, refresh_token: 'rt-keep' } }]
    await callback(app, stateOf(started.authorizationUrl))

    // 两次刷新,上游都只回 access_token 不回 refresh_token(未启用轮换的 provider)。
    tokenResponses = [
      { body: { access_token: 'at-2', expires_in: 10 } },
      { body: { access_token: 'at-3', expires_in: 10 } },
    ]
    expect((await postJson(app, 'svc/oauthp', { tool: 'whoami', arguments: {} })).status).toBe(200)
    const second = await postJson(app, 'svc/oauthp', { tool: 'whoami', arguments: {} })
    expect(second.status, '第二次刷新失败,说明旧 refresh token 没被保留').toBe(200)

    // 每一次刷新都必须带着最初那个 refresh token —— 丢了就再也刷不动。
    const refreshes = upstreamCalls.filter(r => r.url === TOKEN_URL).slice(1)
    expect(refreshes.length).toBeGreaterThanOrEqual(2)
    for (const request of refreshes) {
      const form = new URLSearchParams(await request.text())
      expect(form.get('grant_type')).toBe('refresh_token')
      expect(form.get('refresh_token')).toBe('rt-keep')
    }
  })

  it('刷新失败 → 指引重新授权', async () => {
    const app = await mountedApp()
    const started = (await (await authorize(app)).json()) as { authorizationUrl: string }
    tokenResponses = [{ body: { access_token: 'at', expires_in: 10, refresh_token: 'rt' } }]
    await callback(app, stateOf(started.authorizationUrl))

    tokenResponses = [{ status: 400, body: { error: 'invalid_grant' } }]
    const res = await postJson(app, 'svc/oauthp', { tool: 'whoami', arguments: {} })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { message: string }).message).toContain('tb tool auth')
  })
})

describe('免交互复用', () => {
  it('已有可用令牌时 ~authorize 直接回 authorized,不再弹浏览器', async () => {
    const app = await mountedApp()
    const started = (await (await authorize(app)).json()) as { authorizationUrl: string }
    await callback(app, stateOf(started.authorizationUrl))

    const again = await authorize(app)
    expect(((await again.json()) as { status: string }).status).toBe('authorized')
  })
})

describe('OAuth 与 credentialProbe 叠加', () => {
  /**
   * 回归:OAuth 挂载的 `authRef` 指向的 secret 存的是 **client 凭证**(clientId/clientSecret),
   * 不是上游凭证。挂载期的凭证探针若照常把它当 upstreamAuthRef 传下去,插件就会收到
   * clientSecret 明文 —— 那是凭证泄漏。
   *
   * 正确行为:OAuth 挂载**不跑探针**。凭证可用性由 `~authorize` 流程本身证明
   * (client 凭证不对就换不到 token,走不完流程)。
   */
  function probeBinding(seen: { auth?: string }): (request: Request) => Promise<Response> {
    const json = (value: unknown): Response => new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    return async (request: Request) => {
      const url = new URL(request.url)
      if (url.pathname === '/healthz') return json({ healthy: true })
      if (url.pathname === '/~describe') {
        return json({
          protocolVersion: 'plugin/v2',
          exports: [{
            id: 'actions',
            profile: 'tools/v1',
            // 两个能力同时声明:这正是出问题的组合。
            credentialProbe: 'ping',
            oauth: { authorizationUrl: AUTHORIZE_URL, tokenUrl: TOKEN_URL },
          }],
        })
      }
      const raw = request.headers.get('x-tb-upstream-auth')
      if (raw !== null) {
        const b64 = raw.replaceAll('-', '+').replaceAll('_', '/')
        seen.auth = new TextDecoder().decode(Uint8Array.from(
          atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')),
          c => c.charCodeAt(0),
        ))
      }
      const body = (await request.json()) as { tool: string }
      return json(body.tool === 'List' ? [{ name: 'ping' }] : { content: {} })
    }
  }

  it('**挂载时不把 client secret 发给插件**', async () => {
    const seen: { auth?: string } = {}
    const state = new MemoryStateStore()
    await runBootstrap(state, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
    const app = createTbApp({
      allowInsecureHttp: false,
      canonicalOrigin: 'https://tb.test',
      encryptionKey: TEST_ENCRYPTION_KEY,
      pluginBindings: new Map([['probep', probeBinding(seen)]]),
      remote: { allowlist: [], maxHops: 4, allowInsecure: false },
      secrets: new SecretStoreImpl(state, TEST_ENCRYPTION_KEY),
      state,
      version: 'test',
    })

    await postJson(app, 'system/secret', {
      tool: 'set',
      arguments: {
        name: 'cli-cred',
        value: encodeCredentialValues({ clientId: 'cid', clientSecret: 'MUST_NOT_LEAK' }),
      },
    })
    await postJson(app, 'system/plugin', {
      tool: 'write',
      arguments: {
        id: 'probep',
        protocolVersion: 'plugin/v2',
        endpoint: 'binding:probep',
        auth: { kind: 'platform-token' },
        healthPath: '/healthz',
        enabled: true,
      },
    })
    const mounted = await postJson(app, 'system/registry', {
      tool: 'write',
      arguments: {
        path: 'svc/probep',
        kind: 'tool',
        description: 'oauth + probe',
        config: { kind: 'tool', provider: 'probep', export: 'actions', authRef: 'cli-cred' },
      },
    })
    expect(mounted.status).toBe(200)
    // 探针根本不该跑;即便跑了也绝不能把 client 凭证送出去。
    expect(seen.auth ?? '').not.toContain('MUST_NOT_LEAK')
    expect(seen.auth).toBeUndefined()
  })
})
