/**
 * 设备连接的运行时中立 supervisor。
 *
 * 本文件只能依赖 Web 标准全局、partysocket 与 core 纯逻辑；Node/RN 的 WebSocket
 * 构造差异全部经 DeviceWebSocketFactory 注入。不要从这里导入根入口、app 或 ws。
 */

import {
  type DeviceCallHandler as CoreDeviceCallHandler,
  type DeviceCallContext,
  DeviceClient,
  type DeviceNodeCmd,
  normalizePath,
  PING_FRAME_JSON,
  TBError,
  type TBErrorBody,
  type TreePath,
  validatePath,
  type DeviceExpose as WireDeviceExpose,
} from '@tool-bridge/core/device'
import ReconnectingWebSocket from 'partysocket/ws'

export const DEVICE_HEARTBEAT_INTERVAL_MS = 30_000

export type DeviceConnectionState
  = | 'connecting'
    | 'ready'
    | 'reconnecting'
    | 'suspended'
    | 'closed'

export interface DeviceConnection {
  /** 终止连接；幂等。 */
  close(): void
  /** 连接终结(close 或网关拒绝)。 */
  readonly closed: Promise<void>
  /** 首次 ready；网关拒绝、expose 初始化失败或 ready 前 close 时 reject。 */
  readonly ready: Promise<string>
  /** 强制丢弃当前 transport 并重新取凭证、重连。suspended/closed 时不生效。 */
  restart(): void
  /** 恢复前台连接与心跳；幂等。 */
  resume(): void
  /** 当前连接状态。 */
  readonly state: DeviceConnectionState
  /** 暂停重连与心跳；不声称撤销已经发生的外部副作用。 */
  suspend(): void
}

export interface DeviceNodeDefinition {
  cmds?: readonly DeviceNodeCmd[]
  description: string
  /** 安全作者面只允许实际可路由回设备的节点类型。 */
  kind: 'tool' | 'context'
  /** 相对 mountPath 的路径。 */
  path: string
}

export interface DeviceClientExpose {
  nodes: readonly DeviceNodeDefinition[]
}

export type { DeviceCallContext }

export type DeviceCallHandler = (call: {
  arguments: Record<string, unknown>
  /** 网关鉴权后的调用方来源与权威期限;老网关不带,handler 须按缺省显式降级。 */
  context?: DeviceCallContext
  id: string
  path: string
  signal: AbortSignal
  tool: string
}) => Promise<unknown> | unknown

export interface PreparedDeviceCredential {
  /** WebSocket upgrade 请求头；RN 原生 adapter 可注入 Authorization。 */
  headers?: Readonly<Record<string, string>>
  protocols?: string | readonly string[]
  /** 为短期 ticket 等未来认证形态预留；缺省使用标准 device WS URL。 */
  url?: string
}

export interface DeviceCredentialProvider {
  /** 认证拒绝后的本地失效通知；不得在错误或日志里回显凭证。 */
  invalidate?(reason: TBErrorBody): void
  /** 每次底层连接尝试重新调用，允许异步读取 Keychain/Keystore 或换取 ticket。 */
  prepare(input: {
    baseUrl: string
    deviceId: string
    signal: AbortSignal
  }): Promise<PreparedDeviceCredential> | PreparedDeviceCredential
}

export interface DeviceWebSocketFactoryInput {
  headers?: Readonly<Record<string, string>>
  protocols?: string | readonly string[]
  url: string
}

export interface DeviceWebSocketFactory {
  open(input: DeviceWebSocketFactoryInput): WebSocket
}

/** React Native 原生 WebSocket 的第三参数 headers 扩展；不属于 WHATWG 标准面。 */
export interface ReactNativeWebSocketConstructor {
  new (
    url: string,
    protocols?: string | readonly string[] | null,
    options?: { headers?: Readonly<Record<string, string>> },
  ): WebSocket
}

export function createReactNativeWebSocketFactory(
  WebSocketImpl: unknown,
): DeviceWebSocketFactory {
  if (typeof WebSocketImpl !== 'function') {
    throw new TBError('invalid_argument', 'React Native WebSocket constructor is required')
  }
  const Constructor = WebSocketImpl as ReactNativeWebSocketConstructor
  return {
    open({ url, protocols, headers }) {
      return new Constructor(
        url,
        typeof protocols === 'string' || protocols === undefined
          ? protocols ?? null
          : [...protocols],
        headers === undefined ? undefined : { headers },
      )
    },
  }
}

