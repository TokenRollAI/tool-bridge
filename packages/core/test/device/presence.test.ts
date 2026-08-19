import { describe, expect, it } from 'vitest'
import { derivePresence, PRESENCE_STALE_AFTER_MS } from '../../src/device/presence'

const NOW = '2026-08-19T12:00:00.000Z'
const nowMs = Date.parse(NOW)
const iso = (offsetMs: number): string => new Date(nowMs + offsetMs).toISOString()

describe('derivePresence(三态派生)', () => {
  it('online 位为假 → offline;lastSeenAt 仍带出用于展示', () => {
    expect(derivePresence({ online: false, lastSeenAt: iso(-5_000), now: NOW })).toEqual({
      state: 'offline',
      lastSeenAt: iso(-5_000),
    })
    expect(derivePresence({ online: undefined, now: NOW })).toEqual({ state: 'offline' })
  })

  it('online 且心跳在 TTL 内 → online', () => {
    expect(derivePresence({ online: true, lastSeenAt: iso(-1_000), now: NOW })).toEqual({
      state: 'online',
      lastSeenAt: iso(-1_000),
    })
  })

  it('online 但心跳超过 TTL → stale(不谎报 online)', () => {
    const stale = derivePresence({
      online: true,
      lastSeenAt: iso(-(PRESENCE_STALE_AFTER_MS + 1_000)),
      now: NOW,
    })
    expect(stale.state).toBe('stale')
  })

  it('TTL 边界:恰好等于 TTL 仍算 online,超过 1ms 即 stale', () => {
    expect(derivePresence({ online: true, lastSeenAt: iso(-PRESENCE_STALE_AFTER_MS), now: NOW }).state)
      .toBe('online')
    expect(
      derivePresence({ online: true, lastSeenAt: iso(-(PRESENCE_STALE_AFTER_MS + 1)), now: NOW }).state,
    ).toBe('stale')
  })

  it('online 但无 lastSeenAt → 保守判 stale(无法证明新鲜)', () => {
    expect(derivePresence({ online: true, now: NOW })).toEqual({ state: 'stale' })
  })

  it('lastSeenAt 或 now 无法解析 → 保守判 stale', () => {
    expect(derivePresence({ online: true, lastSeenAt: 'not-a-date', now: NOW }).state).toBe('stale')
    expect(derivePresence({ online: true, lastSeenAt: iso(-1_000), now: 'not-a-date' }).state)
      .toBe('stale')
  })

  it('staleAfterMs 可覆盖默认 TTL', () => {
    const input = { online: true, lastSeenAt: iso(-10_000), now: NOW }
    expect(derivePresence({ ...input, staleAfterMs: 5_000 }).state).toBe('stale')
    expect(derivePresence({ ...input, staleAfterMs: 20_000 }).state).toBe('online')
  })
})
