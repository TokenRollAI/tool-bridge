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
  /** 真实节点是否可能暴露命令；命令只在用户展开后按需加载。 */
  canLoadCommands: boolean
  /** 是否允许从画布直接挂载子节点。 */
  canMountChild: boolean
  /** 是否允许从画布直接卸载当前节点。 */
  canUnmountSelf: boolean
  /** 已加载的直接子节点数(用于折叠态徽章)。 */
  childCount: number
  /** 当前已加载的直接子节点路径（快捷挂载用于重复路径提示）。 */
  childPaths: string[]
  /** 仅命令叶子：是否要求调用前确认。 */
  commandConfirm?: boolean
  /** 仅命令叶子：命令副作用提示。 */
  commandEffect?: string
  /** 仅命令叶子：命令短名。 */
  commandName?: string
  /** 仅命令叶子：协议中的完整调用路径。 */
  commandPath?: string
  /** 仅命令叶子：所需 scope。 */
  commandScope?: string
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
  /** 图节点角色：实体树节点、虚拟命令叶子或“查看全部”入口。 */
  role: 'command' | 'commandOverflow' | 'tree'
  /** 是否还有未加载/未展开的子树(懒加载入口)。 */
  truncated: boolean
  /** 虚拟的 `/` 总根，不对应 registry 记录。 */
  virtualRoot: boolean
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
  /** 真实树边或工具 → 命令的虚拟边。 */
  relation: 'commands' | 'tree'
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

/** `~help.cmds` 投影到画布所需的最小形状。 */
export interface CommandNodeLike {
  confirm?: boolean
  effect?: string
  h?: string
  name: string
  path: string
  scope: string
}

export interface BuildGraphOptions {
  /**
   * 自适应阈值:已加载节点总数 > 此值时,未在 `expanded` 里的分支默认折叠
   * (只展根层)。小树全展,大树收成聚焦模式。传 Infinity 关闭自适应。
   */
  autoCollapseThreshold?: number
  /** 用户请求后按需取得的节点命令；缺少 key 表示命令尚不可见。 */
  commandsByPath?: ReadonlyMap<string, readonly CommandNodeLike[]>
  /** 用户手动展开的节点路径集合。 */
  expanded: ReadonlySet<string>
  /** 单个 owner 在图中最多直接展示的命令叶数；其余收进“查看全部”。 */
  maxVisibleCommands?: number
}

/** 节点卡片的标称尺寸(dagre 需要;与 CanvasNode 的实际渲染盒对齐)。 */
export const ROOT_NODE_ID = '__tb_root__'
export const NODE_WIDTH = 272
export const NODE_HEIGHT = 88
export const COMMAND_NODE_WIDTH = 240
export const COMMAND_NODE_HEIGHT = 72
export const COMMAND_NODE_PREFIX = '__tb_command__:'
export const COMMAND_OVERFLOW_PREFIX = '__tb_command_overflow__:'
export const DEFAULT_MAX_VISIBLE_COMMANDS = 10
const RANK_SEP = 64
const NODE_SEP = 24

export function commandNodeId(path: string): string {
  return `${COMMAND_NODE_PREFIX}${encodeURIComponent(path)}`
}

