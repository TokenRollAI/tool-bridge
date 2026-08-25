import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, Maximize2, RefreshCw } from 'lucide-react'
import { useTheme } from 'next-themes'
import dagre from '@dagrejs/dagre'
import '@xyflow/react/dist/style.css'
import { useSession } from '@/lib/session-context'
import { Button } from '@/components/ui/button'
import { useTree } from '@/lib/queries'
import { cn } from '@/lib/utils'
import {
  buildGraph,
  type DagreModule,
  type FlowNodeData,
  layoutGraph,
} from './treeGraph'
import { useCanvasCommands, useCanvasTree, useExpandedPaths } from './useCanvasTree'
import { CanvasNode, type CanvasNodeAction } from './CanvasNode'

const nodeTypes = { tbNode: CanvasNode }

/** 超过这个已加载节点数,画布默认收成聚焦模式(只展根 + 用户显式展开的分支)。 */
const AUTO_COLLAPSE_THRESHOLD = 60

interface TreeCanvasProps {
  onAddChild?: (target: CanvasActionTarget) => void
  onDelete?: (target: CanvasActionTarget) => void
  onOpenCommand: (path: string, commandName: string) => void
  onOpenCommands: (path: string) => void
  onSelect: (path: string) => void
  /** 当前选中节点(受控;通常来自 URL)。 */
  selectedPath: string | null
}

export interface CanvasActionTarget {
  childPaths: string[]
  description: string
  hasUnloadedPaths: boolean
  label: string
  path: string
}

/** MiniMap 只画矩形，用稳定高对比色编码角色/kind，不能复用暗色卡片 token。 */
function minimapNodeColor(node: Node): string {
  const data = node.data as unknown as FlowNodeData
  if (node.selected || data.virtualRoot) return '#facc15'
  if (data.role !== 'tree') return '#f59e0b'
  if (data.remoteScope) return '#d946ef'
  const colors: Partial<Record<FlowNodeData['kind'], string>> = {
    builtin: '#38bdf8',
    context: '#34d399',
    device: '#fbbf24',
    directory: '#94a3b8',
    http: '#2dd4bf',
    mcp: '#a78bfa',
    skillhub: '#818cf8',
    tool: '#fb7185',
  }
  return colors[data.kind] ?? '#94a3b8'
}

