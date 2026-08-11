import { beforeEach, describe, expect, it } from 'vitest'
import {
  FEEDBACK_DETAIL_MAX,
  FEEDBACK_HELP_LIMIT,
  FEEDBACK_PER_OWNER_MAX,
  FEEDBACK_SEARCH_TEXT_BYTES_MAX,
  FEEDBACK_TITLE_MAX,
  type FeedbackEntry,
  FeedbackStore,
  selectFeedbackSearchText,
  selectHelpItems,
  sortFeedback,
} from '../../src/feedback/store'
import { MemoryStateStore } from '../../src/store'
import { isTBError } from '../../src/errors'

declare const TextEncoder: { new (): { encode(input: string): Uint8Array } }

const NOW = '2026-07-08T00:00:00.000Z'
const AGENT_A = 'agent:a'
const AGENT_B = 'agent:b'

async function codeOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (e) {
    return isTBError(e) ? e.code : 'not-tberror'
  }
}

function entry(partial: Partial<FeedbackEntry> & { id: string }): FeedbackEntry {
  return { title: 't', detail: 'd', by: AGENT_A, at: NOW, up: [], down: [], ...partial }
}

describe('排序与 ~help 选条(纯函数)', () => {
  it('score 降序,at 降序 tie-break(新的在前)', () => {
    const sorted = sortFeedback([
      entry({ id: 'old-zero', at: '2026-07-01T00:00:00.000Z' }),
      entry({ id: 'new-zero', at: '2026-07-07T00:00:00.000Z' }),
      entry({ id: 'liked', at: '2026-07-01T00:00:00.000Z', up: ['agent:x'] }),
    ])
    expect(sorted.map(e => e.id)).toEqual(['liked', 'new-zero', 'old-zero'])
  })

  it('净分 ≤ -3 从 ~help 选条隐藏;取前 5 条;输出 id/title/score', () => {
    const hidden = entry({ id: 'hidden', down: ['agent:1', 'agent:2', 'agent:3'] })
    const boundary = entry({ id: 'boundary', down: ['agent:1', 'agent:2'] }) // score -2 仍展示
    const rest = Array.from({ length: 6 }, (_, i) =>
      entry({ id: `fb_00000${i}`, up: [`agent:${i}`], at: `2026-07-0${i + 1}T00:00:00.000Z` }),
    )
    const items = selectHelpItems([hidden, boundary, ...rest])
    expect(items).toHaveLength(FEEDBACK_HELP_LIMIT)
    expect(items.map(e => e.id)).not.toContain('hidden')
    expect(items[0]).toEqual({ id: 'fb_000005', title: 't', score: 1 })
  })

  it('search 投影复用可见 top 5，并同时包含 title/detail', () => {
    const hidden = entry({
      id: 'hidden',
      title: 'hidden title',
      detail: 'hidden detail',
      down: ['agent:1', 'agent:2', 'agent:3'],
    })
    const visible = entry({ id: 'visible', title: 'use append', detail: 'mode is required' })
    expect(selectFeedbackSearchText([hidden, visible])).toBe('use append\nmode is required')
  })

  it('search 投影去控制字符并按 UTF-8 bytes 截断', () => {
    const projected = selectFeedbackSearchText([
      entry({ id: 'large', title: '\u0001'.repeat(80), detail: '日'.repeat(500) }),
    ])
    expect(projected).not.toContain('\u0001')
    expect(new TextEncoder().encode(projected).byteLength).toBeLessThanOrEqual(
      FEEDBACK_SEARCH_TEXT_BYTES_MAX,
    )
  })
})

