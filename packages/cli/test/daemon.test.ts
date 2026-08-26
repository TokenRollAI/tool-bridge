import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DAEMON_SERVICE,
  type DaemonDeps,
  daemonExecArgv,
  type DaemonPaths,
  daemonStatus,
  installDaemon,
  type ProcessResult,
  type ProcessRunner,
  renderSystemdUnit,
  restartDaemon,
  runDaemon,
  systemdQuote,
  uninstallDaemon,
  waitForDaemonReady,
} from '../src/daemon'
import { runCli } from './cliHarness'

vi.mock('../src/deviceRuntime', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/deviceRuntime')>()
  return { ...mod, runDeviceConnection: vi.fn(async () => {}) }
})

function ok(stdout = ''): ProcessResult {
  return { exitCode: 0, stdout, stderr: '' }
}

let tmp: string
let paths: DaemonPaths
const oldSudoUser = process.env.SUDO_USER

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tb-daemon-'))
  paths = {
    config: join(tmp, 'config', 'device.json'),
    state: join(tmp, 'config', 'state.json'),
    unit: join(tmp, 'systemd', DAEMON_SERVICE),
  }
  delete process.env.SUDO_USER
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(tmp, { recursive: true, force: true })
  if (oldSudoUser === undefined) delete process.env.SUDO_USER
  else process.env.SUDO_USER = oldSudoUser
})

function deps(runner: ProcessRunner): Partial<DaemonDeps> {
  return {
    paths,
    runner,
    platform: 'linux',
    username: 'alice',
    getUid: () => 1000,
    interactive: false,
    execArgv: ['/usr/bin/node', '/opt/tb/dist/index.js'],
    waitForReady: async (_paths, revision) => ({
      revision,
      deviceId: 'd1',
      mountPath: 'device/d1',
      state: 'ready',
      updatedAt: new Date().toISOString(),
    }),
  }
}

describe('systemd unit', () => {
  it('只引用绝对入口与私有配置，不把 SK 写入 unit', () => {
    const unit = renderSystemdUnit(
      ['/usr/bin/node', '/opt/tool bridge/tb%entry.js'],
      '/home/alice/.config/tool-bridge/daemon/device.json',
    )
    expect(unit).toContain('Restart=always')
    expect(unit).toContain('WantedBy=default.target')
    expect(unit).toContain('"/opt/tool bridge/tb%%entry.js"')
    expect(unit).toContain('"daemon" "_run" "--config"')
    expect(unit).not.toContain('tbk_')
  })

  it('引用会阻止 systemd 展开 $/% 并拒绝控制字符', () => {
    expect(systemdQuote('/tmp/$name%id')).toBe('"/tmp/$$name%%id"')
    expect(() => systemdQuote('/tmp/a\nb')).toThrow('control character')
  })

  it('Node 入口固定 runtime + script 绝对路径', () => {
    expect(daemonExecArgv(['node', './dist/index.js'], '/usr/bin/node')).toEqual([
      '/usr/bin/node',
      join(process.cwd(), 'dist/index.js'),
    ])
  })

  it('ready 等待以同 revision 状态为准，连接错误直接失败', async () => {
    mkdirSync(join(tmp, 'config'), { recursive: true })
    writeFileSync(paths.state, JSON.stringify({
      revision: 'old',
      deviceId: 'd1',
      state: 'ready',
      updatedAt: new Date().toISOString(),
    }))
    await expect(waitForDaemonReady(paths, 'new', 5, 1)).rejects.toThrow('did not become ready')

    writeFileSync(paths.state, JSON.stringify({
      revision: 'new',
      deviceId: 'd1',
      state: 'error',
      error: 'SK rejected',
      updatedAt: new Date().toISOString(),
    }))
    await expect(waitForDaemonReady(paths, 'new', 20, 1)).rejects.toThrow('SK rejected')
  })
})

