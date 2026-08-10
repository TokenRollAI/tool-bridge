import { describe, expect, it } from 'vitest'
import { normalizeCanonicalOrigin } from '../src/origin'
import { isTBError } from '../src/errors'

describe('normalizeCanonicalOrigin', () => {
  it('未配置(undefined / 空串 / 纯空白)→ undefined(显式选择不钉)', () => {
    expect(normalizeCanonicalOrigin(undefined)).toBeUndefined()
    expect(normalizeCanonicalOrigin('')).toBeUndefined()
    expect(normalizeCanonicalOrigin('   ')).toBeUndefined()
  })

  it('合法 https → 取 origin,丢弃 path/query/hash', () => {
    expect(normalizeCanonicalOrigin('https://tb.example.com')).toBe('https://tb.example.com')
    expect(normalizeCanonicalOrigin('https://tb.example.com/ui/x?a=1#f')).toBe(
      'https://tb.example.com',
    )
    expect(normalizeCanonicalOrigin('  https://tb.example.com/  ')).toBe('https://tb.example.com')
  })

  it('带端口的 origin 保留端口', () => {
    expect(normalizeCanonicalOrigin('http://127.0.0.1:8787/x')).toBe('http://127.0.0.1:8787')
  })

  const invalid: Array<[string, string]> = [
    ['非绝对 URL', 'tb.example.com'],
    ['只有路径', '/ui'],
    ['垃圾串', 'not a url'],
  ]
  for (const [label, value] of invalid) {
    it(`配置了但非法(${label})→ 抛 invalid_argument,不静默回退`, () => {
      let caught: unknown
      try {
        normalizeCanonicalOrigin(value)
      } catch (err) {
        caught = err
      }
      expect(isTBError(caught)).toBe(true)
      expect((caught as { code: string }).code).toBe('invalid_argument')
    })
  }

  it('非 http(s) 协议 → 抛 invalid_argument(防把 redirect_uri 钉到非法 scheme)', () => {
    let caught: unknown
    try {
      normalizeCanonicalOrigin('ftp://tb.example.com')
    } catch (err) {
      caught = err
    }
    expect(isTBError(caught)).toBe(true)
    expect((caught as { code: string }).code).toBe('invalid_argument')
  })
})
