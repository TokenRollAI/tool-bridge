import { describe, expect, it } from 'vitest'
import { isDirPath, normalizeEntryPath } from '../../src/context/path'
import { isTBError } from '../../src/errors'

/** 执行并返回 TBError code(未抛 → null;非 TBError → 说明串,便于定位)。 */
function codeOf(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (e) {
    return isTBError(e) ? e.code : `非TBError:${String(e)}`
  }
}

describe('normalizeEntryPath', () => {
  it('规范化:折叠重复 /、去尾 /、去 "." 段', () => {
    expect(normalizeEntryPath('a/b.md')).toBe('a/b.md')
    expect(normalizeEntryPath('a//b')).toBe('a/b')
    expect(normalizeEntryPath('a/b/')).toBe('a/b')
    expect(normalizeEntryPath('./a/./b')).toBe('a/b')
  })

  it('合法边界:字面 %(解码失败跳过复查)、"a..b"、".hidden"', () => {
    expect(normalizeEntryPath('100%')).toBe('100%')
    expect(normalizeEntryPath('a..b')).toBe('a..b')
    expect(normalizeEntryPath('.hidden')).toBe('.hidden')
  })

  it('拒绝穿越与非法形态 → invalid_argument(全变体)', () => {
    const bad = [
      '', // 空串
      '..',
      'a/../b',
      'a/..',
      '../x',
      '/abs', // 绝对路径
      'a\\b', // 反斜杠
      'a\u0000b', // 控制字符
      '%2e%2e/x', // percent-decode 后 '..'
      'a/%2E%2E', // 大写变体
      '..%2fb', // 解码后出现 '../b'
      '%5cwin', // 解码后反斜杠
      '%00', // 解码后控制字符
      '%2fabs', // 解码后绝对路径
      '.', // 规范化后为空
      './',
    ]
    for (const p of bad) {
      expect(
        codeOf(() => normalizeEntryPath(p)),
        `应拒绝:'${p}'`,
      ).toBe('invalid_argument')
    }
    expect(codeOf(() => normalizeEntryPath(123 as unknown as string))).toBe('invalid_argument')
  })
})

describe('isDirPath', () => {
  it('尾 / 视为目录路径', () => {
    expect(isDirPath('a/')).toBe(true)
    expect(isDirPath('a')).toBe(false)
  })
})
