import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { integrationAddCommand } from '../src/commands/integration'
import { mockJsonResponse, runCli } from './cliHarness'
import { resetFetch, setFetch } from '../src/http'

/**
 * `tb integration` —— 集成的用户面。
 *
 * 重点验的是**编排**:一条 `add` 内部做 secret set + mount(+ oauth 提示),而 authRef
 * 不再是用户手打的自由文本(拼错不报错、agent 首次调用才 401),改由挂载路径派生。
 */

interface Call { body: unknown, url: string }
interface FetchRoute { body: unknown, match: RegExp, status?: number, tool?: string }

/** 按 URL 路由的桩:catalog 查询与后续写操作用同一个 fetch。 */
function routedFetch(routes: FetchRoute[]): Call[] {
  const calls: Call[] = []
  setFetch((async (url: string, init?: RequestInit) => {
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    calls.push({ url: String(url), body })
    const route = routes.find(r =>
      r.match.test(String(url))
      && (r.tool === undefined || String(url).endsWith(`/${r.tool}`)),
    )
    const payload = route?.body ?? {}
    return mockJsonResponse(url, init, payload, route?.status ?? 200)
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
  exportDetails: {
    actions: { id: 'actions', kind: 'tool', auth: { kind: 'single', required: false } },
  },
  nodeKinds: ['tool'],
  description: 'Tavily',
}

const JIRA = {
  id: 'jira',
  digest: 'd2',
  exports: ['actions'],
  exportDetails: {
    actions: {
      id: 'actions',
      kind: 'tool',
      auth: {
        kind: 'fields',
        fields: [
          { key: 'baseUrl', required: true, secret: false },
          { key: 'personalAccessToken', required: true, secret: true },
        ],
      },
    },
  },
  nodeKinds: ['tool'],
}

const SENTRY = {
  id: 'sentry',
  digest: 'd3',
  exports: ['actions'],
  exportDetails: {
    actions: { id: 'actions', kind: 'tool', auth: { kind: 'oauth' } },
  },
  nodeKinds: ['tool'],
}

/** 自建实例型:单值凭证 + 一个必配的非凭证 baseUrl。 */
const MEMOS = {
  id: 'memos',
  digest: 'd4',
  exports: ['actions'],
  exportDetails: {
    actions: {
      id: 'actions',
      kind: 'tool',
      auth: { kind: 'single', required: false },
      mountConfigFields: [{ key: 'baseUrl', label: '实例地址', required: true }],
    },
  },
  nodeKinds: ['tool'],
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

/** 直连调用的 wire body:裸 arguments 本体(命令名在 URL 路径的叶子段)。 */
interface WireBody {
  config?: Record<string, unknown>
  kind?: string
  name?: string
  path?: string
  q?: string
  value?: string
}

const bodyOf = (calls: Call[], re: RegExp, tool?: string): WireBody | undefined =>
  calls.find(c =>
    re.test(c.url) && (tool === undefined || c.url.endsWith(`/${tool}`)),
  )?.body as WireBody | undefined

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

    const secret = bodyOf(calls, /system\/secret/, 'set')
    expect(secret.name).toBe('integration-tools%2Ftavily')
    expect(secret.value).toBe('tvly-secret')

    const mount = bodyOf(calls, /~register/)
    expect(mount.config).toEqual({
      kind: 'tool',
      provider: 'tavily',
      authRef: 'integration-tools%2Ftavily',
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
    const secret = bodyOf(calls, /system\/secret/, 'set')
    expect(JSON.parse(secret.value)).toEqual({
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

  it('--credential 复用已保存凭证:不代建,内部自动绑定', async () => {
    const calls = routedFetch([catalogOf([SENTRY])])
    await runCli([
      'integration',
      'add',
      'tools/sentry',
      '--provider',
      'sentry',
      '--credential',
      'sentry-client',
      ...base,
    ])
    expect(process.exitCode).toBe(0)
    expect(bodyOf(calls, /system\/secret/)).toBeUndefined()
    expect(bodyOf(calls, /~register/).config.authRef).toBe('sentry-client')
  })

  it('帮助只暴露当前凭证入口', () => {
    const help = integrationAddCommand().helpInformation()
    expect(help).toContain('--credential <name>')
    expect(help).not.toContain('--secret')
    expect(help).not.toContain('authRef')
    expect(help).not.toContain('integration-')
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
      '--credential',
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
      '--credential',
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
    expect(mount.config.authRef).toBe('integration-notes%2Fmemos')
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
      catalogOf([{
        ...TAVILY,
        id: 'docs',
        nodeKinds: ['context'],
        exports: ['documents'],
        exportDetails: {
          documents: {
            id: 'documents',
            kind: 'context',
            auth: { kind: 'single', required: false },
          },
        },
      }]),
    ])
    await runCli(['integration', 'add', 'ctx/docs', '--provider', 'docs', '--key', 'k', ...base])
    expect(bodyOf(calls, /~register/).kind).toBe('context')
  })

  /**
   * 跨 kind 多 export(notes:actions=tool / documents=context):选 context export 时 kind
   * 必须按 exportDetails 取,而不是从 nodeKinds 数组猜。
   */
  it('跨 kind provider 选 context export → 挂成 kind:context(不落默认 tool)', async () => {
    const NOTES = {
      id: 'notes',
      digest: 'dn',
      exports: ['actions', 'documents'],
      exportDetails: {
        actions: { id: 'actions', kind: 'tool', auth: { kind: 'single', required: false } },
        documents: { id: 'documents', kind: 'context', auth: { kind: 'single', required: false } },
      },
      nodeKinds: ['context', 'tool'],
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
      exportDetails: {
        actions: { id: 'actions', kind: 'tool', auth: { kind: 'single', required: false } },
        documents: { id: 'documents', kind: 'context', auth: { kind: 'single', required: false } },
      },
      nodeKinds: ['context', 'tool'],
    }
    const calls = routedFetch([catalogOf([NOTES])])
    await runCli([
      'integration', 'add', 'notes/actions',
      '--provider', 'notes', '--export', 'actions', '--key', 'k', ...base,
    ])
    expect(bodyOf(calls, /~register/).kind).toBe('tool')
  })

  it('逐 export 契约:只使用选中 export 的 auth 与 mountConfigFields', async () => {
    const MULTI = {
      id: 'multi',
      digest: 'dm',
      exports: ['actions', 'documents'],
      exportDetails: {
        actions: { id: 'actions', kind: 'tool', auth: { kind: 'none' } },
        documents: {
          id: 'documents',
          kind: 'context',
          auth: { kind: 'fields', fields: [{ key: 'readerToken', required: true }] },
          mountConfigFields: [{ key: 'tenant', required: true }],
        },
      },
      nodeKinds: ['context', 'tool'],
    }
    const calls = routedFetch([catalogOf([MULTI])])
    await runCli([
      'integration', 'add', 'docs/multi', '--provider', 'multi', '--export', 'documents',
      '--field', 'readerToken=secret', '--config', 'tenant=acme', ...base,
    ])
    expect(process.exitCode).toBe(0)
    expect(bodyOf(calls, /~register/).config).toMatchObject({
      kind: 'context',
      provider: 'multi',
      export: 'documents',
      providerConfig: { tenant: 'acme' },
    })
  })

  it('auth:none export 给凭证 → 本地拒且不写 secret', async () => {
    const NO_AUTH = {
      ...TAVILY,
      exportDetails: {
        actions: { id: 'actions', kind: 'tool', auth: { kind: 'none' } },
      },
    }
    const calls = routedFetch([catalogOf([NO_AUTH])])
    await runCli([
      'integration', 'add', 'tools/public', '--provider', 'tavily', '--key', 'unused', ...base,
    ])
    expect(process.exitCode).not.toBe(0)
    expect(bodyOf(calls, /system\/secret/)).toBeUndefined()
    expect(bodyOf(calls, /~register/)).toBeUndefined()
  })

  it('挂载失败会回滚本轮代建的 secret,不留下孤儿记录', async () => {
    const calls = routedFetch([
      catalogOf([TAVILY]),
      { match: /system\/secret/, tool: 'list', body: { items: [] } },
      { match: /system\/secret/, body: { ok: true } },
      {
        match: /~register/,
        body: { code: 'invalid_argument', message: 'mount rejected', retryable: false },
        status: 400,
      },
    ])
    await runCli([
      'integration', 'add', 'tools/tavily', '--provider', 'tavily', '--key', 'secret', ...base,
    ])
    expect(process.exitCode).not.toBe(0)
    const secretCalls = calls.filter(c => /system\/secret/.test(c.url))
    const secretVerbs = secretCalls.map(c => c.url.split('/').pop())
    expect(secretVerbs).toEqual(['list', 'set', 'delete'])
    expect((secretCalls[2]?.body as WireBody | undefined)?.name).toBe('integration-tools%2Ftavily')
  })

  it('挂载失败不会误删同名既有凭证', async () => {
    const name = 'integration-tools%2Ftavily'
    const calls = routedFetch([
      catalogOf([TAVILY]),
      { match: /system\/secret/, tool: 'list', body: { items: [{ name }] } },
      { match: /system\/secret/, body: { ok: true } },
      {
        match: /~register/,
        body: { code: 'invalid_argument', message: 'mount rejected', retryable: false },
        status: 400,
      },
    ])
    await runCli([
      'integration', 'add', 'tools/tavily', '--provider', 'tavily', '--key', 'rotated', ...base,
    ])
    expect(process.exitCode).not.toBe(0)
    const tools = calls
      .filter(c => /system\/secret/.test(c.url))
      .map(c => c.url.split('/').pop())
    expect(tools).toEqual(['list', 'set'])
  })

  it('内部槽位按完整 path 编码,slash 与 dash 不碰撞', async () => {
    let calls = routedFetch([catalogOf([TAVILY])])
    await runCli(['integration', 'add', 'a/b', '--provider', 'tavily', '--key', 'one', ...base])
    const slashName = bodyOf(calls, /system\/secret/, 'set').name

    resetFetch()
    calls = routedFetch([catalogOf([TAVILY])])
    await runCli(['integration', 'add', 'a-b', '--provider', 'tavily', '--key', 'two', ...base])
    const dashName = bodyOf(calls, /system\/secret/, 'set').name

    expect(slashName).toBe('integration-a%2Fb')
    expect(dashName).toBe('integration-a-b')
    expect(slashName).not.toBe(dashName)
  })

  it('人类输出与 JSON 都不回显内部槽位或 authRef', async () => {
    routedFetch([catalogOf([TAVILY])])
    const lines: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk))
      return true
    })
    await runCli([
      'integration', 'add', 'tools/tavily', '--provider', 'tavily', '--key', 'secret',
      '--base-url', 'https://gw', '--sk', 'tbk_x',
    ])
    expect(lines.join('')).toContain('credential stored and managed by the platform')
    expect(lines.join('')).not.toContain('integration-')
    expect(lines.join('')).not.toContain('authRef')

    vi.mocked(process.stdout.write).mockClear()
    lines.length = 0
    resetFetch()
    routedFetch([
      catalogOf([TAVILY]),
      {
        match: /~register/,
        body: {
          path: 'tools/tavily',
          kind: 'tool',
          config: { provider: 'tavily', authRef: 'integration-tools%2Ftavily' },
        },
      },
    ])
    await runCli([
      'integration', 'add', 'tools/tavily', '--provider', 'tavily', '--key', 'secret', ...base,
    ])
    const json = JSON.parse(lines.join(''))
    expect(json.credentialStored).toBe(true)
    expect(json.node.credential).toBe('managed')
    expect(json.node.config.authRef).toBeUndefined()
    expect(JSON.stringify(json)).not.toContain('integration-')
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
    expect(calls.some(c => /system\/catalog\/list$/.test(c.url))).toBe(true)

    resetFetch()
    calls = routedFetch([catalogOf([TAVILY])])
    await runCli(['integration', 'catalog', '--search', 'tav', ...base])
    const body = bodyOf(calls, /system\/catalog/, 'search')
    expect(body?.q).toBe('tav')
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
    expect(out.items[0].credential).toBe('managed')
    expect(out.items[0].config.authRef).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain('"authRef"')
  })
})

