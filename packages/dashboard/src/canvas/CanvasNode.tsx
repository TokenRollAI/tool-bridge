import { Handle, type NodeProps, Position } from '@xyflow/react'
import { ChevronRight, TerminalSquare } from 'lucide-react'
import { memo } from 'react'
import { KIND_ICON } from '@/components/kind-icon'
import { PRESENCE_TONE } from '@/lib/presence'
import { cn } from '@/lib/utils'
import { type FlowNodeData, NODE_HEIGHT, NODE_WIDTH } from './treeGraph'

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

/**
 * 画布上的一个树节点。纯展示 + 交互:选中态、kind 色带与图标、在线点、
 * 命令/子节点数、展开切换、remote 标识。展开按钮的点击不冒泡到节点选中。
 *
 * 尺寸与 treeGraph 的 NODE_WIDTH/HEIGHT 对齐,dagre 才能算准布局。
 */
function CanvasNodeImpl({ data, selected }: NodeProps) {
  const node = data as FlowNodeData
  const { icon: Icon, className: iconClass } = KIND_ICON[node.kind] ?? KIND_ICON.directory
  const expandable = node.childCount > 0 || node.truncated
  const presenceTone = node.presence ? PRESENCE_TONE[node.presence.state] : null

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2.5 rounded-xl border bg-card pr-3 pl-0 text-left shadow-sm transition-all',
        'hover:border-primary/50 hover:shadow-md',
        selected
          ? 'border-primary ring-2 ring-primary/35'
          : node.remoteScope
            ? 'border-fuchsia-400/30'
            : 'border-border',
      )}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      {/* 入边锚点(左);根节点没有父,但保留 handle 让布局一致 */}
      <Handle
        className="!size-1.5 !border-0 !bg-border"
        isConnectable={false}
        position={Position.Left}
        type="target"
      />

      {/* kind 色带 */}
      <span
        aria-hidden
        className={cn('h-full w-1 shrink-0 rounded-l-xl', KIND_ACCENT[node.kind] ?? KIND_ACCENT.directory)}
      />

      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-lg border bg-background/70',
          iconClass,
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>

      <div className="min-w-0 flex-1">
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
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          {node.childCount > 0 && (
            <span className="tabular-nums">
              {node.childCount}
              {' '}
              子节点
            </span>
          )}
          {node.truncated && node.childCount === 0 && (
            <span className="inline-flex items-center gap-1 text-primary">
              <TerminalSquare className="size-3" />
              展开加载
            </span>
          )}
          {!node.truncated && node.childCount === 0 && (
            <span className="truncate">{node.kind}</span>
          )}
        </div>
      </div>

      {/* 展开/折叠切换:仅可展开节点显示;点击不冒泡到节点选中(在容器层用 stopPropagation) */}
      {expandable && (
        <span
          aria-hidden
          className={cn(
            'grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-transform',
            'nodrag tb-expand-toggle group-hover:text-foreground',
            node.expanded && 'rotate-90',
          )}
          data-expand-toggle
        >
          <ChevronRight className="size-4" />
        </span>
      )}

      <Handle
        className="!size-1.5 !border-0 !bg-border"
        isConnectable={false}
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

export const CanvasNode = memo(CanvasNodeImpl)
