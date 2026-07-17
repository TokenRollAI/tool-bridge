import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../src/program'
import { parseError } from './cliHarness'

/**
 * 解析严格性回归(commander@15 迁移动机)。
 *
 * 事故:citty 0.2.2 对未知 flag 静默接受——`tb connect <url> --allow git --alows ls`
 * 中拼错的 `--alows` 被当 boolean 吞掉、`ls` 变 positional,用户以为放行了 ls,
 * 实际白名单只有 git(shell 权限误配)。本文件锁定"解析层必须报错"的基本路径:
 * 未知 flag / 缺 required / 多余 positional / flag 缺值 / 未知子命令。
 */

vi.mock('../src/deviceRuntime', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/deviceRuntime')>()
  return { ...mod, runDeviceConnection: vi.fn(async () => {}) }
})

let tmpConfig: string | undefined
const oldXdg = process.env.XDG_CONFIG_HOME

beforeEach(() => {
  process.exitCode = 0
  tmpConfig = mkdtempSync(join(tmpdir(), 'tb-cli-strict-'))
  process.env.XDG_CONFIG_HOME = tmpConfig
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  process.exitCode = 0
  vi.restoreAllMocks()
  if (tmpConfig) rmSync(tmpConfig, { recursive: true, force: true })
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = oldXdg
})

describe('未知 flag 必须报错(事故回归)', () => {
  it('tb connect --alows(--allow 拼错)→ unknownOption,绝不静默接受', async () => {
    expect(
      await parseError(['connect', 'https://gw.example', '--allow', 'git', '--alows', 'ls']),
    ).toBe('commander.unknownOption')
  })

  it('每个叶子命令的未知 flag 都报错', async () => {
    const cases: string[][] = [
      ['status', '--bogus'],
      ['login', '--bogus'],
      ['whoami', '--bogus'],
      ['use', 'p', '--bogus'],
      ['sk', 'list', '--bogus'],
      ['sk', 'create', '--owner', 'user:a', '--bogus'],
      ['sk', 'rm', 'id1', '--bogus'],
      ['secret', 'set', '--name', 'n', '--value', 'v', '--bogus'],
      ['secret', 'ls', '--bogus'],
      ['secret', 'rm', 'n', '--bogus'],
      ['federation', 'ls', '--bogus'],
      ['federation', 'add', 'example.com', '--bogus'],
      ['federation', 'rm', 'example.com', '--bogus'],
      ['note', 'ls', '--bogus'],
      ['note', 'get', 'p', '--bogus'],
      ['note', 'set', 'p', 'text', '--bogus'],
      ['note', 'rm', 'p', '--bogus'],
      ['feedback', 'ls', 'p', '--bogus'],
      ['feedback', 'get', 'p', 'fb_x', '--bogus'],
      ['feedback', 'submit', 'p', '--title', 't', '--detail', 'd', '--bogus'],
      ['feedback', 'vote', 'p', 'fb_x', 'up', '--bogus'],
      ['feedback', 'rm', 'p', 'fb_x', '--bogus'],
      ['ls', '--bogus'],
      ['tree', '--bogus'],
      ['help', '--bogus'],
      ['tool', 'mount', 'p', '--kind', 'mcp', '--url', 'u', '--bogus'],
      ['tool', 'rm', 'p', '--bogus'],
      ['server', 'add', 'p', '--base-url', 'u', '--bogus'],
      ['server', 'ls', '--bogus'],
      ['server', 'rm', 'p', '--bogus'],
      ['call', 'p', '--tool', 't', '--bogus'],
      ['ctx', 'ls', 'ns', '--bogus'],
      ['ctx', 'cat', 'ns', 'e', '--bogus'],
      ['ctx', 'put', 'ns', 'e', '--content', 'c', '--bogus'],
      ['ctx', 'patch', 'ns', 'e', '--content', 'c', '--bogus'],
      ['ctx', 'search', 'ns', 'q', '--bogus'],
      ['ctx', 'mount', 'p', '--provider', 'r2', '--bogus'],
      ['ctx', 'unmount', 'p', '--bogus'],
      ['connect', '--bogus'],
      ['device', 'ls', '--bogus'],
      ['mount', 'fs', '/tmp', '--bogus'],
      ['plugin', 'register', '--file', 'f', '--bogus'],
      ['plugin', 'list', '--bogus'],
      ['plugin', 'get', 'id', '--bogus'],
      ['plugin', 'update', 'id', '--file', 'f', '--bogus'],
      ['plugin', 'health', 'id', '--bogus'],
      ['plugin', 'rm', 'id', '--bogus'],
    ]
    for (const argv of cases) {
      expect(await parseError(argv), `argv: ${argv.join(' ')}`).toBe('commander.unknownOption')
    }
  })
})

