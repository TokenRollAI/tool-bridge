import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { NavLink } from 'react-router'
import { KindBadge, OnlineDot } from '@/components/KindBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { useTree } from '@/lib/queries'
import type { TreeJson } from '@/lib/types'
import { cn } from '@/lib/utils'

/** ~tree 驱动的侧边树导航(可见性即权限:树里没有的就是无权的)。 */
export function TreeNav() {
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
  const children = tree.data.children ?? []
  if (children.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">树为空——先挂载一个节点</p>
  }
  return (
    <nav className="grid gap-px" aria-label="节点树">
      {children.map((child) => (
        <TreeBranch key={child.path} node={child} depth={0} />
      ))}
      {tree.data.truncated && (
        <p className="px-3 py-1 text-[10px] text-muted-foreground">…树已按深度/节点数截断</p>
      )}
    </nav>
  )
}

function TreeBranch({ node, depth }: { node: TreeJson; depth: number }) {
  const [open, setOpen] = useState(depth < 1)
  const kids = node.children ?? []
  const label = node.path.split('/').pop() ?? node.path
  return (
    <div>
      <div className="group flex items-center gap-1" style={{ paddingLeft: `${depth * 14 + 4}px` }}>
        {kids.length > 0 ? (
          <button
            type="button"
            aria-label={open ? '收起' : '展开'}
            onClick={() => setOpen((v) => !v)}
            className="grid size-4 shrink-0 place-items-center rounded-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <NavLink
          to={`/nodes/${node.path}`}
          className={({ isActive }) =>
            cn(
              'flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 py-1 text-[13px] leading-none',
              'hover:bg-secondary/80',
              isActive ? 'bg-secondary text-primary' : 'text-foreground/85',
            )
          }
          title={node.description}
        >
          <span className="truncate font-mono">{label}</span>
          <OnlineDot online={node.online} />
          <KindBadge kind={node.kind} className="ml-auto opacity-0 group-hover:opacity-100" />
        </NavLink>
      </div>
      {open && kids.map((k) => <TreeBranch key={k.path} node={k} depth={depth + 1} />)}
    </div>
  )
}
