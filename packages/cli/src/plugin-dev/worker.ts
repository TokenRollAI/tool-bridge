import type { PluginBindingHandler } from '@tool-bridge/app'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { type ChildProcess, fork, spawn } from 'node:child_process'
import { assertPluginPayloadSize } from '@tool-bridge/core'
import { readFile, realpath } from 'node:fs/promises'
import { addAbortListener, once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { CliError } from '../http'

type HeaderPairs = [string, string][]
type WorkerMessage
  = | { entry: string, token: string, type: 'load' }
    | { body: string | undefined, headers: HeaderPairs, id: number, method: string, type: 'fetch', url: string }
    | { id: number, type: 'abort' }

type WorkerReply
  = | { type: 'ready' }
    | { message: string, type: 'load-error' }
    | { body: string | null, headers: HeaderPairs, id: number, status: number, type: 'response' }
    | { id: number, message: string, type: 'fetch-error' }

interface WorkerFetch {
  fetch(request: Request, env: Readonly<{ PLUGIN_TOKEN: string }>): Response | Promise<Response>
}

export async function readPluginEntry(directory: string): Promise<string> {
  const { main } = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')) as {
    main?: unknown
  }
  if (typeof main !== 'string' || !main || isAbsolute(main)) {
    throw new CliError('package.json must declare a relative "main" pointing to the plugin entry')
  }
  const entry = await realpath(resolve(directory, main))
  const rel = relative(directory, entry)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new CliError('plugin entry must be inside the project directory')
  }
  return entry
}

function workerError(error: unknown): string {
  if ((error as NodeJS.ErrnoException)?.code === 'ERR_MODULE_NOT_FOUND') {
    return `${(error as Error).message}. Install project dependencies explicitly (npm install --ignore-scripts).`
  }
  return error instanceof Error ? error.message : String(error)
}

// Child IPC only carries the existing fetch request/response, including the original plugin envelope.
// The child receives a fresh module graph and the plugin token, never the gateway's SK.
export async function runPluginWorker(): Promise<void> {
  if (!process.send) throw new CliError('the plugin worker requires a dev session')
  const send = (reply: WorkerReply) => process.connected && process.send!(reply)
  process.once('disconnect', () => process.exit(0))
  const [message] = await once(process, 'message') as [WorkerMessage]
  if (message.type !== 'load') throw new CliError('the plugin worker requires an entry')
  const env = Object.freeze({ PLUGIN_TOKEN: message.token })
  let plugin: WorkerFetch
  try {
    const module = await import(pathToFileURL(message.entry).href) as { default?: Partial<WorkerFetch> }
    if (typeof module.default?.fetch !== 'function') {
      throw new CliError('the plugin entry must export a default object with fetch(request, env)')
    }
    plugin = module.default as WorkerFetch
  } catch (error) {
    send({ message: workerError(error), type: 'load-error' })
    process.disconnect?.()
    return
  }

  const calls = new Map<number, AbortController>()
  process.on('message', async (request: WorkerMessage) => {
    if (request.type === 'load') return
    if (request.type === 'abort') {
      calls.get(request.id)?.abort()
      return
    }
    const controller = new AbortController()
    calls.set(request.id, controller)
    try {
      const response = await plugin.fetch(new Request(request.url, {
        body: request.body,
        headers: request.headers,
        method: request.method,
        signal: controller.signal,
      }), env)
      const body = response.body === null ? null : await response.text()
      if (body !== null) assertPluginPayloadSize(body)
      if (!controller.signal.aborted) {
        send({ body, headers: [...response.headers], id: request.id, status: response.status, type: 'response' })
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        send({ id: request.id, message: workerError(error), type: 'fetch-error' })
      }
    } finally {
      calls.delete(request.id)
    }
  })
  send({ type: 'ready' })
}

export interface PluginDevWorker {
  close(): void
  fetch: PluginBindingHandler
}

export function startPluginWorker(directory: string): ChildProcess {
  const args = ['plugin', '_dev-worker']
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }
  const stdio = ['ignore', process.stderr, process.stderr, 'ipc'] as const
  if (process.versions.bun) {
    return spawn(process.execPath, args, { cwd: directory, env, stdio: [...stdio] })
  }
  const cli = resolve(process.argv[1]!)
  const source = cli.endsWith('.ts')
  const execArgv = source ? process.execArgv.filter(arg => !arg.startsWith('--inspect')) : []
  if (source) Object.assign(env, { TSX_TSCONFIG_PATH: resolve(dirname(cli), '../tsconfig.json') })
  return fork(cli, args, { cwd: directory, env, execArgv, stdio: [...stdio] })
}

export async function loadPluginWorker(
  child: ChildProcess,
  entry: string,
  token: string,
  signal: AbortSignal,
): Promise<PluginDevWorker> {
  let nextId = 0
  const pending = new Map<number, (reply: WorkerReply | Error) => void>()
  const fail = (error: Error) => {
    for (const finish of pending.values()) finish(error)
  }
  const close = () => {
    child.kill('SIGKILL')
  }
  const send = (message: WorkerMessage, finish: (error: Error) => void) => {
    if (!child.connected) {
      finish(new CliError('plugin process is unavailable'))
      return
    }
    child.send(message, (error) => {
      if (error) finish(error)
    })
  }
  child.on('message', (reply: WorkerReply) => {
    pending.get('id' in reply ? reply.id : 0)?.(reply)
  })
  child.on('error', fail)
  child.on('disconnect', () => fail(new CliError('plugin process disconnected')))
  child.on('exit', (code, sig) => fail(new CliError(`plugin process stopped (${sig ?? code})`)))

  const exchange = (id: number, message: WorkerMessage, abort: AbortSignal): Promise<WorkerReply> => {
    return new Promise((resolve, reject) => {
      abort.throwIfAborted()
      let disposeAbort = () => {}
      const finish = (result: WorkerReply | Error) => {
        pending.delete(id)
        disposeAbort()
        if (result instanceof Error) reject(result)
        else resolve(result)
      }
      pending.set(id, finish)
      const listener = addAbortListener(abort, () => {
        if (id !== 0) send({ id, type: 'abort' }, () => {})
        finish(new CliError(id === 0 ? 'plugin load interrupted or timed out' : 'plugin request interrupted or timed out'))
      })
      disposeAbort = () => listener[Symbol.dispose]()
      send(message, finish)
    })
  }

  try {
    const loaded = await exchange(0, { entry, token, type: 'load' }, signal)
    if (loaded.type !== 'ready') {
      throw new CliError(loaded.type === 'load-error' ? loaded.message : 'unexpected plugin load response')
    }
  } catch (error) {
    close()
    throw error
  }
  return {
    close,
    async fetch(request) {
      const id = ++nextId
      const reply = await exchange(id, {
        body: request.body === null ? undefined : await request.text(),
        headers: [...request.headers],
        id,
        method: request.method,
        type: 'fetch',
        url: request.url,
      }, request.signal)
      if (reply.type !== 'response') {
        throw new CliError(reply.type === 'fetch-error' ? reply.message : 'unexpected plugin response')
      }
      return new Response(reply.body, { headers: reply.headers, status: reply.status })
    },
  }
}
