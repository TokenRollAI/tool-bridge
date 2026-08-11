import { describe, expect, it } from 'vitest'
import { base64urlDecode, base64urlEncode } from '../../src/encoding/base64url'

describe('base64url 统一编解码', () => {
  it('任意长度字节序列 encode→decode 往返一致(覆盖 3n/3n+1/3n+2 尾组)', () => {
    for (let len = 0; len <= 66; len++) {
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + len) & 0xff
      const encoded = base64urlEncode(bytes)
      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/)
      expect(base64urlDecode(encoded)).toEqual(bytes)
    }
  })

  it('空串解码为空字节(是否拒绝空输入由调用方决定)', () => {
    expect(base64urlDecode('')).toEqual(new Uint8Array(0))
    expect(base64urlEncode(new Uint8Array(0))).toBe('')
  })

  it('拒绝 len%4===1 的非法长度(此前的宽松累加器会静默解成截断字节)', () => {
    expect(() => base64urlDecode('A')).toThrow(/malformed/)
    expect(() => base64urlDecode('AAAAB')).toThrow(/malformed/)
  })

  it('拒绝字母表外字符(含标准 base64 的 +/= 与空白)', () => {
    for (const bad of ['a+b0', 'a/b0', 'AA==', 'AA\n', 'AA A', '你好']) {
      expect(() => base64urlDecode(bad)).toThrow(/malformed/)
    }
  })
})
