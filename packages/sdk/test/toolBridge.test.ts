/**
 * SDK 集成测试(DoD ② 前半,DOD.md:105):createToolBridge + registerTool(本地函数工具)
 * → @hono/node-server 起本地 HTTP → ~help 可见工具、POST 调用成功;registerContext 同理;
 * secret 禁用语义;reservedRoots 生效。
 *
 * conformance 测试法(v1 借鉴):断言全部经 HTTP wire(fetch),不直捣内部对象——
 * SDK 与 curl 等价。
 */

import { serve } from '@hono/node-server'
import {
  MemoryObjectStore,
  MemoryStateStore,
  TBError,
  type ToolResult,
  type ToolSpec,
} from '@tool-bridge/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createToolBridge, type ToolBridge } from '../src'

const ADMIN_SK = 'tbk_sdk_test_admin_0000000000'
const ENCRYPTION_KEY = '3ZwpbBkSrp3eT9ylcZedfN33yq9fJLlmeusH98qNbt8'

const echoTool: ToolSpec = {
  name: 'echo',
  description: '原样返回 text',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
}

function echoProvider() {
  return {
    List: (): ToolSpec[] => [echoTool],
    Get: (name: string): ToolSpec => {
      if (name !== 'echo') throw TBError.notFound(`no such tool: ${name}`)
      return echoTool
    },
    Call: (name: string, args: Record<string, unknown>): ToolResult => {
      if (name !== 'echo') throw TBError.notFound(`no such tool: ${name}`)
      return { content: { echoed: args.text } }
    },
  }
}

