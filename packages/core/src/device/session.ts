/**
 * 网关侧设备会话状态机(Proto §6.2/§6.3;纯逻辑,I/O 与时间注入,DO 只做胶水)。
 *
 * - awaiting-hello → ready:hello 经 io.onHello 交胶水层做 Check(register)+§2.4,
 *   通过则 accept(mountPath)(回 ready 帧),否则 reject(error)(拒绝帧 + close(1008))。
 * - 未 hello 先发非 hello 帧 / hello 重复 / 设备发出网关方向帧 → 拒绝帧 + 关闭。
 * - call:requestId 幂等表——已有结果的重复 id 立即以首次结果应答;结果未到的重复 id
 *   挂到同一待决项,不重复下发 call 帧。
 * - 超时(DEVICE_CALL_TIMEOUT_MS):给调用方 unavailable(retryable:true),给设备 cancel 帧;
 *   迟到的 result 仅入幂等表(后续重复 id 以它应答)。
 */

import type { TBErrorBody } from '../errors'
import { TBError } from '../errors'
import { type DeviceFrame, deviceErrorFrame, type HelloFrame } from './frames'

/** 设备调用超时(Proto §6.2);区别于 Plugin 30s / Workers CPU 30s,勿混用常量。 */
export const DEVICE_CALL_TIMEOUT_MS = 60_000

/** 拒绝帧发送后的关闭码(Proto §6.2:close(1008))。 */
export const DEVICE_REJECT_CLOSE_CODE = 1008

export type DeviceCallResult = { ok: true; value: unknown } | { ok: false; error: TBErrorBody }

export type CancelTimer = () => void
/** 时间注入:到期回调 + 返回取消函数(生产 = setTimeout/clearTimeout,单测 = 假时钟)。 */
export type SetTimer = (cb: () => void, ms: number) => CancelTimer

export interface DeviceSessionIo {
  send(frame: DeviceFrame): void
  close(code: number): void
  /** hello 通过结构校验后回调;胶水层完成注册判定后调 accept()/reject()。 */
  onHello(hello: HelloFrame): void
  /** result 落幂等表时回调(胶水层可持久化到 ctx.storage 做跨休眠回放)。 */
  onResult?(id: string, result: DeviceCallResult): void
}

export type DeviceSessionPhase = 'awaiting-hello' | 'ready' | 'closed'

export interface DeviceSessionOptions {
  setTimer: SetTimer
  /** 缺省 DEVICE_CALL_TIMEOUT_MS。 */
  timeoutMs?: number
}

interface PendingCall {
  waiters: Array<(result: DeviceCallResult) => void>
  cancelTimer: CancelTimer
}

export interface DeviceCallRequest {
  id: string
  /** 相对 mountPath,如 "shell"。 */
  path: string
  tool: string
  arguments: Record<string, unknown>
}

export class DeviceGatewaySession {
  private phase_: DeviceSessionPhase = 'awaiting-hello'
  private helloSeen = false
  private readonly results = new Map<string, DeviceCallResult>()
  private readonly pending = new Map<string, PendingCall>()
  private readonly timeoutMs: number

  constructor(
    private readonly io: DeviceSessionIo,
    private readonly opts: DeviceSessionOptions,
  ) {
    this.timeoutMs = opts.timeoutMs ?? DEVICE_CALL_TIMEOUT_MS
  }

  get phase(): DeviceSessionPhase {
    return this.phase_
  }

  /** 设备来帧入口(已 decode);协议违规在此收敛为拒绝帧 + 关闭。 */
  handleFrame(frame: DeviceFrame): void {
    if (this.phase_ === 'closed') return
    if (this.phase_ === 'awaiting-hello') {
      if (frame.type !== 'hello') {
        this.protocolReject(`未 hello 先发 '${frame.type}' 帧`)
        return
      }
      if (this.helloSeen) {
        this.protocolReject('重复 hello')
        return
      }
      this.helloSeen = true
      this.io.onHello(frame)
      return
    }
    // ready
    switch (frame.type) {
      case 'hello':
        this.protocolReject('重复 hello')
        return
      case 'result':
        this.handleResult(
          frame.id,
          frame.ok ? { ok: true, value: frame.value } : { ok: false, error: frame.error },
        )
        return
      case 'ping':
        this.io.send({ type: 'pong' })
        return
      case 'pong':
        return
      default:
        // ready/error/call/cancel 是网关 → 设备方向,设备不应发出
        this.protocolReject(`设备不应发送 '${frame.type}' 帧`)
        return
    }
  }

