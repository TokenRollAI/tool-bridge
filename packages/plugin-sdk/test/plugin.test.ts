/**
 * plugin-sdk:作者只声明操作,SDK 接管整套协议。
 * 断言全部经 `fetch(Request)` 走 wire —— 与平台真实调用等价,不直捣内部对象。
 */

import {
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_REQUEST_ID,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { createPlugin } from '../src'

interface Env { PLUGIN_TOKEN: string }
const ENV: Env = { PLUGIN_TOKEN: 'tok-secret' }

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'feishu',
}

/** 一个同时导出 tools 与 context 的 plugin —— 作者不写任何 JSON Schema 或 List/Get/Call。 */
function makePlugin(calls: string[] = []) {
  const plugin = createPlugin<Env>({ token: env => env.PLUGIN_TOKEN })

  plugin
    .tools('actions', { description: 'Demo actions' })
    .register(
      'create_document',
      {
        description: 'Create a document',
        effect: 'write',
        inputSchema: z.object({
          title: z.string().describe('Document title'),
          content: z.string().optional(),
        }),
      },
      ({ title }, ctx) => {
        calls.push(`create:${title}:${ctx.exportId}:${ctx.upstreamAuth ?? '-'}`)
        return { created: title }
      },
    )
    .register('ping', {}, () => 'pong')

  plugin.context('documents', {
    description: 'Demo documents',
    get: ({ path }) => ({ path, content: 'hello' }),
    list: ({ path }) => ({ items: [{ path }] }),
    search: ({ query }) => ({ items: [{ query }] }),
  })

  return plugin
}

function envelope(
  body: unknown,
  opts: { caller?: CallContext, requestId?: string, token?: string, upstreamAuth?: string } = {},
): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'authorization': `Bearer ${opts.token ?? ENV.PLUGIN_TOKEN}`,
    [HEADER_TB_CONTEXT]: encodeCallContext(opts.caller ?? CALLER),
  }
  if (opts.requestId !== undefined) headers[HEADER_TB_REQUEST_ID] = opts.requestId
  if (opts.upstreamAuth !== undefined) {
    const bytes = new TextEncoder().encode(opts.upstreamAuth)
    const b64 = btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    headers[HEADER_TB_UPSTREAM_AUTH] = b64
  }
  return new Request('https://plugin.test/', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

const withExport = (id: string): CallContext => ({ ...CALLER, exportId: id })

describe('契约面(生命周期 GET)', () => {
  it('healthz', async () => {
    const res = await makePlugin().fetch(new Request('https://plugin.test/healthz'), ENV)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ healthy: true })
  })

  it('~describe:一个 plugin 同时导出 tools 与 context;context 的 methods/capabilities 按 handler 推导', async () => {
    const res = await makePlugin().fetch(new Request('https://plugin.test/~describe'), ENV)
    const body = (await res.json()) as {
      exports: Array<{ capabilities?: string[], id: string, methods?: string[], profile: string }>
      protocolVersion: string
    }
    expect(body.protocolVersion).toBe('plugin/v2')
    expect(body.exports.map(e => [e.id, e.profile])).toEqual([
      ['actions', 'tools/v1'],
      ['documents', 'context/v1'],
    ])
    const docs = body.exports[1]
    // 只写了 get/list/search → 只声明这三个动词;未写 write/update/delete 就不声明。
    expect(docs?.methods?.sort()).toEqual(['Get', 'List', 'Search'])
    expect(docs?.capabilities).toEqual(['search'])
  })

  it('~help 列出每个 export 的真实操作', async () => {
    const res = await makePlugin().fetch(new Request('https://plugin.test/~help'), ENV)
    const body = (await res.json()) as { exports: Array<{ cmds: Array<{ name: string }>, id: string }> }
    expect(body.exports[0]?.cmds.map(c => c.name)).toEqual(['create_document', 'ping'])
    expect(body.exports[1]?.cmds.map(c => c.name).sort()).toEqual(['Get', 'List', 'Search'])
  })

  it('未知路径 → 404', async () => {
    const res = await makePlugin().fetch(new Request('https://plugin.test/nope'), ENV)
    expect(res.status).toBe(404)
  })
})

describe('鉴权', () => {
  it('token 不符 → 401', async () => {
    const res = await makePlugin().fetch(
      envelope({ tool: 'List', arguments: {} }, { caller: withExport('actions'), token: 'wrong' }),
      ENV,
    )
    expect(res.status).toBe(401)
  })

  it('缺 X-TB-Context → invalid_argument', async () => {
    const req = new Request('https://plugin.test/', {
      method: 'POST',
      headers: { authorization: `Bearer ${ENV.PLUGIN_TOKEN}` },
      body: JSON.stringify({ tool: 'List', arguments: {} }),
    })
    const res = await makePlugin().fetch(req, ENV)
    expect(res.status).toBe(400)
  })
})

