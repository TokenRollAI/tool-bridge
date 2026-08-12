import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryStateStore, SecretStoreImpl } from '@tool-bridge/core'
import { builtinPluginBindings } from '@tool-bridge/plugins'
import { TEST_ADMIN_SK, TEST_ENCRYPTION_KEY } from './fixtures'
import { createTbApp, runBootstrap } from '../src/index'

/**
 * 挂载时的凭证探针。
 *
 * 要证的是这个特性存在的理由:**配错的 key 在挂载那一刻就被拒**,而不是等某个 agent
 * 第一次真去调用时才 401。上游 open-connector 每个 provider 都带 credentialValidators,
 * tool-bridge 此前没有对应钩子 —— 这是补上的那一环。
 *
 * 用 clerk(声明了 credentialProbe: 'count_users')。上游 HTTP 打桩。
 */

let pluginToken: string | undefined
let upstream: ReturnType<typeof vi.fn>

async function appWithClerk(): Promise<ReturnType<typeof createTbApp>> {
  const state = new MemoryStateStore()
  await runBootstrap(state, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
  return createTbApp({
    allowInsecureHttp: false,
    pluginBindings: new Map([
      ['clerk', (request: Request) =>
        builtinPluginBindings({ PLUGIN_TOKEN: pluginToken }, { include: ['clerk'] })
          .get('clerk')!(request)],
    ]),
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
  return app.request(new Request(`https://tb.test/${path}`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${TEST_ADMIN_SK}`,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify(body),
  }))
}

/** 存凭证 + 注册 plugin,返回就绪的 app(尚未挂载)。 */
async function registeredApp(secretValue: string): Promise<ReturnType<typeof createTbApp>> {
  const app = await appWithClerk()
  expect((await postJson(app, 'system/secret', {
    tool: 'set',
    arguments: { name: 'clerk-key', value: secretValue },
  })).status).toBe(200)

  const registered = await postJson(app, 'system/plugin', {
    tool: 'write',
    arguments: {
      id: 'clerk',
      protocolVersion: 'plugin/v2',
      endpoint: 'binding:clerk',
      auth: { kind: 'platform-token' },
      healthPath: '/healthz',
      enabled: true,
    },
  })
  expect(registered.status).toBe(200)
  pluginToken = ((await registered.json()) as { pluginToken?: string }).pluginToken
  return app
}

function mount(
  app: ReturnType<typeof createTbApp>,
  config: Record<string, unknown>,
): Promise<Response> {
  return postJson(app, 'system/registry', {
    tool: 'write',
    arguments: {
      path: 'auth/clerk',
      kind: 'tool',
      description: 'Clerk users',
      config: { kind: 'tool', provider: 'clerk', export: 'actions', ...config },
    },
  })
}

beforeEach(() => {
  pluginToken = undefined
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('挂载时的凭证探针', () => {
  it('凭证可用 → 挂载成功,且探针确实打了上游(不是空转)', async () => {
    upstream = vi.fn(() => Promise.resolve(
      new Response(JSON.stringify({ object: 'total_count', total_count: 7 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ))
    vi.stubGlobal('fetch', upstream as unknown as typeof fetch)

    const app = await registeredApp('sk_test_good')
    expect((await mount(app, { authRef: 'clerk-key' })).status).toBe(200)

    expect(upstream).toHaveBeenCalledTimes(1)
    const [request] = upstream.mock.calls[0] as [Request]
    expect(new URL(request.url).pathname).toBe('/v1/users/count')
    expect(request.headers.get('authorization')).toBe('Bearer sk_test_good')
  })

  it('**凭证无效 → 挂载当场被拒**,而不是等第一次调用才 401', async () => {
    upstream = vi.fn(() => Promise.resolve(
      new Response(JSON.stringify({ errors: [{ message: 'Invalid API key' }] }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    ))
    vi.stubGlobal('fetch', upstream as unknown as typeof fetch)

    const app = await registeredApp('sk_test_bad')
    const res = await mount(app, { authRef: 'clerk-key' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    // 消息要说清是**凭证**的问题,并指出是哪个 secret —— 否则运维只看到一个模糊的挂载失败。
    expect(body.message).toContain('凭证探测失败')
    expect(body.message).toContain('clerk-key')
  })

  it('被拒的挂载没有落库(不留一个必然失败的节点)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      new Response('{"errors":[{"message":"bad"}]}', { status: 401 }),
    )) as unknown as typeof fetch)

    const app = await registeredApp('sk_test_bad')
    await mount(app, { authRef: 'clerk-key' })

    const help = await app.request(new Request('https://tb.test/auth/clerk/~help', {
      headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, accept: 'application/json' },
    }))
    expect(help.status).toBe(404)
  })

  it('上游临时故障(5xx)→ unavailable + retryable,不因抖动永久拒绝挂载', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      new Response('{"errors":[{"message":"upstream down"}]}', { status: 503 }),
    )) as unknown as typeof fetch)

    const app = await registeredApp('sk_test_good')
    const res = await mount(app, { authRef: 'clerk-key' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → 不探测,挂载照常(探针只在有凭证可验时才有意义)', async () => {
    upstream = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
    vi.stubGlobal('fetch', upstream as unknown as typeof fetch)

    const app = await registeredApp('sk_test_good')
    expect((await mount(app, {})).status).toBe(200)
    expect(upstream).not.toHaveBeenCalled()
  })
})
