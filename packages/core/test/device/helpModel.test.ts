import { describe, expect, it } from 'vitest'
import {
  deviceDirectoryHelpModel,
  deviceFsHelpModel,
  deviceShellHelpModel,
} from '../../src/device/helpModel'
import { renderHelpDsl, renderHelpJson } from '../../src/htbp/helpDsl'

describe('deviceShellHelpModel(shell 契约)', () => {
  it('单 cmd exec:effect destructive + confirm,scope call,签名与返回', () => {
    const model = deviceShellHelpModel('device/d1/shell', { allow: ['echo', 'git'] })
    expect(model.node).toEqual({
      path: 'device/d1/shell',
      kind: 'device',
      description: 'device shell (remote command execution)',
    })
    expect(model.cmds).toHaveLength(1)
    const exec = model.cmds[0]
    expect(exec).toMatchObject({
      name: 'exec',
      method: 'POST',
      path: '/device/d1/shell/exec',
      scope: 'call',
      effect: 'destructive',
      confirm: true,
      returns: '{ stdout, stderr, exitCode, startedAt, completedAt, outcome, signal?, stdoutTruncated, stderrTruncated }',
    })
    expect(exec?.inputSchema).toMatchObject({
      required: ['command'],
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
    })
  })

  it('h 行含 allow 白名单描述(Agent 调用前可预判)', () => {
    expect(deviceShellHelpModel('d/s', { allow: ['echo', 'git'] }).cmds[0]?.h).toContain(
      'allowed commands: echo, git; everything else denied',
    )
    expect(deviceShellHelpModel('d/s', { allow: ['*'] }).cmds[0]?.h).toContain(
      'allowed commands: *',
    )
    expect(deviceShellHelpModel('d/s').cmds[0]?.h).toContain(
      'allowed commands: none (deny all by default)',
    )
  })

  it('自定义 description 透传;DSL 渲染含 effect destructive(DoD:~help 含 effect destructive)', () => {
    const model = deviceShellHelpModel('device/d1/shell', { description: 'CI 机器' })
    expect(model.node.description).toBe('CI 机器')
    const dsl = renderHelpDsl(model)
    expect(dsl).toContain('cmd exec POST /device/d1/shell/exec')
    expect(dsl).toContain('effect destructive')
    expect(dsl).toContain('confirm')
  })
})

describe('deviceFsHelpModel(复用 context 静态 help)', () => {
  it('全量六 cmd;readOnly 隐藏写动词', () => {
    const node = { path: 'device/d1/fs', description: '设备文件' }
    const full = deviceFsHelpModel(node)
    expect(full.node.kind).toBe('context')
    expect(full.cmds.map(c => c.name)).toEqual([
      'list',
      'get',
      'write',
      'update',
      'delete',
      'search',
    ])
    const readOnly = deviceFsHelpModel(node, { readOnly: true })
    expect(readOnly.cmds.map(c => c.name)).toEqual(['list', 'get', 'search'])
  })

  it('运行时 Help JSON/DSL 显式发出每个文件命令的 effect', () => {
    const model = deviceFsHelpModel({ path: 'device/d1/fs', description: '设备文件' })
    const expected = {
      list: 'read',
      get: 'read',
      write: 'write',
      update: 'write',
      delete: 'destructive',
      search: 'read',
    }

    const json = renderHelpJson(model)
    expect(Object.fromEntries(json.cmds.map(command => [command.name, command.effect])))
      .toEqual(expected)

    const dslEffects: Record<string, string> = {}
    let command = ''
    for (const line of renderHelpDsl(model).split('\n')) {
      if (line.startsWith('cmd ')) command = line.split(' ')[1] ?? ''
      if (line.startsWith('  effect ')) dslEffects[command] = line.slice('  effect '.length)
    }
    expect(dslEffects).toEqual(expected)
  })
})

describe('deviceDirectoryHelpModel(mountPath 节点 presence 呈现)', () => {
  it('presence.state 进 description;children 透传', () => {
    const children = [
      { path: 'device/d1/shell', kind: 'device' as const, description: 'shell' },
      { path: 'device/d1/fs', kind: 'context' as const, description: 'fs' },
    ]
    const online = deviceDirectoryHelpModel(
      { path: 'device/d1', description: '设备 d1', presence: { state: 'online' } },
      children,
    )
    expect(online.node).toEqual({
      path: 'device/d1',
      kind: 'directory',
      description: '设备 d1 (online)',
    })
    expect(online.children).toEqual(children)
    expect(online.cmds).toEqual([])
    const stale = deviceDirectoryHelpModel({
      path: 'device/d1',
      description: '设备 d1',
      presence: { state: 'stale' },
    })
    expect(stale.node.description).toBe('设备 d1 (stale)')
    const offline = deviceDirectoryHelpModel({
      path: 'device/d1',
      description: '设备 d1',
      presence: { state: 'offline' },
    })
    expect(offline.node.description).toBe('设备 d1 (offline)')
    expect(offline.children).toEqual([])
  })
})
