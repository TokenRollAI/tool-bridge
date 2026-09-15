import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod/v4'
import {
  processSessionListSchema, type ProcessSessionObservation, processSessionObservationSchema,
  type ProcessSessionSummary, processSessionSummarySchema,
} from '../../src/device/processSessionContract'
import {
  createProcessSessionManager, processSessionCommands,
  type ProcessSessionManager, type ProcessSessionManagerOptions,
} from '../../src/node/processSessions'

const context = { caller: { owner: 'alice', keyId: 'key-1' } }
const managers: ProcessSessionManager[] = []
const codeSchema = z.strictObject({ code: z.string(), note: z.string().optional() })
function manager(options: ProcessSessionManagerOptions = {}) {
  const value = createProcessSessionManager({ platform: 'linux', terminationGraceMs: 50, ...options })
  value.register({
    path: 'sessions/test', effect: 'destructive', inputSchema: codeSchema,
    prepare: input => ({ executable: process.execPath, argv: ['-e', input.code as string], env: {} }),
  })
  managers.push(value)
  return value
}
function args(value: ProcessSessionManager, code: string, requestId = 'request-1') {
  return { input: { code }, expectedRuntimeId: value.runtimeId, requestId, startBefore: new Date(Date.now() + 60_000).toISOString() }
}
async function start(value: ProcessSessionManager, code: string, requestId?: string) {
  return await value.invoke('sessions/test', 'start', args(value, code, requestId), context) as ProcessSessionSummary
}
async function observe(value: ProcessSessionManager, sessionId: string, options: Record<string, unknown> = {}) {
  return await value.invoke('sessions/test', 'observe', { sessionId, ...options }, context) as ProcessSessionObservation
}
async function terminal(value: ProcessSessionManager, sessionId: string) {
  let result = await observe(value, sessionId)
  for (let i = 0; i < 50 && ['running', 'stopping'].includes(result.state); i++) {
    result = await observe(value, sessionId, { cursor: result.nextCursor, waitMs: 100 })
  }
  expect(['running', 'stopping']).not.toContain(result.state)
  return result
}
afterEach(async () => {
  await Promise.all(managers.splice(0).map(value => value.close()))
})

