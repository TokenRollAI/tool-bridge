import {
  ArrowUpRight,
  ChevronRight,
  CircleAlert,
  Info,
  Loader2,
  Plus,
  TerminalSquare,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Handle, type NodeProps, Position } from '@xyflow/react'
import { memo, type MouseEvent } from 'react'
import { KIND_ICON } from '@/components/kind-icon'
import { PRESENCE_TONE } from '@/lib/presence'
import { cn } from '@/lib/utils'
import {
  COMMAND_NODE_HEIGHT,
  COMMAND_NODE_WIDTH,
  type FlowNodeData,
  NODE_HEIGHT,
  NODE_WIDTH,
} from './treeGraph'

/** kind → 左侧色带(与 KindBadge / TreeNav 同一套色相编码)。 */
const KIND_ACCENT: Record<string, string> = {
  directory: 'bg-muted-foreground/40',
  builtin: 'bg-sky-400',
  mcp: 'bg-violet-400',
  http: 'bg-teal-400',
  remote: 'bg-fuchsia-400',
  context: 'bg-emerald-400',
  skillhub: 'bg-indigo-400',
  device: 'bg-amber-400',
  tool: 'bg-rose-400',
}

export type CanvasNodeAction
  = | 'add'
    | 'commands'
    | 'delete'
    | 'inspect'
    | 'invoke'
    | 'openCommands'
    | 'toggle'

type InteractiveFlowNodeData = FlowNodeData & {
  commandError?: boolean
  commandLoading?: boolean
  commandsOpen?: boolean
  loading?: boolean
  onAction?: (action: CanvasNodeAction) => void
}

/** 节点内按钮不触发卡片的“打开详情”，动作统一交还 TreeCanvas 编排。 */
function runAction(
  event: MouseEvent<HTMLButtonElement>,
  node: InteractiveFlowNodeData,
  action: CanvasNodeAction,
) {
  event.stopPropagation()
  node.onAction?.(action)
}

/**
 * 画布节点卡片：用途说明始终可见，展开/详情/新增/删除均可就地操作。
 * 尺寸与 treeGraph 的 NODE_WIDTH/HEIGHT 对齐，dagre 才能算准布局。
 */
