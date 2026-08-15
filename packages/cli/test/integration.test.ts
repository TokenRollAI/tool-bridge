import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFetch, setFetch } from '../src/http'
import { runCli } from './cliHarness'

/**
 * `tb integration` —— 集成的用户面。
 *
 * 重点验的是**编排**:一条 `add` 内部做 secret set + mount(+ oauth 提示),而 authRef
 * 不再是用户手打的自由文本(拼错不报错、agent 首次调用才 401),改由挂载路径派生。
 */

interface Call { body: unknown, url: string }

/** 按 URL 路由的桩:catalog 查询与后续写操作用同一个 fetch。 */
function routedFetch(routes: Array<{ body: unknown, match: RegExp, status?: number }>): Call[] {
  const calls: Call[] = []
  setFetch((async (url: string, init?: RequestInit) => {
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    calls.push({ url: String(url), body })
    const route = routes.find(r => r.match.test(String(url)))
    const payload = route?.body ?? {}
    return new Response(JSON.stringify(payload), {
      status: route?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch)
  return calls
}

/** 只有 catalog 一条路由时的常用形状。 */
function catalogOf(items: unknown[]): { body: unknown, match: RegExp } {
  return { match: /system\/catalog/, body: { items } }
}

const TAVILY = {
  id: 'tavily',
  digest: 'd1',
  exports: ['actions'],
  nodeKinds: ['tool'],
  needsOAuth: false,
  description: 'Tavily',
}

const JIRA = {
  id: 'jira',
  digest: 'd2',
  exports: ['actions'],
  nodeKinds: ['tool'],
  needsOAuth: false,
  credentialFields: [
    { key: 'baseUrl', required: true, secret: false },
    { key: 'personalAccessToken', required: true, secret: true },
  ],
}

const SENTRY = {
  id: 'sentry',
  digest: 'd3',
  exports: ['actions'],
  nodeKinds: ['tool'],
  needsOAuth: true,
}

/** 自建实例型:单值凭证 + 一个必配的非凭证 baseUrl。 */
const MEMOS = {
  id: 'memos',
  digest: 'd4',
  exports: ['actions'],
  nodeKinds: ['tool'],
  needsOAuth: false,
  mountConfigFields: [
    { key: 'baseUrl', label: '实例地址', required: true },
  ],
}

const savedBaseUrl = process.env.TB_BASE_URL

beforeEach(() => {
  process.exitCode = 0
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  process.exitCode = 0
  process.env.TB_BASE_URL = savedBaseUrl
  resetFetch()
  vi.restoreAllMocks()
})

const base = ['--json', '--base-url', 'https://gw', '--sk', 'tbk_x']

/** 平台调用的 wire body:`{tool, arguments}`(builtin)或 NodeInput(`~register`)。 */
interface WireBody {
  arguments?: Record<string, string>
  config?: Record<string, unknown>
  kind?: string
  tool?: string
}

const bodyOf = (calls: Call[], re: RegExp): WireBody | undefined =>
  calls.find(c => re.test(c.url))?.body as WireBody | undefined

describe('tb integration add', () => {
  it('单值凭证:代建 secret(名字由路径派生)后挂载,authRef 自动对上', async () => {
    const calls = routedFetch([catalogOf([TAVILY])])
    await runCli([
      'integration',
      'add',
      'tools/tavily',
      '--provider',
      'tavily',
      '--key',
      'tvly-secret',
      ...base,
    ])
    expect(process.exitCode).toBe(0)

    const secret = bodyOf(calls, /system\/secret/)
    expect(secret.arguments.name).toBe('integration-tools-tavily')
    expect(secret.arguments.value).toBe('tvly-secret')

    const mount = bodyOf(calls, /~register/)
    expect(mount.config).toEqual({
      kind: 'tool',
      provider: 'tavily',
      authRef: 'integration-tools-tavily',
    })
  })

  it('多字段凭证:编码成 JSON 对象存同一个 secret', async () => {
    const calls = routedFetch([catalogOf([JIRA])])
    await runCli([
      'integration',
      'add',
      'tools/jira',
      '--provider',
      'jira',
      '--field',
      'baseUrl=https://x.atlassian.net',
      '--field',
      'personalAccessToken=pat',
      ...base,
    ])
    expect(process.exitCode).toBe(0)
    const secret = bodyOf(calls, /system\/secret/)
    expect(JSON.parse(secret.arguments.value)).toEqual({
      baseUrl: 'https://x.atlassian.net',
      personalAccessToken: 'pat',
    })
  })

  /** 拼错字段名此前静默成功,第一次调用才炸。 */
  it('字段名拼错 → 本地拒(catalog 知道声明了哪些)', async () => {
    const calls = routedFetch([catalogOf([JIRA])])
    await runCli([
      'integration',
      'add',
      'tools/jira',
      '--provider',
      'jira',
      '--field',
      'baseURL=https://x',
      '--field',
      'personalAccessToken=pat',
      ...base,
    ])
    expect(process.exitCode).not.toBe(0)
    expect(bodyOf(calls, /system\/secret/)).toBeUndefined()
    expect(bodyOf(calls, /~register/)).toBeUndefined()
  })

  it('少给字段 → 本地拒(平台挂载时也会拒,但这里能说清缺哪个)', async () => {
    const calls = routedFetch([catalogOf([JIRA])])
    await runCli([
      'integration',
      'add',
      'tools/jira',
      '--provider',
      'jira',
      '--field',
      'baseUrl=https://x',
      ...base,
    ])
    expect(process.exitCode).not.toBe(0)
    expect(bodyOf(calls, /~register/)).toBeUndefined()
  })

  it('多字段 provider 给了单值 → 本地拒并说清该用 --field', async () => {
    const calls = routedFetch([catalogOf([JIRA])])
    await runCli(['integration', 'add', 'tools/jira', '--provider', 'jira', '--key', 'x', ...base])
    expect(process.exitCode).not.toBe(0)
    expect(bodyOf(calls, /~register/)).toBeUndefined()
  })

  it('--secret 复用已有 secret:不代建,authRef 用给定名字', async () => {
    const calls = routedFetch([catalogOf([SENTRY])])
    await runCli([
      'integration',
      'add',
      'tools/sentry',
      '--provider',
      'sentry',
      '--secret',
      'sentry-client',
      ...base,
    ])
    expect(process.exitCode).toBe(0)
    expect(bodyOf(calls, /system\/secret/)).toBeUndefined()
    expect(bodyOf(calls, /~register/).config.authRef).toBe('sentry-client')
  })

  it('凭证四种给法互斥', async () => {
    const calls = routedFetch([catalogOf([TAVILY])])
    await runCli([
      'integration',
      'add',
      'p',
      '--provider',
      'tavily',
      '--key',
      'a',
      '--secret',
      'b',
      ...base,
    ])
    expect(process.exitCode).not.toBe(0)
    expect(bodyOf(calls, /~register/)).toBeUndefined()
  })

  it('oauth 型:挂载后 needsAuthorization=true', async () => {
    routedFetch([catalogOf([SENTRY])])
    const lines: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk))
      return true
    })
    await runCli([
      'integration',
      'add',
      'tools/sentry',
      '--provider',
      'sentry',
      '--secret',
      'c',
      ...base,
    ])
    expect(JSON.parse(lines.join('')).needsAuthorization).toBe(true)
  })

  it('--config 进 providerConfig,凭证与配置分开两条通道', async () => {
    const calls = routedFetch([catalogOf([TAVILY])])
    await runCli([
      'integration',
      'add',
      'notes/memos',
      '--provider',
      'tavily',
      '--key',
      'k',
      '--config',
      'baseUrl=https://memos.example.com',
      ...base,
    ])
    const mount = bodyOf(calls, /~register/)
    expect(mount.config.providerConfig).toEqual({ baseUrl: 'https://memos.example.com' })
    expect(mount.config.authRef).toBe('integration-notes-memos')
  })

  /** 必配的非凭证配置缺失,此前要等 credentialProbe 或首次调用才炸;现在挂载前拦。 */
  it('缺必填 mountConfig(baseUrl)→ 本地拒,不写 secret 不挂载', async () => {
    const calls = routedFetch([catalogOf([MEMOS])])
    await runCli([
      'integration',
      'add',
      'notes/memos',
      '--provider',
      'memos',
      '--key',
      'k',
      ...base,
    ])
    expect(process.exitCode).not.toBe(0)
    expect(bodyOf(calls, /system\/secret/)).toBeUndefined()
    expect(bodyOf(calls, /~register/)).toBeUndefined()
  })

  it('给了必填 mountConfig 就正常挂载', async () => {
    const calls = routedFetch([catalogOf([MEMOS])])
    await runCli([
      'integration',
      'add',
      'notes/memos',
      '--provider',
      'memos',
      '--key',
      'k',
      '--config',
      'baseUrl=https://memos.example.com',
      ...base,
    ])
    expect(process.exitCode).toBe(0)
    expect(bodyOf(calls, /~register/).config.providerConfig).toEqual({
      baseUrl: 'https://memos.example.com',
    })
  })

  it('context/v1 的 provider 挂成 kind:context', async () => {
    const calls = routedFetch([
      catalogOf([{ ...TAVILY, id: 'docs', nodeKinds: ['context'], exports: ['documents'] }]),
    ])
    await runCli(['integration', 'add', 'ctx/docs', '--provider', 'docs', '--key', 'k', ...base])
    expect(bodyOf(calls, /~register/).kind).toBe('context')
  })

  /**
   * 跨 kind 多 export(notes:actions=tool / documents=context):选 context export 时 kind
   * 必须按 exportKinds 取,而不是从 nodeKinds 数组落到默认 'tool'(那样挂载被平台拒且无解)。
   */
  it('跨 kind provider 选 context export → 挂成 kind:context(不落默认 tool)', async () => {
    const NOTES = {
      id: 'notes',
      digest: 'dn',
      exports: ['actions', 'documents'],
      exportKinds: { actions: 'tool', documents: 'context' },
      nodeKinds: ['context', 'tool'],
      needsOAuth: false,
    }
    const calls = routedFetch([catalogOf([NOTES])])
    await runCli([
      'integration', 'add', 'notes/docs',
      '--provider', 'notes', '--export', 'documents', '--key', 'k', ...base,
    ])
    expect(bodyOf(calls, /~register/).kind).toBe('context')
    expect(bodyOf(calls, /~register/).config.kind).toBe('context')
  })

  it('跨 kind provider 选 tool export → 挂成 kind:tool', async () => {
    const NOTES = {
      id: 'notes',
      digest: 'dn',
      exports: ['actions', 'documents'],
      exportKinds: { actions: 'tool', documents: 'context' },
      nodeKinds: ['context', 'tool'],
      needsOAuth: false,
    }
    const calls = routedFetch([catalogOf([NOTES])])
    await runCli([
      'integration', 'add', 'notes/actions',
      '--provider', 'notes', '--export', 'actions', '--key', 'k', ...base,
    ])
    expect(bodyOf(calls, /~register/).kind).toBe('tool')
  })

  it('多 export 未指定 → 本地拒(免一次往返)', async () => {
    const calls = routedFetch([catalogOf([{ ...TAVILY, exports: ['a', 'b'] }])])
    await runCli(['integration', 'add', 'p', '--provider', 'tavily', '--key', 'k', ...base])
    expect(process.exitCode).not.toBe(0)
    expect(bodyOf(calls, /~register/)).toBeUndefined()
  })

  it('export 不存在 → 本地拒', async () => {
    const calls = routedFetch([catalogOf([TAVILY])])
    await runCli([
      'integration',
      'add',
      'p',
      '--provider',
      'tavily',
      '--export',
      'nope',
      '--key',
      'k',
      ...base,
    ])
    expect(process.exitCode).not.toBe(0)
    expect(bodyOf(calls, /~register/)).toBeUndefined()
  })

  /** external plugin 不在 catalog 里:拿不到提示,但不该阻断挂载。 */
  it('catalog 查不到该 provider 时仍然挂载(降级为无提示)', async () => {
    const calls = routedFetch([catalogOf([])])
    await runCli(['integration', 'add', 'ext/p', '--provider', 'my-ext', '--key', 'k', ...base])
    expect(process.exitCode).toBe(0)
    expect(bodyOf(calls, /~register/).config.provider).toBe('my-ext')
  })

  it('catalog 无权限(403)时也不阻断挂载', async () => {
    const calls = routedFetch([
      { match: /system\/catalog/, body: { code: 'permission_denied' }, status: 403 },
    ])
    await runCli(['integration', 'add', 'ext/p', '--provider', 'x', '--key', 'k', ...base])
    expect(process.exitCode).toBe(0)
    expect(bodyOf(calls, /~register/)).toBeDefined()
  })
})