describe('FeedbackStore', () => {
  let store: MemoryStateStore
  let fb: FeedbackStore

  beforeEach(() => {
    store = new MemoryStateStore()
    fb = new FeedbackStore(store)
  })

  it('submit → get 回读;id 形如 fb_ + 6 位;title/detail trim', async () => {
    const e = await fb.submit(
      'feishu',
      { title: ' mode 必填 ', detail: ' 传 append ' },
      AGENT_A,
      NOW,
    )
    expect(e.id).toMatch(/^fb_[a-z0-9]{6}$/)
    const got = await fb.get('feishu', e.id)
    expect(got.title).toBe('mode 必填')
    expect(got.detail).toBe('传 append')
    expect(got.by).toBe(AGENT_A)
  })

  it('title/detail 空或超长 → invalid_argument', async () => {
    expect(await codeOf(() => fb.submit('a', { title: ' ', detail: 'd' }, AGENT_A, NOW))).toBe(
      'invalid_argument',
    )
    expect(
      await codeOf(() =>
        fb.submit('a', { title: 'x'.repeat(FEEDBACK_TITLE_MAX + 1), detail: 'd' }, AGENT_A, NOW),
      ),
    ).toBe('invalid_argument')
    expect(
      await codeOf(() =>
        fb.submit('a', { title: 't', detail: 'x'.repeat(FEEDBACK_DETAIL_MAX + 1) }, AGENT_A, NOW),
      ),
    ).toBe('invalid_argument')
  })

  it('根路径/保留段路径不可提交', async () => {
    expect(await codeOf(() => fb.submit('', { title: 't', detail: 'd' }, AGENT_A, NOW))).toBe(
      'invalid_argument',
    )
    expect(
      await codeOf(() => fb.submit('a/~help', { title: 't', detail: 'd' }, AGENT_A, NOW)),
    ).toBe('invalid_argument')
  })

  it('每 (path, owner) 上限 → rate_limited;不影响他人与其它路径', async () => {
    for (let i = 0; i < FEEDBACK_PER_OWNER_MAX; i++) {
      await fb.submit('a', { title: `t${i}`, detail: 'd' }, AGENT_A, NOW)
    }
    expect(await codeOf(() => fb.submit('a', { title: 'over', detail: 'd' }, AGENT_A, NOW))).toBe(
      'rate_limited',
    )
    expect(
      await codeOf(() => fb.submit('a', { title: 'ok', detail: 'd' }, AGENT_B, NOW)),
    ).toBeNull()
    expect(
      await codeOf(() => fb.submit('b', { title: 'ok', detail: 'd' }, AGENT_A, NOW)),
    ).toBeNull()
  })

  it('vote 改票与撤票:每 owner 一票', async () => {
    const e = await fb.submit('a', { title: 't', detail: 'd' }, AGENT_A, NOW)
    let v = await fb.vote('a', e.id, AGENT_B, 'up')
    expect([v.up, v.down, v.score]).toEqual([1, 0, 1])
    v = await fb.vote('a', e.id, AGENT_B, 'up') // 重复投同向不叠加
    expect([v.up, v.down, v.score]).toEqual([1, 0, 1])
    v = await fb.vote('a', e.id, AGENT_B, 'down') // 改票
    expect([v.up, v.down, v.score]).toEqual([0, 1, -1])
    v = await fb.vote('a', e.id, AGENT_B, 'clear') // 撤票
    expect([v.up, v.down, v.score]).toEqual([0, 0, 0])
  })

  it('vote/get/remove 不存在的 id → not_found', async () => {
    await fb.submit('a', { title: 't', detail: 'd' }, AGENT_A, NOW)
    expect(await codeOf(() => fb.vote('a', 'fb_nope99', AGENT_B, 'up'))).toBe('not_found')
    expect(await codeOf(() => fb.get('a', 'fb_nope99'))).toBe('not_found')
    expect(await codeOf(() => fb.remove('a', 'fb_nope99'))).toBe('not_found')
  })

  it('listViews 含隐藏阈值以下条目且不含 detail;helpItems 过滤之', async () => {
    const bad = await fb.submit('a', { title: 'bad', detail: 'd' }, AGENT_A, NOW)
    await fb.submit('a', { title: 'good', detail: 'd' }, AGENT_B, NOW)
    for (const voter of ['agent:1', 'agent:2', 'agent:3']) {
      await fb.vote('a', bad.id, voter, 'down')
    }
    const views = await fb.listViews('a')
    expect(views.map(v => v.title)).toEqual(['good', 'bad'])
    expect(views[0]).not.toHaveProperty('detail')
    expect((await fb.helpItems('a')).map(i => i.title)).toEqual(['good'])
  })

  it('remove 删单条;删空后整 key 回收', async () => {
    const e1 = await fb.submit('a', { title: 't1', detail: 'd' }, AGENT_A, NOW)
    const e2 = await fb.submit('a', { title: 't2', detail: 'd' }, AGENT_A, NOW)
    await fb.remove('a', e1.id)
    expect((await fb.listFor('a')).map(e => e.id)).toEqual([e2.id])
    await fb.remove('a', e2.id)
    expect(await store.get('feedback:a')).toBeNull()
  })

  it('mutation listener receives the in-memory snapshot after submit/vote/remove', async () => {
    const snapshots: string[][] = []
    const watched = new FeedbackStore(store, async (_path, entries) => {
      snapshots.push(entries.map(item => `${item.title}:${item.up.length - item.down.length}`))
    })
    const created = await watched.submit('a', { title: 'probe', detail: 'detail' }, AGENT_A, NOW)
    await watched.vote('a', created.id, AGENT_B, 'up')
    await watched.remove('a', created.id)
    expect(snapshots).toEqual([['probe:0'], ['probe:1'], []])
  })

  it('脏值容错:非数组/坏条目 → 跳过', async () => {
    await store.put('feedback:a', { nope: true })
    expect(await fb.listFor('a')).toEqual([])
    await store.put('feedback:a', [{ id: 'fb_okokok', title: 't' }, { broken: 1 }, null])
    const entries = await fb.listFor('a')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'fb_okokok', up: [], down: [] })
  })
})
