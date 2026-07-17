import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetFetch, setFetch } from '../src/http'
import { parseError, runCli } from './cliHarness'

/**
 * repeatable flag 解析级回归(commander@15 迁移)。
 *
 * 事故:citty 0.2.2 底层 node parseArgs 未开 multiple,重复 string flag last-wins,
 * 命令曾被迫从 rawArgs 重收集;更糟的是未知 flag 被静默接受——拼错的 `--alows`
 * 被当 positional 吞掉,用户以为放行了命令,实际 shell 白名单权限误配。
 * commander 严格解析后,重复收集由 `collect` 收集器原生承担、未知 flag 直接报错。
 * 本文件用真实 argv 锁定各命令 repeatable flag 全量收集 + `--flag=value` 形式。
 */

vi.mock('../src/deviceRuntime', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/deviceRuntime')>()
  return { ...mod, runDeviceConnection: vi.fn(async () => {}) }
})

import { runDeviceConnection } from '../src/deviceRuntime'

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

function requestBody(fn: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fn.mock.calls[0] as [string, RequestInit]
  return JSON.parse(init.body as string) as Record<string, unknown>
}

const gw = ['--base-url', 'https://gw', '--sk', 'tbk_x', '--json']

let tmpConfig: string | undefined
const oldXdg = process.env.XDG_CONFIG_HOME

beforeEach(() => {
  process.exitCode = 0
  tmpConfig = mkdtempSync(join(tmpdir(), 'tb-cli-repeat-'))
  process.env.XDG_CONFIG_HOME = tmpConfig
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  vi.mocked(runDeviceConnection).mockClear()
})

afterEach(() => {
  process.exitCode = 0
  resetFetch()
  vi.restoreAllMocks()
  if (tmpConfig) rmSync(tmpConfig, { recursive: true, force: true })
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = oldXdg
})

describe('tb sk create:--scope / --register-path 可重复', () => {
  it('两个 --scope 与两个 --register-path 全部进入请求体', async () => {
    const fn = captureFetch({ key: { id: 'sk1', owner: 'user:a' }, secret: 'tbk_s' })
    await runCli([
      'sk',
      'create',
      '--owner',
      'user:a',
      '--scope',
      'a/**:read',
      '--scope',
      'b/**:call',
      '--register-path',
      'p/a',
      '--register-path',
      'p/b',
      ...gw,
    ])
    const body = requestBody(fn)
    const args = body.arguments as { registerPaths: string[], scopes: unknown[] }
    expect(args.scopes).toEqual([
      { pattern: 'a/**', actions: ['read'] },
      { pattern: 'b/**', actions: ['call'] },
    ])
    expect(args.registerPaths).toEqual(['p/a', 'p/b'])
  })

  it('单个 --scope 仍工作', async () => {
    const fn = captureFetch({ key: { id: 'sk1', owner: 'user:a' }, secret: 'tbk_s' })
    await runCli(['sk', 'create', '--owner', 'user:a', '--scope', 'a/**:read', ...gw])
    const args = requestBody(fn).arguments as { scopes: unknown[] }
    expect(args.scopes).toEqual([{ pattern: 'a/**', actions: ['read'] }])
  })

  it('camel 拼写 --registerPath 不再自动 alias,严格报未知 flag(citty 曾静默接受)', async () => {
    expect(
      await parseError(['sk', 'create', '--owner', 'user:a', '--registerPath', 'p/a', ...gw]),
    ).toBe('commander.unknownOption')
  })
})

describe('tb connect:--allow / --fs 可重复', () => {
  it('两个 --allow 与两个 --fs 全部进入 expose', async () => {
    await runCli([
      'connect',
      '--base-url',
      'https://gw',
      '--sk',
      'tbk_x',
      '--device-id',
      'd-rep',
      '--allow',
      'echo',
      '--allow',
      'git',
      '--fs',
      '/a',
      '--fs',
      '/b',
    ])
    expect(process.exitCode).toBe(0)
    expect(vi.mocked(runDeviceConnection)).toHaveBeenCalledWith(
      expect.objectContaining({
        expose: { shell: { allow: ['echo', 'git'] }, fs: { roots: ['/a', '/b'], readOnly: false } },
      }),
    )
  })

  it('`--flag=value` 形式同样收集', async () => {
    await runCli([
      'connect',
      '--base-url',
      'https://gw',
      '--sk',
      'tbk_x',
      '--device-id',
      'd-rep2',
      '--allow=echo',
      '--allow=git',
    ])
    expect(vi.mocked(runDeviceConnection)).toHaveBeenCalledWith(
      expect.objectContaining({ expose: { shell: { allow: ['echo', 'git'] } } }),
    )
  })
})

describe('tb tool mount:--rename / --hide / --describe 可重复', () => {
  it('虚拟化三个 flag 的重复值全部收集', async () => {
    const fn = captureFetch({ path: 'tools/x', kind: 'mcp' })
    await runCli([
      'tool',
      'mount',
      'tools/x',
      '--kind',
      'mcp',
      '--url',
      'https://up.example/mcp',
      '--rename',
      'a=b',
      '--rename',
      'c=d',
      '--hide',
      'h1',
      '--hide',
      'h2',
      '--describe',
      'n1=t1',
      '--describe',
      'n2=t2',
      ...gw,
    ])
    const input = requestBody(fn) as { virtualize?: Record<string, unknown> }
    expect(input.virtualize).toEqual({
      rename: { a: 'b', c: 'd' },
      hide: ['h1', 'h2'],
      describe: { n1: 't1', n2: 't2' },
    })
  })
})

describe('tb ctx put/patch:--meta 可重复', () => {
  it('put:两个 --meta 合并为 metadata 两键', async () => {
    const fn = captureFetch({ uri: 'node://ctx/notes/a.txt' })
    await runCli([
      'ctx',
      'put',
      'ctx/notes',
      'a.txt',
      '--content',
      'x',
      '--meta',
      'k1=v1',
      '--meta',
      'k2=v2',
      ...gw,
    ])
    const args = requestBody(fn).arguments as { entry: { metadata?: Record<string, string> } }
    expect(args.entry.metadata).toEqual({ k1: 'v1', k2: 'v2' })
  })

  it('patch:两个 --meta 合并为 metadata 两键', async () => {
    const fn = captureFetch({ uri: 'node://ctx/notes/a.txt' })
    await runCli([
      'ctx',
      'patch',
      'ctx/notes',
      'a.txt',
      '--meta',
      'k1=v1',
      '--meta',
      'k2=v2',
      ...gw,
    ])
    const args = requestBody(fn).arguments as { patch: { metadata?: Record<string, string> } }
    expect(args.patch.metadata).toEqual({ k1: 'v1', k2: 'v2' })
  })
})