describe('tools export', () => {
  it('List 回 ToolSpec,inputSchema 由 Zod 自动派生(作者未写一行 JSON Schema)', async () => {
    const res = await makePlugin().fetch(
      envelope({ tool: 'List', arguments: {} }, { caller: withExport('actions') }),
      ENV,
    )
    const specs = (await res.json()) as Array<{ effect?: string, inputSchema?: Record<string, unknown>, name: string }>
    expect(specs.map(s => s.name)).toEqual(['create_document', 'ping'])
    const schema = specs[0]?.inputSchema as { properties?: Record<string, { description?: string }>, required?: string[] }
    expect(schema.required).toEqual(['title'])
    expect(schema.properties?.title?.description).toBe('Document title')
    expect(specs[0]?.effect).toBe('write')
  })

  it('Call 校验入参并把裸返回值包成 ToolResult;上游凭证解包后送达 handler', async () => {
    const calls: string[] = []
    const res = await makePlugin(calls).fetch(
      envelope(
        { tool: 'Call', arguments: { name: 'create_document', args: { title: 'Spec' } } },
        { caller: withExport('actions'), upstreamAuth: 'upstream-token' },
      ),
      ENV,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ content: { created: 'Spec' } })
    expect(calls).toEqual(['create:Spec:actions:upstream-token'])
  })

  it('入参不合 schema → invalid_argument,消息含字段名', async () => {
    const res = await makePlugin().fetch(
      envelope(
        { tool: 'Call', arguments: { name: 'create_document', args: { title: 42 } } },
        { caller: withExport('actions') },
      ),
      ENV,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('title')
  })

  it('平台从不发 Get(v1 的纯样板)→ 未知方法', async () => {
    const res = await makePlugin().fetch(
      envelope({ tool: 'Get', arguments: { name: 'ping' } }, { caller: withExport('actions') }),
      ENV,
    )
    expect(res.status).toBe(400)
  })

  it('同一 X-TB-Request-Id 重放 → handler 只执行一次', async () => {
    const calls: string[] = []
    const plugin = makePlugin(calls)
    const body = { tool: 'Call', arguments: { name: 'create_document', args: { title: 'Once' } } }
    const first = await plugin.fetch(
      envelope(body, { caller: withExport('actions'), requestId: 'req-1' }),
      ENV,
    )
    const second = await plugin.fetch(
      envelope(body, { caller: withExport('actions'), requestId: 'req-1' }),
      ENV,
    )
    expect(await first.json()).toEqual(await second.json())
    expect(calls).toHaveLength(1)
  })
})

describe('context export', () => {
  it('已实现的动词经 wire 可用', async () => {
    const res = await makePlugin().fetch(
      envelope({ tool: 'Get', arguments: { path: 'a.md' } }, { caller: withExport('documents') }),
      ENV,
    )
    expect(await res.json()).toEqual({ path: 'a.md', content: 'hello' })
  })

  it('未实现的动词(Write)→ invalid_argument,而不是假装成功', async () => {
    const res = await makePlugin().fetch(
      envelope(
        { tool: 'Write', arguments: { path: 'a.md', entry: { content: 'x' } } },
        { caller: withExport('documents') },
      ),
      ENV,
    )
    expect(res.status).toBe(400)
    expect((await res.json() as { message: string }).message).toContain('not implemented')
  })
})

describe('export 路由', () => {
  it('exportId 命中对应 export', async () => {
    const res = await makePlugin().fetch(
      envelope({ tool: 'List', arguments: { path: '' } }, { caller: withExport('documents') }),
      ENV,
    )
    // documents 的 List 返回 items,不是 ToolSpec 数组
    expect(await res.json()).toEqual({ items: [{ path: '' }] })
  })

  it('未知 exportId → invalid_argument', async () => {
    const res = await makePlugin().fetch(
      envelope({ tool: 'List', arguments: {} }, { caller: withExport('nope') }),
      ENV,
    )
    expect(res.status).toBe(400)
  })

  it('单 export plugin 可省略 exportId', async () => {
    const solo = createPlugin<Env>({ token: env => env.PLUGIN_TOKEN })
    solo.tools('only').register('ping', {}, () => 'pong')
    const res = await solo.fetch(
      envelope({ tool: 'Call', arguments: { name: 'ping', args: {} } }, { caller: CALLER }),
      ENV,
    )
    expect(await res.json()).toEqual({ content: 'pong' })
  })

  it('多 export 但未给 exportId → invalid_argument(不猜)', async () => {
    const res = await makePlugin().fetch(
      envelope({ tool: 'List', arguments: {} }, { caller: CALLER }),
      ENV,
    )
    expect(res.status).toBe(400)
  })

  it('重复 export id → 声明期即失败', () => {
    const p = createPlugin<Env>()
    p.tools('dup')
    expect(() => p.tools('dup')).toThrow(/already declared/)
  })
})
