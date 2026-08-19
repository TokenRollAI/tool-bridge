/**
 * device presence 的客户端派生(镜像 core 的 `device/presence.ts`,dashboard 不 import core)。
 *
 * 两个数据源要分清:
 * - `~tree`(TreeJson)已由宿主投影好 `presence`,直接读 `presence.state`,**不要**在这里重算。
 * - `system/registry`(RegistryNode)是存储态,只有裸 `online` + `lastSeenAt`,要三态就过这里。
 *
 * 这里用浏览器时钟对比服务端 `lastSeenAt`,存在时钟漂移;因此 TTL 与 core 保持一致而不收紧,
 * 且判据只用于**展示**(把"看似 online 实则久无心跳"标为 stale),不作为任何操作的前置条件。
 */

import type { Presence, PresenceState, TreeJson } from './types'

/**
 * 存活观察 TTL,与 core 的 `PRESENCE_STALE_AFTER_MS` 对齐(设备心跳 30s 的 3 倍)。
 * 改动要同轮跟随 core,否则同一台设备在 ~tree 与设备页显示不同状态。
 */
export const PRESENCE_STALE_AFTER_MS = 90_000

/**
 * 由存储态(online + lastSeenAt)派生三态 presence。语义与 core 的 `derivePresence` 一致:
 * online 非真 → offline(仍带出 lastSeenAt 供展示"最后在线于");online 为真但无法证明新鲜
 * (缺 lastSeenAt / 不可解析 / 超 TTL)→ stale。
 */
export function derivePresence(input: {
  lastSeenAt?: string
  now?: number
  online?: boolean
  staleAfterMs?: number
}): Presence {
  const lastSeenAt = input.lastSeenAt
  const base = lastSeenAt !== undefined ? { lastSeenAt } : {}
  if (input.online !== true) return { state: 'offline', ...base }
  if (lastSeenAt === undefined) return { state: 'stale', ...base }
  const seenMs = Date.parse(lastSeenAt)
  const nowMs = input.now ?? Date.now()
  if (!Number.isFinite(seenMs)) return { state: 'stale', ...base }
  const ttl = input.staleAfterMs ?? PRESENCE_STALE_AFTER_MS
  return { state: nowMs - seenMs <= ttl ? 'online' : 'stale', ...base }
}

/** 人类可读的状态文案(与 CLI / ~help 的 state 字面量一致,不做本地化以便和日志对照)。 */
export const PRESENCE_LABEL: Record<PresenceState, string> = {
  offline: 'offline',
  online: 'online',
  stale: 'stale',
}

/** presence 状态的中文说明(仅用于 title / 辅助文案)。 */
export const PRESENCE_HINT: Record<PresenceState, string> = {
  offline: '连接已拆除，调用会返回可重试的 503',
  online: '连接活跃且近期有心跳',
  stale: '连接位仍为真，但已久无心跳；很可能不可路由',
}

/**
 * presence 三态的边框/底色/字色 token。放在 lib 而非组件文件里,是因为 stale 的琥珀在
 * 徽标、图标框和统计卡三处都要一致 —— 分散写会漂移。
 *
 * stale 走 warn 色相:它和 offline 的处置完全不同(offline 是"确认已拆除、等重连",
 * stale 是"树上还在但很可能打不通"),不能共用同一片灰。
 */
export const PRESENCE_TONE: Record<PresenceState, string> = {
  offline: 'bg-muted/20 text-muted-foreground',
  online: 'border-ok/35 bg-ok/[0.045] text-ok',
  stale: 'border-warn/35 bg-warn/[0.05] text-warn',
}

/**
 * 节点是否进导航树。抽成纯函数是因为三态化后这条判据最容易写错:
 * 旧版 `online !== false` 在 `presence` 下会恒真(字段名都变了),把已离线设备放回树上。
 *
 * 只剪 `offline`(确认已拆除连接)。`stale` 保留 —— 连接位仍为真、可能只是心跳丢了几拍,
 * 剪掉会让用户在"设备还在但树上消失"时无从下手;行内用琥珀点提示即可。
 * 非 device 节点没有 presence,一律保留。
 */
export function isTreeVisiblePresence(presence: Presence | undefined): boolean {
  return presence?.state !== 'offline'
}

/**
 * 递归剪掉 `~tree` 里 presence 为 offline 的子树(设备管理页仍可见全部)。
 * 放在 lib 而非组件里,因为递归 + 三态判据是本次改动的回归风险点,要能被 node 测试直接断言。
 */
export function pruneOfflineNodes(nodes: TreeJson[]): TreeJson[] {
  return nodes
    .filter(node => isTreeVisiblePresence(node.presence))
    .map(node =>
      node.children ? { ...node, children: pruneOfflineNodes(node.children) } : node,
    )
}
