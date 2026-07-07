import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { NavLink } from 'react-router'
import { KIND_ICON } from '@/components/KindBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { useTree } from '@/lib/queries'
import type { TreeJson } from '@/lib/types'
import { cn } from '@/lib/utils'

/** 离线设备不进导航树(设备管理页仍可见全部);其余节点原样保留。 */
function pruneOffline(nodes: TreeJson[]): TreeJson[] {
  return nodes
    .filter((n) => n.online !== false)
    .map((n) => (n.children ? { ...n, children: pruneOffline(n.children) } : n))
}

/** 过滤:保留自身或任一后代匹配 q(路径子串,大小写不敏感)的分支。 */
function filterTree(nodes: TreeJson[], q: string): TreeJson[] {
  const needle = q.toLowerCase()
  const out: TreeJson[] = []
  for (const n of nodes) {
    const kids = n.children ? filterTree(n.children, q) : []
    if (n.path.toLowerCase().includes(needle) || kids.length > 0) {
      out.push({ ...n, children: kids.length > 0 ? kids : n.children })
    }
  }
  return out
}

/** ~tree 驱动的侧边树导航(可见性即权限:树里没有的就是无权的)。 */
export function TreeNav({ filter = '' }: { filter?: string }) {
  const tree = useTree('', 8)
  if (tree.isPending) {
    return (
      <div className="grid gap-2 px-3 py-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }
  if (tree.isError) {
    return <p className="px-3 py-2 text-xs text-destructive">树加载失败:{tree.error.message}</p>
  }
  const pruned = pruneOffline(tree.data.children ?? [])
  const filtering = filter.trim() !== ''
  const children = filtering ? filterTree(pruned, filter.trim()) : pruned
  if (children.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        {filtering ? '无匹配节点' : '树为空——先挂载一个节点'}
      </p>
    )
  }
  return (
    <nav className="grid gap-px px-2" aria-label="节点树">
      {children.map((child) => (
        <TreeBranch key={child.path} node={child} depth={0} forceOpen={filtering} />
      ))}
      {tree.data.truncated && (
        <p className="px-3 py-1 text-[10px] text-muted-foreground">…树已按深度/节点数截断</p>
      )}
    </nav>
  )
}

function TreeBranch({
  node,
  depth,
  forceOpen = false,
}: {
  node: TreeJson
  depth: number
  forceOpen?: boolean
}) {
  const [open, setOpen] = useState(depth < 1)
  const effectiveOpen = forceOpen || open
  const kids = node.children ?? []
  const label = node.path.split('/').pop() ?? node.path
  const { icon: Icon, className: iconClass } = KIND_ICON[node.kind] ?? KIND_ICON.directory
  return (
    <div>
      <div className="group relative flex items-center">
        <NavLink
          to={`/nodes/${node.path}`}
          className={({ isActive }) =>
            cn(
              'flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-sm pr-2 pl-6 text-[13px]',
              'hover:bg-secondary/70',
              isActive
                ? 'bg-secondary text-primary shadow-[inset_2px_0_0_var(--primary)]'
                : 'text-foreground/80',
            )
          }
          title={`${node.path} · ${node.description}`}
        >
          <Icon className={cn('size-3.5 shrink-0', iconClass)} strokeWidth={1.75} />
          <span className="truncate font-mono leading-none">{label}</span>
          {node.online && (
            <span
              title="online"
              className="ml-0.5 inline-block size-1.5 shrink-0 rounded-full bg-ok shadow-[0_0_5px_var(--ok)]"
            />
          )}
        </NavLink>
        {kids.length > 0 && (
          <button
            type="button"
            aria-label={effectiveOpen ? '收起' : '展开'}
            onClick={() => setOpen((v) => !v)}
            className="absolute left-0.5 grid size-5 place-items-center rounded-xs text-muted-foreground/60 hover:text-foreground"
          >
            <ChevronRight
              className={cn('size-3 transition-transform', effectiveOpen && 'rotate-90')}
            />
          </button>
        )}
      </div>
      {effectiveOpen && kids.length > 0 && (
        <div className="ml-[15px] border-l border-border/50 pl-1">
          {kids.map((k) => (
            <TreeBranch key={k.path} node={k} depth={depth + 1} forceOpen={forceOpen} />
          ))}
        </div>
      )}
    </div>
  )
}
