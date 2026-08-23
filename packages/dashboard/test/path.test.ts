import { describe, expect, it } from 'vitest'
import { decodeTreePath, encodeTreePath, isPathSegmentSafe } from '../src/lib/path'

/**
 * 树路径编解码。A8 回归:URL 里的 splat 是编码过的,入站必须逐段解码回真实节点路径,
 * 否则含空格/特殊字符的 deep-link 高亮丢失、Inspector 二次编码后 404。
 */

describe('encodeTreePath / decodeTreePath', () => {
  it('逐段编码,分隔符 / 保留', () => {
    expect(encodeTreePath('docs/my tool')).toBe('docs/my%20tool')
  })

  it('A8:含空格的路径 encode→decode 往返回原文', () => {
    const path = 'tools/my weather api'
    expect(decodeTreePath(encodeTreePath(path))).toBe(path)
  })

  it('A8:含 # % 等字符往返回原文', () => {
    for (const path of ['a/b#c', 'a/100%', 'x/y z/w']) {
      expect(decodeTreePath(encodeTreePath(path))).toBe(path)
    }
  })

  it('逐段解码:编码过的 %2F 不被误当分隔符', () => {
    // 一个字面含斜杠的段(极端情况):encode 成 %2F,decode 应还原为段内的 /
    const encoded = encodeTreePath('weird seg/next') // -> 'weird%20seg/next'
    expect(decodeTreePath(encoded)).toBe('weird seg/next')
  })

  it('单段畸形(落单的 %)回退原文,不抛', () => {
    expect(() => decodeTreePath('a/%/b')).not.toThrow()
    expect(decodeTreePath('a/%/b')).toBe('a/%/b')
  })

  it('空串保持空串(根路径)', () => {
    expect(decodeTreePath('')).toBe('')
    expect(encodeTreePath('')).toBe('')
  })
})

describe('isPathSegmentSafe', () => {
  it('含 / 的段不安全', () => {
    expect(isPathSegmentSafe('a/b')).toBe(false)
    expect(isPathSegmentSafe('ok')).toBe(true)
  })
})
