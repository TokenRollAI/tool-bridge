import type { TbAppDeps } from '@tool-bridge/app'
import { MemoryObjectStore, MemoryStateStore } from '@tool-bridge/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createTbAppSpy } = vi.hoisted(() => ({
  createTbAppSpy: vi.fn((deps: unknown) => {
    void deps
    return { fetch: vi.fn() }
  }),
}))

vi.mock('@tool-bridge/app', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tool-bridge/app')>()
  return { ...actual, createTbApp: createTbAppSpy }
})

import { createToolBridge } from '../src/toolBridge'

describe('SDK 联邦搜索宿主配置', () => {
  beforeEach(() => createTbAppSpy.mockClear())

  it('把调用方预算原样注入 remote，且不伪造 instanceId', () => {
    const federatedSearch = {
      maxConcurrency: 2,
      maxResponseBodyBytes: 131_072,
      maxSources: 8,
      minChildWorkMs: 125,
      perHopReturnReserveMs: 75,
      sessionTtlMs: 60_000,
      totalDeadlineMs: 1_500,
    }
    createToolBridge({
      adminSk: 'tbk_test_admin_key_0000000000',
      federatedSearch,
      objects: new MemoryObjectStore(),
      state: new MemoryStateStore(),
    })

    const deps = createTbAppSpy.mock.calls[0]?.[0] as TbAppDeps
    expect(deps.remote).toMatchObject({ federatedSearch })
    expect(deps.remote.instanceId).toBeUndefined()
  })
})
