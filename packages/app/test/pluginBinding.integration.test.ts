import { MemoryStateStore, parseHelpDsl, SecretStoreImpl } from '@tool-bridge/core'
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
