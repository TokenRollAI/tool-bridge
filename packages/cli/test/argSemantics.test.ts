import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetFetch, setFetch } from '../src/http'
import { runMain } from '../src/main'
import { runCli } from './cliHarness'

vi.mock('../src/deviceRuntime', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/deviceRuntime')>()
  return { ...mod, runDeviceConnection: vi.fn(async () => {}) }
})

function jsonFetch(body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
  setFetch(fn as unknown as typeof fetch)
  return fn
}

function stdoutText(): string {
  const write = process.stdout.write as unknown as ReturnType<typeof vi.fn>
  return write.mock.calls.map(c => String(c[0])).join('')
}

function clearStdout(): void {
  const write = process.stdout.write as unknown as ReturnType<typeof vi.fn>
  write.mockClear()
}

let tmpConfig: string | undefined
const oldXdg = process.env.XDG_CONFIG_HOME
const oldBaseUrl = process.env.TB_BASE_URL
const oldSk = process.env.TB_SK

beforeEach(() => {
  process.exitCode = 0
  tmpConfig = mkdtempSync(join(tmpdir(), 'tb-cli-args-'))
  process.env.XDG_CONFIG_HOME = tmpConfig
  delete process.env.TB_BASE_URL
  delete process.env.TB_SK
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  process.exitCode = 0
  resetFetch()
  vi.restoreAllMocks()
  if (tmpConfig) rmSync(tmpConfig, { recursive: true, force: true })
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = oldXdg
  if (oldBaseUrl === undefined) delete process.env.TB_BASE_URL
  else process.env.TB_BASE_URL = oldBaseUrl
  if (oldSk === undefined) delete process.env.TB_SK
  else process.env.TB_SK = oldSk
})

describe('真正的全局参数', () => {
  it.each([
    ['根命令前', ['--json', '--base-url', 'https://gw', '--sk', 'tbk_x', 'sk', 'list']],
    ['命令组中间', ['sk', '--json', '--base-url', 'https://gw', '--sk', 'tbk_x', 'list']],
    ['叶子命令后', ['sk', 'list', '--json', '--base-url', 'https://gw', '--sk', 'tbk_x']],
  ])('%s也会传入叶子 action', async (_label, argv) => {
    const fn = jsonFetch({ items: [] })
    await runCli(argv)
    expect(String(fn.mock.calls[0]?.[0])).toBe('https://gw/system/sk')
    expect(JSON.parse(stdoutText())).toEqual({ items: [] })
  })

  it.each([
    ['根命令前', ['node', 'tb', '--json', 'sk', 'creat'], 'commander.unknownCommand'],
    ['命令组中间', ['node', 'tb', 'sk', '--json', 'creat'], 'commander.unknownCommand'],
    ['叶子命令后', ['node', 'tb', 'sk', 'list', '--json', '--bogus'], 'commander.unknownOption'],
  ])('%s的 --json 也会结构化 Commander 解析错误', async (_label, argv, code) => {
    await runMain(argv)
    expect(JSON.parse(stdoutText())).toMatchObject({
      ok: false,
      code,
    })
    expect(process.exitCode).toBe(1)
  })

  it('位于 -- 之后的字面量 --json 不会误切换解析错误输出模式', async () => {
    await runMain(['node', 'tb', 'call', 'p', '--bogus', '--', '--json'])
    expect(stdoutText()).toBe('')
    const write = process.stderr.write as unknown as ReturnType<typeof vi.fn>
    expect(write.mock.calls.map(c => String(c[0])).join('')).toContain('--bogus')
    expect(process.exitCode).toBe(1)
  })
})