describe('tb integration catalog', () => {
  it('无 --search 走 list,有则走 search', async () => {
    let calls = routedFetch([catalogOf([TAVILY])])
    await runCli(['integration', 'catalog', ...base])
    expect(bodyOf(calls, /system\/catalog/).tool).toBe('list')

    resetFetch()
    calls = routedFetch([catalogOf([TAVILY])])
    await runCli(['integration', 'catalog', '--search', 'tav', ...base])
    const body = bodyOf(calls, /system\/catalog/)
    expect(body.tool).toBe('search')
    expect(body.arguments.q).toBe('tav')
  })
})

describe('tb integration ls', () => {
  it('过滤出 plugin 型挂载,r2/s3 与非 tool/context 节点不算集成', async () => {
    routedFetch([{
      match: /system\/registry/,
      body: {
        items: [
          { path: 'tools/tavily', kind: 'tool', config: { provider: 'tavily', authRef: 'a' } },
          { path: 'ctx/docs', kind: 'context', config: { provider: 'notion' } },
          { path: 'ctx/files', kind: 'context', config: { provider: 'r2' } },
          { path: 'srv/peer', kind: 'remote', config: { provider: 'x' } },
          { path: 'system', kind: 'directory' },
        ],
      },
    }])
    const lines: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk))
      return true
    })
    await runCli(['integration', 'ls', ...base])
    const out = JSON.parse(lines.join(''))
    expect(out.items.map((i: { path: string }) => i.path)).toEqual(['tools/tavily', 'ctx/docs'])
  })
})

