import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loginCommand } from '../src/commands/login'
import { skCreateCommand, skListCommand } from '../src/commands/sk'
import { readConfig } from '../src/config'
import { resetFetch, setFetch } from '../src/http'

function invoke(
  // biome-ignore lint/suspicious/noExplicitAny: citty run context 仅用到 args,测试直接注入。
  cmd: { run?: (ctx: any) => unknown },
  args: Record<string, unknown>,
): Promise<unknown> {
  return Promise.resolve(cmd.run?.({ args, cmd, rawArgs: [] }))
}

const savedXdg = process.env.XDG_CONFIG_HOME

beforeEach(() => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'tb-cmd-'))
  process.exitCode = 0
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  process.env.XDG_CONFIG_HOME = savedXdg
  process.exitCode = 0
  resetFetch()
  vi.restoreAllMocks()
})

function jsonResponse(body: unknown, status = 200): void {
  setFetch(
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch,
  )
}

describe('tb login', () => {
  it('验证通过后写入 profile 并设为 current', async () => {
    setFetch(
      vi.fn(async () => new Response('htbp 0.1\n', { status: 200 })) as unknown as typeof fetch,
    )
    await invoke(loginCommand, {
      json: true,
      'base-url': 'https://gw.example/',
      sk: 'tbk_abc',
      profile: 'prod',
    })
    const cfg = readConfig()
    expect(cfg.current).toBe('prod')
    expect(cfg.profiles.prod).toEqual({ baseUrl: 'https://gw.example', sk: 'tbk_abc' })
    expect(process.exitCode).toBe(0)
  })

  it('SK 被拒(401)→ 不写配置 + 退出码 1', async () => {
    setFetch(vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch)
    await invoke(loginCommand, { json: true, 'base-url': 'https://gw', sk: 'bad', profile: 'p' })
    expect(readConfig()).toEqual({ profiles: {} })
    expect(process.exitCode).toBe(1)
  })
})

describe('tb sk create', () => {
  it('把 --scope 解析成 Scope[] 放进请求 body.arguments', async () => {
    const fn = vi.fn(
      async () =>
        new Response(JSON.stringify({ key: { id: 'k1', owner: 'user:a' }, secret: 's3cr3t' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    setFetch(fn as unknown as typeof fetch)

    await invoke(skCreateCommand, {
      json: true,
      'base-url': 'https://gw',
      sk: 'tbk_admin',
      owner: 'user:a',
      scope: ['docs/**:read,call', 'device/x:call'],
      'register-path': ['device/x'],
    })

    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/system/sk')
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('write')
    expect(payload.arguments.owner).toBe('user:a')
    expect(payload.arguments.scopes).toEqual([
      { pattern: 'docs/**', actions: ['read', 'call'] },
      { pattern: 'device/x', actions: ['call'] },
    ])
    expect(payload.arguments.registerPaths).toEqual(['device/x'])
    expect(process.exitCode).toBe(0)
  })

  it('非法 --scope → 退出码 1', async () => {
    jsonResponse({})
    await invoke(skCreateCommand, {
      json: true,
      'base-url': 'https://gw',
      sk: 'tbk_admin',
      owner: 'user:a',
      scope: ['bogus-no-colon'],
    })
    expect(process.exitCode).toBe(1)
  })
})

describe('TBError → 退出码 1', () => {
  it('403 TBError 时命令以退出码 1 结束', async () => {
    jsonResponse({ code: 'permission_denied', message: 'admin required', retryable: false }, 403)
    await invoke(skListCommand, { json: true, 'base-url': 'https://gw', sk: 'tbk_x' })
    expect(process.exitCode).toBe(1)
  })
})
