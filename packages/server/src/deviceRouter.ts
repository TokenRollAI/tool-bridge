/**
 * DeviceRouter:多副本部署下的设备调用路由。
 *
 * 为什么不能只换个存储 —— 设备的 WebSocket 是**活 socket**,只存在于接受它的那个
 * 进程里,不可序列化。副本 B 收到打给"连在副本 A 上的设备"的 HTTP 调用时,B 手里
 * 没有那个 socket,必须把调用**转发**给 A、再把结果收回来。所以这里是两件事:
 *
 *   1. 路由表(Redis string,带 TTL):deviceId → 持有者副本 ID。TTL + 周期续期让
 *      副本崩溃后条目自动过期,不需要墓碑清理。
 *   2. 请求/响应转发(Redis pub/sub):B 往 A 的频道发 call、A 执行完往 B 的回执
 *      频道发 result。跨副本的请求-响应用 correlationId 关联,并有独立超时兜底 ——
 *      A 在执行途中崩溃时 B 不能永久挂起。
 *
 * 本副本自己持有连接时**完全不经这里**(DeviceHub 先查本地 Map),故单副本部署零额外
 * 开销、也不需要配 Redis。
 *
 * 与 CF 宿主的对照:那边用 Durable Object,天然"每设备一个单点",不存在这个问题。
 * 本模块是 Node 多副本的等价物。
 */

import type { DeviceInvokeRequest } from '@tool-bridge/app'
import { type DeviceCallResult, TBError } from '@tool-bridge/core'

/** 路由条目 TTL;续期周期取其 1/3,保证正常情况下不会因抖动过期。 */
export const DEVICE_ROUTE_TTL_SEC = 30
/** 跨副本转发的等待上限(毫秒)。持有者副本崩溃时靠它兜底,不能永久挂起。 */
export const DEVICE_FORWARD_TIMEOUT_MS = 65_000

/** Redis 键与频道命名(集中一处,便于运维排查)。 */
export const deviceRouteKey = (deviceId: string): string => `tb:device:route:${deviceId}`
export const deviceCallChannel = (replicaId: string): string => `tb:device:call:${replicaId}`
export const deviceReplyChannel = (replicaId: string): string => `tb:device:reply:${replicaId}`

/** 转发请求信封(经 pub/sub 传给持有者副本)。 */
export interface DeviceForwardCall {
  correlationId: string
  deviceId: string
  /** 发起方副本 ID;持有者把结果发回它的回执频道。 */
  replyTo: string
  req: DeviceInvokeRequest
}

/** 转发回执。 */
export interface DeviceForwardReply {
  correlationId: string
  result: DeviceCallResult
}

/**
 * DeviceHub 需要的 Redis 能力子集。
 *
 * 抽成接口而非直接用 ioredis:让 DeviceHub 不依赖具体客户端,单测可注入内存实现,
 * 也便于将来换 Valkey / 其它 pub/sub 后端。
 */
export interface DeviceRouterBackend {
  /** 删除本副本持有的路由条目(仅当当前值仍是自己,避免删掉已顶替者的条目)。 */
  clearRoute(deviceId: string, replicaId: string): Promise<void>
  close(): Promise<void>
  /** 查 deviceId 的持有者副本;无则 null。 */
  lookupRoute(deviceId: string): Promise<string | null>
  /** 向某副本的频道发布消息。 */
  publish(channel: string, payload: string): Promise<void>
  /** 声明/续期:deviceId 由本副本持有,TTL 秒后过期。 */
  setRoute(deviceId: string, replicaId: string, ttlSec: number): Promise<void>
  /** 订阅频道;handler 收到原始 payload。 */
  subscribe(channel: string, handler: (payload: string) => void): Promise<void>
}

/** 等待中的跨副本调用。 */
interface PendingForward {
  resolve: (result: DeviceCallResult) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * 跨副本调用的发起侧与接收侧编排。
 *
 * DeviceHub 只跟本类打交道:`invoke` 时若本地无连接就问 `forward`,
 * 并把"本副本能否执行某设备调用"的能力通过 `onLocalCall` 交回来。
 */
export class DeviceRouter {
  private readonly pending = new Map<string, PendingForward>()
  private renewTimer: ReturnType<typeof setInterval> | undefined
  /** 本副本当前持有的设备(需周期续期路由条目)。 */
  private readonly owned = new Set<string>()

  constructor(
    readonly replicaId: string,
    private readonly backend: DeviceRouterBackend,
    private readonly opts: {
      forwardTimeoutMs?: number
      /** 收到转发来的调用时,在本副本执行(本地无该连接则返回 offline)。 */
      onLocalCall: (deviceId: string, req: DeviceInvokeRequest) => Promise<DeviceCallResult>
      ttlSec?: number
    },
  ) {}

  private get ttlSec(): number {
    return this.opts.ttlSec ?? DEVICE_ROUTE_TTL_SEC
  }

