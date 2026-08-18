import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryStateStore, SecretStoreImpl } from '@tool-bridge/core'
import { builtinPluginBindings } from '@tool-bridge/plugins'
import { TEST_ADMIN_SK, TEST_ENCRYPTION_KEY } from './fixtures'
import { createTbApp, runBootstrap } from '../src/index'

/**
 * 从 open-connector 迁移过来的 provider 挂上树的端到端验收。
 *
 * 走的是**生产装配路径**:`builtinPluginBindings()` 从内置目录懒加载 → 注册 → 带 authRef
 * 挂载 → `~help` → 调用。要证的三件事:
 *
 * 1. 迁移产物就是一个普通 tool-bridge 插件,平台侧不需要任何特殊分支;
 * 2. 凭证走平台通路:secret 进 SecretStore,挂载只写 authRef,插件侧拿到解出的明文
 *    —— 这是「凭证不出网关」在迁移产物上的证据;
 * 3. ToolSpec 的 outputSchema 一路透到工具级 `~help`。
 */

const API_KEY = 'wpkey_e2e'
let pluginToken: string | undefined
let upstream: ReturnType<typeof vi.fn>

async function appWithPlugin(): Promise<ReturnType<typeof createTbApp>> {
  const state = new MemoryStateStore()
  await runBootstrap(state, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
  return createTbApp({
    allowInsecureHttp: false,
    // env 每次调用才读 pluginToken(注册后才有值),故用转发闭包而非提前装配。
    pluginBindings: new Map([
      ['alt_text_generator_ai', (request: Request) =>
        builtinPluginBindings({ PLUGIN_TOKEN: pluginToken }, { include: ['alt_text_generator_ai'] })
          .get('alt_text_generator_ai')!(request)],
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

async function getJson(app: ReturnType<typeof createTbApp>, path: string): Promise<Response> {
  return app.request(new Request(`https://tb.test/${path}`, {
    headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, accept: 'application/json' },
  }))
}

/** 存凭证 + 注册 + 挂载,返回已就绪的 app。 */
async function mountedApp(): Promise<ReturnType<typeof createTbApp>> {
  const app = await appWithPlugin()

  expect((await postJson(app, 'system/secret', {
    tool: 'set',
    arguments: { name: 'alt-text-key', value: API_KEY },
  })).status).toBe(200)

  const registered = await postJson(app, 'system/plugin', {
    tool: 'write',
    arguments: {
      id: 'alt_text_generator_ai',
      protocolVersion: 'plugin/v2',
      endpoint: 'binding:alt_text_generator_ai',
      auth: { kind: 'platform-token' },
      healthPath: '/healthz',
      enabled: true,
    },
  })
  expect(registered.status).toBe(200)
  pluginToken = ((await registered.json()) as { pluginToken?: string }).pluginToken

  expect((await postJson(app, 'system/registry', {
    tool: 'write',
    arguments: {
      path: 'ai/alt-text',
      kind: 'tool',
      description: 'Alt text generation',
      config: {
        kind: 'tool',
        provider: 'alt_text_generator_ai',
        export: 'actions',
        authRef: 'alt-text-key',
      },
    },
  })).status).toBe(200)

  return app
}

beforeEach(() => {
  pluginToken = undefined
  upstream = vi.fn(() => Promise.resolve(new Response('A cat on a windowsill', { status: 200 })))
  vi.stubGlobal('fetch', upstream as unknown as typeof fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('迁移产物经 binding: 挂上树', () => {
  it('节点 ~help 是索引形态(不带 schema)', async () => {
    const app = await mountedApp()
    const help = await getJson(app, 'ai/alt-text/~help')
    expect(help.status).toBe(200)
    const model = (await help.json()) as { cmds: Array<{ name: string }> }
    expect(model.cmds.map(cmd => cmd.name)).toEqual(['generate_alt_text'])
    expect(model.cmds[0]).not.toHaveProperty('inputSchema')
    expect(model.cmds[0]).not.toHaveProperty('outputSchema')
  })

  it('工具级 ~help 带 Zod 派生的 inputSchema 与 outputSchema', async () => {
    const app = await mountedApp()
    const help = await getJson(app, 'ai/alt-text/generate_alt_text/~help')
    expect(help.status).toBe(200)
    const model = (await help.json()) as {
      cmds: Array<{ inputSchema?: { properties?: object }, outputSchema?: { properties?: object } }>
    }
    expect(model.cmds).toHaveLength(1)
    expect(model.cmds[0]?.inputSchema?.properties).toHaveProperty('imageUrl')
    expect(model.cmds[0]?.outputSchema?.properties).toHaveProperty('altText')
  })

  it('调用链:平台解 authRef → 插件 → 上游,凭证不出网关', async () => {
    const app = await mountedApp()
    const res = await postJson(app, 'ai/alt-text', {
      tool: 'generate_alt_text',
      arguments: { imageUrl: 'https://cdn.example.com/cat.jpg' },
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ altText: 'A cat on a windowsill' })

    // 唯一一次出站是打给上游那次(插件走进程内,无网络跳)。
    expect(upstream).toHaveBeenCalledTimes(1)
    const [request] = upstream.mock.calls[0] as [Request]
    expect(request.url).toBe('https://alttextgeneratorai.com/api/wp')
    await expect(request.json()).resolves.toEqual({
      image: 'https://cdn.example.com/cat.jpg',
      wpkey: API_KEY,
    })
  })

  it('入参校验在插件侧真的生效:非法 URL → 400,且不打上游', async () => {
    const app = await mountedApp()
    const res = await postJson(app, 'ai/alt-text', {
      tool: 'generate_alt_text',
      arguments: { imageUrl: 'not-a-url' },
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(upstream).not.toHaveBeenCalled()
  })
})
