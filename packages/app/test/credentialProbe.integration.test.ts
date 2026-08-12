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

describe('多字段凭证的挂载校验', () => {
  /**
   * 一个手写的最小 binding,不经 plugin-sdk —— `app` 是宿主中立层,不依赖 SDK。
   * 它只需吐出符合 plugin/v2 契约的 `~describe`(带 credentialFields)与一个能调的工具,
   * 平台侧的字段校验就能被完整驱动。
   */
  function multiFieldBinding(): (request: Request) => Promise<Response> {
    const json = (value: unknown): Response => new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    return (request: Request) => {
      const url = new URL(request.url)
      if (url.pathname === '/healthz') return Promise.resolve(json({ healthy: true }))
      if (url.pathname === '/~describe') {
        return Promise.resolve(json({
          protocolVersion: 'plugin/v2',
          exports: [{
            id: 'actions',
            profile: 'tools/v1',
            description: 'Multi-field',
            credentialFields: [
              { key: 'appId', required: true },
              { key: 'appSecret', required: true, secret: true },
            ],
          }],
        }))
      }
      // List/Call 一律回空成功:本组测试只关心挂载期的字段校验。
      return Promise.resolve(json([]))
    }
  }

  async function appWithMultiField(): Promise<{
    app: ReturnType<typeof createTbApp>
    mount: (authRef: string) => Promise<Response>
    setSecret: (value: string) => Promise<Response>
  }> {
    const state = new MemoryStateStore()
    await runBootstrap(state, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
    const app = createTbApp({
      allowInsecureHttp: false,
      pluginBindings: new Map([['mf', multiFieldBinding()]]),
      remote: { allowlist: [], maxHops: 4, allowInsecure: false },
      secrets: new SecretStoreImpl(state, TEST_ENCRYPTION_KEY),
      state,
      version: 'test',
    })

    expect((await postJson(app, 'system/plugin', {
      tool: 'write',
      arguments: {
        id: 'mf',
        protocolVersion: 'plugin/v2',
        endpoint: 'binding:mf',
        auth: { kind: 'platform-token' },
        healthPath: '/healthz',
        enabled: true,
      },
    })).status).toBe(200)

    return {
      app,
      setSecret: (value: string) =>
        postJson(app, 'system/secret', { tool: 'set', arguments: { name: 'mf-cred', value } }),
      mount: (authRef: string) => postJson(app, 'system/registry', {
        tool: 'write',
        arguments: {
          path: 'svc/mf',
          kind: 'tool',
          description: 'multi-field',
          config: { kind: 'tool', provider: 'mf', export: 'actions', authRef },
        },
      }),
    }
  }

  it('字段齐全 → 挂载成功', async () => {
    const { mount, setSecret } = await appWithMultiField()
    await setSecret(JSON.stringify({ appId: 'cli_x', appSecret: 's3cret' }))
    expect((await mount('mf-cred')).status).toBe(200)
  })

  it('**缺必填字段 → 挂载当场被拒,并点名缺哪个**', async () => {
    const { mount, setSecret } = await appWithMultiField()
    await setSecret(JSON.stringify({ appId: 'cli_x' }))
    const res = await mount('mf-cred')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('appSecret')
  })

  it('secret 存的是单值而非 JSON → 挂载被拒,消息指出该怎么写入', async () => {
    const { mount, setSecret } = await appWithMultiField()
    await setSecret('sk_plain_key')
    const res = await mount('mf-cred')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('--field')
  })

  it('被拒的挂载没有落库', async () => {
    const { app, mount, setSecret } = await appWithMultiField()
    await setSecret(JSON.stringify({ appId: 'only' }))
    await mount('mf-cred')
    const help = await app.request(new Request('https://tb.test/svc/mf/~help', {
      headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, accept: 'application/json' },
    }))
    expect(help.status).toBe(404)
  })

  it('authRef 指向不存在的 secret → 挂载被拒', async () => {
    const { mount } = await appWithMultiField()
    const res = await mount('no-such-secret')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('no-such-secret')
  })
})

describe('平台核验探针形状', () => {
  /**
   * `credentialProbe` 的语义前提是"只读、零副作用、无必填入参",但契约层只校验了它是个
   * 字符串 —— 而平台会在**每次挂载**时真调它。114 个产物靠迁移期人工评审还看得住,
   * 1000 个看不住;平台反正要 List,正好用它核验。
   */
  function shapeBinding(tool: Record<string, unknown>): (request: Request) => Promise<Response> {
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
          exports: [{ id: 'actions', profile: 'tools/v1', credentialProbe: 'probe' }],
        })
      }
      const body = (await request.json()) as { tool: string }
      return json(body.tool === 'List' ? [tool] : { content: { ok: true } })
    }
  }

  async function mountWith(tool: Record<string, unknown>): Promise<Response> {
    const state = new MemoryStateStore()
    await runBootstrap(state, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
    const app = createTbApp({
      allowInsecureHttp: false,
      pluginBindings: new Map([['shape', shapeBinding(tool)]]),
      remote: { allowlist: [], maxHops: 4, allowInsecure: false },
      secrets: new SecretStoreImpl(state, TEST_ENCRYPTION_KEY),
      state,
      version: 'test',
    })
    await postJson(app, 'system/secret', {
      tool: 'set',
      arguments: { name: 'k', value: 'sk_x' },
    })
    expect((await postJson(app, 'system/plugin', {
      tool: 'write',
      arguments: {
        id: 'shape',
        protocolVersion: 'plugin/v2',
        endpoint: 'binding:shape',
        auth: { kind: 'platform-token' },
        healthPath: '/healthz',
        enabled: true,
      },
    })).status).toBe(200)
    return postJson(app, 'system/registry', {
      tool: 'write',
      arguments: {
        path: 'svc/shape',
        kind: 'tool',
        description: 'shape',
        config: { kind: 'tool', provider: 'shape', export: 'actions', authRef: 'k' },
      },
    })
  }

  it('形状合规 → 挂载成功', async () => {
    expect((await mountWith({
      name: 'probe',
      effect: 'read',
      inputSchema: { type: 'object', properties: {} },
    })).status).toBe(200)
  })

  it('**探针非只读 → 拒绝挂载**(否则每次挂载都产生业务副作用)', async () => {
    const res = await mountWith({ name: 'probe', effect: 'write' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('必须是 read')
  })

  it('**探针有必填入参 → 拒绝挂载**(会被空参调用,且旧行为错报成可重试)', async () => {
    const res = await mountWith({
      name: 'probe',
      effect: 'read',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('必填入参')
  })

  it('探针不在工具表里 → 拒绝挂载,消息指向 plugin 作者', async () => {
    const res = await mountWith({ name: 'other', effect: 'read' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('不在其工具表里')
  })

  it('effect 未声明也算违规(缺省不等于只读)', async () => {
    const res = await mountWith({ name: 'probe' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('未声明')
  })
})
