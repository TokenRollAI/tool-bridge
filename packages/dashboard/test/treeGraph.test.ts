import { describe, expect, it } from 'vitest'
import dagre from '@dagrejs/dagre'
import {
  buildGraph,
  commandNodeId,
  commandOverflowId,
  countLoadedNodes,
  type DagreModule,
  layoutGraph,
  ROOT_NODE_ID,
  type TreeNodeLike,
} from '../src/canvas/treeGraph'

/** 画布的 `/` 总根、可见性、remote 传播和布局不变量。 */
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

describe('buildGraph 总根与可见性', () => {
  it('以唯一 `/` 总根连接全部一级主树', () => {
    const { nodes, edges } = buildGraph(tree, { expanded: new Set(['']) })
    expect(nodes.map(n => n.id).sort()).toEqual([ROOT_NODE_ID, 'remote/peer', 'tools'].sort())
    expect(nodes.find(n => n.id === ROOT_NODE_ID)?.data).toMatchObject({
      path: '',
      label: '/',
      virtualRoot: true,
      childCount: 2,
      expanded: true,
    })
    expect(edges.filter(edge => edge.source === ROOT_NODE_ID)).toHaveLength(2)
  })

  it('一级节点显式展开后显示直接子节点', () => {
    const { nodes, edges } = buildGraph(tree, { expanded: new Set(['', 'tools']) })
    expect(nodes.map(n => n.id).sort()).toEqual([
      ROOT_NODE_ID,
      'remote/peer',
      'tools',
      'tools/jira',
      'tools/tavily',
    ].sort())
    expect(edges.filter(edge => edge.source === 'tools')).toHaveLength(2)
  })

  it('深层分支仍需逐级展开', () => {
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
    const collapsed = buildGraph(deep, { expanded: new Set(['', 'a']) })
    expect(collapsed.nodes.map(n => n.id).sort()).toEqual([ROOT_NODE_ID, 'a', 'a/b'].sort())
    const expanded = buildGraph(deep, { expanded: new Set(['', 'a', 'a/b']) })
    expect(expanded.nodes.map(n => n.id)).toContain('a/b/c')
  })

  it('折叠总根时只保留 `/`，不留下悬边', () => {
    const { nodes, edges } = buildGraph(tree, { expanded: new Set() })
    expect(nodes.map(node => node.id)).toEqual([ROOT_NODE_ID])
    expect(edges).toEqual([])
  })

  it('truncated 分支可见但未展开时不强行产生子边', () => {
    const { nodes, edges } = buildGraph(tree, { expanded: new Set(['']) })
    const remote = nodes.find(n => n.id === 'remote/peer')
    expect(remote?.data.truncated).toBe(true)
    expect(edges.filter(e => e.source === 'remote/peer')).toHaveLength(0)
  })
})

describe('buildGraph 自适应折叠', () => {
  it('节点数超阈值时仍只展示显式展开的分支', () => {
    const { nodes } = buildGraph(tree, {
      expanded: new Set(['']),
      autoCollapseThreshold: 2,
    })
    expect(nodes.map(n => n.id).sort()).toEqual([ROOT_NODE_ID, 'remote/peer', 'tools'].sort())
  })

  it('超阈值但用户显式展开的分支仍然展开', () => {
    const { nodes } = buildGraph(tree, {
      expanded: new Set(['', 'tools']),
      autoCollapseThreshold: 2,
    })
    expect(nodes.map(n => n.id)).toContain('tools/tavily')
  })
})

