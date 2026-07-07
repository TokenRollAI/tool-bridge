import { describe, expect, it } from 'vitest'
import { assertSecureUrl, normalizeUpstreamError } from '../../src/tool/upstreamError'

describe('normalizeUpstreamError 全分支', () => {
  it('network → unavailable(retryable:true)', () => {
    const err = normalizeUpstreamError({ kind: 'network', message: 'ECONNRESET' })
    expect(err.code).toBe('unavailable')
    expect(err.retryable).toBe(true)
    expect(err.httpStatus).toBe(503)
  })

  it('http 5xx → unavailable(retryable:true)', () => {
    const err = normalizeUpstreamError({ kind: 'http', status: 502 })
    expect(err.code).toBe('unavailable')
    expect(err.retryable).toBe(true)
    expect(err.message).toContain('502')
  })

  it('http 4xx → internal(retryable:false),message 含状态码、不含上游 body', () => {
    const err = normalizeUpstreamError({
      kind: 'http',
      status: 400,
      message: 'secret upstream body should not leak',
    })
    expect(err.code).toBe('internal')
    expect(err.retryable).toBe(false)
    expect(err.message).toContain('400')
    expect(err.message).not.toContain('secret upstream body')
  })

  it('http 404(会话失效重建仍失败落到 http 分支时)→ internal(4xx)', () => {
    const err = normalizeUpstreamError({ kind: 'http', status: 404 })
    expect(err.code).toBe('internal')
  })

  it('http 状态未知 → unavailable(保守)', () => {
    const err = normalizeUpstreamError({ kind: 'http' })
    expect(err.code).toBe('unavailable')
    expect(err.retryable).toBe(true)
  })

  it('http 3xx 等异常状态 → unavailable(保守)', () => {
    const err = normalizeUpstreamError({ kind: 'http', status: 301 })
    expect(err.code).toBe('unavailable')
  })
})

describe('assertSecureUrl(上游 https 强制)', () => {
  it('https:// → 通过(null)', () => {
    expect(assertSecureUrl('https://api.example.com/x', false)).toBeNull()
  })

  it('http:// 且不放行 → invalid_argument', () => {
    const err = assertSecureUrl('http://api.example.com', false)
    expect(err?.code).toBe('invalid_argument')
  })

  it('http:// 且 allowInsecure → 通过', () => {
    expect(assertSecureUrl('http://localhost:8787', true)).toBeNull()
  })

  it('无 scheme → invalid_argument', () => {
    expect(assertSecureUrl('api.example.com', true)?.code).toBe('invalid_argument')
  })

  it('非 http(s) scheme(如 ftp)不被 allowInsecure 放行', () => {
    expect(assertSecureUrl('ftp://x', true)?.code).toBe('invalid_argument')
  })
})
