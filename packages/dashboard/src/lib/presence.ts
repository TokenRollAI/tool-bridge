/**
 * device presence 的三态派生:实现来自 SDK /client(真源 core `device/presence.ts`,
 * 此前 dashboard 手抄一份镜像靠注释同步,现在同一实现)。
 *
 * 两个数据源要分清:
 * - `~tree`(TreeJson)已由宿主投影好 `presence`,直接读 `presence.state`,**不要**在这里重算。
 * - `system/registry`(RegistryNode)是存储态,只有裸 `online` + `lastSeenAt`,要三态就过这里。
 *
 * 浏览器时钟对比服务端 `lastSeenAt` 存在时钟漂移;判据只用于**展示**(把"看似 online
 * 实则久无心跳"标为 stale),不作为任何操作的前置条件。
 */
export { derivePresence, PRESENCE_STALE_AFTER_MS } from '@tool-bridge/sdk/client'

import type { PresenceState } from './types'

/** 人类可读的状态文案(与 CLI / ~help 的 state 字面量一致,不做本地化以便和日志对照)。 */
export const PRESENCE_LABEL: Record<PresenceState, string> = {
  offline: 'offline',
  online: 'online',
  stale: 'stale',
}

/** presence 状态的中文说明(仅用于 title / 辅助文案)。 */
export const PRESENCE_HINT: Record<PresenceState, string> = {
  offline: '连接已拆除；实时调用会失败，支持 Mailbox 的命令仍可入队',
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
