import { describe, expect, it } from 'vitest'
import { appendVia, checkVia, parseVia } from '../../src/tool/via'

describe('parseVia', () => {
  it('缺省/空串 → 空链', () => {
    expect(parseVia(undefined)).toEqual([])
    expect(parseVia('')).toEqual([])
  })
  it('逗号分隔 + trim + 丢弃空段', () => {
    expect(parseVia('a, b ,, c')).toEqual(['a', 'b', 'c'])
  })
})

describe('checkVia 环 / 跳数检测(Proto §3.4)', () => {
  it('链中含自身 → unavailable(retryable:false)', () => {
    const err = checkVia(['x', 'self', 'y'], 'self', 4)
    expect(err?.code).toBe('unavailable')
    expect(err?.retryable).toBe(false)
    expect(err?.httpStatus).toBe(503)
  })

  it('链长 ≥ maxHops → unavailable(retryable:false)', () => {
    const err = checkVia(['a', 'b', 'c', 'd'], 'self', 4)
    expect(err?.code).toBe('unavailable')
    expect(err?.retryable).toBe(false)
  })

  it('链长 < maxHops 且不含自身 → 通过(null)', () => {
    expect(checkVia(['a', 'b'], 'self', 4)).toBeNull()
  })

  it('自身检测优先于跳数(自身在链且链已满)', () => {
    const err = checkVia(['self', 'b', 'c', 'd'], 'self', 4)
    expect(err?.code).toBe('unavailable')
    expect(err?.message).toContain('环')
  })
})

describe('appendVia', () => {
  it('把自身追加到链尾', () => {
    expect(appendVia(['a', 'b'], 'self')).toBe('a, b, self')
  })
  it('空链 → 仅自身', () => {
    expect(appendVia([], 'self')).toBe('self')
  })
  it('parseVia ∘ appendVia 往返', () => {
    expect(parseVia(appendVia(['a'], 'self'))).toEqual(['a', 'self'])
  })
})