  /** 订阅本副本的两个频道并启动路由续期。 */
  async start(): Promise<void> {
    await this.backend.subscribe(deviceCallChannel(this.replicaId), (payload) => {
      void this.handleForwardedCall(payload)
    })
    await this.backend.subscribe(deviceReplyChannel(this.replicaId), (payload) => {
      this.handleReply(payload)
    })
    // 续期周期取 TTL 的 1/3:一次抖动丢包不会让条目过期。
    const renewMs = Math.max(1_000, Math.floor((this.ttlSec * 1000) / 3))
    this.renewTimer = setInterval(() => {
      void this.renewOwned()
    }, renewMs)
    this.renewTimer.unref?.()
  }

  /** 本副本接受了某设备的连接:声明所有权。 */
  async claim(deviceId: string): Promise<void> {
    this.owned.add(deviceId)
    await this.backend.setRoute(deviceId, this.replicaId, this.ttlSec)
  }

  /** 本副本失去某设备的连接:释放所有权。 */
  async release(deviceId: string): Promise<void> {
    this.owned.delete(deviceId)
    await this.backend.clearRoute(deviceId, this.replicaId)
  }

  /** 某设备当前是否在**任一**副本上在线(reclaim 判定用,不能只看本副本)。 */
  async isOnlineAnywhere(deviceId: string): Promise<boolean> {
    return (await this.backend.lookupRoute(deviceId)) !== null
  }

  /**
   * 把调用转发给持有该设备的副本并等结果。
   * 无人持有 → null(调用方按 deviceOffline 处理)。
   */
  async forward(deviceId: string, req: DeviceInvokeRequest): Promise<DeviceCallResult | null> {
    const owner = await this.backend.lookupRoute(deviceId)
    if (owner === null) return null
    // 路由指向自己却走到这里 = 本地连接刚断但条目未过期,按离线处理。
    if (owner === this.replicaId) return null
    const correlationId = `${this.replicaId}:${deviceId}:${++DeviceRouter.seq}`
    const call: DeviceForwardCall = {
      correlationId,
      deviceId,
      replyTo: this.replicaId,
      req,
    }
    return await new Promise<DeviceCallResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId)
        // 持有者副本可能已崩溃;超时按离线返回,而不是永久挂起 HTTP 请求。
        resolve({ ok: false, error: new TBError('unavailable', '设备调用转发超时').toJSON() })
      }, this.opts.forwardTimeoutMs ?? DEVICE_FORWARD_TIMEOUT_MS)
      timer.unref?.()
      this.pending.set(correlationId, { resolve, timer })
      void this.backend
        .publish(deviceCallChannel(owner), JSON.stringify(call))
        .catch(() => {
          const waiter = this.pending.get(correlationId)
          if (waiter === undefined) return
          this.pending.delete(correlationId)
          clearTimeout(waiter.timer)
          waiter.resolve({
            ok: false,
            error: new TBError('unavailable', '设备调用转发失败').toJSON(),
          })
        })
    })
  }

  async close(): Promise<void> {
    if (this.renewTimer !== undefined) clearInterval(this.renewTimer)
    this.renewTimer = undefined
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer)
      waiter.resolve({ ok: false, error: new TBError('unavailable', '网关正在关闭').toJSON() })
    }
    this.pending.clear()
    await Promise.all([...this.owned].map(async id => await this.release(id)))
    await this.backend.close()
  }

  /** correlationId 的进程内序号(与 replicaId 组合后全局唯一)。 */
  private static seq = 0

  private async renewOwned(): Promise<void> {
    for (const deviceId of this.owned) {
      try {
        await this.backend.setRoute(deviceId, this.replicaId, this.ttlSec)
      } catch {
        // 续期失败下一轮再试;条目过期最坏表现是该设备被判离线。
      }
    }
  }

  /** 作为持有者:执行本地调用并回执。 */
  private async handleForwardedCall(payload: string): Promise<void> {
    let call: DeviceForwardCall
    try {
      call = JSON.parse(payload) as DeviceForwardCall
    } catch {
      return
    }
    if (typeof call?.correlationId !== 'string' || typeof call?.replyTo !== 'string') return
    let result: DeviceCallResult
    try {
      result = await this.opts.onLocalCall(call.deviceId, call.req)
    } catch {
      result = { ok: false, error: new TBError('internal', '设备调用执行失败').toJSON() }
    }
    const reply: DeviceForwardReply = { correlationId: call.correlationId, result }
    await this.backend
      .publish(deviceReplyChannel(call.replyTo), JSON.stringify(reply))
      .catch(() => {
        // 回执发不出去,发起方会走超时兜底。
      })
  }

  /** 作为发起方:收到回执,唤醒等待者。 */
  private handleReply(payload: string): void {
    let reply: DeviceForwardReply
    try {
      reply = JSON.parse(payload) as DeviceForwardReply
    } catch {
      return
    }
    const waiter = this.pending.get(reply?.correlationId)
    if (waiter === undefined) return
    this.pending.delete(reply.correlationId)
    clearTimeout(waiter.timer)
    waiter.resolve(reply.result)
  }
}