describe('缺 required option / positional 必须报错', () => {
  it.each([
    [['sk', 'create'], 'commander.missingMandatoryOptionValue'],
    [['tool', 'mount', 'p'], 'commander.missingMandatoryOptionValue'],
    [['ctx', 'mount', 'p'], 'commander.missingMandatoryOptionValue'],
    [['server', 'add', 'p'], 'commander.missingMandatoryOptionValue'],
    // call 的 --tool 已非 required(省略 = path 即直连工具路径),不在此表。
    [['plugin', 'register'], 'commander.missingMandatoryOptionValue'],
    [['secret', 'set'], 'commander.missingMandatoryOptionValue'],
    [['sk', 'rm'], 'commander.missingArgument'],
    [['secret', 'rm'], 'commander.missingArgument'],
    [['tool', 'rm'], 'commander.missingArgument'],
    [['server', 'rm'], 'commander.missingArgument'],
    [['ctx', 'cat', 'ns'], 'commander.missingArgument'],
    [['ctx', 'search', 'ns'], 'commander.missingArgument'],
    [['mount', 'fs'], 'commander.missingArgument'],
    [['plugin', 'get'], 'commander.missingArgument'],
  ])('%j → %s', async (argv, code) => {
    expect(await parseError(argv as string[])).toBe(code)
  })
})

describe('多余 positional / flag 缺值 / 未知子命令', () => {
  it('多余 positional 报错(citty 会静默塞进 _)', async () => {
    expect(await parseError(['connect', 'https://gw.example', 'extra'])).toBe(
      'commander.excessArguments',
    )
    expect(await parseError(['sk', 'rm', 'id1', 'id2'])).toBe('commander.excessArguments')
  })

  it('string flag 缺值报错(citty 会给空串或吞下一个 flag)', async () => {
    expect(await parseError(['connect', '--allow'])).toBe('commander.optionMissingArgument')
    expect(await parseError(['sk', 'create', '--owner'])).toBe('commander.optionMissingArgument')
  })

  it('未知子命令报错', async () => {
    expect(await parseError(['sk', 'creat'])).toBe('commander.unknownCommand')
    expect(await parseError(['ctx', 'putt', 'ns', 'e'])).toBe('commander.unknownCommand')
  })
})

describe('--no-shell 语义(commander 原生否定 flag)', () => {
  it('--no-shell + --fs → 只暴露 fs', async () => {
    const { runDeviceConnection } = await import('../src/deviceRuntime')
    const { runCli } = await import('./cliHarness')
    await runCli([
      'connect',
      '--base-url',
      'https://gw',
      '--sk',
      'tbk_x',
      '--device-id',
      'd-noshell',
      '--no-shell',
      '--fs',
      '/tmp',
    ])
    expect(vi.mocked(runDeviceConnection)).toHaveBeenCalledWith(
      expect.objectContaining({ expose: { fs: { roots: ['/tmp'], readOnly: false } } }),
    )
  })

  it('缺省暴露 shell(allow 默认空 = 拒绝一切)', async () => {
    const { runDeviceConnection } = await import('../src/deviceRuntime')
    const { runCli } = await import('./cliHarness')
    await runCli([
      'connect',
      '--base-url',
      'https://gw',
      '--sk',
      'tbk_x',
      '--device-id',
      'd-default',
    ])
    expect(vi.mocked(runDeviceConnection)).toHaveBeenCalledWith(
      expect.objectContaining({ expose: { shell: { allow: [] } } }),
    )
  })
})

describe('tb help 让位为业务命令', () => {
  it('buildProgram 不注册内置 help 子命令(help [path] 是节点 ~help)', () => {
    const names = buildProgram().commands.map(c => c.name())
    expect(names.filter(n => n === 'help')).toHaveLength(1)
  })
})
