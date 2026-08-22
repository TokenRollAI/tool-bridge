/**
 * 工作树 → React Flow 图的纯逻辑(无 React / 无 DOM 依赖,可被 Node vitest 直接断言)。
 *
 * 抽成纯函数是本仓既有姿势(见 forms/*.ts):布局结果、展开集合、聚焦裁剪都能被
 * 断言,而不必起画布。React 组件只消费这里的输出。
 *
 * 三条硬边界(与 TreeNav 的性能约束对齐,不能因为换成画布就丢):
 * - 只渲染"已加载 + 已展开"的节点;truncated/remote 子树按需懒加载,不在这里强行铺开。
 * - offline 设备节点由 `pruneOfflineNodes` 在进入前剪掉(调用方负责)。
 * - 自适应展开:节点总数超过阈值时默认只展根层,避免一次性布局数百节点卡顿。
 */

import type { NodeKind, Presence } from '@/lib/types'

/** 画布自定义节点携带的数据(消费方:CanvasNode 组件)。 */
export interface FlowNodeData {
  [key: string]: unknown
  /** 已加载的直接子节点数(用于折叠态徽章)。 */
  childCount: number
  /** 该节点在当前图里的深度(0 = 根层)。 */
  depth: number
  description: string
  /** 是否已在展开集合中(有子节点时才有意义)。 */
  expanded: boolean
  kind: NodeKind
  /** 末段短名(展示用);根路径展示为 '/'。 */
  label: string
  /** 树内绝对路径(本地化后)。 */
  path: string
  /** 仅 device:三态在线状态。 */
  presence?: Presence
  /** 是否处在 remote 联邦作用域内(含 remote 自身)。 */
  remoteScope: boolean
  /** 是否还有未加载/未展开的子树(懒加载入口)。 */
  truncated: boolean
}

/** React Flow 节点的最小形状(不引入 @xyflow 类型,保持本模块纯粹可测)。 */
export interface FlowNode {
  data: FlowNodeData
  height?: number
  id: string
  position: { x: number, y: number }
  type: 'tbNode'
  /** dagre 布局前的占位;布局后回填真实尺寸。 */
  width?: number
}

export interface FlowEdge {
  id: string
  /** remote 边用不同色/虚线标出联邦边界。 */
  remoteScope: boolean
  source: string
  target: string
}

/** 树节点的最小消费形状(对齐 lib/types 的 TreeJson,但只取本模块需要的字段)。 */
export interface TreeNodeLike {
  children?: TreeNodeLike[]
  description: string
  kind: NodeKind
  path: string
  presence?: Presence
  truncated?: boolean
}

export interface BuildGraphOptions {
  /**
   * 自适应阈值:已加载节点总数 > 此值时,未在 `expanded` 里的分支默认折叠
   * (只展根层)。小树全展,大树收成聚焦模式。传 Infinity 关闭自适应。
   */
  autoCollapseThreshold?: number
  /** 用户手动展开的节点路径集合。 */
  expanded: ReadonlySet<string>
}

/** 节点卡片的标称尺寸(dagre 需要;与 CanvasNode 的实际渲染盒对齐)。 */
export const NODE_WIDTH = 232
export const NODE_HEIGHT = 60
const RANK_SEP = 64
const NODE_SEP = 24

/** 统计一棵(已加载)树的节点总数,用于自适应展开判定。 */
export function countLoadedNodes(roots: readonly TreeNodeLike[]): number {
  let total = 0
  const visit = (node: TreeNodeLike) => {
    total += 1
    node.children?.forEach(visit)
  }
  roots.forEach(visit)
  return total
}

/**
 * 把(已剪枝的)根子节点数组编译成扁平的 nodes/edges。
 *
 * 只产出"可见"节点:一个分支的子节点当且仅当该分支被视为展开时才产出。
 * 展开判定 = 在 `expanded` 集合里,或(小树且自适应未触发时)默认展开。
 *
 * 不做 dagre 布局(位置留 0),交给 `layoutGraph` —— 拆开是为了让"哪些节点可见"
 * 这条逻辑能被单测,不必依赖布局库。
 */
