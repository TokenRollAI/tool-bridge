import { describe, expect, it, vi } from 'vitest'
import { memoizeRequestFactory } from '../src/app'

describe('memoizeRequestFactory', () => {
  it('同一请求内并发与后续读取只执行一次对象工厂', async () => {
    const factory = vi.fn(async () => ({ id: 'store' }))
    const memoized = memoizeRequestFactory(factory)

    const [first, second] = await Promise.all([memoized(), memoized()])
    const third = await memoized()

    expect(first).toBe(second)
    expect(second).toBe(third)
    expect(factory).toHaveBeenCalledOnce()
  })

  it('失败也在该请求内稳定复用，不重复读取并解密 secret', async () => {
    const factory = vi.fn(async () => {
      throw new Error('secret decrypt failed')
    })
    const memoized = memoizeRequestFactory(factory)

    await expect(memoized()).rejects.toThrow('secret decrypt failed')
    await expect(memoized()).rejects.toThrow('secret decrypt failed')
    expect(factory).toHaveBeenCalledOnce()
  })
})
