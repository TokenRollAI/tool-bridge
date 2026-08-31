import { MemoryStateStore, TBError } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { processDeviceHello, runBootstrap } from '../src/index'
import { TEST_ADMIN_SK } from './fixtures'

/**
 * 存储路径小写折叠意味着同一 hello 里 'Foo' 与 'foo' 落到同一节点键——不设门则
 * 后写者静默胜出。nodesForHello 对**折叠前**的原始拼接路径做 assertNoCollision:
 * 冲突(含自定义节点撞内置 shell/fs)→ invalid_argument 且整个 hello 不落库。
 */

async function seededStore(): Promise<MemoryStateStore> {
  const store = new MemoryStateStore()
  await runBootstrap(store, { adminSk: TEST_ADMIN_SK })
  return store
}

const node = (path: string) => ({ path, kind: 'tool' as const, description: `node ${path}` })

async function helloWith(
  store: MemoryStateStore,
  expose: Parameters<typeof processDeviceHello>[0]['hello']['expose'],
): ReturnType<typeof processDeviceHello> {
  return await processDeviceHello({
    store,
    authorization: `Bearer ${TEST_ADMIN_SK}`,
    deviceIdHint: 'phone',
    hello: { deviceId: 'phone', expose },
  })
}

describe('processDeviceHello × 小写折叠冲突', () => {
  it('expose.nodes 大小写折叠冲突 → invalid_argument,任何节点都不落库', async () => {
    const store = await seededStore()
    await expect(helloWith(store, { nodes: [node('Foo'), node('foo')] })).rejects.toSatisfy(
      err => err instanceof TBError && err.code === 'invalid_argument',
    )
    expect(await store.get('node:device/phone')).toBeNull()
    expect(await store.get('node:device/phone/foo')).toBeNull()
  })

  it('自定义节点与内置 shell 折叠冲突同样拒绝', async () => {
    const store = await seededStore()
    const attempt = helloWith(store, {
      shell: { description: 'shell' },
      nodes: [node('Shell')],
    })
    await expect(attempt).rejects.toSatisfy(
      err => err instanceof TBError && err.code === 'invalid_argument',
    )
    expect(await store.get('node:device/phone/shell')).toBeNull()
  })

  it('无冲突的大小写路径照常折叠挂载到小写节点', async () => {
    const store = await seededStore()
    const acceptance = await helloWith(store, {
      shell: { description: 'shell' },
      nodes: [node('Camera')],
    })
    expect(acceptance.mountPath).toBe('device/phone')
    expect(await store.get('node:device/phone/camera')).not.toBeNull()
    expect(await store.get('node:device/phone/shell')).not.toBeNull()
  })
})
