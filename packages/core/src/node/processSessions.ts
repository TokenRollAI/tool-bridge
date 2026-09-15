/** Runtime-owned POSIX process sessions. Transport cancellation never owns the child. */
import { type ChildProcess, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { z } from 'zod/v4'
import type { DeviceAbortSignal } from '../device/client'
import type { ToolSpec } from '../tool/types'
import { type ProcessSessionChunk, type ProcessSessionList, processSessionListSchema, type ProcessSessionObservation, processSessionObservationSchema, type ProcessSessionSummary, processSessionSummarySchema } from '../device/processSessionContract'
import { OperationRegistry } from '../operation/registry'
import { canonicalizePath } from '../tree/path'
import { TBError } from '../errors'

export const PROCESS_SESSION_DEFAULT_RUNTIME_MS = 30 * 60_000
export const PROCESS_SESSION_MAX_RUNTIME_MS = 24 * 60 * 60_000
export const PROCESS_SESSION_STREAM_LIMIT_BYTES = 1024 * 1024
export const PROCESS_SESSION_MAX_START_WINDOW_MS = 5 * 60_000
export interface ProcessSessionBinding {
  confirm?: boolean
  description?: string
  effect: 'read' | 'write' | 'destructive'
  inputSchema: unknown
  maxRuntimeMs?: number
  path: string
  prepare(input: Record<string, unknown>): {
    argv: string[]
    cwd?: string
    env?: NodeJS.ProcessEnv
    executable: string
    shell?: boolean
  }
}
export interface ProcessSessionContext {
  caller?: { keyId: string, owner: string }
  signal?: DeviceAbortSignal
}
export interface ProcessSessionManagerOptions {
  maxActive?: number
  maxRetained?: number
  now?: () => number
  /** Only Linux is enabled in production; tests may exercise POSIX on a different host. */
  platform?: NodeJS.Platform
  retentionMs?: number
  runtimeId?: string
  streamLimitBytes?: number
  terminationGraceMs?: number
}
export interface ProcessSessionManager {
  close(): Promise<void>
  cmds(path: string): ToolSpec[]
  invoke(path: string, action: string, args: Record<string, unknown>, context?: ProcessSessionContext): Promise<unknown>
  register(binding: ProcessSessionBinding): void
  runtimeId: string
}

const outputSchemas = {
  start: z.toJSONSchema(processSessionSummarySchema),
  list: z.toJSONSchema(processSessionListSchema),
  observe: z.toJSONSchema(processSessionObservationSchema),
  stop: z.toJSONSchema(processSessionSummarySchema),
}
const requestIdSchema = z.string().min(1).max(128)
const listSchema = z.strictObject({
  requestId: requestIdSchema.optional(), state: processSessionSummarySchema.shape.state.optional(),
  cursor: z.string().max(256).optional(), limit: z.number().int().min(1).max(32).optional(),
})
const observeSchema = z.strictObject({
  sessionId: z.string().min(1).max(256), cursor: z.number().int().nonnegative().optional(),
  limitBytes: z.number().int().min(4).max(256 * 1024).optional(),
  waitMs: z.number().int().min(0).max(20_000).optional(),
})
const stopSchema = z.strictObject({ sessionId: z.string().min(1).max(256) })

function startSchema(binding: ProcessSessionBinding) {
  if (!(binding.inputSchema instanceof z.ZodType)) {
    throw new TBError('invalid_argument', 'process session binding requires a Zod input schema')
  }
  return z.strictObject({
    input: binding.inputSchema,
    requestId: requestIdSchema,
    expectedRuntimeId: z.string().min(1).max(128),
    startBefore: z.iso.datetime(),
    timeoutMs: z.number().int().positive().max(binding.maxRuntimeMs ?? PROCESS_SESSION_DEFAULT_RUNTIME_MS).optional(),
  })
}
function makeRegistry(binding: ProcessSessionBinding, handler: (action: string, args: unknown, context: ProcessSessionContext) => Promise<unknown>) {
  const registry = new OperationRegistry<ProcessSessionContext>()
  registry.register('start', {
    description: `${binding.description ?? 'Start the bound command'}. No stdin/PTY; reconnect within this runtime; daemon restart invalidates sessions.`,
    effect: binding.effect, confirm: binding.effect === 'destructive' ? true : binding.confirm,
    delivery: 'realtime', inputSchema: startSchema(binding), outputSchema: outputSchemas.start,
  }, (args, context) => handler('start', args, context))
  registry.register('list', {
    description: 'List this owner’s sessions for this command; includes runtimeId and device time.',
    effect: 'read', delivery: 'realtime', inputSchema: listSchema, outputSchema: outputSchemas.list,
  }, (args, context) => handler('list', args, context))
  registry.register('observe', {
    description: 'Read incremental plain-text logs with an independent UTF-8 byte cursor. Cancelling observation leaves the process running.',
    effect: 'read', delivery: 'realtime', inputSchema: observeSchema, outputSchema: outputSchemas.observe,
  }, (args, context) => handler('observe', args, context))
  registry.register('stop', {
    description: 'Stop the process group; running/stopping states do not claim termination has completed.',
    effect: 'write', delivery: 'realtime', inputSchema: stopSchema, outputSchema: outputSchemas.stop,
  }, (args, context) => handler('stop', args, context))
  return registry
}
/** Pure metadata assembly: safe without Linux, timers, or child processes. */
export function processSessionCommands(binding: ProcessSessionBinding): ToolSpec[] {
  return makeRegistry(binding, async () => undefined).list()
}

interface Session {
  bytes: { stderr: number, stdout: number }
  child: ChildProcess
  chunks: ProcessSessionChunk[]
  cleanupError?: TBError
  dedupeKey: string
  done: Promise<void>
  drainTimer?: ReturnType<typeof setTimeout>
  droppedBytes: number
  fingerprint: string
  keyId: string
  killTimer?: ReturnType<typeof setTimeout>
  nextCursor: number
  notify: Set<() => void>
  owner: string
  path: string
  ready: Promise<void>
  resolveDone(): void
  startBefore: number
  summary: ProcessSessionSummary
  termination?: 'stopped' | 'timed_out'
  timeout?: ReturnType<typeof setTimeout>
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
function active(session: Session): boolean {
  return session.summary.state === 'running' || session.summary.state === 'stopping'
}
function copySummary(session: Session): ProcessSessionSummary {
  return { ...session.summary }
}
/** Cut only between decoded UTF-8 code points. */
function prefixBytes(buffer: Buffer, maxBytes: number): Buffer {
  let end = Math.min(buffer.length, maxBytes)
  while (end > 0 && end < buffer.length && (buffer[end]! & 0xc0) === 0x80) end--
  return buffer.subarray(0, end)
}
function wake(session: Session): void {
  for (const notify of [...session.notify]) notify()
}
function append(session: Session, stream: 'stdout' | 'stderr', text: string, limit: number): void {
  if (text === '') return
  const bytes = Buffer.byteLength(text)
  session.nextCursor += bytes
  session.chunks.push({ seq: session.nextCursor, stream, text })
  session.bytes[stream] += bytes
  while (session.bytes[stream] > limit) {
    const index = session.chunks.findIndex(chunk => chunk.stream === stream)
    const chunk = session.chunks[index]!
    const buffer = Buffer.from(chunk.text)
    const excess = session.bytes[stream] - limit
    let drop = Math.min(excess, buffer.length)
    while (drop < buffer.length && (buffer[drop]! & 0xc0) === 0x80) drop++
    session.bytes[stream] -= drop
    session.droppedBytes += drop
    if (drop === buffer.length) session.chunks.splice(index, 1)
    else chunk.text = buffer.subarray(drop).toString('utf8')
  }
  // Byte budgets also need a fragment-count bound: alternating one-byte writes
  // otherwise retain millions of JS objects despite a small text budget.
  while (session.chunks.length > 2048) {
    const removed = session.chunks.shift()!
    const removedBytes = Buffer.byteLength(removed.text)
    session.bytes[removed.stream] -= removedBytes
    session.droppedBytes += removedBytes
  }
  wake(session)
}
function groupSignal(session: Session, signal: NodeJS.Signals): boolean {
  const pid = session.child.pid
  if (pid === undefined) return true
  try {
    process.kill(-pid, signal)
    if (signal === 'SIGKILL') session.cleanupError = undefined
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      session.cleanupError = undefined
      return true
    }
    // Timer and child-event callbacks must not throw and crash the daemon.
    session.cleanupError = new TBError('unavailable', 'could not signal the process group; termination is unconfirmed')
    session.summary.state = 'stopping'
    wake(session)
    return false
  }
}
function waitForChange(session: Session, waitMs: number, signal?: DeviceAbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timers: { wait?: ReturnType<typeof setTimeout> } = {}
    const handlers = {
      finish: () => {
        clearTimeout(timers.wait)
        session.notify.delete(handlers.finish)
        signal?.removeEventListener('abort', handlers.abort)
        resolve()
      },
      abort: () => {
        clearTimeout(timers.wait)
        session.notify.delete(handlers.finish)
        signal?.removeEventListener('abort', handlers.abort)
        reject(new TBError('unavailable', 'session observation cancelled'))
      },
    }
    timers.wait = setTimeout(handlers.finish, waitMs)
    const { finish, abort } = handlers
    session.notify.add(finish)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted === true) abort()
  })
}
function observation(session: Session, cursor: number, limit: number): ProcessSessionObservation {
  if (cursor > session.nextCursor) throw new TBError('invalid_argument', 'cursor is ahead of this session')
  let nextCursor = cursor
  let remaining = limit
  let gap = false
  const chunks: ProcessSessionChunk[] = []
  for (const chunk of session.chunks) {
    if (chunk.seq <= nextCursor) continue
    const buffer = Buffer.from(chunk.text)
    const start = chunk.seq - buffer.length
    if (start > nextCursor) {
      gap = true
      nextCursor = start
    }
    let offset = Math.max(0, nextCursor - start)
    if (offset < buffer.length && (buffer[offset]! & 0xc0) === 0x80) {
      throw new TBError('invalid_argument', 'cursor must be a UTF-8 boundary returned by observe')
    }
    const selected = prefixBytes(buffer.subarray(offset), remaining)
    if (selected.length === 0) break
    offset += selected.length
    nextCursor = start + offset
    remaining -= selected.length
    chunks.push({ seq: nextCursor, stream: chunk.stream, text: selected.toString('utf8') })
    if (remaining === 0 || offset < buffer.length) break
  }
  if (chunks.length === 0 && nextCursor < session.nextCursor) {
    gap = true
    nextCursor = session.nextCursor
  }
  return { ...copySummary(session), chunks, nextCursor, gap, droppedBytes: session.droppedBytes }
}

