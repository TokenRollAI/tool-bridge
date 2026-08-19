/**
 * 设备在线状态(presence)的新鲜度派生。
 *
 * 背景:注册表里的 `online` 只是"连接建立/拆除"的事件位,不是"此刻可路由"的租约。
 * 移动端进程被杀、TCP 半开、DO 被 evict 时,拆除事件可能永不到达写入点,`online` 会永久
 * 停在 true——于是 `~tree` 报 online 而调用返回 device offline。为不再谎报,投影时用最近一次
 * 存活观察(`lastSeenAt`,由 hello / 心跳 / 成功调用喂入)结合 TTL 把过期的 online 降级为 stale。
 *
 * 纯函数、无副作用:读路径(~tree / ~help / device ls)只做投影期降级,绝不回写权威状态。
 */

import type { Timestamp } from '../types'

/**
 * 三态:
 * - `online`:连接位为真且最近有存活观察,可尝试路由。
 * - `stale`:连接位仍为真但存活观察已超时——很可能已不可路由,调用方应预期失败或先重连。
 * - `offline`:连接位为假(已观察到拆除)。
 */
export type PresenceState = 'online' | 'stale' | 'offline'

/** wire 上的 presence 形状:取代裸 `online` 布尔,进入 ~tree / ~help / device ls / dashboard。 */
export interface Presence {
  /** 最近一次观察到设备存活的时刻;缺省表示从未观察(旧连接或旧数据)。 */
  lastSeenAt?: Timestamp
  state: PresenceState
}

/**
 * 存活观察 TTL:超过它仍未刷新 `lastSeenAt` 即降级 stale。
 * 取设备心跳间隔(sdk DEVICE_HEARTBEAT_INTERVAL_MS = 30s)的 3 倍,容忍两次丢包/一次网络抖动,
 * 又能在进程被杀后 ~90s 内把树上的 online 翻成 stale。宿主可在投影处覆盖。
 */
export const PRESENCE_STALE_AFTER_MS = 90_000

export interface DerivePresenceInput {
  lastSeenAt?: Timestamp
  /** 当前时刻(ISO string);由调用方传入,便于测试与保持纯函数。 */
  now: Timestamp
  online?: boolean
  /** 覆盖默认 TTL(毫秒)。 */
  staleAfterMs?: number
}

/**
 * 由存储态(online + lastSeenAt)派生 wire presence。
 *
 * - `online` 非真 → offline(lastSeenAt 仍带出,便于展示"最后在线于")。
 * - `online` 为真但无 lastSeenAt,或 lastSeenAt 无法解析 → 保守判 stale(无法证明新鲜)。
 * - `online` 为真且 lastSeenAt 在 TTL 内 → online;否则 stale。
 */
export function derivePresence(input: DerivePresenceInput): Presence {
  const lastSeenAt = input.lastSeenAt
  const base = lastSeenAt !== undefined ? { lastSeenAt } : {}
  if (input.online !== true) {
    return { state: 'offline', ...base }
  }
  if (lastSeenAt === undefined) {
    return { state: 'stale', ...base }
  }
  const seenMs = Date.parse(lastSeenAt)
  const nowMs = Date.parse(input.now)
  if (!Number.isFinite(seenMs) || !Number.isFinite(nowMs)) {
    return { state: 'stale', ...base }
  }
  const ttl = input.staleAfterMs ?? PRESENCE_STALE_AFTER_MS
  return { state: nowMs - seenMs <= ttl ? 'online' : 'stale', ...base }
}
