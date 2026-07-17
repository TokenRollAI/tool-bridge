/**
 * 设备侧状态机(纯逻辑,WS 以最小接口注入,不依赖 ws 包)。
 *
 * 宿主胶水(CLI/SDK)负责建连与重连循环:每次 socket 打开调 socketOpened(自动重发
 * hello)、来消息调 socketMessage、断开调 socketClosed;state === 'reconnecting' 即
 * 应重连。收到拒绝帧(error)= 权限拒绝 → 'closed',不再重连;用户 close() 同。
 * 对重复 call id 以本地结果缓存幂等应答(有界,超限逐最旧)。
 */

import type { DeviceExpose, TreePath } from '../types'
import {
  type CallFrame,
  decodeDeviceFrame,
  type DeviceFrame,
  encodeDeviceFrame,
  PONG_FRAME_JSON,
  type ResultFrame,
} from './frames'
import { isTBError, type TBErrorBody } from '../errors'

export type DeviceClientState = 'connecting' | 'ready' | 'reconnecting' | 'closed'

/** 注入的最小 WS 面(node ws / 浏览器 WebSocket 均可适配)。 */
export interface DeviceSocket {
  close(code?: number): void
  send(data: string): void
}

export type DeviceCallHandler = (call: {
  arguments: Record<string, unknown>
  path: string
  tool: string
}) => Promise<unknown> | unknown

export interface DeviceClientOptions {
  deviceId: string
  expose: DeviceExpose
  /** call 帧的执行器(shell executor / file provider / 自定义 nodes 的分发在胶水层)。 */
  handler: DeviceCallHandler
  /** 结果幂等缓存上限(缺省 1000;超限逐最旧)。 */
  maxCachedResults?: number
  mountPath?: TreePath
  onReady?: (mountPath: string) => void
  /** 网关拒绝帧(TBError):权限拒绝等,收到后进入 closed、不重连。 */
  onRejected?: (error: TBErrorBody) => void
  onStateChange?: (state: DeviceClientState) => void
}

const DEFAULT_MAX_CACHED_RESULTS = 1000

export class DeviceClient {
  private state_: DeviceClientState = 'connecting'
  private socket: DeviceSocket | null = null
  private readonly cache = new Map<string, ResultFrame>()
  private readonly inflight = new Set<string>()
  private readonly maxCached: number

  constructor(private readonly opts: DeviceClientOptions) {
    this.maxCached = opts.maxCachedResults ?? DEFAULT_MAX_CACHED_RESULTS
  }

  get state(): DeviceClientState {
    return this.state_
  }

  /** socket 建立(含重连成功):发送 hello;状态保持 connecting/reconnecting 直到 ready 帧。 */
  socketOpened(socket: DeviceSocket): void {
    if (this.state_ === 'closed') {
      socket.close(1000)
      return
    }
    this.socket = socket
    const hello: DeviceFrame = {
      type: 'hello',
      deviceId: this.opts.deviceId,
      // JSON.stringify 丢弃 undefined 值,mountPath 缺省时不出现在帧里
      mountPath: this.opts.mountPath,
      expose: this.opts.expose,
    }
    socket.send(encodeDeviceFrame(hello))
  }

  /** 来消息入口;非法帧忽略(容错,不因对端脏数据断开)。 */
  async socketMessage(text: string): Promise<void> {
    let frame: DeviceFrame
    try {
      frame = decodeDeviceFrame(text)
    } catch {
      return
    }
    switch (frame.type) {
      case 'ready':
        this.setState('ready')
        this.opts.onReady?.(frame.mountPath)
        return
      case 'error':
        // 拒绝帧 = 权限拒绝(可重试断线不会有此帧):不重连
        this.setState('closed')
        this.opts.onRejected?.(frame.error)
        return
      case 'call':
        await this.handleCall(frame)
        return
      case 'ping':
        this.socket?.send(PONG_FRAME_JSON)
        return
      default:
        // pong 忽略;cancel 不中断执行(结果仍入缓存做幂等);hello/result 属设备→网关方向
        return
    }
  }

  /** socket 断开:非用户关闭/拒绝 → reconnecting(胶水层据此重连)。 */
  socketClosed(): void {
    this.socket = null
    if (this.state_ === 'closed') return
    this.setState('reconnecting')
  }

  /** 用户主动关闭:进入 closed,不再重连。 */
  close(): void {
    const socket = this.socket
    this.socket = null
    this.setState('closed')
    socket?.close(1000)
  }

  private async handleCall(frame: CallFrame): Promise<void> {
    const cached = this.cache.get(frame.id)
    if (cached !== undefined) {
      this.socket?.send(encodeDeviceFrame(cached)) // 幂等:以首次结果应答
      return
    }
    if (this.inflight.has(frame.id)) return // 执行中:完成时统一应答
    this.inflight.add(frame.id)
    let result: ResultFrame
    try {
      const value = await this.opts.handler({
        path: frame.path,
        tool: frame.tool,
        arguments: frame.arguments,
      })
      result = { type: 'result', id: frame.id, ok: true, value }
    } catch (e) {
      result = {
        type: 'result',
        id: frame.id,
        ok: false,
        error: isTBError(e)
          ? e.toJSON()
          : {
              code: 'internal',
              message: e instanceof Error ? e.message : String(e),
              retryable: false,
            },
      }
    }
    this.inflight.delete(frame.id)
    this.cache.set(frame.id, result)
    if (this.cache.size > this.maxCached) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.socket?.send(encodeDeviceFrame(result))
  }

  private setState(state: DeviceClientState): void {
    if (this.state_ === state) return
    this.state_ = state
    this.opts.onStateChange?.(state)
  }
}