export function createProcessSessionManager(opts: ProcessSessionManagerOptions = {}): ProcessSessionManager {
  const runtimeId = opts.runtimeId ?? randomUUID()
  const now = opts.now ?? Date.now
  const grace = opts.terminationGraceMs ?? 1000
  const sessions = new Map<string, Session>()
  const dedupe = new Map<string, Session>()
  const registries = new Map<string, OperationRegistry<ProcessSessionContext>>()
  let closed = false
  let closing: Promise<void> | undefined
  const cleanup = () => {
    for (const session of sessions.values()) {
      if (!active(session) && now() > session.startBefore
        && now() - Date.parse(session.summary.completedAt!) >= (opts.retentionMs ?? 30 * 60_000)) {
        sessions.delete(session.summary.sessionId)
        dedupe.delete(session.dedupeKey)
      }
    }
  }
  const terminate = (session: Session, reason: 'stopped' | 'timed_out') => {
    if (!active(session) || (session.termination !== undefined && session.cleanupError === undefined)) return
    clearTimeout(session.killTimer)
    session.termination ??= reason
    session.summary.state = 'stopping'
    groupSignal(session, 'SIGTERM')
    session.killTimer = setTimeout(() => {
      groupSignal(session, 'SIGKILL')
    }, grace)
    wake(session)
  }
  const owned = (path: string, owner: string, id: string): Session => {
    const session = sessions.get(id)
    if (session === undefined || session.path !== path || session.owner !== owner) {
      throw TBError.notFound('session expired or not found in this runtime')
    }
    return session
  }
  const start = async (binding: ProcessSessionBinding, raw: unknown, context: ProcessSessionContext) => {
    const args = raw as z.infer<ReturnType<typeof startSchema>>
    if (context.signal?.aborted === true) throw new TBError('unavailable', 'session start cancelled before acceptance')
    if ((opts.platform ?? process.platform) !== 'linux') throw TBError.unimplemented('process sessions currently require Linux')
    if (args.expectedRuntimeId !== runtimeId) throw new TBError('conflict', 'daemon runtime changed; previous sessions are invalid')
    const deadline = Date.parse(args.startBefore)
    if (deadline <= now() || deadline > now() + PROCESS_SESSION_MAX_START_WINDOW_MS) {
      throw new TBError('invalid_argument', 'startBefore must be in the next five minutes')
    }
    const key = JSON.stringify([binding.path, context.caller!.owner, args.requestId])
    const timeoutMs = args.timeoutMs ?? binding.maxRuntimeMs ?? PROCESS_SESSION_DEFAULT_RUNTIME_MS
    const fingerprint = createHash('sha256').update(canonical({ input: args.input, timeoutMs })).digest('hex')
    const existing = dedupe.get(key)
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) throw new TBError('conflict', 'requestId already belongs to different input')
      // A retry may renew its short receive deadline; never discard its dedupe
      // record while any accepted replay window can still arrive.
      existing.startBefore = Math.max(existing.startBefore, deadline)
      await existing.ready
      return copySummary(existing)
    }
    if ([...sessions.values()].filter(active).length >= (opts.maxActive ?? 8)
      || sessions.size >= (opts.maxRetained ?? 32)) {
      throw new TBError('rate_limited', 'process session capacity reached; wait for retained sessions to expire')
    }
    const prepared = binding.prepare(args.input as Record<string, unknown>)
    let child: ChildProcess
    try {
      child = spawn(prepared.executable, prepared.argv, { cwd: prepared.cwd, env: prepared.env ?? {}, shell: prepared.shell ?? false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      throw new TBError('internal', 'could not start bound command')
    }
    let resolveDone!: () => void
    let resolveReady!: () => void
    let rejectReady!: (reason: Error) => void
    const session: Session = {
      summary: { sessionId: `${runtimeId}:${randomUUID()}`, runtimeId, requestId: args.requestId, state: 'running', startedAt: new Date(now()).toISOString() },
      owner: context.caller!.owner, keyId: context.caller!.keyId, path: binding.path,
      fingerprint, dedupeKey: key, startBefore: deadline, child,
      ready: new Promise<void>((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
      }),
      done: new Promise<void>((resolve) => {
        resolveDone = resolve
      }), resolveDone: () => resolveDone(),
      chunks: [], bytes: { stdout: 0, stderr: 0 }, droppedBytes: 0, nextCursor: 0, notify: new Set(),
    }
    sessions.set(session.summary.sessionId, session)
    dedupe.set(key, session)
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
    const limit = opts.streamLimitBytes ?? PROCESS_SESSION_STREAM_LIMIT_BYTES
    for (const stream of ['stdout', 'stderr'] as const) {
      child[stream]?.on('data', (chunk: Buffer) => append(session, stream, decoders[stream].write(chunk), limit))
    }
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (!active(session)) return
      clearTimeout(session.timeout)
      clearTimeout(session.killTimer)
      clearTimeout(session.drainTimer)
      // Descendants may close stdio before exiting; never abandon the process group.
      if (!groupSignal(session, 'SIGKILL')) {
        session.resolveDone()
        return
      }
      for (const stream of ['stdout', 'stderr'] as const) append(session, stream, decoders[stream].end(), limit)
      session.summary = {
        ...session.summary, state: session.termination ?? 'exited', completedAt: new Date(now()).toISOString(),
        ...(code !== null ? { exitCode: code } : {}), ...(signal !== null ? { signal } : {}),
      }
      wake(session)
      session.resolveDone()
    }
    child.once('spawn', resolveReady)
    child.once('error', () => {
      clearTimeout(session.timeout)
      sessions.delete(session.summary.sessionId)
      dedupe.delete(key)
      rejectReady(new TBError('internal', 'could not start bound command'))
      session.resolveDone()
    })
    child.once('exit', (code, signal) => {
      // A shell descendant may keep the pipes open after its leader exits.
      groupSignal(session, 'SIGTERM')
      session.drainTimer = setTimeout(() => {
        groupSignal(session, 'SIGKILL')
        child.stdout?.destroy()
        child.stderr?.destroy()
        finish(code, signal)
      }, grace)
    })
    child.once('close', finish)
    session.timeout = setTimeout(() => terminate(session, 'timed_out'), timeoutMs)
    await session.ready
    return copySummary(session)
  }
  return {
    runtimeId,
    register(rawBinding) {
      const path = canonicalizePath(rawBinding.path)
      if (path === '' || registries.has(path)) throw new TBError('invalid_argument', 'duplicate or empty process session path')
      if (rawBinding.maxRuntimeMs !== undefined
        && (!Number.isInteger(rawBinding.maxRuntimeMs) || rawBinding.maxRuntimeMs < 1 || rawBinding.maxRuntimeMs > PROCESS_SESSION_MAX_RUNTIME_MS)) {
        throw new TBError('invalid_argument', 'session maxRuntimeMs must be between 1 ms and 24 hours')
      }
      const binding = { ...rawBinding, path }
      registries.set(path, makeRegistry(binding, async (action, raw, context) => {
        if (action === 'start') return start(binding, raw, context)
        if (action === 'list') {
          const args = { limit: 32, ...raw as z.infer<typeof listSchema> }
          const candidates = [...sessions.values()].filter(session => session.owner === context.caller!.owner && session.path === path
            && (args.requestId === undefined || session.summary.requestId === args.requestId)
            && (args.state === undefined || session.summary.state === args.state))
          const offset = args.cursor === undefined ? 0 : candidates.findIndex(session => session.summary.sessionId === args.cursor) + 1
          if (args.cursor !== undefined && offset === 0) throw new TBError('invalid_argument', 'list cursor expired or not found')
          const items = candidates.slice(offset, offset + args.limit).map(copySummary)
          return {
            runtimeId, now: new Date(now()).toISOString(), items,
            ...(offset + items.length < candidates.length ? { cursor: items.at(-1)!.sessionId } : {}),
          } satisfies ProcessSessionList
        }
        const args = { cursor: 0, limitBytes: 64 * 1024, waitMs: 0, ...raw as z.infer<typeof observeSchema> }
        const session = owned(path, context.caller!.owner, args.sessionId)
        if (action === 'stop') {
          terminate(session, 'stopped')
          if (active(session)) await waitForChange(session, grace + 500)
          if (active(session)) await waitForChange(session, grace + 500)
          if (session.cleanupError !== undefined) throw session.cleanupError
          return copySummary(session)
        }
        if (args.cursor === session.nextCursor && active(session) && args.waitMs > 0) {
          await waitForChange(session, args.waitMs, context.signal)
        }
        return observation(session, args.cursor, args.limitBytes)
      }))
    },
    cmds(path) {
      const registry = registries.get(canonicalizePath(path))
      if (registry === undefined) throw TBError.notFound('unknown process session binding')
      return registry.list()
    },
    async invoke(path, action, args, context = {}) {
      if (closed) throw new TBError('unavailable', 'daemon runtime is closed; sessions are invalid')
      if (!context.caller?.owner || !context.caller.keyId) throw new TBError('unavailable', 'authenticated caller context required for process sessions')
      cleanup()
      const registry = registries.get(canonicalizePath(path))
      if (registry === undefined) throw TBError.notFound('unknown process session binding')
      return registry.invoke(action, args, context)
    },
    close() {
      if (closing !== undefined) return closing
      closed = true
      closing = (async () => {
        const pending = [...sessions.values()].filter(active)
        for (const session of pending) terminate(session, 'stopped')
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            Promise.all(pending.map(session => session.done)),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TBError('unavailable', 'process shutdown did not complete')), grace + 3000) }),
          ])
          const failure = pending.find(session => session.cleanupError !== undefined)
          if (failure?.cleanupError !== undefined) throw failure.cleanupError
        } finally { clearTimeout(timer) }
      })()
      return closing
    },
  }
}
