import { describe, expect, it, vi } from 'vitest'
import type { SpawnedProcess } from '../../src/node/processExecution'
import {
  createStructuredCommandRuntime,
  parseStructuredCommandProfile,
  type StructuredCommandProfile,
  type StructuredCommandSpawnFn,
} from '../../src/node/structuredCommand'

const PROFILE: StructuredCommandProfile = {
  version: 1,
  path: 'ops/system',
  description: 'safe system inspection',
  commands: [
    {
      name: 'system-info',
      description: 'read kernel information',
      executable: '/usr/bin/uname',
      effect: 'read',
      inheritEnv: ['DEVICE_REGION'],
      argv: [
        '-s',
        { input: 'all', type: 'boolean', flag: '-a' },
        { input: 'format', flag: '--format', choices: ['short', 'long'] },
        { input: 'labels', flag: '--label', multiple: true },
      ],
    },
    {
      name: 'restart-service',
      description: 'restart one predeclared service',
      executable: '/usr/bin/systemctl',
      effect: 'destructive',
      argv: ['restart', 'example.service'],
    },
  ],
}

function fakeProcess() {
  const listeners = new Map<string, Array<(...args: never[]) => void>>()
  const on = (event: string, cb: (...args: never[]) => void) => {
    const list = listeners.get(event) ?? []
    list.push(cb)
    listeners.set(event, list)
  }
  const emit = (event: string, ...args: unknown[]) => {
    for (const cb of listeners.get(event) ?? []) (cb as (...a: unknown[]) => void)(...args)
  }
  const child: SpawnedProcess = {
    stdout: { on: (event, cb) => on(`stdout:${event}`, cb as never) },
    stderr: { on: (event, cb) => on(`stderr:${event}`, cb as never) },
    on: (event: string, cb: (...args: never[]) => void) => on(event, cb),
    kill: () => emit('exit', null, 'SIGKILL'),
  }
  return { child, emit }
}

describe('structured command profile', () => {
  it('canonicalize 标识符，破坏性命令自动 confirm:true', () => {
    const profile = parseStructuredCommandProfile({
      ...PROFILE,
      path: '/Ops/System/',
      commands: [{ ...PROFILE.commands[1], name: 'Restart-Service' }],
    })
    expect(profile.path).toBe('ops/system')
    expect(profile.commands[0]).toMatchObject({ name: 'restart-service', confirm: true })
  })

  it.each([
    [{ ...PROFILE, extra: true }, 'Unrecognized key'],
    [{ ...PROFILE, commands: [{ ...PROFILE.commands[1], confirm: false }] }, 'confirm:false'],
    [{ ...PROFILE, commands: [{ ...PROFILE.commands[0], name: 'a/b' }] }, 'contains \'/\''],
    [{
      ...PROFILE,
      commands: [{
        ...PROFILE.commands[0],
        argv: [{ input: 'toggle', type: 'boolean' }],
      }],
    }, 'requires flag'],
    [{
      ...PROFILE,
      commands: [PROFILE.commands[0], { ...PROFILE.commands[0], name: 'System-Info' }],
    }, 'duplicate command'],
  ])('非法 profile fail closed: %s', (profile, message) => {
    expect(() => parseStructuredCommandProfile(profile)).toThrow(message)
  })
})

describe('structured command runtime', () => {
  it('Help metadata/schema 来自同一 profile，shell/exec 不参与', () => {
    const runtime = createStructuredCommandRuntime(PROFILE, { spawn: vi.fn() as never })
    expect(runtime).toMatchObject({ path: 'ops/system', description: 'safe system inspection' })
    expect(runtime.cmds.map(command => ({
      name: command.name,
      effect: command.effect,
      confirm: command.confirm,
    }))).toEqual([
      { name: 'system-info', effect: 'read', confirm: undefined },
      { name: 'restart-service', effect: 'destructive', confirm: true },
    ])
    expect(runtime.cmds[0]?.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        all: { type: 'boolean' },
        format: { enum: ['short', 'long'], type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
      },
    })
  })

  it('按 argv 模板直接 spawn(shell:false)，并只继承环境白名单', async () => {
    const { child, emit } = fakeProcess()
    const spawn = vi.fn(() => child) as unknown as StructuredCommandSpawnFn
    const runtime = createStructuredCommandRuntime(PROFILE, {
      spawn,
      env: {
        PATH: '/usr/bin',
        HOME: '/home/alice',
        DEVICE_REGION: 'cn',
        TB_SK: 'tbk_must_not_leak',
      },
    })
    const pending = runtime.invoke('system-info', {
      all: true,
      format: 'long',
      labels: ['a', 'b'],
    })
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/uname',
      ['-s', '-a', '--format', 'long', '--label', 'a', '--label', 'b'],
      {
        shell: false,
        env: { PATH: '/usr/bin', HOME: '/home/alice', DEVICE_REGION: 'cn' },
      },
    )
    emit('stdout:data', 'Linux\n')
    emit('close', 0, null)
    await expect(pending).resolves.toMatchObject({
      stdout: 'Linux\n',
      exitCode: 0,
      outcome: 'exited',
    })
  })

  it('strict 参数校验在 spawn 前拒绝未知字段与非法 choice', async () => {
    const spawn = vi.fn()
    const runtime = createStructuredCommandRuntime(PROFILE, { spawn: spawn as never })
    await expect(runtime.invoke('system-info', { command: 'rm -rf /' }))
      .rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(runtime.invoke('system-info', { format: 'other' }))
      .rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(runtime.invoke('system-info', { labels: ['ok', 'bad\0value'] }))
      .rejects.toMatchObject({ code: 'invalid_argument' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('device cancel AbortSignal 会杀掉直接子进程', async () => {
    const { child } = fakeProcess()
    const kill = vi.spyOn(child, 'kill')
    const runtime = createStructuredCommandRuntime(PROFILE, { spawn: () => child })
    const controller = new AbortController()
    const pending = runtime.invoke('system-info', {}, { signal: controller.signal })
    controller.abort()
    await expect(pending).resolves.toMatchObject({ outcome: 'signaled', signal: 'SIGKILL' })
    expect(kill).toHaveBeenCalledWith('SIGKILL')
  })
})
