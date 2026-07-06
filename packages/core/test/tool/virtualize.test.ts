import { describe, expect, it } from 'vitest'
import { isTBError } from '../../src/errors'
import type { ToolSpec } from '../../src/tool/types'
import { resolveUpstreamTool, virtualizeTools } from '../../src/tool/virtualize'
import type { Virtualize } from '../../src/types'

const upstream: ToolSpec[] = [
  { name: 'search', description: '搜索' },
  { name: 'fetch', description: '抓取' },
  { name: 'delete', description: '删除' },
]

describe('virtualizeTools(Proto §3.1)', () => {
  it('无 Virtualize:原样暴露 + 恒等 reverse', () => {
    const { exposed, reverse } = virtualizeTools(undefined, upstream)
    expect(exposed.map((t) => t.name)).toEqual(['search', 'fetch', 'delete'])
    expect(reverse.get('search')).toBe('search')
  })

  it('hide:剔除,既不在 exposed 也不在 reverse', () => {
    const { exposed, reverse } = virtualizeTools({ hide: ['delete'] }, upstream)
    expect(exposed.map((t) => t.name)).toEqual(['search', 'fetch'])
    expect(reverse.has('delete')).toBe(false)
  })

  it('rename:虚拟名反查上游原名,原名不再可查', () => {
    const { exposed, reverse } = virtualizeTools({ rename: { search: 'find' } }, upstream)
    expect(exposed.map((t) => t.name)).toContain('find')
    expect(reverse.get('find')).toBe('search')
    expect(reverse.has('search')).toBe(false)
  })

  it('prefix:纯拼接,不注入分隔符', () => {
    const { exposed, reverse } = virtualizeTools({ prefix: 'ns__' }, upstream)
    expect(exposed.map((t) => t.name)).toEqual(['ns__search', 'ns__fetch', 'ns__delete'])
    expect(reverse.get('ns__search')).toBe('search')
    // prefix 无分隔符时也是纯拼接
    const bare = virtualizeTools({ prefix: 'x' }, upstream)
    expect(bare.exposed[0]?.name).toBe('xsearch')
  })

  it('describe:override description(按上游原名索引)', () => {
    const { exposed } = virtualizeTools({ describe: { search: '全文检索' } }, upstream)
    expect(exposed.find((t) => t.name === 'search')?.description).toBe('全文检索')
  })

  it('rename + prefix 叠加:先 rename 再套 prefix', () => {
    const v: Virtualize = { rename: { search: 'find' }, prefix: 'ns__' }
    const { exposed, reverse } = virtualizeTools(v, upstream)
    expect(exposed.map((t) => t.name)).toContain('ns__find')
    expect(reverse.get('ns__find')).toBe('search')
    // rename 前的原名 + prefix 不成立
    expect(reverse.has('ns__search')).toBe(false)
  })

  it('describe 对 rename 的工具:仍按上游原名索引 describe', () => {
    const v: Virtualize = { rename: { search: 'find' }, describe: { search: '改述' } }
    const { exposed } = virtualizeTools(v, upstream)
    expect(exposed.find((t) => t.name === 'find')?.description).toBe('改述')
  })
})

describe('resolveUpstreamTool 反查', () => {
  it('rename 后:虚拟名解析成功、原名 → not_found', () => {
    const v: Virtualize = { rename: { search: 'find' } }
    expect(resolveUpstreamTool(v, upstream, 'find')).toBe('search')
    try {
      resolveUpstreamTool(v, upstream, 'search')
      throw new Error('应抛 not_found')
    } catch (e) {
      expect(isTBError(e) && e.code).toBe('not_found')
    }
  })

  it('hidden 工具不可调用 → not_found(不泄露存在性)', () => {
    const v: Virtualize = { hide: ['delete'] }
    try {
      resolveUpstreamTool(v, upstream, 'delete')
      throw new Error('应抛 not_found')
    } catch (e) {
      expect(isTBError(e) && e.code).toBe('not_found')
    }
  })

  it('接受预先算好的 reverse Map', () => {
    const { reverse } = virtualizeTools({ prefix: 'ns__' }, upstream)
    expect(resolveUpstreamTool(undefined, reverse, 'ns__fetch')).toBe('fetch')
  })

  it('完全未知的名字 → not_found', () => {
    expect(() => resolveUpstreamTool(undefined, upstream, 'nope')).toThrow()
  })
})