/** 极简内存 ContextProvider(四动词;无 Search/Delete → 可选能力不出现)。 */
function memoryContextProvider() {
  const entries = new Map<string, { content: unknown; version: number; updatedAt: string }>()
  const meta = (path: string, e: { version: number; updatedAt: string }) => ({
    uri: `node://notes/${path}`,
    contentType: 'text/markdown',
    version: String(e.version),
    updatedAt: e.updatedAt,
    metadata: {},
  })
  return {
    async List() {
      return {
        items: [...entries.entries()].map(([path, e]) => meta(path, e)),
      }
    },
    async Get(path: string) {
      const e = entries.get(path)
      if (!e) throw TBError.notFound(`no such entry: ${path}`)
      return { ...meta(path, e), content: e.content }
    },
    async Write(path: string, entry: { content: unknown }) {
      const existing = entries.get(path)
      const e = {
        content: entry.content,
        version: (existing?.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      }
      entries.set(path, e)
      return meta(path, e)
    },
    async Update(path: string, patch: { content?: unknown }) {
      const existing = entries.get(path)
      if (!existing) throw TBError.notFound(`no such entry: ${path}`)
      const e = {
        content: patch.content ?? existing.content,
        version: existing.version + 1,
        updatedAt: new Date().toISOString(),
      }
      entries.set(path, e)
      return meta(path, e)
    },
  }
}

interface Harness {
  tb: ToolBridge
  baseUrl: string
  close: () => void
}

async function startHarness(config?: { encryptionKey?: string }): Promise<Harness> {
  const tb = createToolBridge({
    state: new MemoryStateStore(),
    objects: new MemoryObjectStore(),
    adminSk: ADMIN_SK,
    ...(config?.encryptionKey !== undefined ? { encryptionKey: config.encryptionKey } : {}),
  })
  tb.registerTool('tools/echo', echoProvider(), { description: '本地 echo 工具' })
  tb.registerContext('notes', memoryContextProvider(), { description: '进程内笔记' })

  const server = serve({ fetch: (req: Request) => tb.fetch(req), port: 0 })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no server port')
  return {
    tb,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => server.close(),
  }
}

async function call(
  h: Harness,
  path: string,
  init: RequestInit = {},
  sk: string = ADMIN_SK,
): Promise<Response> {
  return fetch(`${h.baseUrl}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${sk}`,
      accept: 'application/json',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
}

describe('createToolBridge:本地 HTTP(@hono/node-server)', () => {
  let h: Harness
  beforeAll(async () => {
    h = await startHarness({ encryptionKey: ENCRYPTION_KEY })
  })
  afterAll(() => h.close())

  it('healthz 免认证可达', async () => {
    const res = await fetch(`${h.baseUrl}/healthz`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { healthy: boolean; version: string }
    expect(body.healthy).toBe(true)
  })

  it('无 SK → 401', async () => {
    const res = await fetch(`${h.baseUrl}/~help`)
    expect(res.status).toBe(401)
  })

  it('registerTool 节点在 ~help/~tree 可见且列出工具', async () => {
    const tree = await call(h, '~tree?depth=3')
    expect(tree.status).toBe(200)
    const treeText = JSON.stringify(await tree.json())
    expect(treeText).toContain('tools/echo')

    const help = await call(h, 'tools/echo/~help')
    expect(help.status).toBe(200)
    const model = (await help.json()) as { cmds: Array<{ name: string }> }
    expect(model.cmds.map((c) => c.name)).toContain('echo')
  })

  it('POST 调用本地函数工具成功返回', async () => {
    const res = await call(h, 'tools/echo', {
      method: 'POST',
      body: JSON.stringify({ tool: 'echo', arguments: { text: 'hi sdk' } }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ echoed: 'hi sdk' })
  })

  it('registerContext 四动词经 HTTP 可用;未实现的可选方法被拒', async () => {
    const write = await call(h, 'notes', {
      method: 'POST',
      body: JSON.stringify({
        tool: 'Write',
        arguments: { path: 'a.md', entry: { content: 'hello' } },
      }),
    })
    expect(write.status).toBe(200)

    const get = await call(h, 'notes', {
      method: 'POST',
      body: JSON.stringify({ tool: 'Get', arguments: { path: 'a.md' } }),
    })
    expect(get.status).toBe(200)
    const entry = (await get.json()) as { content: unknown }
    expect(entry.content).toBe('hello')

    const list = await call(h, 'notes', {
      method: 'POST',
      body: JSON.stringify({ tool: 'List', arguments: { path: '' } }),
    })
    expect(list.status).toBe(200)

    const update = await call(h, 'notes', {
      method: 'POST',
      body: JSON.stringify({
        tool: 'Update',
        arguments: { path: 'a.md', patch: { content: 'hello v2' } },
      }),
    })
    expect(update.status).toBe(200)

    // Delete 未实现 → capability 未声明,unknown cmd 拒(Proto §8.2 同口径)。
    const del = await call(h, 'notes', {
      method: 'POST',
      body: JSON.stringify({ tool: 'Delete', arguments: { path: 'a.md' } }),
    })
    expect(del.status).toBe(400)

    // ~describe:无可选实现 → capabilities 空。
    const describeRes = await call(h, 'notes/~describe')
    expect(describeRes.status).toBe(200)
    expect(await describeRes.json()).toEqual({ kind: 'context', capabilities: [] })
  })

  it('r2 平台 provider 走注入的 objects(MemoryObjectStore)', async () => {
    const mount = await call(h, 'system/registry', {
      method: 'POST',
      body: JSON.stringify({
        tool: 'write',
        arguments: {
          path: 'docs/mem',
          kind: 'context',
          description: '内存对象桶',
          config: { kind: 'context', provider: 'r2' },
        },
      }),
    })
    expect(mount.status).toBe(200)
    const write = await call(h, 'docs/mem', {
      method: 'POST',
      body: JSON.stringify({
        tool: 'Write',
        arguments: { path: 'x.md', entry: { content: 'obj', contentType: 'text/markdown' } },
      }),
    })
    expect(write.status).toBe(200)
    const get = await call(h, 'docs/mem', {
      method: 'POST',
      body: JSON.stringify({ tool: 'Get', arguments: { path: 'x.md' } }),
    })
    expect(get.status).toBe(200)
    expect(((await get.json()) as { content: unknown }).content).toBe('obj')
  })

  it('registerTool 落库节点带 @local provider,注册面不可伪造', async () => {
    // 经注册面手工挂 kind:'tool' + provider '@local' → 拒(@local 不是已注册 plugin)。
    const res = await call(h, 'system/registry', {
      method: 'POST',
      body: JSON.stringify({
        tool: 'write',
        arguments: {
          path: 'evil/tool',
          kind: 'tool',
          description: 'forged',
          config: { kind: 'tool', provider: '@local' },
        },
      }),
    })
    expect(res.status).toBe(400)
  })
})

describe('createToolBridge:配置语义', () => {
  it('secret 禁用语义:无主密钥 → set 返回 unavailable', async () => {
    const tb = createToolBridge({ state: new MemoryStateStore(), adminSk: ADMIN_SK })
    const res = await tb.fetch(
      new Request('http://tb.local/system/secret', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ADMIN_SK}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ tool: 'set', arguments: { name: 'k', value: 'v' } }),
      }),
    )
    expect(res.status).toBe(503)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('unavailable')
  })

  it('reservedRoots 生效:追加保留根下注册被拒', async () => {
    const tb = createToolBridge({
      state: new MemoryStateStore(),
      adminSk: ADMIN_SK,
      reservedRoots: ['corp'],
    })
    // admin 无 registerPaths → §2.4b:保留根(含追加)下注册一律拒。
    const res = await tb.fetch(
      new Request('http://tb.local/corp/x/~register', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ADMIN_SK}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ path: 'corp/x', kind: 'directory', description: 'nope' }),
      }),
    )
    expect(res.status).toBe(403)
    // 非保留根照常可注册。
    const ok = await tb.fetch(
      new Request('http://tb.local/free/x/~register', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ADMIN_SK}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ path: 'free/x', kind: 'directory', description: 'ok' }),
      }),
    )
    expect(ok.status).toBe(200)
  })

  it('objects 未注入:r2 provider → 503 unavailable', async () => {
    const tb = createToolBridge({ state: new MemoryStateStore(), adminSk: ADMIN_SK })
    const headers = {
      authorization: `Bearer ${ADMIN_SK}`,
      'content-type': 'application/json',
      accept: 'application/json',
    }
    const mount = await tb.fetch(
      new Request('http://tb.local/system/registry', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool: 'write',
          arguments: {
            path: 'docs/r2',
            kind: 'context',
            description: 'no objects',
            config: { kind: 'context', provider: 'r2' },
          },
        }),
      }),
    )
    expect(mount.status).toBe(200)
    const res = await tb.fetch(
      new Request('http://tb.local/docs/r2', {
        method: 'POST',
        headers,
        body: JSON.stringify({ tool: 'List', arguments: { path: '' } }),
      }),
    )
    expect(res.status).toBe(503)
  })

  it('deviceTransport 注入 → unimplemented(本轮未实现,语义显式)', () => {
    expect(() =>
      createToolBridge({
        state: new MemoryStateStore(),
        deviceTransport: { onConnection: () => {} },
      }),
    ).toThrow(TBError)
  })

  it('device 能力禁用:未注入 deviceTransport → /system/device/ws 501', async () => {
    const tb = createToolBridge({ state: new MemoryStateStore(), adminSk: ADMIN_SK })
    const res = await tb.fetch(
      new Request('http://tb.local/system/device/ws?deviceId=x', {
        headers: { authorization: `Bearer ${ADMIN_SK}`, upgrade: 'websocket' },
      }),
    )
    expect(res.status).toBe(501)
  })
})
