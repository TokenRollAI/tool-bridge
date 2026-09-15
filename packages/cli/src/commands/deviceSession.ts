import { processSessionListSchema, processSessionObservationSchema, type ProcessSessionSummary, processSessionSummarySchema } from '@tool-bridge/sdk/client'
import { stripVTControlCharacters } from 'node:util'
import { randomUUID } from 'node:crypto'
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

export function deviceSessionCommand() {
  return new Command('session')
    .description('Start, observe and stop realtime device process sessions (separate from daemon service logs)')
    .addCommand(withGlobalOpts(new Command('start'))
      .argument('<path>', 'Full session node path')
      .argument('[args]', 'Bound command input as a JSON object')
      .option('--args <json>', 'Bound command input as a JSON object')
      .option('--args-file <file>', 'Input from a JSON file, or - for stdin')
      .option('--arg <key=value>', 'One flat input argument (repeatable)', collect, [])
      .option('--run-timeout <milliseconds>', 'Shorten the configured process runtime limit')
      .option('--yes', 'Skip interactive confirmation')
      .description('Start once; on uncertain results, find the original request with session list --request-id')
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
        try {
          const session = await sessionCall(target, `${path}/start`, {
            input, requestId, expectedRuntimeId: page.runtimeId,
            startBefore: new Date(time + 60_000).toISOString(),
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
          }, processSessionSummarySchema)
          if (opts.json) printJson(session)
          else printSummary(session)
        } catch (error) {
          if (error instanceof CliError) error.hint = `requestId: ${requestId}; find it with tb device session list ${path} --request-id ${requestId}. Do not blindly start again.`
          throw error
        }
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
        const path = nodePath(pathArg)
        let cursor = integer(opts.cursor, '--cursor', Number.MAX_SAFE_INTEGER) ?? 0
        const limitBytes = parsePositiveInt(opts.limitBytes, '--limit-bytes')
        if (limitBytes !== undefined && (limitBytes < 4 || limitBytes > 262_144)) throw new CliError('--limit-bytes must be between 4 and 262144')
        const waitMs = integer(opts.wait, '--wait', 20_000) ?? (opts.follow ? 20_000 : 0)
        if (opts.follow && waitMs === 0) throw new CliError('--follow requires a positive --wait')
        const target = resolveTarget(opts)
        const controller = new AbortController()
        const interrupt = () => controller.abort()
        if (opts.follow) process.on('SIGINT', interrupt)
        try {
          while (!controller.signal.aborted) {
            const page = await sessionCall(target, `${path}/observe`, {
              sessionId, cursor, waitMs, ...(limitBytes === undefined ? {} : { limitBytes }),
            }, processSessionObservationSchema, controller.signal)
            if (opts.json) {
              if (opts.follow) process.stdout.write(`${JSON.stringify(page)}\n`)
              else printJson(page)
            } else {
              if (page.gap) process.stderr.write(`log gap: ${page.droppedBytes} bytes dropped; remaining logs follow\n`)
              for (const chunk of page.chunks) {
                const stream = chunk.stream === 'stderr' ? process.stderr : process.stdout
                stream.write(stripVTControlCharacters(chunk.text))
              }
              if (!opts.follow || (page.state !== 'running' && page.state !== 'stopping' && cursor === page.nextCursor)) printSummary(page)
            }
            const previousCursor = cursor
            cursor = page.nextCursor
            // Terminal responses can still contain a partial page of buffered logs.
            if (!opts.follow || (page.state !== 'running' && page.state !== 'stopping' && cursor === previousCursor)) break
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            if (error instanceof CliError) error.hint = `Resume observation with tb device session observe ${path} ${sessionId} --cursor ${cursor} --follow. A daemon restart invalidates the old session.`
            throw error
          }
        } finally {
          if (opts.follow) process.off('SIGINT', interrupt)
        }
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
