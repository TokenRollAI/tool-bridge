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
import { createPlugin, TBError } from '../src'

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

describe('proxyTools:工具表来自上游的代理型 export', () => {
  /** 上游只有拿到"凭证"才肯报工具表 —— 与飞书 plugin 的真实形状同构。 */
  function makeProxy(seen: string[] = []) {
    const plugin = createPlugin<Env>({ token: env => env.PLUGIN_TOKEN })
    plugin.proxyTools('upstream', {
      description: '代理上游工具',
      list: (ctx) => {
        if (ctx.upstreamAuth === undefined) throw new TBError('unavailable', 'missing credential')
        seen.push(`list:${ctx.upstreamAuth}`)
        return [{ name: 'remote_tool', description: '上游的工具', effect: 'write' }]
      },
      call: ({ name, args }, ctx) => {
        seen.push(`call:${name}:${JSON.stringify(args)}:${ctx.exportId}`)
        return { content: [{ type: 'text', text: name }] }
      },
    })
    return plugin
  }

  const CALLER_PROXY: CallContext = { ...CALLER, exportId: 'upstream' }

  it('~describe 与静态 tools export 同形(profile tools/v1);~help 标 dynamic 且空表', async () => {
    const plugin = makeProxy()
    const desc = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV)
    expect(await desc.json()).toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{ id: 'upstream', profile: 'tools/v1', description: '代理上游工具' }],
    })

    const help = await plugin.fetch(new Request('https://plugin.test/~help'), ENV)
    expect(await help.json()).toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{ id: 'upstream', dynamic: true, cmds: [] }],
    })
  })

  it('List 走 handler 并拿到解包后的上游凭证;Call 的裸参数由 SDK 规整', async () => {
    const seen: string[] = []
    const plugin = makeProxy(seen)
    const list = await plugin.fetch(
      envelope({ tool: 'List', arguments: {} }, { caller: CALLER_PROXY, upstreamAuth: 'secret-x' }),
      ENV,
    )
    expect(await list.json()).toEqual([
      { name: 'remote_tool', description: '上游的工具', effect: 'write' },
    ])

    const call = await plugin.fetch(
      envelope(
        { tool: 'Call', arguments: { name: 'remote_tool', args: { a: 1 } } },
        { caller: CALLER_PROXY, upstreamAuth: 'secret-x' },
      ),
      ENV,
    )
    // 上游已是 ToolResult 形状 → 原样透传(不二次包装)。
    expect(await call.json()).toEqual({ content: [{ type: 'text', text: 'remote_tool' }] })
    expect(seen).toEqual([
      'list:secret-x',
      'call:remote_tool:{"a":1}:upstream',
    ])
  })

  it('Call 缺 name → 400;Get 不是协议动词 → 400;两者都不进 handler', async () => {
    const seen: string[] = []
    const plugin = makeProxy(seen)
    const noName = await plugin.fetch(
      envelope({ tool: 'Call', arguments: {} }, { caller: CALLER_PROXY, upstreamAuth: 's' }),
      ENV,
    )
    expect(noName.status).toBe(400)

    const get = await plugin.fetch(
      envelope({ tool: 'Get', arguments: { name: 'remote_tool' } }, { caller: CALLER_PROXY }),
      ENV,
    )
    expect(get.status).toBe(400)
    expect(seen).toEqual([])
  })

  it('坏 X-TB-Upstream-Auth → 400 invalid_argument(不是 500)', async () => {
    const plugin = makeProxy()
    const req = envelope({ tool: 'List', arguments: {} }, { caller: CALLER_PROXY })
    const headers = new Headers(req.headers)
    headers.set(HEADER_TB_UPSTREAM_AUTH, 'not-base64url!!!')
    const res = await plugin.fetch(
      new Request(req.url, { method: 'POST', headers, body: await req.text() }),
      ENV,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('base64url')
  })
})