function CanvasInner({
  selectedPath,
  onSelect,
  onAddChild,
  onDelete,
  onOpenCommand,
  onOpenCommands,
}: TreeCanvasProps) {
  const { active } = useSession()
  const { resolvedTheme } = useTheme()
  const colorMode = resolvedTheme === 'light' ? 'light' : 'dark'
  // 展开集合的种子直接取共享的根查询(depth=1),不必额外跑一遍 useCanvasTree。
  const rootSeed = useTree('', 1)
  const { expanded, toggle } = useExpandedPaths(rootSeed.data?.children, active?.id ?? '')
  const [lazyPaths, setLazyPaths] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const [commandOwners, setCommandOwners] = useState<ReadonlySet<string>>(() => new Set())
  const tree = useCanvasTree(expanded, lazyPaths)
  const { fitView } = useReactFlow()
  const fittedProfileRef = useRef<string | null>(null)

  useEffect(() => {
    setLazyPaths(new Map())
    setCommandOwners(new Set())
  }, [active?.id])

  // 命令 help 只订阅当前图中可见且用户明确打开过的 owner；折叠祖先会停止 observer。
  const visibleTreePaths = useMemo(() => {
    const graph = buildGraph(tree.roots, {
      expanded,
      autoCollapseThreshold: AUTO_COLLAPSE_THRESHOLD,
    })
    return new Set(graph.nodes.filter(node => node.data.role === 'tree').map(node => node.data.path))
  }, [tree.roots, expanded])
  const visibleCommandOwners = useMemo(
    () => new Set([...commandOwners].filter(path => visibleTreePaths.has(path))),
    [commandOwners, visibleTreePaths],
  )
  const commandTree = useCanvasCommands(visibleCommandOwners)

  const onNodeAction = useCallback(
    (action: CanvasNodeAction, data: FlowNodeData) => {
      if (action === 'toggle') {
        if (data.truncated && !data.expanded) {
          setLazyPaths((current) => {
            const next = new Map(current)
            next.set(data.path, data.remoteScope)
            return next
          })
        }
        toggle(data.path)
        return
      }
      if (action === 'commands') {
        if (commandTree.errorPaths.has(data.path)) {
          commandTree.refetch(data.path)
          return
        }
        setCommandOwners((current) => {
          const next = new Set(current)
          if (next.has(data.path)) {
            next.delete(data.path)
          } else {
            next.add(data.path)
          }
          return next
        })
        return
      }
      if (action === 'invoke' && data.commandName) {
        onOpenCommand(data.path, data.commandName)
        return
      }
      if (action === 'openCommands') {
        onOpenCommands(data.path)
        return
      }
      if (action === 'inspect') {
        onSelect(data.path)
        return
      }
      const target: CanvasActionTarget = {
        path: data.path,
        label: data.label,
        description: data.description,
        childPaths: data.childPaths,
        hasUnloadedPaths: data.truncated,
      }
      if (action === 'add') onAddChild?.(target)
      if (action === 'delete') onDelete?.(target)
    },
    [
      commandTree,
      onAddChild,
      onDelete,
      onOpenCommand,
      onOpenCommands,
      onSelect,
      toggle,
    ],
  )

  const { nodes, edges } = useMemo(() => {
    const built = buildGraph(tree.roots, {
      expanded,
      autoCollapseThreshold: AUTO_COLLAPSE_THRESHOLD,
      commandsByPath: commandTree.commandsByPath,
    })
    const laid = layoutGraph(built.nodes, built.edges, dagre as unknown as DagreModule, 'LR')
    const rfNodes: Node[] = laid.map(n => ({
      id: n.id,
      type: n.type,
      position: n.position,
      width: n.width,
      height: n.height,
      data: {
        ...n.data,
        loading: tree.loadingPaths.has(n.id),
        commandsOpen: n.data.role === 'tree' && commandOwners.has(n.data.path),
        commandLoading: n.data.role === 'tree' && commandTree.loadingPaths.has(n.data.path),
        commandError: n.data.role === 'tree' && commandTree.errorPaths.has(n.data.path),
        onAction: (action: CanvasNodeAction) => onNodeAction(action, n.data),
      },
      selected: n.data.role === 'tree' && n.data.path === selectedPath,
    }))
    const rfEdges: Edge[] = built.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      animated: false,
      style: e.relation === 'commands'
        ? { stroke: '#f59e0b', strokeDasharray: '3 3', strokeWidth: 1.5 }
        : e.remoteScope
          ? { stroke: 'var(--color-brand-to)', strokeDasharray: '4 3', strokeWidth: 1.5 }
          : { stroke: 'var(--border)', strokeWidth: 1.5 },
    }))
    return { nodes: rfNodes, edges: rfEdges }
  }, [
    tree.roots,
    tree.loadingPaths,
    expanded,
    commandTree.commandsByPath,
    commandTree.loadingPaths,
    commandTree.errorPaths,
    commandOwners,
    selectedPath,
    onNodeAction,
  ])

  // 每个连接首次布局后只自动适配一次；后续展开、选中和命令显隐必须保留用户视口。
  useEffect(() => {
    if (nodes.length === 0) return
    const profileId = active?.id ?? ''
    if (fittedProfileRef.current === profileId) return
    fittedProfileRef.current = profileId
    const id = requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 300, maxZoom: 1.1 }))
    return () => cancelAnimationFrame(id)
  }, [active?.id, nodes.length, fitView])

  const onNodeClick: NodeMouseHandler = useCallback(
    (event, node) => {
      const data = node.data as unknown as FlowNodeData
      // 节点内部快捷按钮自己处理动作，不再触发卡片的详情行为。
      const target = event.target as HTMLElement
      if (target.closest('button')) return
      if (data.role === 'command' && data.commandName) {
        onOpenCommand(data.path, data.commandName)
        return
      }
      if (data.role === 'commandOverflow') {
        onOpenCommands(data.path)
        return
      }
      onSelect(data.path)
    },
    [onOpenCommand, onOpenCommands, onSelect],
  )

  if (tree.isPending) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin text-primary" />
          正在加载工作树…
        </div>
      </div>
    )
  }

  if (tree.isError) {
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="max-w-sm rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-center">
          <CircleAlert className="mx-auto size-6 text-destructive" />
          <p className="mt-3 text-sm font-medium">工作树加载失败</p>
          <p className="mt-1 text-xs break-words text-muted-foreground">{tree.error?.message}</p>
          <Button className="mt-4" onClick={tree.refetchRoot} size="sm" variant="outline">
            <RefreshCw />
            重试
          </Button>
        </div>
      </div>
    )
  }

  return (
    <ReactFlow
      className="tb-canvas"
      colorMode={colorMode}
      edges={edges}
      fitView
      maxZoom={1.6}
      minZoom={0.2}
      nodes={nodes}
      nodesConnectable={false}
      nodesDraggable={false}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      panOnScroll
      proOptions={{ hideAttribution: true }}
      selectionOnDrag={false}
      zoomOnDoubleClick={false}
    >
      <Background color="var(--border)" gap={22} variant={BackgroundVariant.Dots} />
      <Controls
        className="!rounded-lg !border !bg-card !shadow-md [&_button]:!border-border [&_button]:!bg-card [&_button:hover]:!bg-accent [&_button_svg]:!fill-foreground"
        showInteractive={false}
      />
      <MiniMap
        ariaLabel="能力树导航缩略图"
        bgColor="var(--card)"
        className="!rounded-xl !border !border-border !shadow-lg max-sm:!hidden"
        maskColor="rgb(2 6 23 / 0.28)"
        maskStrokeColor="var(--primary)"
        maskStrokeWidth={1.25}
        nodeBorderRadius={6}
        nodeColor={minimapNodeColor}
        nodeStrokeColor="rgb(15 23 42 / 0.72)"
        nodeStrokeWidth={1}
        pannable
        style={{ width: 176, height: 112 }}
      />
    </ReactFlow>
  )
}

