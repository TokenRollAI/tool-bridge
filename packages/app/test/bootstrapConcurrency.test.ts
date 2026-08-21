/**
 * 并发引导去重(多 Pod / 多 isolate 同时冷启动):同一 TB_BOOTSTRAP_ADMIN_SK 下,
 * 并发 runBootstrap 只留下**一条** sk:i:<id> 管理面索引 —— putIfAbsent 输者不再写
 * 自己的索引。无该原语的后端(Workers KV)回退 get-miss→put,窗口仍在但 hash key
 * 同值幂等,此处只测原子路径与顺序重跑幂等。
 */

import { KEY_BOOTSTRAPPED, KEY_SK_HASH, KEY_SK_ID, MemoryStateStore } from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runBootstrap } from '../src/bootstrap'

const ADMIN_SK = 'tbk_bootstrap_concurrency_test_0'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('并发引导去重', () => {
  it('并发 runBootstrap:sk:h 与 sk:i 各恰一条,幂等标志置位', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const store = new MemoryStateStore()
    await Promise.all(
      Array.from({ length: 8 }, () => runBootstrap(store, { adminSk: ADMIN_SK })),
    )
    expect((await store.list(KEY_SK_HASH)).items).toHaveLength(1)
    expect((await store.list(KEY_SK_ID)).items).toHaveLength(1)
    expect(await store.get(KEY_BOOTSTRAPPED)).toBe(true)
  })

  it('已引导实例重跑:不再铸造,索引不增', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const store = new MemoryStateStore()
    await runBootstrap(store, { adminSk: ADMIN_SK })
    const before = (await store.list(KEY_SK_ID)).items
    await runBootstrap(store, { adminSk: ADMIN_SK })
    expect((await store.list(KEY_SK_ID)).items).toEqual(before)
  })
})
