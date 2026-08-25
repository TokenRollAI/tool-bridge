import { describe, expect, it } from 'vitest'
import {
  asJsonObject,
  booleanValue,
  compactDefined,
  finiteNumber,
  integerValue,
  messageFrom,
  trimmedText,
} from '../../src/_runtime/jsonValue'

describe('provider JSON value helpers', () => {
  it('只接受非 null、非数组的对象', () => {
    const object = { value: 1 }
    expect(asJsonObject(object)).toBe(object)
    expect(asJsonObject(null)).toBeUndefined()
    expect(asJsonObject([])).toBeUndefined()
    expect(asJsonObject('value')).toBeUndefined()
  })

  it('trimmedText 返回 trim 后的非空字符串', () => {
    expect(trimmedText('  value  ')).toBe('value')
    expect(trimmedText(' \n ')).toBeUndefined()
    expect(trimmedText(1)).toBeUndefined()
  })

  it('数字和布尔 helper 不做字符串强转', () => {
    expect(finiteNumber(1.5)).toBe(1.5)
    expect(finiteNumber(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(finiteNumber('1')).toBeUndefined()
    expect(integerValue(2)).toBe(2)
    expect(integerValue(2.5)).toBeUndefined()
    expect(integerValue('2')).toBeUndefined()
    expect(booleanValue(false)).toBe(false)
    expect(booleanValue('false')).toBeUndefined()
  })

  it('compactDefined 只删除顶层 undefined，保留 null、空值和嵌套 undefined', () => {
    const nested = { missing: undefined }
    expect(compactDefined({
      missing: undefined,
      nil: null,
      empty: '',
      false: false,
      zero: 0,
      nested,
    })).toEqual({ nil: null, empty: '', false: false, zero: 0, nested })
    expect(nested).toHaveProperty('missing', undefined)
  })

  it('messageFrom 按字段顺序选择 trim 后文本并保留 fallback', () => {
    expect(messageFrom(' direct ', ['message'], 'fallback')).toBe('direct')
    expect(messageFrom({ error: ' ', message: ' useful ' }, ['error', 'message'], 'fallback'))
      .toBe('useful')
    expect(messageFrom({ message: 1 }, ['message'], 'fallback')).toBe('fallback')
  })
})