export interface ConnectDeviceOptions {
  baseUrl: string
  credentialProvider: DeviceCredentialProvider
  deviceId: string
  expose: DeviceClientExpose | (() => DeviceClientExpose | Promise<DeviceClientExpose>)
  handler: DeviceCallHandler
  /** 缺省 30 秒；不得依赖 Node timer.unref。 */
  heartbeatIntervalMs?: number
  maxCachedResults?: number
  mountPath?: TreePath
  onError?: (error: Error) => void
  onProtocolError?: (message: string) => void
  onStateChange?: (state: DeviceConnectionState) => void
  webSocketFactory: DeviceWebSocketFactory
}

interface OpenPortableDeviceConnectionOptions {
  baseUrl: string
  credentialProvider: DeviceCredentialProvider
  deviceId: string
  expose: () => Promise<WireDeviceExpose>
  handler: CoreDeviceCallHandler
  heartbeatIntervalMs?: number
  maxCachedResults?: number
  mountPath?: TreePath
  onError?: (error: Error) => void
  onProtocolError?: (message: string) => void
  onStateChange?: (state: DeviceConnectionState) => void
  webSocketFactory: DeviceWebSocketFactory
}

interface HeartbeatHandle {
  markAlive(): void
  start(): void
  stop(): void
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function errorFromEvent(event: Event): Error {
  const message = (event as Event & { message?: unknown }).message
  return typeof message === 'string' && message !== '' ? new Error(message) : new Error('ws error')
}

function startHeartbeat(
  socket: ReconnectingWebSocket,
  intervalMs: number,
): HeartbeatHandle {
  let alive = true
  let timer: ReturnType<typeof setInterval> | undefined
  return {
    markAlive() {
      alive = true
    },
    start() {
      if (timer !== undefined) return
      alive = true
      timer = setInterval(() => {
        if (socket.readyState !== ReconnectingWebSocket.OPEN) {
          alive = true
          return
        }
        if (!alive) {
          socket.reconnect(1012, 'heartbeat timeout')
          alive = true
          return
        }
        alive = false
        socket.send(PING_FRAME_JSON)
      }, intervalMs)
      // Node 根入口沿用“不因心跳阻止进程退出”的行为；neutral 类型不暴露 Node timer。
      ;(timer as unknown as { unref?: () => void }).unref?.()
    },
    stop() {
      if (timer === undefined) return
      clearInterval(timer)
      timer = undefined
    },
  }
}

export function deviceWsUrl(baseUrl: string, deviceId: string): string {
  if (deviceId.trim() === '') throw new TBError('invalid_argument', 'deviceId 不能为空')
  const url = new URL(baseUrl)
  if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol === 'http:') url.protocol = 'ws:'
  else throw new TBError('invalid_argument', `unsupported base URL protocol: ${url.protocol}`)
  url.pathname = '/system/device/ws'
  url.search = ''
  url.hash = ''
  url.searchParams.set('deviceId', deviceId)
  return url.toString()
}

function validateCredential(
  credential: PreparedDeviceCredential,
  fallbackUrl: string,
): PreparedDeviceCredential & { url: string } {
  const url = new URL(credential.url ?? fallbackUrl)
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new TBError('invalid_argument', 'device credential URL must use ws: or wss:')
  }
  if (url.username !== '' || url.password !== '') {
    throw new TBError('invalid_argument', 'device credential URL must not contain userinfo')
  }
  for (const [name, value] of Object.entries(credential.headers ?? {})) {
    if (name.includes('\r') || name.includes('\n') || value.includes('\r') || value.includes('\n')) {
      throw new TBError('invalid_argument', 'device credential headers contain a newline')
    }
  }
  return { ...credential, url: url.toString() }
}