describe('tb integration rm', () => {
  it('只卸载节点，凭证由 tb secret 显式管理', async () => {
    const calls = routedFetch([
      { match: /system\/registry/, tool: 'get', body: { path: 'tools/tavily', kind: 'tool' } },
      { match: /system\/registry/, tool: 'delete', body: { ok: true } },
    ])
    await runCli(['integration', 'rm', 'tools/tavily', ...base])
    const bodies = calls.map(c => c.body as WireBody)
    expect(bodies.some(b => b.name !== undefined)).toBe(false)
  })

  it('拒绝卸载非 tool/context 节点(误删 device 节点的护栏)', async () => {
    const calls = routedFetch([
      { match: /system\/registry/, tool: 'get', body: { path: 'device/build-01', kind: 'device' } },
      { match: /system\/registry/, tool: 'delete', body: { ok: true } },
    ])
    await runCli(['integration', 'rm', 'device/build-01', ...base])
    // kind 校验失败 → 只发了 get,绝不发 delete;命令以非零码退出。
    expect(calls.some(c => c.url.endsWith('/delete'))).toBe(false)
    expect(process.exitCode).not.toBe(0)
    // base 带 --json,错误经 stdout 输出结构化 {ok:false,error}。
    const stdout = (process.stdout.write as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map(c => String(c[0])).join('')
    expect(stdout).toContain('expected tool | context')
  })
})
