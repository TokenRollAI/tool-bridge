import { describe, expect, it } from 'vitest'
import {
  HTBP_HELP_HEADER,
  HTBP_VERSION,
  isTBError,
  statusForCode,
  TBError,
  type TBErrorCode,
} from '../src/index'

describe('TBError ↔ HTTP 映射(Proto §0.2 七码表)', () => {
  // 逐码断言规范映射(Proto.md:49)
  const cases: Array<[TBErrorCode, number]> = [
    ['not_found', 404],
    ['permission_denied', 403],
    ['invalid_argument', 400],
    ['conflict', 409],
    ['rate_limited', 429],
    ['unavailable', 503],
    ['internal', 500],
  ]

  it.each(cases)('statusForCode(%s) === %i', (code, status) => {
    expect(statusForCode(code)).toBe(status)
  })

  it.each(cases)('new TBError(%s).httpStatus === %i(无特例时)', (code, status) => {
    expect(new TBError(code, 'x').httpStatus).toBe(status)
  })
})

describe('retryable 约束(Proto §0.2:仅三码允许 true)', () => {
  const allowed: TBErrorCode[] = ['rate_limited', 'unavailable', 'internal']
  const forbidden: TBErrorCode[] = [
    'not_found',
    'permission_denied',
    'invalid_argument',
    'conflict',
  ]

  it.each(allowed)('%s 允许 retryable:true', (code) => {
    expect(new TBError(code, 'x', { retryable: true }).retryable).toBe(true)
  })

  it.each(forbidden)('%s 设 retryable:true 时构造抛错', (code) => {
    expect(() => new TBError(code, 'x', { retryable: true })).toThrow()
  })

  it('retryable 缺省为 false', () => {
    expect(new TBError('internal', 'x').retryable).toBe(false)
  })
})

describe('特例工厂(401 / 501 / 503)', () => {
  it('unauthenticated → HTTP 401,code=permission_denied,retryable=false', () => {
    const e = TBError.unauthenticated()
    expect(e.httpStatus).toBe(401)
    expect(e.code).toBe('permission_denied')
    expect(e.retryable).toBe(false)
  })

  it('unimplemented → HTTP 501,code=unavailable,retryable=false', () => {
    const e = TBError.unimplemented()
    expect(e.httpStatus).toBe(501)
    expect(e.code).toBe('unavailable')
    expect(e.retryable).toBe(false)
  })

  it('deviceOffline → HTTP 503,code=unavailable,retryable=true', () => {
    const e = TBError.deviceOffline()
    expect(e.httpStatus).toBe(503)
    expect(e.code).toBe('unavailable')
    expect(e.retryable).toBe(true)
  })

  it('notFound → HTTP 404', () => {
    expect(TBError.notFound().httpStatus).toBe(404)
  })
})

describe('toJSON 只含规范 body 字段(不泄漏 httpStatus)', () => {
  it('形状为 {code,message,retryable}', () => {
    const e = TBError.unauthenticated('nope')
    expect(e.toJSON()).toEqual({
      code: 'permission_denied',
      message: 'nope',
      retryable: false,
    })
    expect(Object.keys(e.toJSON())).toEqual(['code', 'message', 'retryable'])
  })
})

describe('isTBError', () => {
  it('对 TBError 实例为 true,对普通值为 false', () => {
    expect(isTBError(TBError.notFound())).toBe(true)
    expect(isTBError(new Error('x'))).toBe(false)
    expect(isTBError({ code: 'not_found' })).toBe(false)
  })
})

describe('版本常量', () => {
  it('HTBP_VERSION 为 0.1,Help 首行为 "htbp 0.1"', () => {
    expect(HTBP_VERSION).toBe('0.1')
    expect(HTBP_HELP_HEADER).toBe('htbp 0.1')
  })
})