describe('runtime-owned process sessions', () => {
  it('starts once under concurrent replay, fingerprints canonical input and keeps owner/path isolation', async () => {
    const value = manager()
    const request = args(value, 'setInterval(() => {}, 1000)')
    const [first, second] = await Promise.all([
      value.invoke('sessions/test', 'start', request, context),
      value.invoke('sessions/test', 'start', { ...request, input: { code: request.input.code } }, context),
    ]) as ProcessSessionSummary[]
    expect(first!.sessionId).toBe(second!.sessionId)
    await expect(value.invoke('sessions/test', 'start', { ...request, input: { code: 'process.exit()' } }, context)).rejects.toMatchObject({ code: 'conflict' })
    await expect(value.invoke('sessions/test', 'observe', { sessionId: first!.sessionId }, { caller: { owner: 'bob', keyId: 'key-2' } })).rejects.toMatchObject({ code: 'not_found' })
    value.register({ path: 'sessions/other', effect: 'read', inputSchema: z.strictObject({}), prepare: () => ({ executable: process.execPath, argv: [] }) })
    await expect(value.invoke('sessions/other', 'stop', { sessionId: first!.sessionId }, context)).rejects.toMatchObject({ code: 'not_found' })
    const sameOwner = await value.invoke('sessions/test', 'list', {}, { caller: { owner: 'alice', keyId: 'rotated' } })
    expect(processSessionListSchema.parse(sameOwner).items).toHaveLength(1)
  })

  it('fails closed for missing identity, invalid inputs, expired starts and old runtimes', async () => {
    const value = manager()
    const request = args(value, 'process.exit()')
    await expect(value.invoke('sessions/test', 'start', request)).rejects.toMatchObject({ code: 'unavailable' })
    await expect(value.invoke('sessions/test', 'start', { ...request, owner: 'alice' }, context)).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(value.invoke('sessions/test', 'start', { ...request, input: { code: 'ok', executable: 'sh' } }, context)).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(value.invoke('sessions/test', 'start', { ...request, expectedRuntimeId: 'old' }, context)).rejects.toMatchObject({ code: 'conflict' })
    await expect(value.invoke('sessions/test', 'start', { ...request, startBefore: new Date(0).toISOString() }, context)).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(value.invoke('sessions/test', 'start', { ...request, startBefore: new Date(Date.now() + 600_000).toISOString() }, context)).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(value.invoke('sessions/test', 'start', { ...request, timeoutMs: 86_400_001 }, context)).rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it('preserves nonzero exit, incremental independent readers and UTF-8 fragments', async () => {
    const value = manager()
    const session = await start(value, 'const b=Buffer.from(\'你😀好\');process.stdout.write(b.subarray(0,2));setTimeout(()=>{process.stdout.write(b.subarray(2));process.stderr.write(\'err\');process.exitCode=7},20)')
    await terminal(value, session.sessionId)
    const first = await observe(value, session.sessionId, { limitBytes: 4 })
    const second = await observe(value, session.sessionId, { limitBytes: 4 })
    expect(first).toEqual(second)
    let cursor = 0
    const text = { stdout: '', stderr: '' }
    while (true) {
      const fragment = await observe(value, session.sessionId, { cursor, limitBytes: 4 })
      for (const chunk of fragment.chunks) text[chunk.stream] += chunk.text
      if (fragment.nextCursor === cursor) break
      cursor = fragment.nextCursor
    }
    expect(text).toEqual({ stdout: '你😀好', stderr: 'err' })
    expect(first.exitCode).toBe(7)
    expect(first.state).toBe('exited')
    await expect(observe(value, session.sessionId, { cursor: 1 })).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(observe(value, session.sessionId, { cursor: 1000 })).rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it('reports dropped output with bounded per-stream storage, including a huge UTF-8 write', async () => {
    const value = manager({ streamLimitBytes: 32 })
    const session = await start(value, 'process.stdout.write(\'你\'.repeat(100000));process.stderr.write(\'😀\'.repeat(100000))')
    await terminal(value, session.sessionId)
    const output = await observe(value, session.sessionId)
    expect(output.gap).toBe(true)
    expect(output.droppedBytes).toBeGreaterThan(600_000)
    expect(Buffer.byteLength(output.chunks.filter(chunk => chunk.stream === 'stdout').map(chunk => chunk.text).join(''))).toBeLessThanOrEqual(32)
    expect(Buffer.byteLength(output.chunks.filter(chunk => chunk.stream === 'stderr').map(chunk => chunk.text).join(''))).toBeLessThanOrEqual(32)
    expect(output.chunks.map(chunk => chunk.text).join('')).not.toContain('\ufffd')
    expect((await observe(value, session.sessionId, { cursor: output.nextCursor })).chunks).toEqual([])
  })

  it('observation cancellation leaves the child running, and explicit stop waits for a real exit', async () => {
    const value = manager()
    const controller = new AbortController()
    const session = await value.invoke('sessions/test', 'start', args(value, 'setInterval(() => {}, 1000)'), { ...context, signal: controller.signal }) as ProcessSessionSummary
    const waiting = value.invoke('sessions/test', 'observe', { sessionId: session.sessionId, waitMs: 20_000 }, { ...context, signal: controller.signal })
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ code: 'unavailable' })
    expect((await observe(value, session.sessionId)).state).toBe('running')
    const stopped = await value.invoke('sessions/test', 'stop', { sessionId: session.sessionId }, context)
    expect(processSessionSummarySchema.parse(stopped).state).toBe('stopped')
    expect(await value.invoke('sessions/test', 'stop', { sessionId: session.sessionId }, context)).toEqual(stopped)
  })

  it('kills a SIGTERM-ignoring process on timeout and distinguishes the terminal state', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const value = manager()
    let session: ProcessSessionSummary
    try {
      session = await value.invoke('sessions/test', 'start', {
        ...args(value, 'process.on(\'SIGTERM\',()=>{});process.stdout.write(\'ready\');setInterval(()=>{},1000)'), timeoutMs: 200,
      }, context) as ProcessSessionSummary
      // Advance the runtime deadline only after the real child installed its handler.
      // CPU contention must not turn this escalation test into a startup-speed test.
      let ready = false
      for (let attempt = 0; attempt < 200 && !ready; attempt++) {
        ready = (await observe(value, session.sessionId)).chunks.some(chunk => chunk.text.includes('ready'))
        if (!ready) await delay(10)
      }
      expect(ready).toBe(true)
      await vi.advanceTimersByTimeAsync(251)
    } finally {
      vi.useRealTimers()
    }
    const result = await terminal(value, session!.sessionId)
    expect(result.state).toBe('timed_out')
    expect(result.signal).toBe('SIGKILL')
  })

  it('close cleans the process group including a descendant and invalidates the runtime', async () => {
    const value = manager()
    const session = await start(value, 'const {spawn}=require(\'node:child_process\');const child=spawn(process.execPath,[\'-e\',\'setInterval(()=>{},1000)\'],{stdio:\'ignore\'});process.stdout.write(String(child.pid));setInterval(()=>{},1000)')
    let output = await observe(value, session.sessionId, { waitMs: 1000 })
    if (output.chunks.length === 0) output = await observe(value, session.sessionId, { waitMs: 1000 })
    const descendantPid = Number(output.chunks.map(chunk => chunk.text).join(''))
    expect(descendantPid).toBeGreaterThan(0)
    await value.close()
    await expect(value.invoke('sessions/test', 'list', {}, context)).rejects.toMatchObject({ code: 'unavailable' })
    // POSIX delivery can precede OS reaping by a scheduling tick.
    await vi.waitFor(() => expect(() => process.kill(descendantPid, 0)).toThrow(), { timeout: 2000, interval: 10 })
  })

  it('holds dedupe records until the acceptance deadline and rejects over-capacity starts', async () => {
    let clock = Date.now()
    const value = manager({ maxActive: 1, maxRetained: 1, retentionMs: 0, now: () => clock })
    const request = args(value, 'process.exit()')
    const session = await value.invoke('sessions/test', 'start', request, context) as ProcessSessionSummary
    await terminal(value, session.sessionId)
    expect(await value.invoke('sessions/test', 'start', request, context)).toMatchObject({ sessionId: session.sessionId })
    await expect(start(value, 'process.exit()', 'other')).rejects.toMatchObject({ code: 'rate_limited' })
    clock += 61_000
    await expect(value.invoke('sessions/test', 'start', request, context)).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(processSessionListSchema.parse(await value.invoke('sessions/test', 'list', {}, context)).items).toEqual([])
  })

  it('spawn failures release capacity; metadata is pure and platform gating is start-only', async () => {
    const value = manager({ maxActive: 1, maxRetained: 1 })
    value.register({ path: 'bad', effect: 'read', inputSchema: z.strictObject({}), prepare: () => ({ executable: '/nonexistent/tool-bridge-test', argv: [] }) })
    await expect(value.invoke('bad', 'start', { ...args(value, ''), input: {} }, context)).rejects.toMatchObject({ code: 'internal' })
    const valid = await start(value, 'process.exit()')
    await terminal(value, valid.sessionId)
    const disabled = manager({ platform: 'darwin' })
    expect(disabled.cmds('sessions/test')).toHaveLength(4)
    await expect(start(disabled, 'process.exit()')).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('contains signal errors from child/timer callbacks and still escalates to SIGKILL', async () => {
    const value = manager()
    const session = await start(value, 'setInterval(()=>{},1000)')
    const kill = process.kill.bind(process)
    const spy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid < 0 && signal === 'SIGTERM') {
        throw Object.assign(new Error('synthetic signal permission failure'), { code: 'EPERM' })
      }
      return kill(pid, signal)
    })
    try {
      const stopped = await value.invoke('sessions/test', 'stop', { sessionId: session.sessionId }, context)
      expect(stopped).toMatchObject({ state: 'stopped', signal: 'SIGKILL' })
    } finally {
      spy.mockRestore()
    }
  })

  it('does not apply the synchronous 55-second deadline, and restart invalidates session IDs', async () => {
    vi.useFakeTimers()
    const value = manager()
    let session: ProcessSessionSummary
    try {
      session = await start(value, 'setInterval(()=>{},1000)')
      await vi.advanceTimersByTimeAsync(55_001)
      expect((await observe(value, session.sessionId)).state).toBe('running')
    } finally {
      vi.useRealTimers()
    }
    const restarted = manager()
    await expect(observe(restarted, session!.sessionId)).rejects.toMatchObject({ code: 'not_found' })
    await expect(restarted.invoke('sessions/test', 'start', args(value, 'process.exit()'), context)).rejects.toMatchObject({ code: 'conflict' })
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(restarted.invoke('sessions/test', 'start', args(restarted, 'process.exit()'), { ...context, signal: cancelled.signal })).rejects.toMatchObject({ code: 'unavailable' })
    expect(processSessionListSchema.parse(await restarted.invoke('sessions/test', 'list', {}, context)).items).toEqual([])
  })

  it('contract coverage is derived from public commands and every registered scenario executes', async () => {
    const value = manager()
    const session = await start(value, 'setInterval(()=>{},1000)')
    const scenarios = {
      start: async () => processSessionSummarySchema.parse(await value.invoke('sessions/test', 'start', args(value, 'setInterval(()=>{},1000)'), context)),
      list: async () => processSessionListSchema.parse(await value.invoke('sessions/test', 'list', {}, context)),
      observe: async () => processSessionObservationSchema.parse(await observe(value, session.sessionId)),
      stop: async () => processSessionSummarySchema.parse(await value.invoke('sessions/test', 'stop', { sessionId: session.sessionId }, context)),
    }
    const commands = processSessionCommands({ path: 'test', effect: 'destructive', inputSchema: codeSchema, prepare: () => ({ executable: '', argv: [] }) })
    expect(commands.map(command => command.name).sort()).toEqual(Object.keys(scenarios).sort())
    expect(commands.find(command => command.name === 'start')).toMatchObject({ confirm: true, effect: 'destructive', delivery: 'realtime' })
    for (const command of commands) {
      expect(command.outputSchema).toBeDefined()
      await scenarios[command.name as keyof typeof scenarios]()
    }
  })
})
