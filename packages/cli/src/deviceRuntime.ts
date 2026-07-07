import {
  type ContextEntryInput,
  type ContextPatch,
  createObjectContextProvider,
  DeviceClient,
  type DeviceClientState,
  type DeviceExpose,
  type ListOptions,
  type ObjectContextProvider,
  PING_FRAME_JSON,
  type SearchOptions,
  TBError,
} from '@tool-bridge/core'
import { createShellExecutor, FsObjectStore } from '@tool-bridge/core/node'
import ReconnectingWebSocket from 'partysocket/ws'
import WS, { type ClientOptions } from 'ws'
import { CliError } from './http'

export interface DeviceConnectionOptions {
  baseUrl: string
  sk: string
  deviceId: string
  mountPath?: string
  expose: DeviceExpose
  onReady?: (mountPath: string) => void
  onStateChange?: (state: DeviceClientState) => void
}

export interface DeviceConnectionHandle {
  close(): void
  closed: Promise<void>
}

export function deviceWsUrl(baseUrl: string, deviceId: string): string {
  const url = new URL(baseUrl)
  if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol === 'http:') url.protocol = 'ws:'
  else throw new CliError(`unsupported base URL protocol: ${url.protocol}`)
  url.pathname = '/system/device/ws'
  url.search = ''
  url.searchParams.set('deviceId', deviceId)
  return url.toString()
}

function authorizedWebSocket(sk: string): typeof WS {
  return class AuthorizedWebSocket extends WS {
    constructor(address: null)
    constructor(address: string | URL, options?: ClientOptions)
    constructor(address: string | URL, protocols?: string | string[], options?: ClientOptions)
    constructor(
      address: string | URL | null,
      protocolsOrOptions?: string | string[] | ClientOptions,
      options?: ClientOptions,
    ) {
      if (address === null) {
        super(address)
        return
      }
      const withAuth = (opts?: ClientOptions): ClientOptions => ({
        ...(opts ?? {}),
        headers: { ...(opts?.headers ?? {}), authorization: `Bearer ${sk}` },
      })
      if (
        protocolsOrOptions !== undefined &&
        typeof protocolsOrOptions === 'object' &&
        !Array.isArray(protocolsOrOptions)
      ) {
        super(address, withAuth(protocolsOrOptions))
        return
      }
      super(address, protocolsOrOptions, withAuth(options))
    }
  }
}

export const HEARTBEAT_INTERVAL_MS = 30_000

export interface HeartbeatSocket {
  readyState: number
  send(data: string): void
  reconnect(): void
}

export interface HeartbeatHandle {
  /** 任何入站帧都算存活证据(pong / call / ready 等)。 */
  markAlive(): void
  stop(): void
}

/**
 * 应用层心跳:每 intervalMs 发一帧 ping(网关 DO 的 setWebSocketAutoResponse 自动应答
 * pong,不唤醒 DO)。空闲 WS 会被 Cloudflare 边缘 ~100s 掐断,且客户端对此毫无感知
 * (半开连接);心跳既保活,又在"上一轮 ping 后无任何入站帧"时主动 reconnect
 * (重连会自动重发 hello 恢复在线)。
 */
export function startHeartbeat(
  socket: HeartbeatSocket,
  intervalMs = HEARTBEAT_INTERVAL_MS,
): HeartbeatHandle {
  let alive = true
  const timer = setInterval(() => {
    if (socket.readyState !== ReconnectingWebSocket.OPEN) {
      alive = true // 重连期间不判死链,open 后重新计
      return
    }
    if (!alive) {
      socket.reconnect()
      alive = true
      return
    }
    alive = false
    socket.send(PING_FRAME_JSON)
  }, intervalMs)
  return {
    markAlive: () => {
      alive = true
    },
    stop: () => clearInterval(timer),
  }
}

function dispatchFs(
  provider: ObjectContextProvider,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (tool) {
    case 'List':
      return provider.List((args.path as string) ?? '', args.opts as ListOptions | undefined)
    case 'Get':
      return provider.Get(args.path as string)
    case 'Write':
      if (typeof args.entry !== 'object' || args.entry === null) {
        throw new TBError('invalid_argument', "Write 需要对象 'entry'")
      }
      return provider.Write(args.path as string, args.entry as ContextEntryInput)
    case 'Update':
      if (typeof args.patch !== 'object' || args.patch === null) {
        throw new TBError('invalid_argument', "Update 需要对象 'patch'")
      }
      return provider.Update(args.path as string, args.patch as ContextPatch)
    case 'Delete':
      return provider.Delete(args.path as string)
    case 'Search':
      return provider.Search(args.query as string, args.opts as SearchOptions | undefined)
    default:
      throw new TBError('invalid_argument', `unknown fs cmd '${tool}'`)
  }
}