describe('daemon lifecycle', () => {
  it('install 冻结目标到 0600 配置、启用 linger 并启动用户服务', async () => {
    const calls: Array<[string, string[]]> = []
    const runner: ProcessRunner = vi.fn(async (executable, args) => {
      calls.push([executable, args])
      if (executable === 'loginctl' && args[0] === 'show-user') return ok('no\n')
      return ok()
    })
    const status = await installDaemon(
      {
        baseUrl: 'https://tb.example',
        sk: 'tbk_device_secret',
        deviceId: 'ubuntu-01',
        mountPath: 'device/ubuntu-01',
        expose: { shell: { allow: ['*'] } },
        commandProfiles: [{
          version: 1,
          path: 'ops/system',
          description: 'safe operations',
          commands: [{
            name: 'system-info',
            description: 'read system information',
            executable: '/usr/bin/uname',
            effect: 'read',
          }],
        }],
      },
      deps(runner),
    )

    const config = readFileSync(paths.config, 'utf8')
    const unit = readFileSync(paths.unit, 'utf8')
    expect(JSON.parse(config)).toMatchObject({
      baseUrl: 'https://tb.example',
      sk: 'tbk_device_secret',
      deviceId: 'ubuntu-01',
      mountPath: 'device/ubuntu-01',
      expose: { shell: { allow: ['*'] } },
      commandProfiles: [expect.objectContaining({ path: 'ops/system' })],
    })
    expect(statSync(paths.config).mode & 0o777).toBe(0o600)
    expect(unit).not.toContain('tbk_device_secret')
    expect(calls).toContainEqual(['loginctl', ['enable-linger', 'alice']])
    expect(calls).toContainEqual([
      'systemctl',
      ['--user', 'enable', DAEMON_SERVICE],
    ])
    expect(calls).toContainEqual([
      'systemctl',
      ['--user', 'restart', DAEMON_SERVICE],
    ])
    expect(status).toMatchObject({ installed: true, enabled: true, active: true })
  })

  it('linger 已开启时不重复 enable；权限失败给出 sudo 修复命令', async () => {
    const enabledRunner: ProcessRunner = vi.fn(async (executable, args) =>
      executable === 'loginctl' && args[0] === 'show-user' ? ok('yes\n') : ok())
    await installDaemon(
      {
        baseUrl: 'https://tb.example',
        sk: 'tbk_x',
        deviceId: 'd1',
        expose: { shell: { allow: ['echo'] } },
      },
      deps(enabledRunner),
    )
    expect(vi.mocked(enabledRunner).mock.calls).not.toContainEqual([
      'loginctl',
      ['enable-linger', 'alice'],
    ])

    rmSync(tmp, { recursive: true, force: true })
    const deniedRunner: ProcessRunner = vi.fn(async (executable, args) => {
      if (executable === 'loginctl' && args[0] === 'show-user') return ok('no\n')
      if (executable === 'loginctl') return { exitCode: 1, stdout: '', stderr: 'denied' }
      return ok()
    })
    await expect(installDaemon(
      {
        baseUrl: 'https://tb.example',
        sk: 'tbk_x',
        deviceId: 'd1',
        expose: { shell: { allow: ['echo'] } },
      },
      deps(deniedRunner),
    )).rejects.toThrow('sudo loginctl enable-linger alice')
    expect(existsSync(paths.config)).toBe(false)
  })

  it('交互终端下用固定 sudo loginctl 命令完成一次性 linger 授权', async () => {
    const runner: ProcessRunner = vi.fn(async (executable, args) => {
      if (executable === 'loginctl' && args[0] === 'show-user') return ok('no\n')
      if (executable === 'loginctl') return { exitCode: 1, stdout: '', stderr: 'denied' }
      return ok()
    })
    await installDaemon(
      {
        baseUrl: 'https://tb.example',
        sk: 'tbk_x',
        deviceId: 'd1',
        expose: { shell: { allow: ['echo'] } },
      },
      { ...deps(runner), interactive: true },
    )
    expect(vi.mocked(runner).mock.calls).toContainEqual([
      'sudo',
      ['loginctl', 'enable-linger', 'alice'],
      { inherit: true },
    ])
  })

  it('status/restart/uninstall 幂等且不删除 login profile', async () => {
    const runner: ProcessRunner = vi.fn(async () => ok())
    await installDaemon(
      {
        baseUrl: 'https://tb.example',
        sk: 'tbk_x',
        deviceId: 'd1',
        expose: { shell: { allow: ['echo'] } },
      },
      deps(runner),
    )
    const restarted = await restartDaemon(deps(runner))
    expect(restarted.active).toBe(true)
    expect(vi.mocked(runner).mock.calls.some(call =>
      call[0] === 'systemctl'
      && JSON.stringify(call[1]) === JSON.stringify(['--user', 'restart', DAEMON_SERVICE]),
    )).toBe(true)

    const removed = await uninstallDaemon(deps(runner))
    expect(removed).toEqual({ removed: true })
    expect(await daemonStatus(deps(runner))).toEqual({
      installed: false,
      enabled: false,
      active: false,
      connection: 'unknown',
    })
    expect(await uninstallDaemon(deps(runner))).toEqual({ removed: false })
  })

  it('重复 install 会 restart 已 active 服务，失败更新会恢复旧配置', async () => {
    const runner: ProcessRunner = vi.fn(async () => ok())
    await installDaemon(
      {
        baseUrl: 'https://old.example',
        sk: 'tbk_old',
        deviceId: 'd1',
        expose: { shell: { allow: ['echo'] } },
      },
      deps(runner),
    )
    const oldConfig = readFileSync(paths.config, 'utf8')
    const restartBefore = vi.mocked(runner).mock.calls.filter(
      call => call[0] === 'systemctl' && call[1][1] === 'restart',
    ).length

    await expect(installDaemon(
      {
        baseUrl: 'https://new.example',
        sk: 'tbk_new',
        deviceId: 'd1',
        expose: { shell: { allow: ['echo'] } },
      },
      {
        ...deps(runner),
        waitForReady: async () => {
          throw new Error('not ready')
        },
      },
    )).rejects.toThrow('not ready')
    expect(readFileSync(paths.config, 'utf8')).toBe(oldConfig)
    const restartAfter = vi.mocked(runner).mock.calls.filter(
      call => call[0] === 'systemctl' && call[1][1] === 'restart',
    ).length
    // 新 revision restart 一次，rollback 后旧 revision 再 restart 一次。
    expect(restartAfter - restartBefore).toBe(2)
  })

  it('status 区分 inactive 与 systemd user bus 故障', async () => {
    const okRunner: ProcessRunner = vi.fn(async (executable, args) => {
      if (executable === 'loginctl' && args[0] === 'show-user') return ok('yes\n')
      return ok()
    })
    await installDaemon(
      {
        baseUrl: 'https://tb.example',
        sk: 'tbk_x',
        deviceId: 'd1',
        expose: { shell: { allow: ['echo'] } },
      },
      deps(okRunner),
    )
    const busDown: ProcessRunner = vi.fn(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'Failed to connect to bus',
    }))
    await expect(daemonStatus(deps(busDown))).rejects.toThrow('Failed to connect to bus')
  })

  it('非 Linux 与 sudo/root 安装 fail closed', async () => {
    const runner: ProcessRunner = vi.fn(async () => ok())
    await expect(installDaemon(
      {
        baseUrl: 'https://tb.example',
        sk: 'tbk_x',
        deviceId: 'd1',
        expose: { shell: { allow: [] } },
      },
      { ...deps(runner), platform: 'darwin' },
    )).rejects.toThrow('Linux with systemd only')
    await expect(daemonStatus({ ...deps(runner), getUid: () => 0 })).rejects.toThrow(
      'with sudo/root',
    )
  })
})