describe('SK 参数与能力对齐', () => {
  it('create 在本地拒绝非法 expires，合法 offset 会先规范成 UTC', async () => {
    const fn = jsonFetch({ key: { id: 'k1', owner: 'user:a', scopes: [] }, secret: 'once' })
    const base = ['sk', 'create', '--owner', 'user:a', '--base-url', 'https://gw', '--sk', 'admin']
    await runCli([...base, '--expires', 'not-a-date', '--json'])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)

    process.exitCode = 0
    clearStdout()
    await runCli([...base, '--expires', '2026-07-23T08:00:00+08:00', '--json'])
    const payload = JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(payload.arguments.expiresAt).toBe('2026-07-23T00:00:00.000Z')
  })

  it('get/update/disable 映射到已有 SKRegistry 动词', async () => {
    const key = { id: 'k1', owner: 'user:a', scopes: [], disabled: false }
    const fn = jsonFetch(key)
    const gw = ['--base-url', 'https://gw', '--sk', 'admin', '--json']

    await runCli(['sk', 'get', 'k1', ...gw])
    expect(JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      tool: 'get',
      arguments: { id: 'k1' },
    })
    await runCli(['sk', 'update', 'k1', '--description', 'build key', '--scope', 'ci/**:call', ...gw])
    expect(JSON.parse((fn.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual({
      tool: 'update',
      arguments: {
        id: 'k1',
        patch: {
          description: 'build key',
          scopes: [{ pattern: 'ci/**', actions: ['call'] }],
        },
      },
    })
    await runCli(['sk', 'disable', 'k1', ...gw])
    expect(JSON.parse((fn.mock.calls[2]?.[1] as RequestInit).body as string)).toEqual({
      tool: 'update',
      arguments: { id: 'k1', patch: { disabled: true } },
    })
  })
})

describe('分页参数', () => {
  it.each([
    ['sk', ['sk', 'list'], '/system/sk'],
    ['secret', ['secret', 'ls'], '/system/secret'],
    ['plugin', ['plugin', 'list'], '/system/plugin'],
  ])('%s list 统一发送 arguments.opts', async (_name, command, path) => {
    const fn = jsonFetch({ items: [], cursor: 'next' })
    await runCli([
      ...command,
      '--limit',
      '10',
      '--cursor',
      'c1',
      '--base-url',
      'https://gw',
      '--sk',
      'admin',
      '--json',
    ])
    expect(String(fn.mock.calls[0]?.[0])).toBe(`https://gw${path}`)
    expect(JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string).arguments).toEqual({
      opts: { limit: 10, cursor: 'c1' },
    })
  })

  it('limit 超过服务端上限会在本地拒绝', async () => {
    const fn = jsonFetch({ items: [] })
    await runCli([
      'plugin',
      'list',
      '--limit',
      '201',
      '--base-url',
      'https://gw',
      '--sk',
      'admin',
      '--json',
    ])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('context/skill search 都透传 cursor', async () => {
    const fn = jsonFetch({ items: [] })
    const gw = ['--base-url', 'https://gw', '--sk', 'admin', '--json']
    await runCli(['ctx', 'search', 'ctx/docs', 'q', '--cursor', 'ctx-c', ...gw])
    expect(JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string).arguments).toEqual({
      query: 'q',
      opts: { cursor: 'ctx-c' },
    })
    await runCli(['skill', 'search', 'skills/team', 'q', '--cursor', 'skill-c', ...gw])
    expect(JSON.parse((fn.mock.calls[1]?.[1] as RequestInit).body as string).arguments).toEqual({
      query: 'q',
      opts: { cursor: 'skill-c' },
    })
  })

  it('device/server 的 registry 分页既透传参数也保留下一页 cursor', async () => {
    const fn = jsonFetch({
      items: [{ path: 'device/d1', kind: 'directory', online: true }],
      cursor: 'device-next',
    })
    const gw = ['--base-url', 'https://gw', '--sk', 'admin', '--json']
    await runCli(['device', 'ls', '--limit', '10', '--cursor', 'd0', ...gw])
    expect(JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string).arguments).toEqual({
      prefix: 'device',
      opts: { limit: 10, cursor: 'd0' },
    })
    expect(JSON.parse(stdoutText()).cursor).toBe('device-next')

    fn.mockClear()
    clearStdout()
    fn.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [{ path: 'fed/a', kind: 'remote', config: { kind: 'remote', baseUrl: 'x' } }],
          cursor: 'server-next',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    await runCli(['server', 'ls', '--limit', '20', '--cursor', 's0', ...gw])
    expect(JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string).arguments).toEqual({
      opts: { limit: 20, cursor: 's0' },
    })
    expect(JSON.parse(stdoutText()).cursor).toBe('server-next')
  })
})

