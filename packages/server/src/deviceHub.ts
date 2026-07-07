/**
 * DeviceHub:Node 宿主的设备通道(DeviceChannel 实现,对位 CF 的 DeviceSession DO)。
 *
 * WS 升级走 http.Server 'upgrade' 事件 + ws handleUpgrade(不经 fetch handler,
 * tbApp 的认证中间件天然旁路),认证双点补齐:升级前 identify(401 早失败)+
 * 共享 processDeviceHello 内的权威判定(与 DO 同一模块,树形态/权限判定序不漂移)。
 *
 * 与 DO 的有意分叉:
 * - requestId 幂等表仅内存(session 内):进程重启 WS 必断、待决调用随进程消亡,
 *   无 DO hibernation 的跨休眠回放需求;tbApp 每次 invoke 生成新 UUID,跨连接去重无收益。
 * - 断线回收用进程内 setTimeout + StateStore 持久 meta(devicemeta:<id>),启动时
 *   sweepOrphans 扫描孤儿排程(对位 DO 的 storage+alarm)。
 * - 心跳:应用层 ping→pong 已内置于 DeviceGatewaySession.handleFrame;另加 ws 协议层
 *   探活(isAlive + 周期 ping + terminate)踢半开死连接,避免调用一律吃 60s 超时。
 */

import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import {
  type DeviceCallResult,
  DeviceGatewaySession,
  decodeDeviceFrame,
  encodeDeviceFrame,
  identify,
  NodeRegistryStore,
  type StateStore,
  TBError,
  type TreePath,
} from '@tool-bridge/core'
import { assertDeviceId, processDeviceHello } from '@tool-bridge/gateway/deviceHello'
import type { DeviceInvokeRequest } from '@tool-bridge/gateway/tbApp'
import { type WebSocket, WebSocketServer } from 'ws'

export const DEVICE_WS_PATH = '/system/device/ws'
const KEY_DEVICE_META = 'devicemeta:'
const DEFAULT_HEARTBEAT_MS = 30_000

interface DeviceMeta {
  deviceId: string
  mountPath: TreePath
  keyId: string
  connectedAt?: string
  disconnectedAt?: string
}

interface Conn {
  deviceId: string
  authorization: string | undefined
  ws: WebSocket
  session: DeviceGatewaySession
  isAlive: boolean
}

function isDeviceMeta(value: unknown): value is DeviceMeta {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { deviceId?: unknown }).deviceId === 'string' &&
    typeof (value as { mountPath?: unknown }).mountPath === 'string'
  )
}

/** 升级握手失败时的原始 HTTP 应答(不经 Hono;与 tbApp 的 TBError JSON 同形)。 */
function rejectUpgrade(socket: Duplex, error: TBError): void {
  const body = JSON.stringify(error.toJSON())
  const status = error.httpStatus
  const reason = status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : 'Bad Request'
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      'content-type: application/json; charset=utf-8\r\n' +
      `content-length: ${Buffer.byteLength(body)}\r\n` +
      'connection: close\r\n\r\n' +
      body,
  )
  socket.destroy()
}

export class DeviceHub {
  private readonly store: StateStore
  private readonly reclaimSec: number
  private readonly wss = new WebSocketServer({ noServer: true })
  private readonly activeByDevice = new Map<string, Conn>()
  private readonly connections = new Set<Conn>()
  private readonly reclaimTimers = new Map<string, NodeJS.Timeout>()
  private heartbeat: NodeJS.Timeout | undefined

  constructor(opts: { store: StateStore; reclaimSec: number; heartbeatMs?: number }) {
    this.store = opts.store
    this.reclaimSec = opts.reclaimSec
    const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
    this.heartbeat = setInterval(() => this.pingConnections(), heartbeatMs)
    this.heartbeat.unref?.()
  }