function portableExpose(expose: DeviceClientExpose): WireDeviceExpose {
  if (!Array.isArray(expose.nodes) || expose.nodes.length === 0) {
    throw new TBError('invalid_argument', 'device expose.nodes 至少需要一个节点')
  }
  return {
    nodes: expose.nodes.map((node) => {
      if (node.kind !== 'tool' && node.kind !== 'context') {
        throw new TBError('invalid_argument', 'device 节点只支持 tool/context')
      }
      const normalized = normalizePath(node.path)
      const invalid = validatePath(normalized)
      if (invalid !== null) throw invalid
      if (normalized !== node.path) {
        throw new TBError('invalid_argument', `device 节点必须使用规范相对路径:'${node.path}'`)
      }
      return {
        path: normalized,
        kind: node.kind,
        description: node.description,
        ...(node.cmds === undefined
          ? {}
          : { cmds: node.cmds.map((cmd: DeviceNodeCmd) => ({ ...cmd })) }),
      }
    }),
  }
}

/** SDK 根入口与 @tool-bridge/sdk/device 共用的 neutral supervisor。 */
export function openPortableDeviceConnection(
  opts: OpenPortableDeviceConnectionOptions,
): DeviceConnection {
  let state: DeviceConnectionState = 'connecting'
  let terminal = false
  let suspended = false
  let socket: ReconnectingWebSocket | null = null
  let client: DeviceClient | null = null
  let heartbeat: HeartbeatHandle | null = null
  let activeGeneration = 0
  let preparedCredential: (PreparedDeviceCredential & { url: string }) | null = null
  let credentialAttempt: {
    controller: AbortController
    promise: Promise<PreparedDeviceCredential & { url: string }>
  } | null = null

  let resolveReady!: (mountPath: string) => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<string>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  ready.catch(() => {})

  let resolveClosed!: () => void
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })

  const setState = (next: DeviceConnectionState): void => {
    if (state === next) return
    state = next
    opts.onStateChange?.(next)
  }

  const clearCredentialAttempt = (): void => {
    credentialAttempt?.controller.abort()
    credentialAttempt = null
    preparedCredential = null
  }

  const finish = (error?: Error, closeCode = 1000): void => {
    if (terminal) return
    terminal = true
    suspended = false
    clearCredentialAttempt()
    heartbeat?.stop()
    setState('closed')
    if (error !== undefined) rejectReady(error)
    client?.close()
    socket?.close(closeCode, error?.message ?? 'closed')
    resolveClosed()
  }

  const fallbackUrl = deviceWsUrl(opts.baseUrl, opts.deviceId)

  const prepareCredential = (): Promise<PreparedDeviceCredential & { url: string }> => {
    if (credentialAttempt !== null) return credentialAttempt.promise
    const controller = new AbortController()
    const current = {
      controller,
      promise: Promise.resolve(opts.credentialProvider.prepare({
        baseUrl: opts.baseUrl,
        deviceId: opts.deviceId,
        signal: controller.signal,
      })).then(credential => validateCredential(credential, fallbackUrl)),
    }
    current.promise = current.promise.catch((error: unknown) => {
      if (credentialAttempt === current) credentialAttempt = null
      throw error
    })
    credentialAttempt = current
    return current.promise
  }

  const urlProvider = async (): Promise<string> => {
    const credential = await prepareCredential()
    preparedCredential = credential
    return credential.url
  }

  const protocolsProvider = async (): Promise<string | string[] | null> => {
    const credential = await prepareCredential()
    preparedCredential = credential
    if (credential.protocols === undefined) return null
    return typeof credential.protocols === 'string'
      ? credential.protocols
      : [...credential.protocols]
  }

  const InjectedWebSocket = function (
    this: unknown,
    url: string,
    protocols?: string | string[],
  ): WebSocket {
    const credential = preparedCredential
    if (credential === null) throw new Error('device credentials were not prepared')
    try {
      return opts.webSocketFactory.open({
        url,
        ...(protocols === undefined ? {} : { protocols }),
        ...(credential.headers === undefined ? {} : { headers: credential.headers }),
      })
    } finally {
      preparedCredential = null
      credentialAttempt = null
    }
  } as unknown as typeof WebSocket

  void (async () => {
    let expose: WireDeviceExpose
    try {
      expose = await opts.expose()
    } catch (error) {
      finish(asError(error))
      return
    }
    if (terminal) return

    const dc = new DeviceClient({
      deviceId: opts.deviceId,
      expose,
      handler: opts.handler,
      ...(opts.maxCachedResults === undefined ? {} : { maxCachedResults: opts.maxCachedResults }),
      ...(opts.mountPath === undefined ? {} : { mountPath: opts.mountPath }),
      onProtocolError: opts.onProtocolError,
      onReady: resolveReady,
      onRejected: (error) => {
        opts.credentialProvider.invalidate?.(error)
        finish(new TBError(error.code, error.message, { retryable: error.retryable }), 1008)
      },
      onStateChange: (next) => {
        if (!suspended && !terminal) setState(next)
      },
    })
    client = dc

    const ws = new ReconnectingWebSocket(urlProvider, protocolsProvider, {
      WebSocket: InjectedWebSocket,
      connectionTimeout: 4000,
      maxEnqueuedMessages: 10,
      startClosed: suspended,
    })
    socket = ws
    const heartbeatHandle = startHeartbeat(
      ws,
      opts.heartbeatIntervalMs ?? DEVICE_HEARTBEAT_INTERVAL_MS,
    )
    heartbeat = heartbeatHandle
    if (!suspended) heartbeatHandle.start()

    ws.addEventListener('open', () => {
      if (terminal || suspended) {
        ws.close(1000, terminal ? 'closed' : 'suspended')
        return
      }
      activeGeneration = dc.socketOpened({
        send: data => ws.send(data),
        close: code => ws.close(code),
      })
    })
    ws.addEventListener('message', (event) => {
      heartbeatHandle.markAlive()
      const generation = activeGeneration
      void dc.socketMessage(String(event.data), generation)
    })
    ws.addEventListener('close', () => {
      const generation = activeGeneration
      activeGeneration = 0
      dc.socketClosed(generation)
      if (terminal) resolveClosed()
      else if (suspended) setState('suspended')
    })
    ws.addEventListener('error', (event) => {
      if (!terminal) opts.onError?.(errorFromEvent(event))
    })
  })()

  return {
    get state() {
      return state
    },
    ready,
    closed,
    close() {
      finish(new TBError('unavailable', 'connection closed by user'))
    },
    restart() {
      if (terminal || suspended) return
      clearCredentialAttempt()
      setState('reconnecting')
      socket?.reconnect(1012, 'restarted by user')
    },
    resume() {
      if (terminal || !suspended) return
      suspended = false
      setState(socket === null ? 'connecting' : 'reconnecting')
      heartbeat?.start()
      socket?.reconnect()
    },
    suspend() {
      if (terminal || suspended) return
      suspended = true
      clearCredentialAttempt()
      heartbeat?.stop()
      setState('suspended')
      socket?.close(1000, 'suspended')
    },
  }
}

