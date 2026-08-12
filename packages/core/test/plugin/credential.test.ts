import { describe, expect, it } from 'vitest'
import { encodeCredentialValues, parseCredentialValues } from '../../src/plugin/credential'
import { isTBError } from '../../src/errors'

/**
 * 多字段凭证的编解码。平台与插件共用这份规则,所以它的边界行为要钉死 ——
 * 两边对"什么算合法凭证"判断不一致会让配置错误表现成运行时故障。
 */

const FIELDS = [
  { key: 'appId', required: true },
  { key: 'appSecret', required: true, secret: true },
  { key: 'region', required: false },
]

describe('parseCredentialValues', () => {
  it('取出声明过的字段', () => {
    const raw = JSON.stringify({ appId: 'cli_x', appSecret: 's3cret', region: 'cn' })
    expect(parseCredentialValues(raw, FIELDS)).toEqual({
      appId: 'cli_x',
      appSecret: 's3cret',
      region: 'cn',
    })
  })

  it('可选字段缺省不报错', () => {
    const raw = JSON.stringify({ appId: 'cli_x', appSecret: 's3cret' })
    expect(parseCredentialValues(raw, FIELDS)).toEqual({ appId: 'cli_x', appSecret: 's3cret' })
  })

  it('缺必填字段 → invalid_argument,点名缺哪个', () => {
    try {
      parseCredentialValues(JSON.stringify({ appId: 'cli_x' }), FIELDS)
      expect.unreachable('应当抛出')
    } catch (err) {
      expect(isTBError(err) && err.code).toBe('invalid_argument')
      expect((err as Error).message).toContain('appSecret')
    }
  })

  it('**未标 required 的字段按必填处理**(漏标不该被静默放行)', () => {
    const fields = [{ key: 'token' }]
    expect(() => parseCredentialValues('{}', fields)).toThrow(/token/)
  })

  it('空串不算有值(等同缺失)', () => {
    expect(() => parseCredentialValues(JSON.stringify({ appId: '', appSecret: 'x' }), FIELDS))
      .toThrow(/appId/)
  })

  it('不是 JSON → invalid_argument,消息指出该怎么写入', () => {
    try {
      parseCredentialValues('sk_plain_key', FIELDS)
      expect.unreachable('应当抛出')
    } catch (err) {
      expect(isTBError(err) && err.code).toBe('invalid_argument')
      expect((err as Error).message).toContain('--field')
    }
  })

  it('JSON 数组/null 不算对象', () => {
    expect(() => parseCredentialValues('[]', FIELDS)).toThrow(/JSON 对象/)
    expect(() => parseCredentialValues('null', FIELDS)).toThrow(/JSON 对象/)
  })

  it('**错误消息不回显凭证值**(否则日志里就有明文了)', () => {
    try {
      parseCredentialValues(JSON.stringify({ appId: 'SECRET_VALUE_X' }), FIELDS)
      expect.unreachable('应当抛出')
    } catch (err) {
      expect((err as Error).message).not.toContain('SECRET_VALUE_X')
    }
  })

  it('声明外的多余字段被忽略(不透传给插件)', () => {
    const raw = JSON.stringify({ appId: 'a', appSecret: 'b', stray: 'x' })
    expect(parseCredentialValues(raw, FIELDS)).not.toHaveProperty('stray')
  })
})

describe('encodeCredentialValues', () => {
  it('键序固定:同一份凭证每次编码一致', () => {
    const a = encodeCredentialValues({ b: '2', a: '1' })
    const b = encodeCredentialValues({ a: '1', b: '2' })
    expect(a).toBe(b)
  })

  it('编码后能被 parse 还原', () => {
    const values = { appId: 'cli_x', appSecret: 's3cret' }
    expect(parseCredentialValues(encodeCredentialValues(values), FIELDS)).toEqual(values)
  })
})