  /** 挂到 http.Server 的 'upgrade' 事件(仅处理 DEVICE_WS_PATH,其余 404)。 */
  attach(server: HttpServer): void {
    server.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head).catch((err) => {
        rejectUpgrade(
          socket,
          err instanceof TBError ? err : new TBError('internal', 'upgrade failed'),
        )
      })
    })
  }

  /** DeviceChannel.invoke:HTTP→WS 调用转发(无活连接 → deviceOffline)。 */
  async invoke(deviceId: string, req: DeviceInvokeRequest): Promise<unknown> {
    const conn = this.activeByDevice.get(deviceId)
    if (conn === undefined) {
      const offline: DeviceCallResult = { ok: false, error: TBError.deviceOffline().toJSON() }
      return offline
    }
    return await new Promise<DeviceCallResult>((resolve) => conn.session.call(req, resolve))
  }

  /** DeviceChannel.ws:Node 宿主的升级在 http 层处理,永不应命中此路由。 */
  async ws(): Promise<Response> {
    throw new TBError('invalid_argument', 'device ws upgrade 由 Node http 层处理(DeviceHub.attach)')
  }

  /**
   * 启动孤儿扫描:devicemeta: 里无活连接的设备补排回收 timer。
   * 崩溃时仍在线(无 disconnectedAt)按"此刻断线"起算;已过期立即回收。
   */
  async sweepOrphans(): Promise<void> {
    let cursor: string | undefined
    do {
      const page = await this.store.list(KEY_DEVICE_META, cursor !== undefined ? { cursor } : {})
      for (const item of page.items) {
        if (!isDeviceMeta(item.value)) continue
        const meta = item.value
        if (this.activeByDevice.has(meta.deviceId)) continue
        if (meta.disconnectedAt === undefined) {
          const now = new Date().toISOString()
          await this.store.put(KEY_DEVICE_META + meta.deviceId, { ...meta, disconnectedAt: now })
          this.scheduleReclaim(meta.deviceId, this.reclaimSec * 1000)
        } else {
          const dueMs = Date.parse(meta.disconnectedAt) + this.reclaimSec * 1000 - Date.now()
          if (dueMs <= 0) await this.reclaim(meta.deviceId)
          else this.scheduleReclaim(meta.deviceId, dueMs)
        }
      }
      cursor = page.cursor
    } while (cursor !== undefined)
  }

  async close(): Promise<void> {
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    for (const timer of this.reclaimTimers.values()) clearTimeout(timer)
    this.reclaimTimers.clear()
    for (const conn of this.connections) conn.ws.terminate()
    this.connections.clear()
    this.activeByDevice.clear()
    await new Promise<void>((resolve) => this.wss.close(() => resolve()))
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== DEVICE_WS_PATH) {
      rejectUpgrade(socket, TBError.notFound('not found'))
      return
    }
    const deviceId = url.searchParams.get('deviceId') ?? ''
    if (deviceId === '') {
      rejectUpgrade(socket, new TBError('invalid_argument', 'deviceId query is required'))
      return
    }
    assertDeviceId(deviceId)
    const authorization = req.headers.authorization
    // 早失败(对位 tbApp 认证中间件);权威判定仍在 processDeviceHello(hello 时)。
    const authCtx = await identify(this.store, authorization, new Date().toISOString())
    if (authCtx === null) {
      rejectUpgrade(socket, TBError.unauthenticated())
      return
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.acceptConnection(ws, deviceId, authorization)
    })
  }

  private acceptConnection(
    ws: WebSocket,
    deviceId: string,
    authorization: string | undefined,
  ): void {
    const session = new DeviceGatewaySession(
      {
        send: (frame) => ws.send(encodeDeviceFrame(frame)),
        close: (code) => ws.close(code),
        onHello: (hello) => {
          this.acceptHello(conn, hello).catch((err) => {
            session.reject(err instanceof TBError ? err : new TBError('internal', 'hello 失败'))
          })
        },
      },
      {
        setTimer: (cb, ms) => {
          const id = setTimeout(cb, ms)
          return () => clearTimeout(id)
        },
      },
    )
    const conn: Conn = { deviceId, authorization, ws, session, isAlive: true }
    this.connections.add(conn)
    ws.on('pong', () => {
      conn.isAlive = true
    })
    ws.on('message', (data) => {
      try {
        session.handleFrame(decodeDeviceFrame(data.toString()))
      } catch (err) {
        session.reject(err instanceof TBError ? err : new TBError('invalid_argument', '非法帧'))
      }
    })
    ws.on('close', () => {
      this.onClose(conn).catch(() => {})
    })
    ws.on('error', () => ws.terminate())
  }

  private async acceptHello(
    conn: Conn,
    hello: { deviceId: string; mountPath?: TreePath; expose: DeviceMetaExpose },
  ): Promise<void> {
    const now = new Date().toISOString()
    const { mountPath, keyId } = await processDeviceHello({
      store: this.store,
      authorization: conn.authorization,
      deviceIdHint: conn.deviceId,
      hello,
      now,
    })
    const meta: DeviceMeta = { deviceId: conn.deviceId, mountPath, keyId, connectedAt: now }
    await this.store.put(KEY_DEVICE_META + conn.deviceId, meta)
    this.cancelReclaim(conn.deviceId)
    const prev = this.activeByDevice.get(conn.deviceId)
    if (prev !== undefined && prev !== conn) prev.ws.close(1000, 'replaced')
    this.activeByDevice.set(conn.deviceId, conn)
    conn.session.accept(mountPath)
  }

  /** 连接失效收尾(对位 DO markDisconnected):registry 下线 + meta 记断线 + 排回收。 */
  private async onClose(conn: Conn): Promise<void> {
    conn.session.dispose()
    this.connections.delete(conn)
    if (this.activeByDevice.get(conn.deviceId) !== conn) return
    this.activeByDevice.delete(conn.deviceId)

    const raw = await this.store.get(KEY_DEVICE_META + conn.deviceId)
    if (!isDeviceMeta(raw)) return
    const now = new Date().toISOString()
    try {
      await new NodeRegistryStore(this.store).setOnline(raw.mountPath, false, now)
    } catch {
      // 节点可能已被管理面删除;只更新 meta 即可。
    }
    await this.store.put(KEY_DEVICE_META + conn.deviceId, { ...raw, disconnectedAt: now })
    this.scheduleReclaim(conn.deviceId, this.reclaimSec * 1000)
  }

  private scheduleReclaim(deviceId: string, delayMs: number): void {
    this.cancelReclaim(deviceId)
    const timer = setTimeout(() => {
      this.reclaim(deviceId).catch(() => {})
    }, delayMs)
    timer.unref?.()
    this.reclaimTimers.set(deviceId, timer)
  }

  private cancelReclaim(deviceId: string): void {
    const timer = this.reclaimTimers.get(deviceId)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.reclaimTimers.delete(deviceId)
    }
  }

  /** 回收执行(对位 DO alarm):仍无活连接才删子树 + meta。 */
  private async reclaim(deviceId: string): Promise<void> {
    this.reclaimTimers.delete(deviceId)
    if (this.activeByDevice.has(deviceId)) return
    const raw = await this.store.get(KEY_DEVICE_META + deviceId)
    if (!isDeviceMeta(raw)) return
    try {
      await new NodeRegistryStore(this.store).deleteSubtree(raw.mountPath)
    } catch {
      // 已被外部清理时,meta 仍要删。
    }
    await this.store.delete(KEY_DEVICE_META + deviceId)
  }

  /** ws 协议层探活:上一轮未回 pong → terminate(触发 close → markDisconnected)。 */
  private pingConnections(): void {
    for (const conn of this.connections) {
      if (!conn.isAlive) {
        conn.ws.terminate()
        continue
      }
      conn.isAlive = false
      conn.ws.ping()
    }
  }
}

/** hello.expose 的结构由 core 帧 schema 校验;此处仅透传给 processDeviceHello。 */
type DeviceMetaExpose = Parameters<typeof processDeviceHello>[0]['hello']['expose']