describe('鉴权 fail closed(未配置 PLUGIN_TOKEN)', () => {
  /**
   * 此前这里只要求 Bearer 非空,理由是"避免完全裸奔"。但那让一个部署错误
   * (忘了 `wrangler secret put PLUGIN_TOKEN`)变成:公网任何人自造 X-TB-Context 就能调
   * 全部 action,把插件当匿名出站中转 —— 而且毫无征兆。
   *
   * 本地开发的便利该由显式开关表达,不该让"缺配置"这条路默认放行。
   */
  function bareplugin(): ReturnType<typeof createPlugin> {
    const plugin = createPlugin<{ PLUGIN_TOKEN?: string, TB_PLUGIN_ALLOW_ANY_TOKEN?: string }>({
      token: env => env.PLUGIN_TOKEN,
    })
    plugin.tools('actions', { description: 'x' })
      .register('ping', { description: 'p', effect: 'read' }, () => ({ ok: true }))
    return plugin as ReturnType<typeof createPlugin>
  }

  function call(env: Record<string, string | undefined>): Promise<Response> {
    return Promise.resolve(bareplugin().fetch(
      new Request('https://p.test/', {
        method: 'POST',
        headers: {
          authorization: 'Bearer anything',
          [HEADER_TB_CONTEXT]: encodeCallContext({
            keyId: 'k', owner: 'agent:x', scopes: [], traceId: 't',
            mountPath: 'p', exportId: 'actions',
          }),
        },
        body: JSON.stringify({ tool: 'Call', arguments: { name: 'ping', args: {} } }),
      }),
      env as never,
    ))
  }

  it('**没配 PLUGIN_TOKEN 时拒绝调用**,消息说清该配什么', async () => {
    const res = await call({})
    expect(res.status).toBe(503)
    const body = (await res.json()) as { message: string }
    expect(body.message).toContain('PLUGIN_TOKEN')
    expect(body.message).toContain('TB_PLUGIN_ALLOW_ANY_TOKEN')
  })

  it('显式开发开关才放行(而且仍要求 Bearer 非空)', async () => {
    expect((await call({ TB_PLUGIN_ALLOW_ANY_TOKEN: 'true' })).status).toBe(200)
    // 非 'true' 的任意值不算开启 —— 免得 =0 / =false 被当成打开。
    expect((await call({ TB_PLUGIN_ALLOW_ANY_TOKEN: '1' })).status).toBe(503)
    expect((await call({ TB_PLUGIN_ALLOW_ANY_TOKEN: 'false' })).status).toBe(503)
  })

  it('配了 token 就按 token 校验(开发开关无关)', async () => {
    const res = await call({ PLUGIN_TOKEN: 'tbk_real', TB_PLUGIN_ALLOW_ANY_TOKEN: 'true' })
    // 送的是 'Bearer anything',与真 token 不符 → 401。
    expect(res.status).toBe(401)
  })
})

describe('oauth:平台托管的 provider 型 OAuth2 声明', () => {
  const OAUTH = {
    authorizationUrl: 'https://sentry.io/oauth/authorize',
    tokenUrl: 'https://sentry.io/oauth/token/',
    scopes: ['project:read', 'event:read'],
  }

  function oauthPlugin(): ReturnType<typeof createPlugin<Env>> {
    const plugin = createPlugin<Env>({ token: env => env.PLUGIN_TOKEN })
    plugin.tools('actions', { description: 'Sentry' })
      .oauth(OAUTH)
      .register('list_projects', { description: 'List projects', effect: 'read' }, () => ({ projects: [] }))
    return plugin
  }

  it('~describe 把 oauth 原样报给平台(平台据此发起授权码流程)', async () => {
    const res = await oauthPlugin().fetch(new Request('https://plugin.test/~describe'), ENV)
    const body = (await res.json()) as { exports: Array<{ oauth?: unknown, profile: string }> }
    expect(body.exports[0]?.profile).toBe('tools/v1')
    expect(body.exports[0]?.oauth).toEqual(OAUTH)
  })

  it('没声明 oauth 的 export 不带这个字段(不是 undefined 占位)', async () => {
    const res = await makePlugin().fetch(new Request('https://plugin.test/~describe'), ENV)
    const body = (await res.json()) as { exports: Array<Record<string, unknown>> }
    expect('oauth' in body.exports[0]!).toBe(false)
  })

  // 下面三条是互斥约束。平台侧契约也会拒(core/plugin/contract.ts),但那要等注册时才
  // 400 —— 作者看到的是一个远端错误。在 SDK 当场炸,错误发生在写代码的地方。
  it('已声明 oauth 再声明 credentials() → 当场拒', () => {
    const plugin = createPlugin<Env>({ token: env => env.PLUGIN_TOKEN })
    const tools = plugin.tools('actions').oauth(OAUTH)
    expect(() => tools.credentials([{ key: 'appId', label: 'App ID', required: true }]))
      .toThrow(/已声明 oauth/)
  })

  it('已声明 credentials() 再声明 oauth → 当场拒(两个方向都拦,声明顺序不影响)', () => {
    const plugin = createPlugin<Env>({ token: env => env.PLUGIN_TOKEN })
    const tools = plugin.tools('actions').credentials([{ key: 'appId', label: 'App ID', required: true }])
    expect(() => tools.oauth(OAUTH)).toThrow(/已声明 credentials/)
  })

  it('oauth 与 credentialProbe 互斥:拿 client 凭证去调探针会把 clientSecret 送进插件', () => {
    const plugin = createPlugin<Env>({ token: env => env.PLUGIN_TOKEN })
    const tools = plugin.tools('actions')
      .register('list_projects', { description: 'List', effect: 'read' }, () => ({}))
    tools.oauth(OAUTH)
    expect(() => tools.probeCredentialWith('list_projects')).toThrow(/已声明 oauth/)

    const other = createPlugin<Env>({ token: env => env.PLUGIN_TOKEN })
    const t2 = other.tools('actions')
      .register('list_projects', { description: 'List', effect: 'read' }, () => ({}))
    t2.probeCredentialWith('list_projects')
    expect(() => t2.oauth(OAUTH)).toThrow(/已声明 credentialProbe/)
  })
})