describe('命令虚拟子树', () => {
  const registry: TreeNodeLike[] = [{
    path: 'system/registry',
    kind: 'builtin',
    description: 'registry',
    children: [],
  }]
  const commands = [
    { name: 'list', path: 'system/registry/list', scope: 'read', h: 'list nodes' },
    { name: 'write', path: 'system/registry/write', scope: 'register', h: 'mount node' },
  ]

  it('没有显式命令状态时保持纯实体树，真实 childCount 不受命令影响', () => {
    const { nodes } = buildGraph(registry, { expanded: new Set(['']) })
    expect(nodes.map(node => node.id)).toEqual([ROOT_NODE_ID, 'system/registry'])
    expect(nodes.find(node => node.id === 'system/registry')?.data).toMatchObject({
      role: 'tree',
      childCount: 0,
      canLoadCommands: true,
    })
  })

  it('打开 owner 后直接显示命令叶，并由 owner 直接连接', () => {
    const commandsByPath = new Map([['system/registry', commands]])
    const opened = buildGraph(registry, {
      expanded: new Set(['']),
      commandsByPath,
    })
    expect(opened.nodes.map(node => node.id)).toEqual(expect.arrayContaining([
      commandNodeId('system/registry/list'),
      commandNodeId('system/registry/write'),
    ]))
    expect(opened.nodes.map(node => node.data.role)).not.toContain('commandGroup')
    expect(opened.edges.find(edge => edge.target === commandNodeId('system/registry/list')))
      .toMatchObject({ source: 'system/registry', relation: 'commands' })
    expect(opened.nodes.find(node => node.id === commandNodeId('system/registry/write'))?.data)
      .toMatchObject({
        role: 'command',
        path: 'system/registry',
        commandName: 'write',
        commandPath: 'system/registry/write',
        commandScope: 'register',
      })
  })

  it('owner 不可见时不留下命令叶或悬边', () => {
    const commandsByPath = new Map([['tools/tavily', commands]])
    const { nodes, edges } = buildGraph(tree, {
      expanded: new Set(['']),
      commandsByPath,
    })
    expect(nodes.some(node => node.data.role === 'command')).toBe(false)
    expect(edges.every(edge => nodes.some(node => node.id === edge.source))).toBe(true)
    expect(edges.every(edge => nodes.some(node => node.id === edge.target))).toBe(true)
  })

  it('命令过多时限制叶子数量并追加完整目录入口', () => {
    const many = Array.from({ length: 4 }, (_, index) => ({
      name: `cmd-${index}`,
      path: `system/registry/cmd-${index}`,
      scope: 'read',
    }))
    const { nodes } = buildGraph(registry, {
      expanded: new Set(['']),
      commandsByPath: new Map([['system/registry', many]]),
      maxVisibleCommands: 2,
    })
    expect(nodes.filter(node => node.data.role === 'command')).toHaveLength(2)
    expect(nodes.find(node => node.id === commandOverflowId('system/registry'))?.data)
      .toMatchObject({ role: 'commandOverflow', label: '还有 2 个命令' })
  })

  it('LR 布局保持 owner → 命令的直接父子顺序', () => {
    const built = buildGraph(registry, {
      expanded: new Set(['']),
      commandsByPath: new Map([['system/registry', commands]]),
    })
    const laid = layoutGraph(built.nodes, built.edges, dagre as unknown as DagreModule, 'LR')
    const owner = laid.find(node => node.id === 'system/registry')!
    const command = laid.find(node => node.id === commandNodeId('system/registry/list'))!
    expect(owner.position.x).toBeLessThan(command.position.x)
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
    const { nodes, edges } = buildGraph(withChild, {
      expanded: new Set(['', 'remote/peer']),
    })
    expect(nodes.find(n => n.id === 'remote/peer')?.data.remoteScope).toBe(true)
    expect(nodes.find(n => n.id === 'remote/peer/tool')?.data.remoteScope).toBe(true)
    expect(edges.every(edge => edge.remoteScope)).toBe(true)
  })
})

describe('countLoadedNodes', () => {
  it('递归统计 API 已加载节点，不把虚拟总根计入', () => {
    expect(countLoadedNodes(tree)).toBe(4)
  })
})

describe('layoutGraph', () => {
  it('LR 布局：总根在一级节点左侧，父节点也在子节点左侧', () => {
    const { nodes, edges } = buildGraph(tree, { expanded: new Set(['', 'tools']) })
    const laid = layoutGraph(nodes, edges, dagre as unknown as DagreModule, 'LR')
    const root = laid.find(n => n.id === ROOT_NODE_ID)!
    const parent = laid.find(n => n.id === 'tools')!
    const child = laid.find(n => n.id === 'tools/tavily')!
    expect(root.position.x).toBeLessThan(parent.position.x)
    expect(parent.position.x).toBeLessThan(child.position.x)
  })

  it('空图直接返回，不调用 dagre', () => {
    expect(layoutGraph([], [], dagre as unknown as DagreModule)).toEqual([])
  })
})
