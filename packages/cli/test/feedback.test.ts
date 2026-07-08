import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFetch, setFetch } from '../src/http'
import { parseError, runCli } from './cliHarness'

const gw = ['--base-url', 'https://gw', '--sk', 'tbk_agent'] as const

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

const VIEW = {
  id: 'fb_a1x9k2',
  title: 'mode 必填',
  by: 'agent:a',
  at: '2026-07-08T00:00:00.000Z',
  up: 3,
  down: 1,
  score: 2,
}

describe('tb feedback', () => {
  it('ls <path> → system/feedback list;--hidden 加 includeHidden', async () => {
    const fn = jsonFetch({ items: [VIEW] })
    await runCli(['feedback', 'ls', 'feishu', ...gw, '--json'])
    let [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/system/feedback')
    let payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('list')
    expect(payload.arguments).toEqual({ path: 'feishu' })

    await runCli(['feedback', 'ls', 'feishu', '--hidden', ...gw, '--json'])
    ;[url, init] = fn.mock.calls[1] as [string, RequestInit]
    payload = JSON.parse(init.body as string)
    expect(payload.arguments).toEqual({ path: 'feishu', includeHidden: true })
    expect(process.exitCode).toBe(0)
  })

  it('get <path> <id> → system/feedback get;非 json 含 title 与 detail', async () => {
    const fn = jsonFetch({ ...VIEW, detail: '不传报 invalid_argument' })
    await runCli(['feedback', 'get', 'feishu', 'fb_a1x9k2', ...gw])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('get')
    expect(payload.arguments).toEqual({ path: 'feishu', id: 'fb_a1x9k2' })
    expect(stdoutText()).toContain('mode 必填')
    expect(stdoutText()).toContain('不传报 invalid_argument')
    expect(process.exitCode).toBe(0)
  })

  it('submit <path> --title --detail → system/feedback submit', async () => {
    const fn = jsonFetch({ id: 'fb_new123', path: 'feishu', title: 't' })
    await runCli(['feedback', 'submit', 'feishu', '--title', 't', '--detail', 'd', ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('submit')
    expect(payload.arguments).toEqual({ path: 'feishu', title: 't', detail: 'd' })
    expect(process.exitCode).toBe(0)
  })

  it('submit 缺 --title → commander 报错,不发请求', async () => {
    const fn = jsonFetch({})
    expect(await parseError(['feedback', 'submit', 'feishu', '--detail', 'd', ...gw])).toBe(
      'commander.missingMandatoryOptionValue',
    )
    expect(fn).not.toHaveBeenCalled()
  })

  it('vote <path> <id> <value> → system/feedback vote;非法 value 本地拒绝', async () => {
    const fn = jsonFetch(VIEW)
    await runCli(['feedback', 'vote', 'feishu', 'fb_a1x9k2', 'up', ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('vote')
    expect(payload.arguments).toEqual({ path: 'feishu', id: 'fb_a1x9k2', value: 'up' })
    expect(process.exitCode).toBe(0)

    await runCli(['feedback', 'vote', 'feishu', 'fb_a1x9k2', 'sideways', ...gw])
    expect(fn).toHaveBeenCalledTimes(1) // 非法 value 未发第二次请求
    expect(process.exitCode).toBe(1)
  })

  it('rm <path> <id> → system/feedback remove', async () => {
    const fn = jsonFetch({ ok: true })
    await runCli(['feedback', 'rm', 'feishu', 'fb_a1x9k2', ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('remove')
    expect(payload.arguments).toEqual({ path: 'feishu', id: 'fb_a1x9k2' })
    expect(process.exitCode).toBe(0)
  })
})
