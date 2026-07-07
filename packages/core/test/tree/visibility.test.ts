import { describe, expect, it } from 'vitest'
import { filterVisible, type ScopeChecker } from '../../src/tree/visibility'
import type { Scope, TreeNode } from '../../src/types'

function node(path: string): TreeNode {
  return {
    path,
    kind: 'directory',
    description: '',
    registeredBy: 'user:1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const nodes = [node('docs'), node('docs/context7'), node('device/build-01'), node('system/sk')]

describe('filterVisible(可见性裁剪)', () => {
  it('剔除对 (path,read) 判不过的节点', async () => {
    // 行内 stub:只放行 docs 子树的 read(真实 checkScopes 由并行 worker 提供)
    const stub: ScopeChecker = (_scopes, path, action) =>
      action === 'read' && (path === 'docs' || path.startsWith('docs/'))
    const visible = filterVisible(nodes, [], stub)
    expect(visible.map((n) => n.path)).toEqual(['docs', 'docs/context7'])
  })

  it('checker 始终以 read 动作与 node.path 调用', async () => {
    const seen: Array<[string, string]> = []
    const stub: ScopeChecker = (_s, path, action) => {
      seen.push([path, action])
      return true
    }
    const scopes: Scope[] = [{ pattern: '**', actions: ['read'] }]
    filterVisible([node('a'), node('b')], scopes, stub)
    expect(seen).toEqual([
      ['a', 'read'],
      ['b', 'read'],
    ])
  })

  it('全部放行 → 原样返回', () => {
    const allow: ScopeChecker = () => true
    expect(filterVisible(nodes, [], allow)).toHaveLength(nodes.length)
  })

  it('全部拒绝 → 空', () => {
    const deny: ScopeChecker = () => false
    expect(filterVisible(nodes, [], deny)).toEqual([])
  })
})
