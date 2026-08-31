import { describe, expect, it } from 'vitest'
import {
  derivePresence,
  PRESENCE_HINT,
  PRESENCE_LABEL,
  PRESENCE_STALE_AFTER_MS,
  PRESENCE_TONE,
} from '../src/lib/presence'

/**
 * presence 派生的语义真源与全量测试在 core(经 SDK /client re-export,dashboard 不再
 * 手抄镜像)。此处只保留:① re-export 冒烟(调用形态与 core 契约一致——now 是 ISO
 * string 且必填);② dashboard 专属的三态 UI 常量表完整性(LABEL/HINT/TONE)。
 */

const NOW = '2026-08-19T12:00:00.000Z'
const iso = (offsetMs: number) => new Date(Date.parse(NOW) - offsetMs).toISOString()

describe('presence(SDK re-export 冒烟 + UI 常量表)', () => {
  it('derivePresence 经 SDK 可用:online/stale/offline 三态', () => {
    expect(derivePresence({ online: true, lastSeenAt: iso(1_000), now: NOW }).state).toBe('online')
    expect(
      derivePresence({
        online: true,
        lastSeenAt: iso(PRESENCE_STALE_AFTER_MS + 1),
        now: NOW,
      }).state,
    ).toBe('stale')
    expect(derivePresence({ online: false, lastSeenAt: iso(600_000), now: NOW })).toEqual({
      state: 'offline',
      lastSeenAt: iso(600_000),
    })
  })

  it('UI 常量表对三态各有完整映射(徽标/说明/色 token 不漂移)', () => {
    for (const state of ['offline', 'online', 'stale'] as const) {
      expect(PRESENCE_LABEL[state]).toBeTruthy()
      expect(PRESENCE_HINT[state]).toBeTruthy()
      expect(PRESENCE_TONE[state]).toBeTruthy()
    }
  })
})
