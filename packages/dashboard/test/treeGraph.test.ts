import { describe, expect, it } from 'vitest'
import dagre from '@dagrejs/dagre'
import {
  buildGraph,
  countLoadedNodes,
  type DagreModule,
  layoutGraph,
  type TreeNodeLike,
} from '../src/canvas/treeGraph'

/**
 * 画布图构建的纯逻辑。可见性(展开哪些)、自适应折叠、remote 作用域传播、dagre 布局
 * 不变量都在这里钉死 —— 这些是换成画布后最容易回归的点。
 */

const tree: TreeNodeLike[] = [
  {
    path: 'tools',
    kind: 'directory',
    description: 'tools',
    children: [
      { path: 'tools/tavily', kind: 'tool', description: 'search', children: [] },
      { path: 'tools/jira', kind: 'tool', description: 'issues', children: [] },
    ],
  },
  {
    path: 'remote/peer',
    kind: 'remote',
    description: 'federated',
    truncated: true,
    children: [],
  },
]

describe('buildGraph 可见性', () => {
  it('小树默认展开根层:根 + 其直接子节点都出现', () => {
    const { nodes, edges } = buildGraph(tree, { expanded: new Set() })
    const ids = nodes.map(n => n.id).sort()
    expect(ids).toEqual(['remote/peer', 'tools', 'tools/jira', 'tools/tavily'])
    // tools → 两个子节点两条边
    expect(edges.filter(e => e.source === 'tools')).toHaveLength(2)
  })

  it('深层默认折叠:非根分支的子节点要显式展开才出现', () => {
    const deep: TreeNodeLike[] = [{
      path: 'a',
      kind: 'directory',
      description: '',
      children: [{
        path: 'a/b',
        kind: 'directory',
        description: '',
        children: [{ path: 'a/b/c', kind: 'tool', description: '', children: [] }],
      }],
    }]
    const collapsed = buildGraph(deep, { expanded: new Set() })
    // 根 a 展开露出 a/b,但 a/b 默认不展开 → a/b/c 不出现
    expect(collapsed.nodes.map(n => n.id).sort()).toEqual(['a', 'a/b'])
    const expanded = buildGraph(deep, { expanded: new Set(['a/b']) })
    expect(expanded.nodes.map(n => n.id)).toContain('a/b/c')
  })

  it('truncated 分支自身可见,但不强行展开(无子边)', () => {
    const { nodes, edges } = buildGraph(tree, { expanded: new Set() })
    const remote = nodes.find(n => n.id === 'remote/peer')
    expect(remote?.data.truncated).toBe(true)
    expect(edges.filter(e => e.source === 'remote/peer')).toHaveLength(0)
  })
})

describe('buildGraph 自适应折叠', () => {
  it('节点数超阈值:未显式展开的分支全部折叠(只留根)', () => {
    const { nodes } = buildGraph(tree, { expanded: new Set(), autoCollapseThreshold: 2 })
    // 4 个已加载节点 > 2 → autoCollapsed;根层也折叠,只剩两个根
    expect(nodes.map(n => n.id).sort()).toEqual(['remote/peer', 'tools'])
  })

  it('超阈值但用户显式展开的分支仍然展开', () => {
    const { nodes } = buildGraph(tree, {
      expanded: new Set(['tools']),
      autoCollapseThreshold: 2,
    })
    expect(nodes.map(n => n.id)).toContain('tools/tavily')
  })
})

describe('remote 作用域传播', () => {
  it('remote 节点及其后代边都标 remoteScope', () => {
    const withChild: TreeNodeLike[] = [{
      path: 'remote/peer',
      kind: 'remote',
      description: '',
      children: [{ path: 'remote/peer/tool', kind: 'tool', description: '', children: [] }],
    }]
    const { nodes, edges } = buildGraph(withChild, { expanded: new Set(['remote/peer']) })
    expect(nodes.find(n => n.id === 'remote/peer')?.data.remoteScope).toBe(true)
    expect(nodes.find(n => n.id === 'remote/peer/tool')?.data.remoteScope).toBe(true)
    expect(edges[0]?.remoteScope).toBe(true)
  })
})

describe('countLoadedNodes', () => {
  it('递归统计全部已加载节点', () => {
    expect(countLoadedNodes(tree)).toBe(4)
  })
})

describe('layoutGraph', () => {
  it('LR 布局:父节点在子节点左侧(x 更小)', () => {
    const { nodes, edges } = buildGraph(tree, { expanded: new Set() })
    const laid = layoutGraph(nodes, edges, dagre as unknown as DagreModule, 'LR')
    const parent = laid.find(n => n.id === 'tools')!
    const child = laid.find(n => n.id === 'tools/tavily')!
    expect(parent.position.x).toBeLessThan(child.position.x)
  })

  it('空图直接返回,不调用 dagre', () => {
    expect(layoutGraph([], [], dagre as unknown as DagreModule)).toEqual([])
  })
})
