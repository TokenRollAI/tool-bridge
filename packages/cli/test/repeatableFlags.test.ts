import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectCommand } from '../src/commands/connect'
import { ctxPatchCommand, ctxPutCommand } from '../src/commands/ctx'
import { skCreateCommand } from '../src/commands/sk'
import { toolMountCommand } from '../src/commands/tool'
import { resetFetch, setFetch } from '../src/http'

/**
 * repeatable flag 回归:citty 0.2.2 底层 node parseArgs 未开 multiple,重复 string
 * flag last-wins(args 只剩最后一个值)。命令必须从 rawArgs 重收集全部值。
 * 测试按真实解析结果注入:args.<flag> = 最后值,rawArgs = 完整命令行。
 */

vi.mock('../src/deviceRuntime', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/deviceRuntime')>()
  return { ...mod, runDeviceConnection: vi.fn(async () => {}) }
})

import { runDeviceConnection } from '../src/deviceRuntime'

function invoke(
  // biome-ignore lint/suspicious/noExplicitAny: citty run context 仅用到 args/rawArgs,测试直接注入。
  cmd: { run?: (ctx: any) => unknown },
  args: Record<string, unknown>,
  rawArgs: string[] = [],
): Promise<unknown> {
  return Promise.resolve(cmd.run?.({ args, cmd, rawArgs }))
}

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

const gw = { 'base-url': 'https://gw', sk: 'tbk_x', json: true }

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
    await invoke(
      skCreateCommand,
      { ...gw, owner: 'user:a', scope: 'b/**:call', 'register-path': 'p/b' },
      [
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
      ],
    )
    const body = requestBody(fn)
    const args = body.arguments as { scopes: unknown[]; registerPaths: string[] }
    expect(args.scopes).toEqual([
      { pattern: 'a/**', actions: ['read'] },
      { pattern: 'b/**', actions: ['call'] },
    ])
    expect(args.registerPaths).toEqual(['p/a', 'p/b'])
  })

  it('单个 --scope(或编程注入 args)仍工作', async () => {
    const fn = captureFetch({ key: { id: 'sk1', owner: 'user:a' }, secret: 'tbk_s' })
    await invoke(skCreateCommand, { ...gw, owner: 'user:a', scope: 'a/**:read' })
    const args = requestBody(fn).arguments as { scopes: unknown[] }
    expect(args.scopes).toEqual([{ pattern: 'a/**', actions: ['read'] }])
  })

  it('camel 拼写 --registerPath 也收集(citty 自动 camel alias)', async () => {
    const fn = captureFetch({ key: { id: 'sk1', owner: 'user:a' }, secret: 'tbk_s' })
    await invoke(skCreateCommand, { ...gw, owner: 'user:a', 'register-path': 'p/b' }, [
      'create',
      '--owner',
      'user:a',
      '--registerPath',
      'p/a',
      '--registerPath',
      'p/b',
    ])
    const args = requestBody(fn).arguments as { registerPaths: string[] }
    expect(args.registerPaths).toEqual(['p/a', 'p/b'])
  })
})

describe('tb connect:--allow / --fs 可重复', () => {
  it('两个 --allow 与两个 --fs 全部进入 expose', async () => {
    await invoke(
      connectCommand,
      { ...gw, json: false, 'device-id': 'd-rep', allow: 'git', fs: '/b' },
      [
        'connect',
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
      ],
    )
    expect(process.exitCode).toBe(0)
    expect(vi.mocked(runDeviceConnection)).toHaveBeenCalledWith(
      expect.objectContaining({
        expose: { shell: { allow: ['echo', 'git'] }, fs: { roots: ['/a', '/b'], readOnly: false } },
      }),
    )
  })

  it('`--flag=value` 形式同样收集', async () => {
    await invoke(connectCommand, { ...gw, json: false, 'device-id': 'd-rep2', allow: 'git' }, [
      'connect',
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
    await invoke(
      toolMountCommand,
      {
        ...gw,
        path: 'tools/x',
        kind: 'mcp',
        url: 'https://up.example/mcp',
        rename: 'c=d',
        hide: 'h2',
        describe: 'n2=t2',
      },
      [
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
      ],
    )
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
    await invoke(
      ctxPutCommand,
      { ...gw, ns: 'ctx/notes', entry: 'a.txt', content: 'x', meta: 'k2=v2' },
      ['put', 'ctx/notes', 'a.txt', '--content', 'x', '--meta', 'k1=v1', '--meta', 'k2=v2'],
    )
    const args = requestBody(fn).arguments as { entry: { metadata?: Record<string, string> } }
    expect(args.entry.metadata).toEqual({ k1: 'v1', k2: 'v2' })
  })

  it('patch:两个 --meta 合并为 metadata 两键', async () => {
    const fn = captureFetch({ uri: 'node://ctx/notes/a.txt' })
    await invoke(ctxPatchCommand, { ...gw, ns: 'ctx/notes', entry: 'a.txt', meta: 'k2=v2' }, [
      'patch',
      'ctx/notes',
      'a.txt',
      '--meta',
      'k1=v1',
      '--meta',
      'k2=v2',
    ])
    const args = requestBody(fn).arguments as { patch: { metadata?: Record<string, string> } }
    expect(args.patch.metadata).toEqual({ k1: 'v1', k2: 'v2' })
  })
})
