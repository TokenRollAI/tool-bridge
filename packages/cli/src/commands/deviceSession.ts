import { processSessionListSchema, processSessionObservationSchema, type ProcessSessionSummary, processSessionSummarySchema } from '@tool-bridge/sdk/client'
import { stripVTControlCharacters } from 'node:util'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:os'
import { Command } from 'commander'
import { collect, parsePageOpts, parsePositiveInt, resolveTarget, withGlobalOpts, withPageOpts } from '../args'
import { CliError, type Target, withClient } from '../http'
import { printJson, printLine, table } from '../output'
import { confirmDestructive } from '../confirm'
import { parseCallArgs } from './call'

const STATES = ['running', 'stopping', 'stopped', 'exited', 'timed_out']

function nodePath(value: string): string {
  const path = value.trim().replace(/^\/+|\/+$/g, '')
  if (!path || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new CliError('a complete session node path is required')
  }
  return path
}

function integer(value: string | undefined, flag: string, max: number): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new CliError(`${flag} must be an integer between 0 and ${max}`)
  return n
}

function printSummary(session: ProcessSessionSummary): void {
  printLine(`session: ${session.sessionId}`)
  printLine(`runtime: ${session.runtimeId}`)
  printLine(`request: ${session.requestId}`)
  printLine(`state: ${session.state}${session.state === 'stopping' ? ' (termination requested; exit not yet confirmed)' : ''}`)
  if (session.exitCode !== undefined) printLine(`exit code: ${session.exitCode}`)
  if (session.signal !== undefined) printLine(`signal: ${session.signal}`)
}

async function sessionCall<T>(
  target: Target,
  path: string,
  input: Record<string, unknown>,
  schema: { safeParse: (value: unknown) => { data: T, success: true } | { success: false } },
  signal?: AbortSignal,
): Promise<T> {
  const result = schema.safeParse(await withClient(target, client => client.invokeJson(path, input, { signal })))
  if (result.success) return result.data
  const error = new CliError('invalid process session response; request outcome is unknown', 'internal')
  error.kind = 'protocol'
  error.outcome = 'unknown'
  throw error
}

async function confirmCommand(target: Target, path: string, name: string, yes?: boolean): Promise<void> {
  const help = await withClient(target, client => client.getHelp(path))
  const command = help.cmds.find(cmd => cmd.name === name)
  if (!command) throw new CliError(`session command ${name} is not available`)
  if (command.confirm) await confirmDestructive({ yes }, `Execute ${path}/${name}${command.effect ? ` (${command.effect})` : ''}?`)
}

interface ObserveOptions {
  cursor?: string
  follow?: boolean
  json?: boolean
  limitBytes?: string
  wait?: string
}

type ObservationMode = 'observe' | 'wait' | 'run'

function remoteExitCode(summary: ProcessSessionSummary): number {
  if (summary.state === 'timed_out') return 124
  if (summary.exitCode !== undefined) return summary.exitCode
  const signal = summary.signal as keyof typeof constants.signals | undefined
  return signal && constants.signals[signal] ? 128 + constants.signals[signal] : 1
}