export function startDeviceConnection(opts: DeviceConnectionOptions): DeviceConnectionHandle {
  const url = deviceWsUrl(opts.baseUrl, opts.deviceId)
  let fsProvider: ObjectContextProvider | undefined
  const shell = opts.expose.shell
    ? createShellExecutor({ allow: opts.expose.shell.allow ?? [] })
    : undefined
  const fsStore = opts.expose.fs ? new FsObjectStore(opts.expose.fs.roots) : undefined

  let rejectClosed: (err: Error) => void = () => {}
  let resolveClosed: () => void = () => {}
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve
    rejectClosed = reject
  })

  const socket = new ReconnectingWebSocket(url, [], {
    WebSocket: authorizedWebSocket(opts.sk),
    maxEnqueuedMessages: 10,
    connectionTimeout: 4000,
  })
  const heartbeat = startHeartbeat(socket)
  closed.then(
    () => heartbeat.stop(),
    () => heartbeat.stop(),
  )

  const client = new DeviceClient({
    deviceId: opts.deviceId,
    ...(opts.mountPath !== undefined ? { mountPath: opts.mountPath } : {}),
    expose: opts.expose,
    onReady: (mountPath) => {
      if (fsStore !== undefined) {
        fsProvider = createObjectContextProvider(fsStore, {
          nsPath: `${mountPath}/fs`,
          readOnly: opts.expose.fs?.readOnly ?? false,
        })
      }
      opts.onReady?.(mountPath)
    },
    onStateChange: opts.onStateChange,
    onRejected: (error) => {
      // 先 reject 再 close:partysocket 的 close() 同步派发 close 事件,若先 close,
      // close listener 的 resolveClosed 会抢先 settle,拒绝被吞(退出码 0 且无输出)。
      rejectClosed(new CliError(error.message, error.code))
      socket.close(1008, error.message)
    },
    handler: async (call) => {
      if (call.path === 'shell') {
        if (call.tool !== 'exec')
          throw new TBError('invalid_argument', `unknown shell cmd '${call.tool}'`)
        if (shell === undefined) throw TBError.notFound('shell not exposed')
        const command = call.arguments.command
        if (typeof command !== 'string' || command.trim() === '') {
          throw new TBError('invalid_argument', "exec 需要字符串 'command'")
        }
        return shell(command, {
          ...(typeof call.arguments.cwd === 'string' ? { cwd: call.arguments.cwd } : {}),
          ...(typeof call.arguments.timeoutMs === 'number'
            ? { timeoutMs: call.arguments.timeoutMs }
            : {}),
        })
      }
      if (call.path === 'fs') {
        if (fsProvider === undefined) throw TBError.notFound('fs not exposed')
        return dispatchFs(fsProvider, call.tool, call.arguments)
      }
      throw TBError.notFound(`device path not exposed:'${call.path}'`)
    },
  })

  socket.addEventListener('open', () => {
    client.socketOpened({
      send: (data) => socket.send(data),
      close: (code) => socket.close(code),
    })
  })
  socket.addEventListener('message', (event) => {
    heartbeat.markAlive()
    void client.socketMessage(String(event.data))
  })
  socket.addEventListener('close', () => {
    client.socketClosed()
    if (client.state === 'closed') resolveClosed()
  })
  socket.addEventListener('error', (event) => {
    const message =
      typeof (event as { message?: unknown }).message === 'string'
        ? String((event as { message: unknown }).message)
        : 'ws error'
    opts.onStateChange?.('reconnecting')
    if (client.state === 'closed') rejectClosed(new CliError(message))
  })

  return {
    close() {
      client.close()
      socket.close(1000, 'closed by user')
      resolveClosed()
    },
    closed,
  }
}

export async function runDeviceConnection(opts: DeviceConnectionOptions): Promise<void> {
  const handle = startDeviceConnection(opts)
  await new Promise<void>((resolve, reject) => {
    const stop = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      handle.close()
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    handle.closed.then(
      () => {
        process.off('SIGINT', stop)
        process.off('SIGTERM', stop)
        resolve()
      },
      (err) => {
        process.off('SIGINT', stop)
        process.off('SIGTERM', stop)
        reject(err)
      },
    )
  })
}
