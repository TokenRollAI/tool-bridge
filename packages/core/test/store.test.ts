import { describe, expect, it } from 'vitest'
import { MemoryStateStore } from '../src/store'

describe('MemoryStateStore.compareAndSwap', () => {
  it('absent create、revision update 与 revision delete 都是条件操作', async () => {
    const store = new MemoryStateStore()
    expect(await store.compareAndSwap('k', null, { revision: 1, value: 'a' })).toBe(true)
    expect(await store.compareAndSwap('k', null, { revision: 1, value: 'b' })).toBe(false)
    expect(await store.compareAndSwap('k', 0, { revision: 1, value: 'b' })).toBe(false)
    expect(await store.compareAndSwap('k', 1, { revision: 2, value: 'b' })).toBe(true)
    expect(await store.compareAndSwap('k', 1, null)).toBe(false)
    expect(await store.compareAndSwap('k', 2, null)).toBe(true)
    expect(await store.get('k')).toBeNull()
  })

  it('不把无 revision 的普通 StateStore 值误当成 CAS record', async () => {
    const store = new MemoryStateStore()
    await store.put('plain', { value: 1 })
    expect(await store.compareAndSwap('plain', 0, { revision: 1 })).toBe(false)
    expect(await store.get('plain')).toEqual({ value: 1 })
  })
})
