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
  type DeviceCallContext,
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

/** AbortSignal 的宿主中立最小面；运行时传入的仍是原生 AbortSignal。 */
export interface DeviceAbortSignal {
  readonly aborted: boolean
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

export type DeviceCallHandler = (call: {
  arguments: Record<string, unknown>
  /** 网关鉴权后的调用方来源与权威期限;老网关不带,handler 须按缺省显式降级。 */
  context?: DeviceCallContext
  id: string
  path: string
  signal: DeviceAbortSignal
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
  /** 非法帧或阶段错误只在本地报告，不把原始输入回传对端。 */
  onProtocolError?: (message: string) => void
  onReady?: (mountPath: string) => void
  /** 网关拒绝帧(TBError):权限拒绝等,收到后进入 closed、不重连。 */
  onRejected?: (error: TBErrorBody) => void
  onStateChange?: (state: DeviceClientState) => void
}

const DEFAULT_MAX_CACHED_RESULTS = 1000

interface DeviceAbortController {
  abort(): void
  readonly signal: DeviceAbortSignal
}

function createAbortController(): DeviceAbortController {
  const ctor = (globalThis as unknown as {
    AbortController?: new () => DeviceAbortController
  }).AbortController
  if (ctor === undefined) {
    throw new Error('DeviceClient requires a global AbortController')
  }
  return new ctor()
}

function jsonValue(value: unknown): unknown {
  let encoded: string
  try {
    encoded = JSON.stringify({ value })
  } catch {
    throw new Error('device handler result is not JSON serializable')
  }
  const parsed = JSON.parse(encoded) as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(parsed, 'value')) {
    throw new Error('device handler result is not JSON serializable')
  }
  return parsed.value
}

export class DeviceClient {
  private state_: DeviceClientState = 'connecting'
  private socket: DeviceSocket | null = null
  private readonly cache = new Map<string, ResultFrame>()
  private readonly inflight = new Map<string, {
    controller: DeviceAbortController
    generation: number
  }>()

  private readonly maxCached: number
  private activeGeneration = 0
  private nextGeneration = 0

  constructor(private readonly opts: DeviceClientOptions) {
    this.maxCached = opts.maxCachedResults ?? DEFAULT_MAX_CACHED_RESULTS
  }

  get state(): DeviceClientState {
    return this.state_
  }

  /** socket 建立(含重连成功):发送 hello;状态保持 connecting/reconnecting 直到 ready 帧。 */
  socketOpened(socket: DeviceSocket): number {
    if (this.state_ === 'closed') {
      socket.close(1000)
      return this.activeGeneration
    }
    const generation = ++this.nextGeneration
    this.activeGeneration = generation
    this.socket = socket
    const hello: DeviceFrame = {
      type: 'hello',
      deviceId: this.opts.deviceId,
      // JSON.stringify 丢弃 undefined 值,mountPath 缺省时不出现在帧里
      mountPath: this.opts.mountPath,
      expose: this.opts.expose,
    }
    socket.send(encodeDeviceFrame(hello))
    return generation
  }

  /** 来消息入口;非法帧忽略(容错,不因对端脏数据断开)。 */
  async socketMessage(text: string, generation = this.activeGeneration): Promise<void> {
    if (generation !== this.activeGeneration || this.state_ === 'closed') return
    let frame: DeviceFrame
    try {
      frame = decodeDeviceFrame(text)
    } catch {
      this.opts.onProtocolError?.('invalid device frame ignored')
      return
    }
    switch (frame.type) {
      case 'ready':
        if (this.state_ !== 'connecting' && this.state_ !== 'reconnecting') {
          this.opts.onProtocolError?.('ready frame received outside handshake')
          return
        }
        this.setState('ready')
        this.opts.onReady?.(frame.mountPath)
        return
      case 'error':
        // 拒绝帧 = 权限拒绝(可重试断线不会有此帧):不重连
        this.setState('closed')
        this.opts.onRejected?.(frame.error)
        return
      case 'call':
        if (this.state_ !== 'ready') {
          this.opts.onProtocolError?.('call frame received before ready')
          return
        }
        await this.handleCall(frame, generation)
        return
      case 'ping':
        this.socket?.send(PONG_FRAME_JSON)
        return
      case 'cancel':
        this.inflight.get(frame.id)?.controller.abort()
        return
      default:
        // pong 忽略;hello/result 属设备→网关方向。
        return
    }
  }

  /** socket 断开:非用户关闭/拒绝 → reconnecting(胶水层据此重连)。 */
  socketClosed(generation = this.activeGeneration): void {
    if (generation !== this.activeGeneration) return
    this.socket = null
    if (this.state_ === 'closed') return
    this.setState('reconnecting')
  }

  /** 用户主动关闭:进入 closed,不再重连。 */
  close(): void {
    const socket = this.socket
    this.socket = null
    this.setState('closed')
    for (const { controller } of this.inflight.values()) controller.abort()
    socket?.close(1000)
  }

  private async handleCall(frame: CallFrame, generation: number): Promise<void> {
    const cached = this.cache.get(frame.id)
    if (cached !== undefined) {
      if (generation === this.activeGeneration) {
        this.socket?.send(encodeDeviceFrame(cached)) // 幂等:以首次结果应答
      }
      return
    }
    if (this.inflight.has(frame.id)) return // 执行中:完成时统一应答
    const controller = createAbortController()
    this.inflight.set(frame.id, { controller, generation })
    let result: ResultFrame
    try {
      const value = await this.opts.handler({
        id: frame.id,
        path: frame.path,
        tool: frame.tool,
        arguments: frame.arguments,
        signal: controller.signal,
        // 老网关不带 context:字段缺省透传,handler 侧显式降级。
        ...(frame.context !== undefined ? { context: frame.context } : {}),
      })
      result = { type: 'result', id: frame.id, ok: true, value: jsonValue(value) }
    } catch (e) {
      result = {
        type: 'result',
        id: frame.id,
        ok: false,
        error: isTBError(e)
          ? e.toJSON()
          : controller.signal.aborted
            ? {
                code: 'unavailable',
                message: 'device call cancelled',
                retryable: true,
              }
            : {
                code: 'internal',
                message: 'device handler failed',
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
    if (generation === this.activeGeneration && this.state_ === 'ready') {
      this.socket?.send(encodeDeviceFrame(result))
    }
  }

  private setState(state: DeviceClientState): void {
    if (this.state_ === state) return
    this.state_ = state
    this.opts.onStateChange?.(state)
  }
}
