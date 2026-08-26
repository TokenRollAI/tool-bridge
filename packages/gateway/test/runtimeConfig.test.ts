import { MemoryStateStore, parseRuntimeEnv } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { depsFromEnv, type Env } from '../src/app'

describe('Gateway 联邦搜索 runtime 配置', () => {
  it('把 Workers env 解析结果完整注入 TbAppDeps.remote', () => {
    const runtime = parseRuntimeEnv({
      TB_INSTANCE_ID: 'worker-a',
      TB_SEARCH_FEDERATION_CONCURRENCY: '5',
      TB_SEARCH_FEDERATION_DEADLINE_MS: '2200',
      TB_SEARCH_FEDERATION_MAX_RESPONSE_BYTES: '393216',
      TB_SEARCH_FEDERATION_MAX_SOURCES: '11',
      TB_SEARCH_FEDERATION_MIN_CHILD_WORK_MS: '175',
      TB_SEARCH_FEDERATION_RETURN_RESERVE_MS: '95',
      TB_SEARCH_FEDERATION_SESSION_TTL_SEC: '150',
    })
    const deps = depsFromEnv(
      { TB_R2: {} } as Env,
      new MemoryStateStore(),
      undefined,
      runtime,
    )

    expect(deps.remote).toMatchObject({
      federatedSearch: {
        maxConcurrency: 5,
        maxResponseBodyBytes: 393_216,
        maxSources: 11,
        minChildWorkMs: 175,
        perHopReturnReserveMs: 95,
        sessionTtlMs: 150_000,
        totalDeadlineMs: 2_200,
      },
      instanceId: 'worker-a',
    })
  })
})