async function observeSession(
  target: Target,
  path: string,
  sessionId: string,
  opts: ObserveOptions,
  mode: ObservationMode,
): Promise<void> {
  let cursor = integer(opts.cursor, '--cursor', Number.MAX_SAFE_INTEGER) ?? 0
  const limitBytes = parsePositiveInt(opts.limitBytes, '--limit-bytes')
  if (limitBytes !== undefined && (limitBytes < 4 || limitBytes > 262_144)) throw new CliError('--limit-bytes must be between 4 and 262144')
  const following = mode !== 'observe' || Boolean(opts.follow)
  const waitMs = integer(opts.wait, '--wait', 20_000) ?? (following ? 20_000 : 0)
  if (following && waitMs === 0) throw new CliError('--follow requires a positive --wait')
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  if (following) process.on('SIGINT', interrupt)
  try {
    while (!controller.signal.aborted) {
      const page = await sessionCall(target, `${path}/observe`, {
        sessionId, cursor, waitMs, ...(limitBytes === undefined ? {} : { limitBytes }),
      }, processSessionObservationSchema, controller.signal)
      const terminal = page.state !== 'running' && page.state !== 'stopping'
      const complete = terminal && cursor === page.nextCursor
      const emitLogs = mode === 'observe' || Boolean(opts.follow)
      if (emitLogs) {
        if (opts.json) {
          if (following) process.stdout.write(`${JSON.stringify(page)}\n`)
          else printJson(page)
        } else {
          if (page.gap) process.stderr.write(`log gap: ${page.droppedBytes} bytes dropped; remaining logs follow\n`)
          for (const chunk of page.chunks) {
            const stream = chunk.stream === 'stderr' ? process.stderr : process.stdout
            stream.write(stripVTControlCharacters(chunk.text))
          }
          if (!following || complete) printSummary(page)
        }
      } else if (terminal) {
        if (opts.json) {
          const { sessionId, runtimeId, requestId, state, startedAt, completedAt, exitCode, signal } = page
          printJson({ sessionId, runtimeId, requestId, state, startedAt, completedAt, exitCode, signal })
        } else printSummary(page)
      }
      cursor = page.nextCursor
      if (!following || complete || (!emitLogs && terminal)) {
        if (mode !== 'observe') process.exitCode = remoteExitCode(page)
        return
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      if (error instanceof CliError) error.hint = `Resume observation with tb device session observe ${path} ${sessionId} --cursor ${cursor} --follow. A daemon restart invalidates the old session.`
      throw error
    }
  } finally {
    if (following) process.off('SIGINT', interrupt)
    if (controller.signal.aborted && mode !== 'observe') process.exitCode = 130
  }
}

function startCommand(name: 'start' | 'run') {
  const command = withGlobalOpts(new Command(name))
  if (name === 'run') command.option('--follow', 'Stream output through exit; Ctrl-C detaches')
  return command
    .argument('<path>', 'Full session node path')
    .argument('[args]', 'Bound command input as a JSON object')
    .option('--args <json>', 'Bound command input as a JSON object')
    .option('--args-file <file>', 'Input from a JSON file, or - for stdin')
    .option('--arg <key=value>', 'One flat input argument (repeatable)', collect, [])
    .option('--run-timeout <milliseconds>', 'Shorten the configured process runtime limit')
    .option('--yes', 'Skip interactive confirmation')
    .description(name === 'run'
      ? 'Start a process, print its recovery handle on stderr, and wait for its exit status'
      : 'Start once; on uncertain results, find the original request with session list --request-id')
    .action(async (pathArg, positional, opts) => {
      const path = nodePath(pathArg)
      const input = await parseCallArgs(opts.args, opts.argsFile, positional, opts.arg)
      const timeoutMs = parsePositiveInt(opts.runTimeout, '--run-timeout')
      const target = resolveTarget(opts)
      await confirmCommand(target, path, 'start', opts.yes)
      const page = await sessionCall(target, `${path}/list`, { limit: 1 }, processSessionListSchema)
      const time = Date.parse(page.now)
      if (!page.runtimeId || !Number.isFinite(time)) throw new CliError('invalid session runtime response', 'internal')
      const requestId = randomUUID()
      let session: ProcessSessionSummary
      try {
        session = await sessionCall(target, `${path}/start`, {
          input, requestId, expectedRuntimeId: page.runtimeId,
          startBefore: new Date(time + 60_000).toISOString(),
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        }, processSessionSummarySchema)
      } catch (error) {
        if (error instanceof CliError) error.hint = `requestId: ${requestId}; find it with tb device session list ${path} --request-id ${requestId}. Do not blindly start again.`
        throw error
      }
      if (name === 'run') {
        process.stderr.write(`${JSON.stringify({ path, sessionId: session.sessionId, requestId, runtimeId: session.runtimeId })}\n`)
        await observeSession(target, path, session.sessionId, opts, 'run')
      } else if (opts.json) printJson(session)
      else printSummary(session)
    })
}

export function deviceSessionCommand() {
  return new Command('session')
    .description('Run, observe and wait for device-owned process sessions')
    .addCommand(startCommand('start'))
    .addCommand(startCommand('run'))
    .addCommand(withGlobalOpts(new Command('wait'))
      .argument('<path>', 'Full session node path')
      .argument('<session-id>', 'Session identifier')
      .description('Wait for a process and return its exit status; Ctrl-C detaches')
      .action(async (path, sessionId, opts) => {
        await observeSession(resolveTarget(opts), nodePath(path), sessionId, opts, 'wait')
      }))
    .addCommand(withPageOpts(withGlobalOpts(new Command('list')))
      .alias('ls')
      .argument('<path>', 'Full session node path')
      .option('--request-id <id>', 'Find an original start request after a lost response')
      .option('--state <state>', `Filter: ${STATES.join(', ')}`)
      .description('List this caller’s sessions; an empty page does not prove a command never ran')
      .action(async (pathArg, opts) => {
        const path = nodePath(pathArg)
        const pageOpts = parsePageOpts(opts)
        if (opts.state !== undefined && !STATES.includes(opts.state)) throw new CliError('invalid --state')
        if (opts.requestId !== undefined && !opts.requestId.trim()) throw new CliError('--request-id must not be empty')
        const page = await sessionCall(resolveTarget(opts), `${path}/list`, {
          ...pageOpts,
          ...(opts.state === undefined ? {} : { state: opts.state }),
          ...(opts.requestId === undefined ? {} : { requestId: opts.requestId }),
        }, processSessionListSchema)
        if (opts.json) printJson(page)
        else {
          printLine(`runtime: ${page.runtimeId} (reported at ${page.now})`)
          printLine(page.items.length ? table(['SESSION', 'REQUEST', 'STATE', 'STARTED'], page.items.map(item => [item.sessionId, item.requestId, item.state, item.startedAt])) : '(no visible sessions on this page; this does not prove a command never ran)')
          if (page.cursor) printLine(`next cursor: ${page.cursor}`)
        }
      }))
    .addCommand(withGlobalOpts(new Command('observe'))
      .argument('<path>', 'Full session node path')
      .argument('<session-id>', 'Session identifier')
      .option('--cursor <sequence>', 'Resume after this log sequence')
      .option('--limit-bytes <bytes>', 'Maximum log bytes per response (4-262144)')
      .option('--wait <milliseconds>', 'Wait for logs up to 20000 ms per request')
      .option('--follow', 'Follow logs; Ctrl-C only stops observation. JSON output is one object per line')
      .description('Read incremental process logs; daemon restart invalidates old sessions')
      .action(async (pathArg, sessionId, opts) => {
        await observeSession(resolveTarget(opts), nodePath(pathArg), sessionId, opts, 'observe')
      }))
    .addCommand(withGlobalOpts(new Command('stop'))
      .argument('<path>', 'Full session node path')
      .argument('<session-id>', 'Session identifier')
      .option('--yes', 'Skip interactive confirmation when declared by command help')
      .description('Explicitly terminate a process session; reports the actual state')
      .action(async (pathArg, sessionId, opts) => {
        const path = nodePath(pathArg)
        const target = resolveTarget(opts)
        await confirmCommand(target, path, 'stop', opts.yes)
        const session = await sessionCall(target, `${path}/stop`, { sessionId }, processSessionSummarySchema)
        if (opts.json) printJson(session)
        else printSummary(session)
      }))
}
