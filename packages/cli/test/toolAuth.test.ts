import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockJsonResponse, runCli } from './cliHarness'
import { resetFetch, setFetch } from '../src/http'

/** 捕获请求并按 body 应答;返回 mock 以断言 URL/body。 */
function captureFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string, init?: RequestInit) =>
    mockJsonResponse(url, init, body, status))
  setFetch(fn as unknown as typeof fetch)
  return fn
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

describe('tb tool mount --auth oauth', () => {
  it('config 带 auth:\'oauth\' 且不带 authRef', async () => {
    const fn = captureFetch({ path: 'db/bytebase', kind: 'mcp' })
    await runCli([
      'tool',
      'mount',
      'db/bytebase',
      ...base,
      '--kind',
      'mcp',
      '--url',
      'https://bb.example/mcp',
      '--auth',
      'oauth',
      '--description',
      'Bytebase',
    ])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.config).toEqual({ kind: 'mcp', url: 'https://bb.example/mcp', auth: 'oauth' })
    expect(process.exitCode).toBe(0)
  })

  it('--auth oauth 与 --auth-ref 互斥 → 退出码 1,不发请求', async () => {
    const fn = captureFetch({})
    await runCli([
      'tool',
      'mount',
      'db/bytebase',
      ...base,
      '--kind',
      'mcp',
      '--url',
      'https://bb.example/mcp',
      '--auth',
      'oauth',
      '--auth-ref',
      's-bb',
    ])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('预注册 public client 写入独立 oauthClient，不复用 authRef', async () => {
    const fn = captureFetch({ path: 'home/assistant', kind: 'mcp' })
    await runCli([
      'tool', 'mount', 'home/assistant', ...base,
      '--kind', 'mcp',
      '--url', 'https://ha.example/api/mcp',
      '--auth', 'oauth',
      '--oauth-client-id', 'tool-bridge-client',
    ])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.config).toEqual({
      kind: 'mcp',
      url: 'https://ha.example/api/mcp',
      auth: 'oauth',
      oauthClient: { clientId: 'tool-bridge-client' },
    })
    expect(payload.config.authRef).toBeUndefined()
    expect(process.exitCode).toBe(0)
  })

  it('预注册 confidential client 只写 clientSecretRef', async () => {
    const fn = captureFetch({ path: 'home/assistant', kind: 'mcp' })
    await runCli([
      'tool', 'mount', 'home/assistant', ...base,
      '--kind', 'mcp',
      '--url', 'https://ha.example/api/mcp',
      '--auth', 'oauth',
      '--oauth-client-id', 'tool-bridge-client',
      '--oauth-client-secret-ref', 'ha-oauth-secret',
    ])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.config.oauthClient).toEqual({
      clientId: 'tool-bridge-client',
      clientSecretRef: 'ha-oauth-secret',
    })
    expect(JSON.stringify(payload)).not.toContain('clientSecret"')
    expect(process.exitCode).toBe(0)
  })

  it('--oauth-client-secret-ref 缺 client id → 退出码 1,不发请求', async () => {
    const fn = captureFetch({})
    await runCli([
      'tool', 'mount', 'home/assistant', ...base,
      '--kind', 'mcp',
      '--url', 'https://ha.example/api/mcp',
      '--auth', 'oauth',
      '--oauth-client-secret-ref', 'ha-oauth-secret',
    ])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('--oauth-client-id 缺 --auth oauth → 退出码 1,不发请求', async () => {
    const fn = captureFetch({})
    await runCli([
      'tool', 'mount', 'home/assistant', ...base,
      '--kind', 'mcp',
      '--url', 'https://ha.example/api/mcp',
      '--oauth-client-id', 'tool-bridge-client',
    ])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('--auth 非 oauth → 退出码 1,不发请求', async () => {
    const fn = captureFetch({})
    await runCli([
      'tool',
      'mount',
      'db/bytebase',
      ...base,
      '--kind',
      'mcp',
      '--url',
      'https://bb.example/mcp',
      '--auth',
      'basic',
    ])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})

describe('tb tool auth', () => {
  it('POST /<path>/~authorize;redirect → 输出授权 URL', async () => {
    const fn = captureFetch({
      status: 'redirect',
      authorizationUrl: 'https://as.example/authorize?client_id=x',
    })
    await runCli(['tool', 'auth', 'db/bytebase', ...base, '--no-open'])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/db/bytebase/~authorize')
    expect(init.method).toBe('POST')
    expect(process.exitCode).toBe(0)
  })

  it('authorized(静默刷新成功)→ 直接完成', async () => {
    captureFetch({ status: 'authorized' })
    await runCli(['tool', 'auth', 'db/bytebase', ...base])
    expect(process.exitCode).toBe(0)
  })

  it('网关报错(非 oauth 挂载)→ 退出码 1', async () => {
    captureFetch({ code: 'invalid_argument', message: 'not an oauth mount' }, 400)
    await runCli(['tool', 'auth', 'db/plain', ...base])
    expect(process.exitCode).toBe(1)
  })
})

/**
 * 挂载后的"下一步"提示。oauth 型挂载差一步授权,而**挂载时判不出来**:
 * - mcp:`config.auth === 'oauth'` 就在挂载配置里,能精确提示;
 * - plugin tool:oauth 声明在 plugin 的 `~describe` 里、不在挂载配置里,只能按
 *   "带了 authRef"给条件式提示。
 *
 * 不提示的后果:用户挂完一个 oauth 型 provider(gmail 之类)没有任何线索知道还差一步,
 * 只会在第一次调用时收到 permission_denied。
 */
describe('tb tool mount 的授权提示', () => {
  /** 非 --json 模式才打提示(--json 输出是给程序消费的,不塞人读文案)。 */
  function humanOutput(): string[] {
    const lines: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk))
      return true
    })
    return lines
  }

  const humanBase = ['--base-url', 'https://gw', '--sk', 'tbk_x']

  it('mcp + --auth oauth → 明确提示跑 tb tool auth', async () => {
    captureFetch({ path: 'db/bytebase', kind: 'mcp' })
    const lines = humanOutput()
    await runCli([
      'tool', 'mount', 'db/bytebase', '--kind', 'mcp',
      '--url', 'https://mcp.example/mcp', '--auth', 'oauth', ...humanBase,
    ])
    expect(lines.join('')).toContain('tb tool auth db/bytebase')
  })

  it('plugin tool + --auth-ref → 条件式提示(oauth 声明在 ~describe 里,挂载时判不出)', async () => {
    captureFetch({ path: 'mail/gmail', kind: 'tool' })
    const lines = humanOutput()
    await runCli([
      'tool', 'mount', 'mail/gmail', '--kind', 'tool',
      '--provider', 'gmail', '--auth-ref', 'gmail-client', ...humanBase,
    ])
    const out = lines.join('')
    expect(out).toContain('tb tool auth mail/gmail')
    // 措辞必须是条件式的 —— 多数 tool 挂载走 api_key,不需要授权。
    expect(out).toMatch(/if this export declares oauth/i)
  })

  it('plugin tool 不带 authRef → 不提示(没有凭证引用就谈不上授权)', async () => {
    captureFetch({ path: 'notes', kind: 'tool' })
    const lines = humanOutput()
    await runCli([
      'tool', 'mount', 'notes', '--kind', 'tool', '--provider', 'notes', ...humanBase,
    ])
    expect(lines.join('')).not.toContain('tb tool auth')
  })
})
