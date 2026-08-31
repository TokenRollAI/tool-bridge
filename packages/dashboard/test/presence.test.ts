import { describe, expect, it } from 'vitest'
import {
  derivePresence,
  PRESENCE_STALE_AFTER_MS,
} from '../src/lib/presence'

/**
 * presence 三态的客户端派生。
 *
 * 数据源边界:`~tree` 已投影好 presence；`system/registry` 是存储态，需自行 derive，
 * 两者不可互换。画布保留 offline 设备，以便 Mailbox 命令仍可发现和入队。
 */

const NOW = Date.parse('2026-08-19T12:00:00.000Z')
const iso = (offsetMs: number) => new Date(NOW - offsetMs).toISOString()

describe('derivePresence（registry 存储态 → 三态）', () => {
  it('online 位为假 → offline，且保留 lastSeenAt 供展示“最后在线于”', () => {
    expect(derivePresence({ online: false, lastSeenAt: iso(600_000), now: NOW })).toEqual({
      state: 'offline',
      lastSeenAt: iso(600_000),
    })
  })

  it('online 缺省（非 device 节点）→ offline，且不凭空造 lastSeenAt', () => {
    expect(derivePresence({ now: NOW })).toEqual({ state: 'offline' })
  })

  it('online 为真且 lastSeenAt 在 TTL 内 → online', () => {
    expect(derivePresence({ online: true, lastSeenAt: iso(1_000), now: NOW }).state).toBe('online')
  })

  it('TTL 边界取闭区间：恰好等于 TTL 仍算 online', () => {
    const at = derivePresence({
      online: true,
      lastSeenAt: iso(PRESENCE_STALE_AFTER_MS),
      now: NOW,
    })
    const past = derivePresence({
      online: true,
      lastSeenAt: iso(PRESENCE_STALE_AFTER_MS + 1),
      now: NOW,
    })
    expect([at.state, past.state]).toEqual(['online', 'stale'])
  })

  it('online 为真但无 lastSeenAt（旧数据）→ 保守判 stale，不谎报在线', () => {
    expect(derivePresence({ online: true, now: NOW })).toEqual({ state: 'stale' })
  })

  it('lastSeenAt 不可解析 → stale，而不是当成新鲜', () => {
    expect(derivePresence({ online: true, lastSeenAt: 'not-a-date', now: NOW }).state).toBe('stale')
  })

  it('online 位停在 true 但久无心跳 → stale：本次改动要解决的谎报场景', () => {
    expect(derivePresence({ online: true, lastSeenAt: iso(3_600_000), now: NOW }).state)
      .toBe('stale')
  })

  it('省略 now 时回落到本机时钟（浏览器实际调用形态）', () => {
    expect(derivePresence({ online: true, lastSeenAt: new Date().toISOString() }).state)
      .toBe('online')
  })
})
