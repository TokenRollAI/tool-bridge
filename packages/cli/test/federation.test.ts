import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFetch, setFetch } from '../src/http'
import { parseError, runCli } from './cliHarness'

/** gw 三件套:目标与输出开关(经真实 commander 解析)。 */
const gw = ['--base-url', 'https://gw', '--sk', 'tbk_admin'] as const

let stdoutSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  process.exitCode = 0
  // biome-ignore lint/suspicious/noExplicitAny: spyOn 重载推断,与其他命令测试同法。
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true) as any
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  process.exitCode = 0
  resetFetch()
  vi.restoreAllMocks()
})

function stdoutText(): string {
  return stdoutSpy.mock.calls.map(c => String(c[0])).join('')
}

function jsonFetch(body: unknown, status = 200) {
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

describe('tb federation', () => {
  it('ls → system/federation list;--json 原样输出合并视图', async () => {
    const page = {
      items: [
        { host: 'env-base.com', source: 'env', removable: false },
        {
          host: 'runtime.com',
          source: 'store',
          removable: true,
          updatedAt: '2026-07-08T00:00:00.000Z',
        },
      ],
    }
    const fn = jsonFetch(page)
    await runCli(['federation', 'ls', ...gw, '--json'])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/system/federation')
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('list')
    expect(process.exitCode).toBe(0)
    expect(JSON.parse(stdoutText())).toEqual(page)
  })

  it('add <host> → system/federation add,参数含 host', async () => {
    const fn = jsonFetch({ host: 'example.com', updatedAt: '2026-07-08T00:00:00.000Z' })
    await runCli(['federation', 'add', 'example.com', ...gw, '--json'])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/system/federation')
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('add')
    expect(payload.arguments).toEqual({ host: 'example.com' })
    expect(process.exitCode).toBe(0)
  })

  it('rm <host> → system/federation remove,参数含 host', async () => {
    const fn = jsonFetch({ ok: true })
    await runCli(['federation', 'rm', 'example.com', ...gw, '--json'])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/system/federation')
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('remove')
    expect(payload.arguments).toEqual({ host: 'example.com' })
    expect(process.exitCode).toBe(0)
  })

  it('add 缺 host 位置参数 → commander 严格解析报错(missingArgument),不发请求', async () => {
    const fn = jsonFetch({})
    expect(await parseError(['federation', 'add', ...gw, '--json'])).toBe(
      'commander.missingArgument',
    )
    expect(fn).not.toHaveBeenCalled()
  })
})
