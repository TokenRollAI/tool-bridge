/**
 * SDK 侧设备连接胶水(自 cli/src/deviceRuntime.ts 下沉):
 * partysocket 重连 + 握手 Bearer 注入 + 30s 应用层心跳(DO hibernation 生产坑:
 * 空闲 WS 会被边缘 ~100s 掐断且客户端毫无感知,须 ping 保活 + 死链主动 reconnect,
 * 见 llmdoc guides/do-websocket-hibernation)。
 *
 * expose 以异步工厂注入:connect() 同步返回 Connection,工具表(cmds)在建连前
 * 才向本实例 Provider 收集(List 可能异步)。
 */

import {
  type DeviceCallHandler,
  DeviceClient,
  type DeviceClientState,
  type DeviceExpose,
  PING_FRAME_JSON,
  TBError,
} from '@tool-bridge/core'
import ReconnectingWebSocket from 'partysocket/ws'
import WS, { type ClientOptions } from 'ws'
import type { SdkConnection } from './types'

export function deviceWsUrl(baseUrl: string, deviceId: string): string {
  const url = new URL(baseUrl)
  if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol === 'http:') url.protocol = 'ws:'
  else throw new TBError('invalid_argument', `unsupported base URL protocol: ${url.protocol}`)
  url.pathname = '/system/device/ws'
  url.search = ''
  url.searchParams.set('deviceId', deviceId)
  return url.toString()
}

/** node ws 子类:握手请求注入 Authorization(浏览器 WebSocket 无此入口,SDK 面向 Node)。 */
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
        protocolsOrOptions !== undefined
        && typeof protocolsOrOptions === 'object'
        && !Array.isArray(protocolsOrOptions)
      ) {
        super(address, withAuth(protocolsOrOptions))
        return
      }
      super(address, protocolsOrOptions, withAuth(options))
    }
  }
}

export const HEARTBEAT_INTERVAL_MS = 30_000

interface HeartbeatSocket {
  readyState: number
  reconnect(): void
  send(data: string): void
}

interface HeartbeatHandle {
  /** 任何入站帧都算存活证据(pong / call / ready 等)。 */
  markAlive(): void
  stop(): void
}

/**
 * 应用层心跳:每 intervalMs 发一帧 ping(网关 DO setWebSocketAutoResponse 自动应答
 * pong,不唤醒 DO);"上一轮 ping 后无任何入站帧" → 半开连接,主动 reconnect
 * (重连自动重发 hello 恢复在线)。
 */
function startHeartbeat(
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
  // 长驻嵌入方不因心跳阻止进程退出(close() 会 stop;unref 兜底)。
  timer.unref?.()
  return {
    markAlive: () => {
      alive = true
    },
    stop: () => clearInterval(timer),
  }
}

export interface OpenConnectionConfig {
  baseUrl: string
  deviceId: string
  /** 建连前解析(工具表收集可能异步);失败 → ready reject + closed。 */
  expose: () => Promise<DeviceExpose>
  handler: DeviceCallHandler
  mountPath?: string
  sk: string
}

export function openConnection(cfg: OpenConnectionConfig): SdkConnection {
  let userClosed = false
  let state: DeviceClientState = 'connecting'
  let client: DeviceClient | null = null
  let socket: InstanceType<typeof ReconnectingWebSocket> | null = null
  let heartbeat: HeartbeatHandle | null = null

  let resolveReady!: (mountPath: string) => void
  let rejectReady!: (err: Error) => void
  const ready = new Promise<string>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // 嵌入方可以不 await ready(只用 closed);预挂 catch 防未观察 rejection。
  ready.catch(() => {})

  let resolveClosed!: () => void
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })

  const finish = (): void => {
    heartbeat?.stop()
    state = 'closed'
    resolveClosed()
  }

  void (async () => {
    let expose: DeviceExpose
    try {
      expose = await cfg.expose()
    } catch (err) {
      rejectReady(err instanceof Error ? err : new Error(String(err)))
      finish()
      return
    }
    if (userClosed) return

    const url = deviceWsUrl(cfg.baseUrl, cfg.deviceId)
    const ws = new ReconnectingWebSocket(url, [], {
      WebSocket: authorizedWebSocket(cfg.sk),
      maxEnqueuedMessages: 10,
      connectionTimeout: 4000,
    })
    socket = ws
    heartbeat = startHeartbeat(ws)

    const dc = new DeviceClient({
      deviceId: cfg.deviceId,
      ...(cfg.mountPath !== undefined ? { mountPath: cfg.mountPath } : {}),
      expose,
      handler: cfg.handler,
      onStateChange: (s) => {
        state = s
      },
      onReady: mountPath => resolveReady(mountPath),
      onRejected: (error) => {
        // 网关拒绝帧 = 权限拒绝等,不重连(DeviceClient 已置 closed)。
        rejectReady(new TBError(error.code, error.message, { retryable: error.retryable }))
        ws.close(1008, error.message)
        finish()
      },
    })
    client = dc

    ws.addEventListener('open', () => {
      dc.socketOpened({
        send: data => ws.send(data),
        close: code => ws.close(code),
      })
    })
    ws.addEventListener('message', (event) => {
      heartbeat?.markAlive()
      void dc.socketMessage(String(event.data))
    })
    ws.addEventListener('close', () => {
      dc.socketClosed()
      if (dc.state === 'closed') finish()
    })
    ws.addEventListener('error', () => {
      if (dc.state === 'closed') finish()
    })
  })()

  return {
    get state() {
      return state
    },
    ready,
    closed,
    close() {
      userClosed = true
      client?.close()
      socket?.close(1000, 'closed by user')
      rejectReady(new TBError('unavailable', 'connection closed by user', { retryable: false }))
      finish()
    },
  }
}
