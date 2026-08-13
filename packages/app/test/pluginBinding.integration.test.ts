import { MemoryStateStore, parseHelpDsl, SecretStoreImpl } from '@tool-bridge/core'
import { createNotesPlugin, type Env } from '@tool-bridge/plugins/notes'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { builtinPluginBindings } from '@tool-bridge/plugins'
import { createTbApp, type PluginBindings, runBootstrap } from '../src/index'
import { TEST_ADMIN_SK, TEST_ENCRYPTION_KEY } from './fixtures'

/**
 * binding: 进程内插件传输(plugin-in-process-catalog 决策第一刀)。
 *
 * 与 pluginExample.integration.test.ts 的关键差别:那边 stub 全局 fetch 模拟
 * "外挂 HTTP plugin";这里**把全局 fetch 打桩为一碰即炸**——注册(探活 +
 * ~describe 契约抓取)与调用全程必须走宿主注入的 binding handler 进程内直调,
 * 任何一次网络出站都会让测试 FAIL。envelope/auth 契约与 HTTP 通道完全一致。
 */

let pluginToken: string | undefined

function bindingsWithNotesPlugin(): PluginBindings {
  const plugin = createNotesPlugin()
  return new Map([
    ['notes', (request: Request) => {
      const env: Env = { ...(pluginToken !== undefined ? { PLUGIN_TOKEN: pluginToken } : {}) }
      return plugin.fetch(request, env)
    }],
  ])
}

