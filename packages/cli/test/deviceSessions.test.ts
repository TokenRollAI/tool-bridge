import type { OpenPortableDeviceConnectionOptions } from '@tool-bridge/sdk/device'
import { processSessionListSchema, processSessionObservationSchema, processSessionSummarySchema } from '@tool-bridge/sdk/client'
import { parseStructuredCommandProfile } from '@tool-bridge/core/node'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startDeviceConnection } from '../src/deviceRuntime'
import { buildExpose } from '../src/commands/connect'
import { renderSystemdUnit } from '../src/daemon'

const transport = vi.hoisted(() => ({
  options: undefined as OpenPortableDeviceConnectionOptions | undefined,
  finish: () => {},
  close: vi.fn(),
}))
vi.mock('@tool-bridge/sdk/device', async original => ({
  ...await original<typeof import('@tool-bridge/sdk/device')>(),
  openPortableDeviceConnection: (options: OpenPortableDeviceConnectionOptions) => {
    transport.options = options
    return {
      ready: Promise.resolve('device/test'),
      closed: new Promise<void>((resolve) => { transport.finish = resolve }),
      close: () => {
        transport.close()
        transport.finish()
      },
      restart: vi.fn(), resume: vi.fn(), suspend: vi.fn(), state: 'ready',
    }
  },
}))
// Linux is the enabled production platform; these tests also exercise POSIX groups on macOS.
vi.mock('@tool-bridge/core/node', async (original) => {
  const actual = await original<typeof import('@tool-bridge/core/node')>()
  return { ...actual, createProcessSessionManager: () => actual.createProcessSessionManager({ platform: 'linux', terminationGraceMs: 30 }) }
})

const handles: ReturnType<typeof startDeviceConnection>[] = []
afterEach(async () => {
  for (const handle of handles.splice(0)) {
    handle.close()
    await handle.closed.catch(() => {})
  }
  transport.options = undefined
  vi.clearAllMocks()
})
const profile = () => parseStructuredCommandProfile({
  version: 1, path: 'ops', description: 'test command',
  commands: [{ name: 'build', description: 'test build', executable: process.execPath,
    argv: ['-e', 'console.log(\'ready\');setInterval(()=>console.log(\'tick\'),20)'], effect: 'read',
    session: { path: 'sessions/build', maxRuntimeMs: 60_000 } }],
})
function connect() {
  const commandProfiles = [profile()]
  const handle = startDeviceConnection({ baseUrl: 'https://gateway.example', sk: 'test-key', deviceId: 'test',
    commandProfiles, expose: buildExpose({ shell: false }, commandProfiles) })
  handles.push(handle)
  return handle
}
async function call(action: string, args: Record<string, unknown>, owner = 'agent:alice') {
  if (!transport.options) throw new Error('transport not initialized')
  return transport.options.handler({ id: crypto.randomUUID(), path: `sessions/build/${action}`, arguments: args,
    context: { caller: { owner, keyId: 'key-1' }, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), traceId: 'test' },
    signal: new AbortController().signal,
    uploadObject: async () => { throw new Error('not used') } })
}

describe('device process session host integration', () => {
  it('opts in through profile, preserves sync command and blocks path collisions', () => {
    const expose = buildExpose({ shell: false }, [profile()])
    expect(expose.nodes?.map(node => node.path)).toEqual(['ops', 'sessions/build'])
    expect(expose.nodes?.[0]?.cmds?.map(cmd => cmd.name)).toEqual(['build'])
    expect(expose.nodes?.[1]?.cmds?.map(cmd => cmd.name)).toEqual(['start', 'list', 'observe', 'stop'])
    expect(() => buildExpose({ shell: false, shellSessionPath: 'sessions/shell' })).toThrow('requires shell')
    expect(() => buildExpose({ shellSessionPath: 'ops' }, [profile()])).toThrow('conflicts')
    expect(() => buildExpose({ shellSessionPath: 'shell/sessions' })).toThrow('conflicts')
    expect(() => parseStructuredCommandProfile({ ...profile(), commands: [{ ...profile().commands[0], session: { path: 'ops/nested' } }] })).toThrow('conflicts')
  })

  it('retains one runtime across reconnect and waits for child cleanup on close', async () => {
    const handle = connect()
    await handle.ready
    const listed = processSessionListSchema.parse(await call('list', {}))
    const started = processSessionSummarySchema.parse(await call('start', {
      input: {}, requestId: 'start-once', expectedRuntimeId: listed.runtimeId,
      startBefore: new Date(Date.parse(listed.now) + 60_000).toISOString(),
    }))
    expect(started.state).toBe('running')
    transport.options?.onStateChange?.('reconnecting')
    transport.options?.onStateChange?.('ready')
    const afterReconnect = processSessionListSchema.parse(await call('list', {}))
    expect(afterReconnect.runtimeId).toBe(listed.runtimeId)
    expect(afterReconnect.items[0]?.sessionId).toBe(started.sessionId)
    await vi.waitFor(async () => {
      const output = processSessionObservationSchema.parse(await call('observe', { sessionId: started.sessionId }))
      expect(output.chunks.map(chunk => chunk.text).join('')).toContain('ready')
    })
    const first = processSessionObservationSchema.parse(await call('observe', { sessionId: started.sessionId }))
    const replay = processSessionObservationSchema.parse(await call('observe', { sessionId: started.sessionId }))
    expect(replay.chunks[0]).toEqual(first.chunks[0])
    await expect(call('observe', { sessionId: started.sessionId }, 'agent:bob')).rejects.toMatchObject({ code: 'not_found' })
    const wireExpose = await transport.options!.expose()
    expect(wireExpose.environment).toMatchObject({ runtimeId: listed.runtimeId, arch: process.arch })
    expect(wireExpose.environment).not.toHaveProperty('cwd')
    handle.close()
    await handle.closed
    await expect(call('list', {})).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('invalidates old IDs after a new runtime and fails closed without caller identity', async () => {
    const first = connect()
    const old = processSessionListSchema.parse(await call('list', {}))
    first.close()
    await first.closed
    connect()
    const next = processSessionListSchema.parse(await call('list', {}))
    expect(next.runtimeId).not.toBe(old.runtimeId)
    await expect(call('start', { input: {}, requestId: 'old', expectedRuntimeId: old.runtimeId,
      startBefore: new Date(Date.now() + 60_000).toISOString() })).rejects.toMatchObject({ code: 'conflict' })
    await expect(transport.options!.handler({ id: 'no-owner', path: 'sessions/build/list', arguments: {}, signal: new AbortController().signal,
      uploadObject: async () => { throw new Error('unused') } })).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('pins systemd group cleanup and a bounded stop deadline', () => {
    const unit = renderSystemdUnit(['/usr/bin/node', '/opt/tb/index.js'], '/home/test/device.json')
    expect(unit).toContain('KillMode=control-group')
    expect(unit).toContain('TimeoutStopSec=15s')
    expect(unit).toContain('SendSIGKILL=yes')
  })
})