describe('条件参数与挂载语义', () => {
  it('tool-provider plugin 可挂载，缺省描述非空', async () => {
    const fn = jsonFetch({ path: 'tools/notion', kind: 'tool' })
    await runCli([
      'tool',
      'mount',
      'tools/notion',
      '--kind',
      'tool',
      '--provider',
      'notion-tools',
      '--auth-ref',
      'notion-token',
      '--base-url',
      'https://gw',
      '--sk',
      'admin',
      '--json',
    ])
    expect(JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      path: 'tools/notion',
      kind: 'tool',
      description: 'plugin-backed tool source at tools/notion',
      config: { kind: 'tool', provider: 'notion-tools', authRef: 'notion-token' },
    })
  })

  it('server add 用独立 remote URL，并为省略的描述生成兼容默认值', async () => {
    const fn = jsonFetch({ path: 'fed/team', kind: 'remote' })
    await runCli([
      'server',
      'add',
      'fed/team',
      '--remote-url',
      'https://team.example',
      '--base-url',
      'https://gw',
      '--sk',
      'admin',
      '--json',
    ])
    expect(String(fn.mock.calls[0]?.[0])).toBe('https://gw/fed/team/~register')
    expect(JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      path: 'fed/team',
      kind: 'remote',
      description: 'remote HTBP server at https://team.example',
      config: { kind: 'remote', baseUrl: 'https://team.example' },
    })
  })

  it('server add 旧 --base-url 远端写法会给出可执行迁移提示', async () => {
    const fn = jsonFetch({})
    await runCli(['server', 'add', 'fed/team', '--base-url', 'https://old-remote', '--json'])
    expect(fn).not.toHaveBeenCalled()
    expect(JSON.parse(stdoutText())).toMatchObject({
      ok: false,
      error: expect.stringContaining('--base-url now selects the gateway'),
    })
    expect(JSON.parse(stdoutText()).error).toContain('--remote-url')
    expect(process.exitCode).toBe(1)
  })

  it('不属于当前 kind/provider 的参数会失败，不再静默忽略', async () => {
    const fn = jsonFetch({})
    const gw = ['--base-url', 'https://gw', '--sk', 'admin', '--json']
    await runCli([
      'tool',
      'mount',
      'x',
      '--kind',
      'mcp',
      '--url',
      'https://mcp.example',
      '--endpoint',
      'https://ignored.example',
      ...gw,
    ])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)

    process.exitCode = 0
    await runCli(['ctx', 'mount', 'ctx/x', '--provider', 'r2', '--auth-ref', 'unused', ...gw])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('ctx put 的内容来源互斥；ctx rm 映射到 Delete', async () => {
    const fn = jsonFetch({ ok: true })
    const gw = ['--base-url', 'https://gw', '--sk', 'admin', '--json']
    await runCli(['ctx', 'put', 'ctx/docs', 'a', '--content', 'x', '--file', 'a.txt', ...gw])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)

    process.exitCode = 0
    await runCli(['ctx', 'rm', 'ctx/docs', 'a', ...gw])
    expect(JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      tool: 'Delete',
      arguments: { path: 'a' },
    })
  })

  it('connect 的重复 URL、无效 shell/fs 组合会提前失败', async () => {
    const { runDeviceConnection } = await import('../src/deviceRuntime')
    await runCli([
      'connect',
      'https://positional',
      '--base-url',
      'https://flag',
      '--sk',
      'device-key',
      '--json',
    ])
    await runCli([
      'connect',
      '--base-url',
      'https://gw',
      '--sk',
      'device-key',
      '--no-shell',
      '--allow',
      'git',
      '--json',
    ])
    await runCli([
      'connect',
      '--base-url',
      'https://gw',
      '--sk',
      'device-key',
      '--fs-readonly',
      '--json',
    ])
    expect(vi.mocked(runDeviceConnection)).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('skill get 的 --file/--out 与 help 的 --md/--json 均互斥', async () => {
    const fn = jsonFetch({})
    const gw = ['--base-url', 'https://gw', '--sk', 'admin', '--json']
    await runCli(['skill', 'get', 'skills/team', 'pdf', '--file', 'a', '--out', 'dir', ...gw])
    await runCli(['help', 'docs', '--md', ...gw])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('tree depth 与 status timeout 使用各自声明的范围', async () => {
    const fn = jsonFetch({ healthy: true })
    const gw = ['--base-url', 'https://gw', '--sk', 'admin', '--json']
    await runCli(['tree', '--depth', '0', ...gw])
    await runCli(['tree', '--depth', '9', ...gw])
    await runCli(['status', '--timeout', '0', ...gw])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('长驻 connect 明确拒绝不适用的 --timeout', async () => {
    const { runDeviceConnection } = await import('../src/deviceRuntime')
    await runCli([
      'connect',
      '--base-url',
      'https://gw',
      '--sk',
      'device-key',
      '--timeout',
      '3',
      '--json',
    ])
    expect(vi.mocked(runDeviceConnection)).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('status 通过统一 HTTP 层发送带 timeout 的 AbortSignal', async () => {
    const fn = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(JSON.stringify({ healthy: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    setFetch(fn as unknown as typeof fetch)
    await runCli(['status', '--base-url', 'https://gw', '--timeout', '0.001', '--json'])
    expect(fn).toHaveBeenCalledOnce()
    expect(process.exitCode).toBe(0)
  })
})
