import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFetch, setFetch } from '../src/http'
import { parseError, runCli } from './cliHarness'

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
  return stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
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

const ANNO = {
  path: 'feishu/create-doc',
  text: 'mode 必填',
  updatedAt: '2026-07-08T00:00:00.000Z',
  updatedBy: 'k-admin',
}

describe('tb note', () => {
  it('ls [prefix] → system/annotation list;--json 原样输出', async () => {
    const page = { items: [ANNO] }
    const fn = jsonFetch(page)
    await runCli(['note', 'ls', 'feishu', ...gw, '--json'])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/system/annotation')
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('list')
    expect(payload.arguments).toEqual({ prefix: 'feishu' })
    expect(JSON.parse(stdoutText())).toEqual(page)
    expect(process.exitCode).toBe(0)
  })

  it('ls 无 prefix → arguments 为空对象', async () => {
    const fn = jsonFetch({ items: [] })
    await runCli(['note', 'ls', ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string).arguments).toEqual({})
  })

  it('get <path> → system/annotation get;非 json 输出全文', async () => {
    const fn = jsonFetch(ANNO)
    await runCli(['note', 'get', 'feishu/create-doc', ...gw])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('get')
    expect(payload.arguments).toEqual({ path: 'feishu/create-doc' })
    expect(stdoutText()).toContain('mode 必填')
    expect(process.exitCode).toBe(0)
  })

  it("set <path> <text> → system/annotation set;'/' 化为根空串", async () => {
    const fn = jsonFetch({ ...ANNO, path: '', text: '全树公告' })
    await runCli(['note', 'set', '/', '全树公告', ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('set')
    expect(payload.arguments).toEqual({ path: '', text: '全树公告' })
    expect(process.exitCode).toBe(0)
  })

  it('rm <path> → system/annotation remove', async () => {
    const fn = jsonFetch({ ok: true })
    await runCli(['note', 'rm', 'feishu/create-doc', ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('remove')
    expect(payload.arguments).toEqual({ path: 'feishu/create-doc' })
    expect(process.exitCode).toBe(0)
  })

  it('set 缺 text 位置参数 → commander 严格解析报错,不发请求', async () => {
    const fn = jsonFetch({})
    expect(await parseError(['note', 'set', 'feishu', ...gw])).toBe('commander.missingArgument')
    expect(fn).not.toHaveBeenCalled()
  })
})
