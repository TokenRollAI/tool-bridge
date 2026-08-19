import { type CallContext, DEVICE_CALL_TIMEOUT_MS } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { deviceCallContextFrom } from '../src/deviceNodes'

/**
 * A 阶段安全不变量:下发给设备的 caller/deadline 只来自网关鉴权后的 CallContext,
 * 绝不来自调用 arguments;expiresAt 是网关权威时间戳。
 */
describe('deviceCallContextFrom', () => {
  const ctx: CallContext = {
    keyId: 'sk_1',
    owner: 'agent:researcher',
    traceId: 'trace-abc',
    scopes: [{ pattern: 'device/**', actions: ['call'] }],
  }

  it('只透传网关权威身份(keyId/owner/traceId),不含 scopes/SK', () => {
    const out = deviceCallContextFrom(ctx)
    expect(out.caller).toEqual({ keyId: 'sk_1', owner: 'agent:researcher' })
    expect(out.traceId).toBe('trace-abc')
    // 故意不下发 scopes:设备不做授权裁决。
    expect(out).not.toHaveProperty('scopes')
    expect(JSON.stringify(out)).not.toContain('device/**')
  })

  it('expiresAt = createdAt + DEVICE_CALL_TIMEOUT_MS,对齐网关真正取消该 call 的时刻', () => {
    const out = deviceCallContextFrom(ctx)
    const delta = Date.parse(out.expiresAt) - Date.parse(out.createdAt)
    expect(delta).toBe(DEVICE_CALL_TIMEOUT_MS)
    expect(out.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
