import {
  type ContextEntryInput,
  type ContextPatch,
  TBError as CoreTBError,
  createObjectContextProvider,
  type DeviceExpose,
  type ListOptions,
  type ObjectContextProvider,
  type SearchOptions,
} from '@tool-bridge/core'
import {
  type DeviceConnection,
  type DeviceConnectionState,
  type DeviceWebSocketFactory,
  deviceWsUrl,
  openPortableDeviceConnection,
  TBError,
} from '@tool-bridge/sdk/device'
import {
  createShellExecutor,
  createStructuredCommandRuntime,
  FsObjectStore,
  type StructuredCommandProfile,
} from '@tool-bridge/core/node'
import WS, { type ClientOptions } from 'ws'
import { CliError } from './http'

export { deviceWsUrl }

export interface DeviceConnectionOptions {
  baseUrl: string
  commandProfiles?: StructuredCommandProfile[]
  deviceId: string
  expose: DeviceExpose
  mountPath?: string
  onReady?: (mountPath: string) => void
  onStateChange?: (state: DeviceConnectionState) => void
  sk: string
}

export type DeviceConnectionHandle = DeviceConnection

const nodeWebSocketFactory: DeviceWebSocketFactory = {
  open({ headers, protocols, url }) {
    const options: ClientOptions = {
      ...(headers === undefined ? {} : { headers: { ...headers } }),
    }
    const socket = protocols === undefined
      ? new WS(url, options)
      : new WS(url, typeof protocols === 'string' ? protocols : [...protocols], options)
    return socket as unknown as WebSocket
  },
}

function fsProvider(
  store: FsObjectStore,
  mountPath: string,
  readOnly: boolean,
): ObjectContextProvider {
  return createObjectContextProvider(store, {
    nsPath: `${mountPath}/fs`,
    readOnly,
  })
}

async function dispatchFs(
  provider: ObjectContextProvider,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (tool.toLowerCase()) {
    case 'list':
      return await provider.list((args.path as string) ?? '', args.opts as ListOptions | undefined)
    case 'get':
      return await provider.get(args.path as string)
    case 'write':
      if (typeof args.entry !== 'object' || args.entry === null) {
        throw new TBError('invalid_argument', 'write 需要对象 \'entry\'')
      }
      return await provider.write(args.path as string, args.entry as ContextEntryInput)
    case 'update':
      if (typeof args.patch !== 'object' || args.patch === null) {
        throw new TBError('invalid_argument', 'update 需要对象 \'patch\'')
      }
      return await provider.update(args.path as string, args.patch as ContextPatch)
    case 'delete':
      return await provider.delete(args.path as string)
    case 'search':
      return await provider.search(args.query as string, args.opts as SearchOptions | undefined)
    default:
      throw new TBError('invalid_argument', `unknown fs cmd '${tool}'`)
  }
}

function bridgeCoreError(error: unknown): never {
  if (error instanceof TBError) throw error
  if (error instanceof CoreTBError) {
    throw new TBError(error.code, error.message, { retryable: error.retryable })
  }
  throw error
}

function cliError(error: unknown): CliError {
  if (error instanceof CliError) return error
  if (error instanceof TBError || error instanceof CoreTBError) {
    return new CliError(error.message, error.code, error.retryable)
  }
  return new CliError(error instanceof Error ? error.message : String(error))
}