export function buildGraph(
  roots: readonly TreeNodeLike[],
  options: BuildGraphOptions,
): { edges: FlowEdge[], nodes: FlowNode[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const threshold = options.autoCollapseThreshold ?? Infinity
  const loadedCount = countLoadedNodes(roots)
  // 自适应:大树默认折叠(除非用户显式展开);小树默认展开首层可见分支。
  const autoCollapsed = loadedCount > threshold

  const isExpanded = (node: TreeNodeLike, depth: number): boolean => {
    if (options.expanded.has(node.path)) return true
    if (autoCollapsed) return false
    // 小树:根层默认展开,更深层要用户点开(避免深树一次性全铺)。
    return depth === 0
  }

  const visit = (node: TreeNodeLike, depth: number, remoteScope: boolean) => {
    const children = node.children ?? []
    const expandable = children.length > 0 || node.truncated === true
    const expanded = expandable && isExpanded(node, depth)
    const label = node.path === '' ? '/' : (node.path.split('/').pop() ?? node.path)

    nodes.push({
      id: node.path,
      type: 'tbNode',
      position: { x: 0, y: 0 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: {
        label,
        path: node.path,
        kind: node.kind,
        description: node.description,
        depth,
        truncated: node.truncated === true,
        remoteScope,
        expanded,
        childCount: children.length,
        ...(node.presence !== undefined ? { presence: node.presence } : {}),
      },
    })

    if (!expanded) return
    for (const child of children) {
      const childRemote = remoteScope || child.kind === 'remote'
      edges.push({
        id: `${node.path}->${child.path}`,
        source: node.path,
        target: child.path,
        remoteScope: childRemote,
      })
      visit(child, depth + 1, childRemote)
    }
  }

  for (const root of roots) {
    visit(root, 0, root.kind === 'remote')
  }
  return { nodes, edges }
}

export type LayoutDirection = 'LR' | 'TB'

/**
 * 用 dagre 给已构建的 nodes/edges 计算位置。dagre 是唯一有副作用(构图)的一步,
 * 但输入输出都是纯数据,故仍可测:断言"父在子左侧 / 上方"这类不变量。
 *
 * dagre 以中心锚点布局,React Flow 以左上角定位,末尾转换一次。
 */
export function layoutGraph<N extends { height?: number, id: string, position: { x: number, y: number }, width?: number }>(
  nodes: N[],
  edges: ReadonlyArray<{ source: string, target: string }>,
  dagre: DagreModule,
  direction: LayoutDirection = 'LR',
): N[] {
  if (nodes.length === 0) return nodes
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: direction, ranksep: RANK_SEP, nodesep: NODE_SEP, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of nodes) {
    g.setNode(node.id, { width: node.width ?? NODE_WIDTH, height: node.height ?? NODE_HEIGHT })
  }
  for (const edge of edges) {
    // 只连两端都在集合里的边(懒加载/裁剪后可能有悬边)。
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const laid = g.node(node.id)
    if (laid === undefined) return node
    const width = node.width ?? NODE_WIDTH
    const height = node.height ?? NODE_HEIGHT
    return {
      ...node,
      position: { x: laid.x - width / 2, y: laid.y - height / 2 },
    }
  })
}

/** dagre 的最小接口(只用到这几处;避免把 @dagrejs/dagre 类型泄漏进纯逻辑签名)。 */
export interface DagreModule {
  graphlib: {
    Graph: new () => {
      node: (id: string) => { x: number, y: number } | undefined
      setDefaultEdgeLabel: (fn: () => unknown) => void
      setEdge: (source: string, target: string) => void
      setGraph: (opts: Record<string, unknown>) => void
      setNode: (id: string, dims: { height: number, width: number }) => void
    }
  }
  layout: (g: unknown) => void
}
