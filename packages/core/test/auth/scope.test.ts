import { describe, expect, it } from 'vitest'
import { checkScopes, matchGlob } from '../../src/auth/scope'
import type { Action, Scope } from '../../src/types'

describe('matchGlob(Proto §2.2 glob 语义:行 216)', () => {
  describe('** 匹配任意层级(含零段)', () => {
    it.each(['', 'a', 'a/b', 'a/b/c/d'])('matchGlob("**", %o) === true', (path) => {
      expect(matchGlob('**', path)).toBe(true)
    })

    it('docs/** 匹配 docs 本身(** 零段)', () => {
      expect(matchGlob('docs/**', 'docs')).toBe(true)
    })

    it('docs/** 匹配 docs 的多级后代', () => {
      expect(matchGlob('docs/**', 'docs/context7')).toBe(true)
      expect(matchGlob('docs/**', 'docs/a/b/c')).toBe(true)
    })

    it('docs/** 不匹配同前缀的其他根段(前缀是段级,不是字符级)', () => {
      expect(matchGlob('docs/**', 'documents')).toBe(false)
      expect(matchGlob('docs/**', 'other/docs')).toBe(false)
    })

    it('device/build-01/** 收紧到该设备子树', () => {
      expect(matchGlob('device/build-01/**', 'device/build-01/shell')).toBe(true)
      expect(matchGlob('device/build-01/**', 'device/build-01')).toBe(true)
      expect(matchGlob('device/build-01/**', 'device/build-02/shell')).toBe(false)
    })

    it('中间 ** 也匹配零段与多段', () => {
      expect(matchGlob('a/**/b', 'a/b')).toBe(true)
      expect(matchGlob('a/**/b', 'a/x/y/b')).toBe(true)
      expect(matchGlob('a/**/b', 'a/x')).toBe(false)
    })
  })

  describe('* 匹配恰好单段(不跨段)', () => {
    it('* 匹配任意单段', () => {
      expect(matchGlob('*', 'a')).toBe(true)
      expect(matchGlob('*', 'docs')).toBe(true)
    })

    it('* 不匹配零段(根)', () => {
      expect(matchGlob('*', '')).toBe(false)
    })

    it('* 不跨段', () => {
      expect(matchGlob('*', 'a/b')).toBe(false)
    })

    it('段内定位的 *', () => {
      expect(matchGlob('*/b', 'a/b')).toBe(true)
      expect(matchGlob('a/*', 'a/b')).toBe(true)
      expect(matchGlob('a/*', 'a')).toBe(false)
      expect(matchGlob('a/*/c', 'a/b/c')).toBe(true)
    })
  })

  describe('字面段匹配', () => {
    it('完全相等匹配', () => {
      expect(matchGlob('docs/context7', 'docs/context7')).toBe(true)
    })

    it('前缀不算匹配(需通配符)', () => {
      expect(matchGlob('docs', 'docs/context7')).toBe(false)
    })

    it('多余段不匹配', () => {
      expect(matchGlob('docs/context7', 'docs')).toBe(false)
    })
  })

  describe('根路径(空 path)语义', () => {
    it('空 pattern 匹配空 path', () => {
      expect(matchGlob('', '')).toBe(true)
    })

    it('空 pattern 不匹配非空 path', () => {
      expect(matchGlob('', 'a')).toBe(false)
    })

    it('前后/重复斜杠归一后不影响匹配', () => {
      expect(matchGlob('/docs/', 'docs')).toBe(true)
      expect(matchGlob('docs//context7', 'docs/context7')).toBe(true)
    })
  })
})

describe('checkScopes(Proto §2.2 判定序:行 210-214)', () => {
  const rule = (pattern: string, actions: Action[], effect?: 'allow' | 'deny'): Scope =>
    effect ? { pattern, actions, effect } : { pattern, actions }

  it('规则1:任一 deny 匹配 → false(deny 优先于 allow)', () => {
    const scopes = [rule('**', ['read']), rule('docs/**', ['read'], 'deny')]
    expect(checkScopes(scopes, 'docs/x', 'read')).toBe(false)
  })

  it('规则1 反例:deny 不覆盖其模式外的路径', () => {
    const scopes = [rule('**', ['read']), rule('docs/**', ['read'], 'deny')]
    expect(checkScopes(scopes, 'other/x', 'read')).toBe(true)
  })

  it('规则2:allow 匹配 → true', () => {
    expect(checkScopes([rule('docs/**', ['read'])], 'docs/x', 'read')).toBe(true)
  })

  it('规则3:无匹配 → false(默认拒)', () => {
    expect(checkScopes([rule('docs/**', ['read'])], 'other/x', 'read')).toBe(false)
  })

  it('空 scopes(无权)默认拒', () => {
    expect(checkScopes([], 'anything', 'read')).toBe(false)
  })

  it('effect 缺省视为 allow', () => {
    expect(checkScopes([rule('**', ['write'])], 'x', 'write')).toBe(true)
  })

  it('动作不匹配 → false(pattern 命中但 action 不在集合内)', () => {
    expect(checkScopes([rule('**', ['read'])], 'x', 'write')).toBe(false)
  })

  it('deny 仅在 action 命中时才生效', () => {
    const scopes = [rule('**', ['read', 'write']), rule('**', ['write'], 'deny')]
    expect(checkScopes(scopes, 'x', 'read')).toBe(true)
    expect(checkScopes(scopes, 'x', 'write')).toBe(false)
  })
})
