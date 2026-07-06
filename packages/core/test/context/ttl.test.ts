import { describe, expect, it } from 'vitest'
import { isContextExpired } from '../../src/context/ttl'

const CREATED_AT = '2026-07-07T00:00:00.000Z'
const CREATED_MS = Date.parse(CREATED_AT)

describe('isContextExpired', () => {
  it('无 ttl(undefined / 0)→ 永不过期', () => {
    expect(isContextExpired(CREATED_AT, undefined, CREATED_MS + 10 ** 12)).toBe(false)
    expect(isContextExpired(CREATED_AT, 0, CREATED_MS + 10 ** 12)).toBe(false)
  })

  it('未到期 → false', () => {
    expect(isContextExpired(CREATED_AT, 60, CREATED_MS + 59_999)).toBe(false)
  })

  it('刚到期(now == createdAt + ttl)→ true;过期后 → true', () => {
    expect(isContextExpired(CREATED_AT, 60, CREATED_MS + 60_000)).toBe(true)
    expect(isContextExpired(CREATED_AT, 60, CREATED_MS + 60_001)).toBe(true)
  })

  it('createdAt 无法解析 → 不误回收(false)', () => {
    expect(isContextExpired('not-a-date', 60, CREATED_MS)).toBe(false)
  })
})