async function appWithBindings(): Promise<ReturnType<typeof createTbApp>> {
  const state = new MemoryStateStore()
  await runBootstrap(state, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
  return createTbApp({
    allowInsecureHttp: false,
    pluginBindings: bindingsWithNotesPlugin(),
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
  return app.request(
    new Request(`https://tb.test/${path}`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${TEST_ADMIN_SK}`,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
}

async function registerBindingPlugin(
  app: ReturnType<typeof createTbApp>,
  endpoint: string,
  id = 'notes',
): Promise<Response> {
  return postJson(app, 'system/plugin', {
    tool: 'write',
    arguments: {
      id,
      protocolVersion: 'plugin/v2',
      endpoint,
      auth: { kind: 'platform-token' },
      healthPath: '/healthz',
      enabled: true,
    },
  })
}

beforeEach(() => {
  pluginToken = undefined
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('binding transport must not touch the network')
  }) as unknown as typeof fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('binding: 进程内插件传输', () => {
  it('注册(探活+契约)→ 挂载 → 工具调用全链路零网络出站', async () => {
    const app = await appWithBindings()

    // catalog:注册前 notes 是"可用未激活"。
    const before = await postJson(app, 'system/plugin', { tool: 'catalog', arguments: {} })
    expect(before.status).toBe(200)
    expect(((await before.json()) as { items: unknown[] }).items).toEqual([
      { name: 'notes', endpoint: 'binding:notes', registered: false },
    ])

    const registered = await registerBindingPlugin(app, 'binding:notes')
    expect(registered.status).toBe(200)
    pluginToken = ((await registered.json()) as { pluginToken?: string }).pluginToken
    expect(pluginToken).toMatch(/^tbk_/)

    const mounted = await postJson(app, 'system/registry', {
      tool: 'write',
      arguments: {
        path: 'tools/notes',
        kind: 'tool',
        description: 'notes actions (in-process)',
        config: { kind: 'tool', provider: 'notes', export: 'actions' },
      },
    })
    expect(mounted.status).toBe(200)

    // ~help 经 List 直调进程内 plugin;Zod 派生 schema 原样可见。
    const help = await app.request(
      new Request('https://tb.test/tools/notes/~help', {
        headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, accept: 'text/plain' },
      }),
    )
    expect(help.status).toBe(200)
    const names = parseHelpDsl(await help.text()).cmds.map(c => c.name).sort()
    expect(names).toEqual(['count_notes', 'create_note'])

    const created = await postJson(app, 'tools/notes', {
      tool: 'create_note',
      arguments: { title: 'In Process', body: 'no network hop' },
    })
    expect(created.status).toBe(200)
    expect(await created.json()).toEqual({ path: 'in-process', version: 1 })

    // catalog:注册后状态翻为 registered 并带 pluginId。
    const after = await postJson(app, 'system/plugin', { tool: 'catalog', arguments: {} })
    expect(((await after.json()) as { items: unknown[] }).items).toEqual([
      { name: 'notes', endpoint: 'binding:notes', registered: true, pluginId: 'notes' },
    ])

    // 全局 fetch 从未被触达。
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('未装配的 binding 名注册被拒(探活按 unavailable 报告,fail closed)', async () => {
    const app = await appWithBindings()
    const res = await registerBindingPlugin(app, 'binding:ghost', 'ghost')
    expect(res.status).not.toBe(200)
    const body = (await res.json()) as { message?: string }
    expect(body.message).toContain('ghost')
  })

  it('plugin 错误语义与 HTTP 通道一致:TBError 归一透传(缺必填字段 → 400)', async () => {
    const app = await appWithBindings()
    const registered = await registerBindingPlugin(app, 'binding:notes')
    expect(registered.status).toBe(200)
    pluginToken = ((await registered.json()) as { pluginToken?: string }).pluginToken
    expect((await postJson(app, 'system/registry', {
      tool: 'write',
      arguments: {
        path: 'tools/notes',
        kind: 'tool',
        description: 'notes actions',
        config: { kind: 'tool', provider: 'notes', export: 'actions' },
      },
    })).status).toBe(200)

    const bad = await postJson(app, 'tools/notes', {
      tool: 'create_note',
      arguments: { title: 'no body' },
    })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { code: string }).code).toBe('invalid_argument')
  })
})

describe('binding 传输的超时', () => {
  /**
   * 进程内直调也必须有超时。此前只有网络分支带 `AbortSignal.timeout`,binding 分支裸调 ——
   * 而 114 个迁移产物走的正是 binding。某个产物忘了给自己的出站加超时,上游挂住就会无上界
   * 占着这个请求:CF 侧撞 30s CPU/墙钟限制,Node 侧无限等,而 callPlugin 的重试还会再来一轮。
   */
  it('**binding handler 收到的 Request 带 signal**', async () => {
    let seenSignal: AbortSignal | null | undefined
    const state = new MemoryStateStore()
    await runBootstrap(state, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
    const app = createTbApp({
      allowInsecureHttp: false,
      pluginBindings: new Map([['probe', (request: Request) => {
        seenSignal = request.signal
        const url = new URL(request.url)
        const json = (value: unknown): Response => new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
        if (url.pathname === '/healthz') return Promise.resolve(json({ healthy: true }))
        if (url.pathname === '/~describe') {
          return Promise.resolve(json({
            protocolVersion: 'plugin/v2',
            exports: [{ id: 'actions', profile: 'tools/v1' }],
          }))
        }
        return Promise.resolve(json([]))
      }]]),
      remote: { allowlist: [], maxHops: 4, allowInsecure: false },
      secrets: new SecretStoreImpl(state, TEST_ENCRYPTION_KEY),
      state,
      version: 'test',
    })

    const registered = await postJson(app, 'system/plugin', {
      tool: 'write',
      arguments: {
        id: 'probe',
        protocolVersion: 'plugin/v2',
        endpoint: 'binding:probe',
        auth: { kind: 'platform-token' },
        healthPath: '/healthz',
        enabled: true,
      },
    })
    expect(registered.status).toBe(200)

    // 注册时的 ~describe 抓取已经走过一次 binding。
    expect(seenSignal, 'binding 收到的 Request 没有 signal —— 上游挂住就无上界').toBeDefined()
    expect(seenSignal).not.toBeNull()
    expect(seenSignal?.aborted).toBe(false)
  })
})

/**
 * 内置 binding 插件**免手工注册**:挂载时若 provider 是宿主装配的 binding 却没注册,
 * 当场补齐 manifest 与 `~describe` 缓存。
 *
 * 为什么能省:内置插件与网关同源同构建,代码就在这个 Worker 里 —— 探活对它没有信息量
 * (不可能"连不上"),mint token 是同义反复(binding 直调跳过 token 校验)。真正必要的
 * 只有 `~describe` 缓存(挂载选 export、Dashboard 列凭证字段都靠它),故只做那一件。
 *
 * 边界:**只对装配表里有同名 binding 的 id 生效**。外挂 https 插件在网络那头,
 * 探活与契约校验是必要前置,仍须显式注册 —— 最后一个用例钉住这条。
 */
describe('内置 binding 插件免注册', () => {
  /**
   * 用 `builtinPluginBindings` 装配 —— 这是**生产宿主的真实装配方式**
   * (gateway 的 deployEntry.ts 就这么调),它递给插件的 env 带 `TB_PLUGIN_IN_PROCESS`,
   * 插件因此跳过 PLUGIN_TOKEN 校验。
   *
   * 上面那些用例手工造 Map 是为了模拟"宿主自己装配"并注入受控的 token;
   * 而免注册这条路**不 mint token**(那对同进程调用是同义反复),所以它必须配
   * 真实装配方式才成立 —— 这不是测试的将就,是这条能力的前置条件。
   */
  async function appWithBuiltins(): Promise<ReturnType<typeof createTbApp>> {
    const state = new MemoryStateStore()
    await runBootstrap(state, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
    return createTbApp({
      allowInsecureHttp: false,
      pluginBindings: builtinPluginBindings({}, { include: ['notes'] }),
      remote: { allowlist: [], maxHops: 4, allowInsecure: false },
      secrets: new SecretStoreImpl(state, TEST_ENCRYPTION_KEY),
      state,
      version: 'test',
    })
  }

  const mountNotes = (app: ReturnType<typeof createTbApp>, path = 'auto/notes') =>
    postJson(app, 'system/registry', {
      tool: 'write',
      arguments: {
        path,
        kind: 'tool',
        description: 'auto-registered notes',
        // notes 有两个 export,按契约必须显式指定 —— 与自动注册无关。
        config: { kind: 'tool', provider: 'notes', export: 'actions' },
      },
    })

  it('直接挂载未注册的 binding provider → 自动补齐,工具可列可调', async () => {
    const app = await appWithBuiltins()

    // 注意:没有 register 那一步。
    expect((await mountNotes(app)).status).toBe(200)

    // manifest 与 ~describe 缓存都已落库 —— plugin get 能读到。
    const got = await postJson(app, 'system/plugin', { tool: 'get', arguments: { id: 'notes' } })
    expect(got.status).toBe(200)
    const record = (await got.json()) as { endpoint: string, exports?: Array<{ id: string }> }
    expect(record.endpoint).toBe('binding:notes')
    // exports 缓存是关键:挂载表单选 export、Dashboard 的凭证提示都靠它。
    expect(record.exports?.map(e => e.id)).toContain('actions')

    // 真的能用(全程零网络出站 —— 本文件把 fetch 打桩为一碰即炸)。
    const help = await app.request(new Request('https://tb.test/auto/notes/~help', {
      headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, accept: 'text/plain' },
    }))
    expect(help.status).toBe(200)
    expect(parseHelpDsl(await help.text()).cmds.length).toBeGreaterThan(0)
  })

  it('catalog 随后把它标成已注册(自动与手工注册殊途同归)', async () => {
    const app = await appWithBuiltins()
    await mountNotes(app)
    const res = await postJson(app, 'system/plugin', { tool: 'catalog', arguments: {} })
    const items = ((await res.json()) as { items: Array<{ name: string, registered: boolean }> }).items
    expect(items.find(i => i.name === 'notes')?.registered).toBe(true)
  })

  it('**装配表里没有的 provider 仍然拒绝** —— 自动注册不是"什么都收"', async () => {
    const app = await appWithBuiltins()
    const res = await postJson(app, 'system/registry', {
      tool: 'write',
      arguments: {
        path: 'auto/nope',
        kind: 'tool',
        description: 'x',
        config: { kind: 'tool', provider: 'not-assembled' },
      },
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('not-assembled')
  })
})