function TreeCanvasNode({ data, selected }: NodeProps) {
  const node = data as InteractiveFlowNodeData
  const { icon: Icon, className: iconClass } = KIND_ICON[node.kind] ?? KIND_ICON.directory
  const expandable = node.childCount > 0 || node.truncated
  const presenceTone = node.presence ? PRESENCE_TONE[node.presence.state] : null
  const pathLabel = node.path === '' ? '能力总树' : node.path

  return (
    <div
      aria-label={`${pathLabel}，${node.description || '无描述'}`}
      className={cn(
        'group relative flex overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all',
        'hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md',
        selected
          ? 'border-primary ring-2 ring-primary/35'
          : node.remoteScope
            ? 'border-fuchsia-400/30'
            : 'border-border',
      )}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <Handle
        className="!size-1.5 !border-0 !bg-border"
        isConnectable={false}
        position={Position.Left}
        type="target"
      />

      <span
        aria-hidden
        className={cn(
          'h-full w-1 shrink-0',
          KIND_ACCENT[node.kind] ?? KIND_ACCENT.directory,
        )}
      />

      <div className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2">
        <span
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-lg border bg-background/70',
            iconClass,
          )}
        >
          <Icon className="size-4" strokeWidth={1.75} />
        </span>

        <div className="min-w-0 flex-1 self-stretch">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] leading-tight font-medium">
              {node.label}
            </span>
            {node.remoteScope && node.kind === 'remote' && (
              <span className="shrink-0 rounded border border-fuchsia-400/30 px-1 font-mono text-[8px] leading-3 text-fuchsia-400">
                REMOTE
              </span>
            )}
            {presenceTone && (
              <span
                className={cn('size-2 shrink-0 rounded-full', presenceTone)}
                title={node.presence?.state}
              />
            )}
          </div>

          <p
            className="mt-1 truncate text-[10px] leading-4 text-muted-foreground"
            title={node.description || '该节点没有提供说明'}
          >
            {node.description || '该节点没有提供说明'}
          </p>

          <div className="mt-1 flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
            <span>{node.virtualRoot ? 'ROOT' : node.kind}</span>
            {expandable && (
              <span className="tabular-nums">
                {node.childCount}
                {' 子节点'}
                {node.truncated ? '+' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="nodrag nowheel grid shrink-0 grid-cols-3 gap-0.5 border-l pl-1.5">
          {expandable && (
            <button
              aria-expanded={node.expanded}
              aria-label={node.expanded ? `折叠 ${pathLabel}` : `展开 ${pathLabel}`}
              className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              data-expand-toggle
              disabled={node.loading}
              onClick={event => runAction(event, node, 'toggle')}
              title={node.expanded ? '折叠子树' : '展开子树'}
              type="button"
            >
              {node.loading
                ? <Loader2 className="size-3.5 animate-spin text-primary" />
                : (
                    <ChevronRight
                      className={cn('size-3.5 transition-transform', node.expanded && 'rotate-90')}
                    />
                  )}
            </button>
          )}
          <button
            aria-label={`查看 ${pathLabel} 详情`}
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={event => runAction(event, node, 'inspect')}
            title="查看详情"
            type="button"
          >
            <Info className="size-3.5" />
          </button>
          {node.canLoadCommands && (
            <button
              aria-expanded={node.commandsOpen === true}
              aria-label={node.commandsOpen ? `隐藏 ${pathLabel} 的命令` : `显示 ${pathLabel} 的命令`}
              className={cn(
                'grid size-6 place-items-center rounded-md text-muted-foreground transition-colors',
                'hover:bg-amber-400/10 hover:text-amber-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                node.commandsOpen && 'bg-amber-400/10 text-amber-400',
                node.commandError && 'text-destructive',
              )}
              disabled={node.commandLoading}
              onClick={event => runAction(event, node, 'commands')}
              title={node.commandError ? '命令加载失败，点击重试' : node.commandsOpen ? '隐藏命令' : '显示命令'}
              type="button"
            >
              {node.commandLoading
                ? <Loader2 className="size-3.5 animate-spin" />
                : node.commandError
                  ? <CircleAlert className="size-3.5" />
                  : <TerminalSquare className="size-3.5" />}
            </button>
          )}
          {node.canMountChild && (
            <button
              aria-label={`在 ${pathLabel} 下挂载节点`}
              className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={event => runAction(event, node, 'add')}
              title="挂载子节点"
              type="button"
            >
              <Plus className="size-3.5" />
            </button>
          )}
          {node.canUnmountSelf && (
            <button
              aria-label={`卸载 ${pathLabel}`}
              className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={event => runAction(event, node, 'delete')}
              title="卸载节点"
              type="button"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <Handle
        className="!size-1.5 !border-0 !bg-border"
        isConnectable={false}
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

/** 命令叶是前端投影，不暴露真实节点的挂载/卸载动作。 */
function CommandCanvasNode({ node }: { node: InteractiveFlowNodeData }) {
  const isOverflow = node.role === 'commandOverflow'
  const action = isOverflow ? 'openCommands' : 'invoke'
  const pathLabel = node.commandPath ?? `${node.path}/~commands`

  return (
    <div
      aria-label={`${pathLabel}，${node.description}`}
      className={cn(
        'group relative flex overflow-hidden rounded-xl border text-left shadow-sm transition-all',
        'border-amber-400/25 bg-card/90 hover:-translate-y-0.5 hover:border-amber-400/55 hover:shadow-md',
      )}
      style={{ width: COMMAND_NODE_WIDTH, height: COMMAND_NODE_HEIGHT }}
    >
      <Handle
        className="!size-1.5 !border-0 !bg-amber-400/65"
        isConnectable={false}
        position={Position.Left}
        type="target"
      />
      <span aria-hidden className="h-full w-1 shrink-0 bg-amber-400" />

      <div className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-amber-400/25 bg-amber-400/[0.06] text-amber-400">
          {isOverflow ? <ArrowUpRight className="size-4" /> : <TerminalSquare className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[12px] leading-tight font-medium">{node.label}</p>
          <p className="mt-1 truncate text-[10px] leading-4 text-muted-foreground" title={node.description}>
            {node.description}
          </p>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground">
            {isOverflow
              ? <span>完整目录</span>
              : (
                  <>
                    <span className="uppercase text-amber-400">{node.commandScope}</span>
                    {node.commandEffect && <span>{node.commandEffect}</span>}
                    {node.commandConfirm && (
                      <span className="inline-flex items-center gap-0.5 text-warn">
                        <TriangleAlert className="size-2.5" />
                        confirm
                      </span>
                    )}
                  </>
                )}
          </div>
        </div>

        <button
          aria-label={isOverflow ? `查看 ${node.path} 的完整命令目录` : `调用 ${node.commandName}`}
          className="nodrag nowheel grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-amber-400/10 hover:text-amber-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={event => runAction(event, node, action)}
          title={isOverflow ? '查看完整命令目录' : '打开调用面板'}
          type="button"
        >
          <ArrowUpRight className="size-4" />
        </button>
      </div>
    </div>
  )
}

function CanvasNodeImpl(props: NodeProps) {
  const node = props.data as InteractiveFlowNodeData
  return node.role === 'tree'
    ? <TreeCanvasNode {...props} />
    : <CommandCanvasNode node={node} />
}

export const CanvasNode = memo(CanvasNodeImpl)