describe('daemon run', () => {
  it('从私有配置启动连接，并只把非敏感状态写入 state 文件', async () => {
    const { runDeviceConnection } = await import('../src/deviceRuntime')
    const config = {
      version: 1,
      revision: 'rev-1',
      baseUrl: 'https://tb.example',
      sk: 'tbk_never_in_state',
      deviceId: 'd1',
      mountPath: 'device/d1',
      expose: { shell: { allow: ['echo'] } },
      commandProfiles: [{
        version: 1,
        path: 'ops/system',
        description: 'safe operations',
        commands: [{
          name: 'system-info',
          description: 'read system information',
          executable: '/usr/bin/uname',
          effect: 'read',
        }],
      }],
    }
    mkdirSync(join(tmp, 'config'), { recursive: true })
    writeFileSync(paths.config, JSON.stringify(config))
    vi.mocked(runDeviceConnection).mockImplementationOnce(async (opts) => {
      opts.onReady?.('device/d1')
    })

    await runDaemon(paths.config)
    expect(vi.mocked(runDeviceConnection)).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://tb.example',
        sk: 'tbk_never_in_state',
        deviceId: 'd1',
        commandProfiles: [expect.objectContaining({ path: 'ops/system' })],
      }),
    )
    const state = readFileSync(paths.state, 'utf8')
    expect(JSON.parse(state)).toMatchObject({
      revision: 'rev-1',
      state: 'ready',
      mountPath: 'device/d1',
    })
    expect(state).not.toContain('tbk_never_in_state')
  })
})

describe('daemon command safety UX', () => {
  it(`非交互 --allow '*' 必须显式 --yes`, async () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    process.exitCode = 0
    await runCli([
      'daemon',
      'install',
      '--base-url',
      'https://tb.example',
      '--sk',
      'tbk_device',
      '--device-id',
      'd1',
      '--allow',
      '*',
    ])
    expect(stderr.mock.calls.map(call => String(call[0])).join('')).toContain('pass --yes')
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })
})
