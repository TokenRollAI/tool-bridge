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
import { CircleAlert, Maximize2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
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
import { useCanvasTree, useExpandedPaths } from './useCanvasTree'
import { CanvasNode } from './CanvasNode'

const nodeTypes = { tbNode: CanvasNode }

/** 超过这个已加载节点数,画布默认收成聚焦模式(只展根 + 用户显式展开的分支)。 */
const AUTO_COLLAPSE_THRESHOLD = 60

interface TreeCanvasProps {
  onSelect: (path: string) => void
  /** 当前选中节点(受控;通常来自 URL)。 */
  selectedPath: string | null
}

function CanvasInner({ selectedPath, onSelect }: TreeCanvasProps) {
  const { active } = useSession()
  // 展开集合的种子直接取共享的根查询(depth=1),不必额外跑一遍 useCanvasTree。
  const rootSeed = useTree('', 1)
  const { expanded, toggle, expand } = useExpandedPaths(rootSeed.data?.children, active?.id ?? '')
  const tree = useCanvasTree(expanded)
  const { fitView } = useReactFlow()

  const { nodes, edges } = useMemo(() => {
    const built = buildGraph(tree.roots, {
      expanded,
      autoCollapseThreshold: AUTO_COLLAPSE_THRESHOLD,
    })
    const laid = layoutGraph(built.nodes, built.edges, dagre as unknown as DagreModule, 'LR')
    const rfNodes: Node[] = laid.map(n => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: {
        ...n.data,
        loading: tree.loadingPaths.has(n.id),
      },
      selected: n.id === selectedPath,
    }))
    const rfEdges: Edge[] = built.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      animated: false,
      style: e.remoteScope
        ? { stroke: 'var(--color-brand-to)', strokeDasharray: '4 3', strokeWidth: 1.5 }
        : { stroke: 'var(--border)', strokeWidth: 1.5 },
    }))
    return { nodes: rfNodes, edges: rfEdges }
  }, [tree.roots, tree.loadingPaths, expanded, selectedPath])

  // 首次布局完成后自动 fit;节点集合变化时轻量重 fit。
  useEffect(() => {
    if (nodes.length === 0) return
    const id = requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 300, maxZoom: 1.1 }))
    return () => cancelAnimationFrame(id)
  }, [nodes.length, fitView])

  const onNodeClick: NodeMouseHandler = useCallback(
    (event, node) => {
      const data = node.data as unknown as FlowNodeData
      // 点在展开切换上:只切换展开,不选中。
      const target = event.target as HTMLElement
      if (target.closest('[data-expand-toggle]')) {
        if (data.childCount > 0 || data.truncated) {
          toggle(data.path)
          if (data.truncated) expand(data.path)
        }
        return
      }
      onSelect(data.path)
    },
    [onSelect, toggle, expand],
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
        className="!rounded-lg !border !bg-card"
        maskColor="color-mix(in oklch, var(--background) 70%, transparent)"
        nodeColor="var(--muted)"
        nodeStrokeColor="var(--border)"
        pannable
        zoomable
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
        <CanvasInner onSelect={props.onSelect} selectedPath={props.selectedPath} />
      </ReactFlowProvider>
    </div>
  )
}
