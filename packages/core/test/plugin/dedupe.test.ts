import { describe, expect, it } from 'vitest'
import { RequestDedupe } from '../../src/plugin/dedupe'

/** 手动 resolve 的 deferred,用于并发合并断言。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('同 id 重放(重试时 Request-Id 不变,以此去重实现幂等)', () => {
  it('第二次执行同 id 返回首次结果,executor 只跑一次', async () => {
    const dedupe = new RequestDedupe()
    let runs = 0
    const exec = async () => {
      runs++
      return `result-${runs}`
    }
    expect(await dedupe.run('id-1', exec)).toBe('result-1')
    expect(await dedupe.run('id-1', exec)).toBe('result-1')
    expect(runs).toBe(1)
  })

  it('不同 id 各自独立执行', async () => {
    const dedupe = new RequestDedupe()
    let runs = 0
    const exec = async () => ++runs
    expect(await dedupe.run('a', exec)).toBe(1)
    expect(await dedupe.run('b', exec)).toBe(2)
    expect(runs).toBe(2)
  })

  it('首次执行抛错:错误也按首次结果重放(重试同 id 不再执行)', async () => {
    const dedupe = new RequestDedupe()
    let runs = 0
    const exec = async () => {
      runs++
      throw new Error('boom')
    }
    await expect(dedupe.run('id-e', exec)).rejects.toThrow('boom')
    await expect(dedupe.run('id-e', exec)).rejects.toThrow('boom')
    expect(runs).toBe(1)
  })
})

describe('in-flight 合并(同 id 并发只执行一次)', () => {
  it('执行未完成时的并发同 id 调用共享同一结果', async () => {
    const dedupe = new RequestDedupe()
    const gate = deferred<string>()
    let runs = 0
    const exec = () => {
      runs++
      return gate.promise
    }
    const p1 = dedupe.run('id-c', exec)
    const p2 = dedupe.run('id-c', exec)
    gate.resolve('first')
    expect(await p1).toBe('first')
    expect(await p2).toBe('first')
    expect(runs).toBe(1)
  })

  it('并发同 id 且首次失败:两个调用者都拿到同一错误', async () => {
    const dedupe = new RequestDedupe()
    const gate = deferred<never>()
    let runs = 0
    const exec = () => {
      runs++
      return gate.promise
    }
    const p1 = dedupe.run('id-f', exec)
    const p2 = dedupe.run('id-f', exec)
    gate.reject(new Error('down'))
    await expect(p1).rejects.toThrow('down')
    await expect(p2).rejects.toThrow('down')
    expect(runs).toBe(1)
  })
})

describe('有界缓存(缺省 1000;超限逐最旧)', () => {
  it('超过 maxEntries 时最旧的 id 被逐出,重放会重新执行', async () => {
    const dedupe = new RequestDedupe({ maxEntries: 2 })
    const runsById = new Map<string, number>()
    const exec = (id: string) => async () => {
      runsById.set(id, (runsById.get(id) ?? 0) + 1)
      return id
    }
    await dedupe.run('a', exec('a'))
    await dedupe.run('b', exec('b'))
    await dedupe.run('c', exec('c')) // 'a' 被逐出
    await dedupe.run('a', exec('a')) // 重新执行
    expect(runsById.get('a')).toBe(2)
    // 'c' 仍在缓存(重放不执行)
    await dedupe.run('c', exec('c'))
    expect(runsById.get('c')).toBe(1)
  })

  it('缺省上限 1000', async () => {
    const dedupe = new RequestDedupe()
    let firstRuns = 0
    await dedupe.run('first', async () => ++firstRuns)
    for (let i = 0; i < 1000; i++) {
      await dedupe.run(`filler-${i}`, async () => i)
    }
    // 'first' 已被逐出 → 再跑一次
    await dedupe.run('first', async () => ++firstRuns)
    expect(firstRuns).toBe(2)
  })

  it('in-flight 条目不因逐出丢失合并语义(逐出只作用于已完成结果)', async () => {
    const dedupe = new RequestDedupe({ maxEntries: 1 })
    const gate = deferred<string>()
    let runs = 0
    const p1 = dedupe.run('slow', () => {
      runs++
      return gate.promise
    })
    await dedupe.run('other', async () => 'x') // 触发容量压力
    const p2 = dedupe.run('slow', () => {
      runs++
      return gate.promise
    })
    gate.resolve('done')
    expect(await p1).toBe('done')
    expect(await p2).toBe('done')
    expect(runs).toBe(1)
  })
})
