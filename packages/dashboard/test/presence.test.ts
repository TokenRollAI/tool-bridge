import { describe, expect, it } from 'vitest'
import type { TreeJson } from '../src/lib/types'
import {
  derivePresence,
  isTreeVisiblePresence,
  PRESENCE_STALE_AFTER_MS,
  pruneOfflineNodes,
} from '../src/lib/presence'

/**
 * presence 三态的客户端派生与树剪枝。
 *
 * 为什么值得测:wire 从裸 `online: boolean` 换成 `presence: { state }` 后,旧判据
 * `node.online !== false` 在新形状下**恒真且不报类型错**(字段直接不存在),会静默把已离线
 * 设备放回导航树。这类"改对了字段名但语义反了"的回归只有断言能拦住。
 *
 * 数据源边界也在这里钉住:`~tree` 已投影好 presence(测 prune),`system/registry` 是存储态
 * 需自行 derive(测 derivePresence),两者不可互换。
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

describe('isTreeVisiblePresence（导航树可见性）', () => {
  it('只剪 offline：stale 留在树上，非 device 节点（无 presence）一律保留', () => {
    expect([
      isTreeVisiblePresence({ state: 'online' }),
      isTreeVisiblePresence({ state: 'stale' }),
      isTreeVisiblePresence({ state: 'offline' }),
      isTreeVisiblePresence(undefined),
    ]).toEqual([true, true, false, true])
  })
})

describe('pruneOfflineNodes（~tree 投影后的剪枝）', () => {
  const tree: TreeJson[] = [
    { path: 'docs', kind: 'directory', description: '' },
    {
      path: 'devices',
      kind: 'directory',
      description: '',
      children: [
        { path: 'devices/a', kind: 'directory', description: '', presence: { state: 'online' } },
        { path: 'devices/b', kind: 'directory', description: '', presence: { state: 'stale' } },
        { path: 'devices/c', kind: 'directory', description: '', presence: { state: 'offline' } },
      ],
    },
  ]

  it('递归剪掉 offline 设备，保留 online / stale 与无 presence 的节点', () => {
    const kept = pruneOfflineNodes(tree)
    expect(kept.map(n => n.path)).toEqual(['docs', 'devices'])
    expect(kept[1]?.children?.map(n => n.path)).toEqual(['devices/a', 'devices/b'])
  })

  it('不改动入参（树数据来自 query cache，就地改会污染共享缓存）', () => {
    const before = JSON.stringify(tree)
    pruneOfflineNodes(tree)
    expect(JSON.stringify(tree)).toBe(before)
  })
})