  /** hello 判定通过:回 ready 帧,进入 ready。 */
  accept(mountPath: string): void {
    if (this.phase_ !== 'awaiting-hello' || !this.helloSeen) {
      throw new Error(`DeviceGatewaySession.accept: 非法时机(phase=${this.phase_})`)
    }
    this.phase_ = 'ready'
    this.io.send({ type: 'ready', mountPath })
  }

  /**
   * hibernation 唤醒恢复:该连接的 hello 已在休眠前完成(胶水层据持久化的连接标识判定),
   * 直接进入 ready,不重发 ready 帧。
   */
  restoreReady(): void {
    if (this.phase_ !== 'awaiting-hello' || this.helloSeen) {
      throw new Error(`DeviceGatewaySession.restoreReady: 非法时机(phase=${this.phase_})`)
    }
    this.helloSeen = true
    this.phase_ = 'ready'
  }

  /** 拒绝:发拒绝帧后关闭(Proto §6.2)。hello 判定失败与协议违规共用。 */
  reject(error: TBError): void {
    if (this.phase_ === 'closed') return
    this.io.send(deviceErrorFrame(error))
    this.io.close(DEVICE_REJECT_CLOSE_CODE)
    this.teardown('设备连接已被网关关闭')
  }

  /**
   * 发起调用:结果经 done 回调(幂等回放可能同步回调)。
   * 重复 id:已有结果 → 立即以首次结果应答;in-flight → 挂同一待决项,不重复下发。
   */
  call(req: DeviceCallRequest, done: (result: DeviceCallResult) => void): void {
    const cached = this.results.get(req.id)
    if (cached !== undefined) {
      done(cached)
      return
    }
    const inflight = this.pending.get(req.id)
    if (inflight !== undefined) {
      inflight.waiters.push(done)
      return
    }
    if (this.phase_ !== 'ready') {
      done({ ok: false, error: TBError.deviceOffline().toJSON() })
      return
    }
    const cancelTimer = this.opts.setTimer(() => this.onCallTimeout(req.id), this.timeoutMs)
    this.pending.set(req.id, { waiters: [done], cancelTimer })
    this.io.send({
      type: 'call',
      id: req.id,
      path: req.path,
      tool: req.tool,
      arguments: req.arguments,
    })
  }

  /** 幂等表回放种子(DO 从 ctx.storage 恢复时用);已有同 id 结果则忽略。 */
  seedResult(id: string, result: DeviceCallResult): void {
    if (!this.results.has(id)) this.results.set(id, result)
  }

  /** 连接断开(webSocketClose):所有待决调用回 unavailable(retryable),不再发帧。 */
  dispose(): void {
    this.teardown('设备连接已断开')
  }

  private teardown(reason: string): void {
    this.phase_ = 'closed'
    const entries = [...this.pending.values()]
    this.pending.clear()
    const result: DeviceCallResult = {
      ok: false,
      error: new TBError('unavailable', reason, { retryable: true }).toJSON(),
    }
    for (const entry of entries) {
      entry.cancelTimer()
      for (const waiter of entry.waiters) waiter(result)
    }
  }

  private protocolReject(message: string): void {
    this.reject(new TBError('invalid_argument', message))
  }

  private handleResult(id: string, result: DeviceCallResult): void {
    if (this.results.has(id)) return // 重复 result:以首次为准
    this.results.set(id, result)
    this.io.onResult?.(id, result)
    const entry = this.pending.get(id)
    if (entry === undefined) return // 超时后迟到的 result:仅入幂等表
    this.pending.delete(id)
    entry.cancelTimer()
    for (const waiter of entry.waiters) waiter(result)
  }

  private onCallTimeout(id: string): void {
    const entry = this.pending.get(id)
    if (entry === undefined) return
    this.pending.delete(id)
    this.io.send({ type: 'cancel', id })
    const result: DeviceCallResult = {
      ok: false,
      error: new TBError('unavailable', `设备调用超时(${this.timeoutMs}ms)`, {
        retryable: true,
      }).toJSON(),
    }
    for (const waiter of entry.waiters) waiter(result)
  }
}
