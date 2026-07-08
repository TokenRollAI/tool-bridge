import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFetch, setFetch } from '../src/http'
import { runCli } from './cliHarness'

/** 捕获请求并按 body 应答;返回 mock 以断言 URL/body。 */
function captureFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )
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
  it("config 带 auth:'oauth' 且不带 authRef", async () => {
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
