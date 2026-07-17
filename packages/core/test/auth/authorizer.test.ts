import { describe, expect, it } from 'vitest'
import type { CallContext, Scope } from '../../src/types'
import { check } from '../../src/auth/authorizer'

const ctxWith = (scopes: Scope[]): CallContext => ({
  keyId: 'k1',
  owner: 'user:alice',
  scopes,
  traceId: 't1',
})

describe('check(Authorizer 纯 scope 判定包装)', () => {
  it('scope 允许 → { allow: true }', () => {
    const ctx = ctxWith([{ pattern: '**', actions: ['read'] }])
    expect(check(ctx, 'docs/x', 'read')).toEqual({ allow: true })
  })

  it('scope 拒绝 → { allow: false, reason }', () => {
    const ctx = ctxWith([{ pattern: 'docs/**', actions: ['read'] }])
    const r = check(ctx, 'other/x', 'read')
    expect(r.allow).toBe(false)
    expect(r.reason).toBeTypeOf('string')
  })

  it('deny 优先于 allow', () => {
    const ctx = ctxWith([
      { pattern: '**', actions: ['write'] },
      { pattern: 'system/**', actions: ['write'], effect: 'deny' },
    ])
    expect(check(ctx, 'system/sk', 'write').allow).toBe(false)
    expect(check(ctx, 'docs/x', 'write').allow).toBe(true)
  })
})