export function connectDevice(opts: ConnectDeviceOptions): DeviceConnection {
  const exposeFactory = typeof opts.expose === 'function'
    ? opts.expose
    : () => opts.expose as DeviceClientExpose
  return openPortableDeviceConnection({
    baseUrl: opts.baseUrl,
    credentialProvider: opts.credentialProvider,
    deviceId: opts.deviceId,
    expose: async () => portableExpose(await exposeFactory()),
    handler: async call => await opts.handler({
      id: call.id,
      path: call.path,
      tool: call.tool,
      arguments: call.arguments,
      signal: call.signal as AbortSignal,
      // 老网关不带 context:字段缺省透传,consumer handler 侧显式降级。
      ...(call.context !== undefined ? { context: call.context } : {}),
    }),
    webSocketFactory: opts.webSocketFactory,
    ...(opts.heartbeatIntervalMs === undefined
      ? {}
      : { heartbeatIntervalMs: opts.heartbeatIntervalMs }),
    ...(opts.maxCachedResults === undefined ? {} : { maxCachedResults: opts.maxCachedResults }),
    ...(opts.mountPath === undefined ? {} : { mountPath: opts.mountPath }),
    ...(opts.onError === undefined ? {} : { onError: opts.onError }),
    ...(opts.onProtocolError === undefined ? {} : { onProtocolError: opts.onProtocolError }),
    ...(opts.onStateChange === undefined ? {} : { onStateChange: opts.onStateChange }),
  })
}
