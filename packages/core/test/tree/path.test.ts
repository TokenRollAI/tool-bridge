import { describe, expect, it } from 'vitest'
import { isPrefixOf, normalizePath, parentPaths, segments, validatePath } from '../../src/tree/path'

describe('normalizePath', () => {
  it.each([
    ['a/b/c', 'a/b/c'],
    ['/a/b/c', 'a/b/c'],
    ['a/b/c/', 'a/b/c'],
    ['///a/b///', 'a/b'],
    ['', ''],
    ['/', ''],
    ['///', ''],
  ])('normalizePath(%j) === %j', (input, expected) => {
    expect(normalizePath(input)).toBe(expected)
  })

  it('保留内部空段(不折叠 a//b),交由 validatePath 判非法', () => {
    expect(normalizePath('a//b')).toBe('a//b')
  })
})

describe('segments', () => {
  it.each([
    ['a/b/c', ['a', 'b', 'c']],
    ['/a/', ['a']],
    ['', []],
    ['/', []],
  ])('segments(%j) === %j', (input, expected) => {
    expect(segments(input)).toEqual(expected)
  })
})

describe('validatePath', () => {
  it('合法路径 → null', () => {
    expect(validatePath('docs/context7')).toBeNull()
  })

  it('空路径默认非法(invalid_argument)', () => {
    const e = validatePath('')
    expect(e?.code).toBe('invalid_argument')
  })

  it('空路径 allowRoot 时合法 → null', () => {
    expect(validatePath('', { allowRoot: true })).toBeNull()
  })

  it('内部空段(a//b)→ invalid_argument', () => {
    expect(validatePath('a//b')?.code).toBe('invalid_argument')
  })

  it.each([
    '~help',
    '~skill',
    '~tree',
    '~register',
    '~describe',
  ])('保留段 %s 作段 → invalid_argument', (seg) => {
    expect(validatePath(`a/${seg}/c`)?.code).toBe('invalid_argument')
  })

  it('以 ~ 开头的任意段 → invalid_argument', () => {
    expect(validatePath('~future')?.code).toBe('invalid_argument')
  })
})

describe('parentPaths', () => {
  it.each([
    ['a/b/c', ['a', 'a/b']],
    ['a/b', ['a']],
    ['a', []],
    ['', []],
  ])('parentPaths(%j) === %j', (input, expected) => {
    expect(parentPaths(input)).toEqual(expected)
  })
})

describe('isPrefixOf(按段,非字符串前缀)', () => {
  it("'a/b' 是 'a/b/c' 前缀", () => {
    expect(isPrefixOf('a/b', 'a/b/c')).toBe(true)
  })

  it("'a/bx' 不是 'a/b/c' 前缀(字符串前缀但非段前缀)", () => {
    expect(isPrefixOf('a/bx', 'a/b/c')).toBe(false)
  })

  it('相等亦视为前缀', () => {
    expect(isPrefixOf('a/b', 'a/b')).toBe(true)
  })

  it('空前缀(根)是任意路径前缀', () => {
    expect(isPrefixOf('', 'a/b/c')).toBe(true)
  })

  it('更长的前缀不是更短路径的前缀', () => {
    expect(isPrefixOf('a/b/c', 'a/b')).toBe(false)
  })
})
