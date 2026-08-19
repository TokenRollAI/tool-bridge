import {
  MemoryStateStore,
  NodeRegistryStore,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
} from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { processDeviceHello, runBootstrap } from '../src/index'
import { MemorySearchIndex } from './memorySearchIndex'
import { TEST_ADMIN_SK } from './fixtures'

/**
 * issue #72 缺陷 C:registry 超出工具搜索 canonical audit 容量时,新设备 hello 的
 * `rebuildAll` 保留 last-known-good、新节点静默不进索引。此前 hello 照常返回 ready、
 * 无任何信号。修复后 `processDeviceHello` 透出 `searchIndexed`,宿主据此告警。
 */

const HELLO = {
  deviceId: 'phone',
  expose: {
    nodes: [
      {
        path: 'attention',
        kind: 'tool' as const,
        description: 'phone attention',
        cmds: [{ name: 'ring', description: 'ring the phone (haptics / vibration / 震动)' }],
      },
    ],
  },
}

async function seededStore(): Promise<MemoryStateStore> {
  const store = new MemoryStateStore()
  await runBootstrap(store, { adminSk: TEST_ADMIN_SK })
  return store
}

describe('processDeviceHello × 搜索索引', () => {
  it('容量充足时 searchIndexed 为 true,且设备工具进入索引', async () => {
    const store = await seededStore()
    const search = new MemorySearchIndex()
    const acceptance = await processDeviceHello({
      store,
      authorization: `Bearer ${TEST_ADMIN_SK}`,
      deviceIdHint: 'phone',
      hello: HELLO,
      search,
    })
    expect(acceptance.searchIndexed).toBe(true)
    const page = await search.search('vibration')
    expect(page.items.map(item => item.path)).toContain('device/phone/attention')
  })

  it('registry 超出 canonical audit 容量时 searchIndexed 为 false(设备仍挂载)', async () => {
    const store = await seededStore()
    // 预置一个已 seed 的索引,再把 registry 撑过审计上限:rebuildAll 命中 truncated
    // 分支,保留 last-known-good、返回 false。
    const search = new MemorySearchIndex()
    await search.rebuild([{ path: 'legitimate/provider', tool: { name: 'legitimate' } }])
    for (let i = 0; i <= TOOL_SEARCH_AUDIT_NODE_LIMIT; i++) {
      const path = `filler/${i.toString().padStart(4, '0')}`
      await store.put(`node:${path}`, {
        path,
        kind: 'http',
        description: 'filler',
        config: {
          kind: 'http',
          endpoint: 'https://filler.test',
          tools: [{ name: 'probe', description: 'probe', method: 'GET', pathTemplate: '/p' }],
        },
        registeredBy: 'system:test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    }

    const acceptance = await processDeviceHello({
      store,
      authorization: `Bearer ${TEST_ADMIN_SK}`,
      deviceIdHint: 'phone',
      hello: HELLO,
      search,
    })
    // hello 不被阻断:设备节点已写入 canonical registry,可被调用。
    expect(acceptance.mountPath).toBe('device/phone')
    const node = await new NodeRegistryStore(store).get('device/phone/attention')
    expect(node.kind).toBe('tool')
    // 但索引保留 last-known-good,设备工具未进入 → 告警信号。
    expect(acceptance.searchIndexed).toBe(false)
  })

  it('未注入 search 时 searchIndexed 恒为 true(该宿主无搜索面)', async () => {
    const store = await seededStore()
    const acceptance = await processDeviceHello({
      store,
      authorization: `Bearer ${TEST_ADMIN_SK}`,
      deviceIdHint: 'phone',
      hello: HELLO,
    })
    expect(acceptance.searchIndexed).toBe(true)
  })
})
