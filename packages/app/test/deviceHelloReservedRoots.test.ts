import { isTBError, MemoryStateStore } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { processDeviceHello, runBootstrap } from '../src/index'
import { TEST_ADMIN_SK } from './fixtures'

/**
 * 设备 hello 是第三条 NodeConfig 写入口,须与 `~register` / system/registry 同权:
 * 部署追加的保留根(TbAppDeps.reservedRoots)此前只在 HTTP 注册面生效,持 register
 * scope 的设备 SK 经 hello 可挂进被追加保留的根下。processDeviceHello 现在接收
 * reservedRoots 并逐节点执行同一 checkRegisterPath。
 */

const helloFor = (mountPath: string) => ({
  deviceId: 'phone',
  mountPath,
  expose: { shell: { description: 'shell' } },
})

async function seededStore(): Promise<MemoryStateStore> {
  const store = new MemoryStateStore()
  await runBootstrap(store, { adminSk: TEST_ADMIN_SK })
  return store
}

describe('processDeviceHello × 部署追加保留根', () => {
  it('reservedRoots 覆盖 mountPath → permission_denied,节点不落库', async () => {
    const store = await seededStore()
    const attempt = processDeviceHello({
      store,
      authorization: `Bearer ${TEST_ADMIN_SK}`,
      deviceIdHint: 'phone',
      hello: helloFor('internal/phone'),
      reservedRoots: ['internal'],
    })
    await expect(attempt).rejects.toSatisfy(
      err => isTBError(err) && err.code === 'permission_denied',
    )
    expect(await store.get('node:internal/phone')).toBeNull()
  })

  it('未配置 reservedRoots 时同一 mountPath 照常挂载(仅内置保留根生效)', async () => {
    const store = await seededStore()
    const acceptance = await processDeviceHello({
      store,
      authorization: `Bearer ${TEST_ADMIN_SK}`,
      deviceIdHint: 'phone',
      hello: helloFor('internal/phone'),
    })
    expect(acceptance.mountPath).toBe('internal/phone')
  })
})