/** 「适应视图」浮动按钮(放在 Provider 内才能用 useReactFlow)。 */
function FitButton() {
  const { fitView } = useReactFlow()
  return (
    <Button
      aria-label="适应视图"
      className="absolute top-3 right-3 z-10 shadow-md"
      onClick={() => void fitView({ padding: 0.2, duration: 300 })}
      size="icon-sm"
      title="适应视图"
      variant="outline"
    >
      <Maximize2 />
    </Button>
  )
}

/**
 * 工作树画布:React Flow 承载整棵可见树,dagre 自动布局。点击节点交给上层开 Inspector,
 * 点击展开切换就地懒加载子树。数据/性能边界与 TreeNav 一致(root depth=1、按需懒加载)。
 */
export function TreeCanvas(props: TreeCanvasProps & { className?: string }) {
  return (
    <div className={cn('relative h-full min-h-0 w-full', props.className)}>
      <ReactFlowProvider>
        <FitButton />
        <CanvasInner
          onAddChild={props.onAddChild}
          onDelete={props.onDelete}
          onOpenCommand={props.onOpenCommand}
          onOpenCommands={props.onOpenCommands}
          onSelect={props.onSelect}
          selectedPath={props.selectedPath}
        />
      </ReactFlowProvider>
    </div>
  )
}