export function startDeviceConnection(opts: DeviceConnectionOptions): DeviceConnectionHandle {
  const shell = opts.expose.shell === undefined
    ? undefined
    : createShellExecutor({ allow: opts.expose.shell.allow ?? [] })
  const store = opts.expose.fs === undefined ? undefined : new FsObjectStore(opts.expose.fs.roots)
  const readOnly = opts.expose.fs?.readOnly ?? false
  const structured = new Map<string, ReturnType<typeof createStructuredCommandRuntime>>()
  for (const profile of opts.commandProfiles ?? []) {
    const runtime = createStructuredCommandRuntime(profile)
    if (
      runtime.path === 'shell'
      || runtime.path.startsWith('shell/')
      || runtime.path === 'fs'
      || runtime.path.startsWith('fs/')
    ) {
      throw new CliError(`structured command path '${runtime.path}' conflicts with shell/fs`)
    }
    if ([...structured.keys()].some(path =>
      path === runtime.path
      || path.startsWith(`${runtime.path}/`)
      || runtime.path.startsWith(`${path}/`))) {
      throw new CliError(`structured command path '${runtime.path}' conflicts with another profile`)
    }
    structured.set(runtime.path, runtime)
  }
  let activeMountPath = opts.mountPath ?? `device/${opts.deviceId}`
  let files = store === undefined ? undefined : fsProvider(store, activeMountPath, readOnly)

  let userClosed = false
  let settled = false
  let resolveClosed!: () => void
  let rejectClosed!: (error: Error) => void
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve
    rejectClosed = reject
  })
  const fail = (error: unknown): void => {
    if (settled || userClosed) return
    settled = true
    rejectClosed(cliError(error))
  }

  const connection = openPortableDeviceConnection({
    baseUrl: opts.baseUrl,
    deviceId: opts.deviceId,
    expose: async () => opts.expose,
    mountPath: opts.mountPath,
    webSocketFactory: nodeWebSocketFactory,
    credentialProvider: {
      // SDK 每次 reconnect 都重新调用 prepare；这里不把 Bearer 固化进 WS constructor。
      prepare: () => ({ headers: { authorization: `Bearer ${opts.sk}` } }),
      invalidate: error => fail(new TBError(error.code, error.message, {
        retryable: error.retryable,
      })),
    },
    onStateChange: opts.onStateChange,
    handler: async (call) => {
      const slash = call.path.lastIndexOf('/')
      const mount = slash < 0 ? call.path : call.path.slice(0, slash)
      const cmd = slash < 0 ? '' : call.path.slice(slash + 1)
      try {
        if (mount === 'shell') {
          if (cmd !== 'exec') throw new TBError('invalid_argument', `unknown shell cmd '${cmd}'`)
          if (shell === undefined) throw TBError.notFound('shell not exposed')
          const command = call.arguments.command
          if (typeof command !== 'string' || command.trim() === '') {
            throw new TBError('invalid_argument', 'exec 需要字符串 \'command\'')
          }
          return await shell(command, {
            ...(typeof call.arguments.cwd === 'string'
              ? { cwd: call.arguments.cwd }
              : {}),
            ...(typeof call.arguments.timeoutMs === 'number'
              ? { timeoutMs: call.arguments.timeoutMs }
              : {}),
          })
        }
        if (mount === 'fs') {
          if (files === undefined) throw TBError.notFound('fs not exposed')
          return await dispatchFs(files, cmd, call.arguments)
        }
        const structuredCommand = structured.get(mount)
        if (structuredCommand !== undefined) {
          return await structuredCommand.invoke(cmd, call.arguments, { signal: call.signal })
        }
        throw TBError.notFound(`device path not exposed:'${call.path}'`)
      } catch (error) {
        bridgeCoreError(error)
      }
    },
  })

  const ready = connection.ready.then((mountPath) => {
    if (store !== undefined && mountPath !== activeMountPath) {
      activeMountPath = mountPath
      files = fsProvider(store, mountPath, readOnly)
    }
    opts.onReady?.(mountPath)
    return mountPath
  }, (error: unknown) => {
    fail(error)
    throw cliError(error)
  })
  // runDeviceConnection consumes `closed`; avoid an unhandled parallel ready rejection.
  ready.catch(() => {})
  connection.closed.then(() => {
    if (settled) return
    settled = true
    resolveClosed()
  }, fail)

  return {
    ready,
    closed,
    get state() {
      return connection.state
    },
    close() {
      userClosed = true
      connection.close()
    },
    restart() {
      connection.restart()
    },
    resume() {
      connection.resume()
    },
    suspend() {
      connection.suspend()
    },
  }
}

export async function runDeviceConnection(opts: DeviceConnectionOptions): Promise<void> {
  const handle = startDeviceConnection(opts)
  const stop = () => handle.close()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    await handle.closed
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}