export function commandOverflowId(path: string): string {
  return `${COMMAND_OVERFLOW_PREFIX}${encodeURIComponent(path)}`
}

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
 * `/` 是唯一总根；其余分支只在 `expanded` 集合里时展开。
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
  const maxVisibleCommands = options.maxVisibleCommands ?? DEFAULT_MAX_VISIBLE_COMMANDS
  const loadedCount = countLoadedNodes(roots)
  // 自适应:大树默认折叠(除非用户显式展开);小树默认展开首层可见分支。
  const autoCollapsed = loadedCount > threshold

  const isSystemNode = (node: TreeNodeLike): boolean =>
    node.kind === 'builtin' || node.path === 'system' || node.path.startsWith('system/')

  const isExpanded = (node: TreeNodeLike, depth: number): boolean => {
    if (options.expanded.has(node.path)) return true
    if (autoCollapsed) return false
    // 兼容直接消费单棵子树的场景；画布里的业务节点从 depth=1 开始。
    return depth === 0
  }

  const visit = (node: TreeNodeLike, depth: number, remoteScope: boolean) => {
    const children = node.children ?? []
    // directory 是纯结构节点；其它实体 kind 都可能从 ~help 暴露虚拟命令叶子。
    const canLoadCommands = node.kind !== 'directory'
    const commands = options.commandsByPath?.get(node.path)
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
        role: 'tree',
        label,
        path: node.path,
        kind: node.kind,
        description: node.description,
        depth,
        truncated: node.truncated === true,
        virtualRoot: false,
        remoteScope,
        expanded,
        childCount: children.length,
        childPaths: children.map(child => child.path),
        canLoadCommands,
        canMountChild: !isSystemNode(node),
        canUnmountSelf: node.path !== '' && !isSystemNode(node),
        ...(node.presence !== undefined ? { presence: node.presence } : {}),
      },
    })

    if (expanded) {
      for (const child of children) {
        const childRemote = remoteScope || child.kind === 'remote'
        edges.push({
          id: `${node.path}->${child.path}`,
          source: node.path,
          target: child.path,
          remoteScope: childRemote,
          relation: 'tree',
        })
        visit(child, depth + 1, childRemote)
      }
    }

    // 命令是 ~help 投影的虚拟叶子，直接连接 owner，但不改变真实 childCount 或展开语义。
    if (commands !== undefined) {
      for (const command of commands.slice(0, maxVisibleCommands)) {
        const id = commandNodeId(command.path)
        nodes.push({
          id,
          type: 'tbNode',
          position: { x: 0, y: 0 },
          width: COMMAND_NODE_WIDTH,
          height: COMMAND_NODE_HEIGHT,
          data: {
            role: 'command',
            label: command.name,
            path: node.path,
            kind: node.kind,
            description: command.h ?? '可调用命令',
            depth: depth + 1,
            truncated: false,
            virtualRoot: false,
            remoteScope,
            expanded: false,
            childCount: 0,
            childPaths: [],
            canLoadCommands: false,
            canMountChild: false,
            canUnmountSelf: false,
            commandName: command.name,
            commandPath: command.path,
            commandScope: command.scope,
            ...(command.effect !== undefined ? { commandEffect: command.effect } : {}),
            ...(command.confirm !== undefined ? { commandConfirm: command.confirm } : {}),
          },
        })
        edges.push({
          id: `${node.path}->${id}`,
          source: node.path,
          target: id,
          remoteScope,
          relation: 'commands',
        })
      }

      const hiddenCount = commands.length - maxVisibleCommands
      if (hiddenCount > 0) {
        const id = commandOverflowId(node.path)
        nodes.push({
          id,
          type: 'tbNode',
          position: { x: 0, y: 0 },
          width: COMMAND_NODE_WIDTH,
          height: COMMAND_NODE_HEIGHT,
          data: {
            role: 'commandOverflow',
            label: `还有 ${hiddenCount} 个命令`,
            path: node.path,
            kind: node.kind,
            description: '在详情面板中查看并筛选完整命令目录',
            depth: depth + 1,
            truncated: false,
            virtualRoot: false,
            remoteScope,
            expanded: false,
            childCount: 0,
            childPaths: [],
            canLoadCommands: false,
            canMountChild: false,
            canUnmountSelf: false,
          },
        })
        edges.push({
          id: `${node.path}->${id}`,
          source: node.path,
          target: id,
          remoteScope,
          relation: 'commands',
        })
      }
    }
  }

  const rootExpanded = roots.length > 0 && options.expanded.has('')
  nodes.push({
    id: ROOT_NODE_ID,
    type: 'tbNode',
    position: { x: 0, y: 0 },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    data: {
      role: 'tree',
      label: '/',
      path: '',
      kind: 'directory',
      description: 'Tool Bridge 能力总树',
      depth: 0,
      truncated: false,
      virtualRoot: true,
      remoteScope: false,
      expanded: rootExpanded,
      childCount: roots.length,
      childPaths: roots.map(root => root.path),
      canLoadCommands: false,
      canMountChild: true,
      canUnmountSelf: false,
    },
  })

  if (rootExpanded) {
    for (const root of roots) {
      edges.push({
        id: `${ROOT_NODE_ID}->${root.path}`,
        source: ROOT_NODE_ID,
        target: root.path,
        remoteScope: root.kind === 'remote',
        relation: 'tree',
      })
      visit(root, 1, root.kind === 'remote')
    }
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
