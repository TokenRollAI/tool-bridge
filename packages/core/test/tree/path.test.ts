import { describe, expect, it } from 'vitest'
import {
  assertNoCollision,
  canonicalizePath,
  canonicalizeSegment,
  isPrefixOf,
  normalizePath,
  parentPaths,
  segments,
  validatePath,
  validateSegment,
} from '../../src/tree/path'
import { RESERVED_SEGMENTS } from '../../src/types'

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
    '~search',
  ])('保留段 %s 作段 → invalid_argument', (seg) => {
    expect(validatePath(`a/${seg}/c`)?.code).toBe('invalid_argument')
  })

  it('协议保留段显式包含 ~search', () => {
    expect(RESERVED_SEGMENTS).toContain('~search')
  })

  it('以 ~ 开头的任意段 → invalid_argument', () => {
    expect(validatePath('~future')?.code).toBe('invalid_argument')
  })
})

describe('canonicalizeSegment(小写化 + 形状校验)', () => {
  it.each([
    ['Foo', 'foo'],
    ['GET_BY', 'get_by'],
    ['resolve-library-id', 'resolve-library-id'],
    ['Foo_Bar', 'foo_bar'],
  ])('canonicalizeSegment(%j) === %j', (input, expected) => {
    expect(canonicalizeSegment(input)).toBe(expected)
  })

  it.each(['', '~x', '.', '..'])('非法段 %j 抛 invalid_argument', (seg) => {
    expect(() => canonicalizeSegment(seg)).toThrow()
    expect(validateSegment(seg)?.code).toBe('invalid_argument')
  })
})

describe('canonicalizePath(整条路径小写化)', () => {
  it.each([
    ['SYSTEM/Status/Get', 'system/status/get'],
    ['/Docs/Context7/', 'docs/context7'],
    ['', ''],
    ['Foo_Bar/BAZ', 'foo_bar/baz'],
  ])('canonicalizePath(%j) === %j', (input, expected) => {
    expect(canonicalizePath(input)).toBe(expected)
  })

  it.each(['a/~x/c', 'a/./b', 'a/../b', 'a//b'])('非法路径 %j 抛', (p) => {
    expect(() => canonicalizePath(p)).toThrow()
  })
})

describe('assertNoCollision(大小写折叠冲突 fail closed)', () => {
  it('Foo 与 foo 同时出现 → 抛 invalid_argument,不选其一', () => {
    expect(() => assertNoCollision(['Foo', 'foo'], 'test')).toThrow()
  })

  it('同名(全等)不算冲突', () => {
    expect(() => assertNoCollision(['foo', 'foo', 'bar'], 'test')).not.toThrow()
  })

  it('规范化后互异 → 放行', () => {
    expect(() => assertNoCollision(['foo', 'bar', 'baz'], 'test')).not.toThrow()
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
  it('\'a/b\' 是 \'a/b/c\' 前缀', () => {
    expect(isPrefixOf('a/b', 'a/b/c')).toBe(true)
  })

  it('\'a/bx\' 不是 \'a/b/c\' 前缀(字符串前缀但非段前缀)', () => {
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