describe('tb integration rm', () => {
  it('卸载节点;--purge 连带删派生 secret', async () => {
    const calls = routedFetch([{ match: /system\//, body: { ok: true } }])
    await runCli(['integration', 'rm', 'tools/tavily', '--purge', ...base])
    expect(process.exitCode).toBe(0)
    const bodies = calls.filter(c => /system\//.test(c.url)).map(c => c.body as WireBody)
    expect(bodies.some(b => b.tool === 'delete' && b.arguments?.path === 'tools/tavily')).toBe(true)
    expect(
      bodies.some(b => b.tool === 'delete' && b.arguments?.name === 'integration-tools-tavily'),
    ).toBe(true)
  })

  it('不给 --purge 就只卸载,不碰 secret', async () => {
    const calls = routedFetch([{ match: /system\//, body: { ok: true } }])
    await runCli(['integration', 'rm', 'tools/tavily', ...base])
    const bodies = calls.map(c => c.body as WireBody)
    expect(bodies.some(b => b.arguments?.name !== undefined)).toBe(false)
  })

  /** 用了 --secret 复用现成凭证时没有派生 secret:删不到不是错误。 */
  it('--purge 删不到派生 secret 时不报错', async () => {
    routedFetch([
      { match: /system\/secret/, body: { code: 'not_found' }, status: 404 },
      { match: /system\/registry/, body: { ok: true } },
    ])
    await runCli(['integration', 'rm', 'tools/x', '--purge', ...base])
    expect(process.exitCode).toBe(0)
  })
})
