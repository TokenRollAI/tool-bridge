import type { ObjectBodyStream } from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import { toWebObjectBodyStream } from '../src/objectBodyStream'

describe('toWebObjectBodyStream', () => {
  it('逐块桥接并在 EOF 只释放一次 reader', async () => {
    const releaseLock = vi.fn()
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3])]
    const source: ObjectBodyStream = {
      getReader: () => ({
        read: vi.fn(async () => chunks.length === 0
          ? { done: true }
          : { done: false, value: chunks.shift()! }),
        releaseLock,
      }),
    }

    const response = new Response(toWebObjectBodyStream(source, { highWaterMark: 0 }))
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3])
    expect(releaseLock).toHaveBeenCalledTimes(1)
  })

  it('consumer cancel 传播到 reader 并释放一次', async () => {
    const cancel = vi.fn(async () => {})
    const releaseLock = vi.fn()
    const source: ObjectBodyStream = {
      getReader: () => ({
        cancel,
        read: async () => await new Promise(() => {}),
        releaseLock,
      }),
    }
    const reader = toWebObjectBodyStream(source).getReader()

    await reader.cancel('stop')

    expect(cancel).toHaveBeenCalledWith('stop')
    expect(releaseLock).toHaveBeenCalledTimes(1)
  })
})
