import { MemoryStateStore, parseHelpDsl, SecretStoreImpl } from '@tool-bridge/core'
import { BUILTIN_CATALOG, builtinPluginBindings } from '@tool-bridge/plugins'
import { createNotesPlugin, type Env } from '@tool-bridge/plugins/notes'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
 * 内置 binding 插件**免手工注册**:装配了 catalog 的宿主,直接挂载即可用。
 *
 * 免的不是"注册这个动作",而是**注册这份状态**:内置插件的 descriptor 由构建期求值
 * `~describe` 生成(`catalog.generated.ts`),与插件代码同一份构建产物 —— 不需要先搬进 KV
 * 再读出来。故解析走 catalog,**零写库**。
 *
 * 此前这条能力由 `autoRegisterBinding` 兑现:读到未注册就当场写 `plugin:` + `pluginmeta:`。
 * 那让 help/call 这类读操作带上写副作用(删掉后随便读一次就复活),而且 7 个调用点里
 * 传 deps 还是传裸 store 是随手决定的。现在解析函数结构上拿不到写能力。
 *
 * 边界:**只对 catalog 里有的 id 生效**。外挂 https 插件在网络那头,探活与契约校验是必要
 * 前置,仍须显式注册 —— 倒数第二个用例钉住这条。
 */
describe('内置 binding 插件免注册', () => {
  /**
   * 用 `builtinPluginBindings` + `BUILTIN_CATALOG` 装配 —— **生产宿主的真实装配方式**
   * (gateway `deployEntry.ts` 与 server `main.ts` 都这么调)。两者是一对:catalog 说
   * "声明了什么",bindings 说"代码在哪"。
   *
   * bindings 那半边还有个前置条件:`builtinPluginBindings` 递给插件的 env 带
   * `TB_PLUGIN_IN_PROCESS`,插件因此跳过 PLUGIN_TOKEN 校验。上面那些用例手工造 Map 是为了
   * 模拟"宿主自己装配"并注入受控 token;这里必须用真实装配方式才成立。
   */
  async function appWithBuiltins(): Promise<ReturnType<typeof createTbApp>> {
    const state = new MemoryStateStore()
    await runBootstrap(state, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
    return createTbApp({
      allowInsecureHttp: false,
      pluginBindings: builtinPluginBindings({}, { include: ['notes'] }),
      pluginCatalog: { notes: BUILTIN_CATALOG.notes! },
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

  it('直接挂载未注册的 binding provider → 工具可列可调', async () => {
    const app = await appWithBuiltins()

    // 注意:没有 register 那一步。
    expect((await mountNotes(app)).status).toBe(200)

    // 真的能用(全程零网络出站 —— 本文件把 fetch 打桩为一碰即炸)。
    const help = await app.request(new Request('https://tb.test/auto/notes/~help', {
      headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, accept: 'text/plain' },
    }))
    expect(help.status).toBe(200)
    expect(parseHelpDsl(await help.text()).cmds.length).toBeGreaterThan(0)
  })

  /**
   * **A1 的回归**:挂载 + 读一整轮之后,注册表里一条 plugin 记录都不该有。
   *
   * 此前这里会写 `plugin:notes` 与 `pluginmeta:notes`,于是 `tb plugin rm notes` 删掉后
   * 任何一次 help/call 都会把它写回来 —— 删除即复活。现在 builtin 不落库,`plugin list`
   * 因此只列真正注册过的 external plugin(而内置目录由 catalog 呈现)。
   */
  it('挂载与调用全程零写库(删除即复活的回归)', async () => {
    const app = await appWithBuiltins()
    await mountNotes(app)
    await app.request(new Request('https://tb.test/auto/notes/~help', {
      headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, accept: 'text/plain' },
    }))

    const listed = await postJson(app, 'system/plugin', { tool: 'list', arguments: {} })
    expect(((await listed.json()) as { items: unknown[] }).items).toEqual([])

    // get 也读不到:它从来没被注册过,而这正是"内置目录项不落库"的意思。
    const got = await postJson(app, 'system/plugin', { tool: 'get', arguments: { id: 'notes' } })
    expect(got.status).toBe(404)
  })

  it('catalog 仍把它列为可用(available,但不是 registered)', async () => {
    const app = await appWithBuiltins()
    await mountNotes(app)
    const res = await postJson(app, 'system/plugin', { tool: 'catalog', arguments: {} })
    const items = ((await res.json()) as { items: Array<{ name: string, registered: boolean }> }).items
    const notes = items.find(i => i.name === 'notes')
    expect(notes).toBeDefined()
    // registered 现在如实反映"有没有 external 注册记录" —— 内置插件可用但未注册。
    expect(notes?.registered).toBe(false)
  })

  it('**catalog 里没有的 provider 仍然拒绝** —— 免注册不是"什么都收"', async () => {
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

  /**
   * 装配了 bindings 却没给 catalog:插件调得动,但解析不出 export。这条把那个失配钉成
   * 明确的 invalid_argument,而不是让它表现成别的什么 —— 宿主该两者同源装配。
   */
  it('只给 bindings 不给 catalog → 解析不出 export(装配失配是可见的)', async () => {
    const state = new MemoryStateStore()
    await runBootstrap(state, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
    const app = createTbApp({
      allowInsecureHttp: false,
      pluginBindings: builtinPluginBindings({}, { include: ['notes'] }),
      remote: { allowlist: [], maxHops: 4, allowInsecure: false },
      secrets: new SecretStoreImpl(state, TEST_ENCRYPTION_KEY),
      state,
      version: 'test',
    })
    const res = await mountNotes(app)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('notes')
  })
})
