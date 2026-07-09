import { ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
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

/**
 * 把懒加载返回的子树 path 重挂到本地 `basePath` 下。
 *
 * 本地节点的 ~tree 返回本地绝对路径(rebase 后不变);remote 节点是纯透传,返回的是
 * **远端树内路径**(相对上游根,不含本地挂载前缀),须 rebase 到 basePath——否则子节点
 * 链接会丢失 `remote/<name>` 前缀(与 NodePage 同源问题)。root.path 为空 = 上游根透传。
 */
function localizeSubtree(root: TreeJson, basePath: string): TreeJson[] {
  const rootPath = root.path
  const rebase = (n: TreeJson): TreeJson => {
    const rel =
      rootPath === '' || rootPath === '/'
        ? n.path.replace(/^\/+/, '')
        : n.path === rootPath
          ? ''
          : n.path.startsWith(`${rootPath}/`)
            ? n.path.slice(rootPath.length + 1)
            : n.path
    const local = rel === '' ? basePath : `${basePath}/${rel}`
    return {
      ...n,
      path: local,
      ...(n.children ? { children: n.children.map(rebase) } : {}),
    }
  }
  return (root.children ?? []).map(rebase)
}

/** 首屏树深度:depth=1 完全不聚合远端(本地秒开;remote 节点标 truncated 可展开)。 */
const ROOT_DEPTH = 1
/** 懒加载本地目录:只拉 1 层——避免 buildTree 深入其下的 remote 节点触发 N+1 远端聚合。 */
const LAZY_DEPTH_LOCAL = 1
/** 懒加载 remote 节点及其后代:走纯透传一次返回,可多拉几层减少点击(不受 N+1 影响)。 */
const LAZY_DEPTH_REMOTE = 3

/** ~tree 驱动的侧边树导航(可见性即权限:树里没有的就是无权的)。 */
export function TreeNav({ filter = '', onNavigate }: { filter?: string; onNavigate?: () => void }) {
  const filtering = filter.trim() !== ''
  // 非过滤:首屏只拉 depth=1(本地结构秒开,不碰远端);展开某节点时由 TreeBranch 按需懒加载。
  // 过滤:需全树子串匹配,拉满 depth=8(用户主动搜索;filter 不进 queryKey → 仅触发一次请求,
  // 后续过滤纯客户端)。
  const tree = useTree('', filtering ? 8 : ROOT_DEPTH)
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
        <TreeBranch
          key={child.path}
          node={child}
          depth={0}
          forceOpen={filtering}
          onNavigate={onNavigate}
        />
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
  underRemote = false,
  onNavigate,
}: {
  node: TreeJson
  depth: number
  forceOpen?: boolean
  /** 是否处于 remote 挂载子树内(其下请求走纯透传,懒加载可用较大深度)。 */
  underRemote?: boolean
  onNavigate?: () => void
}) {
  // 首层本地、已随根查询拿到 children 的目录可默认展开；remote / truncated 必须等用户显式展开，
  // 否则会在首屏悄悄触发 remote 透传或下一层查询，抵消 depth=1 的性能边界。
  const [open, setOpen] = useState(
    () =>
      depth < 1 &&
      node.kind !== 'remote' &&
      node.truncated !== true &&
      (node.children?.length ?? 0) > 0,
  )
  const effectiveOpen = forceOpen || open
  // truncated:该节点还有未加载的子树(remote 联邦或本地深层被首屏 depth 截断)。
  // 过滤模式用全树(depth=8),不再懒加载,避免全展开触发大量并发请求。
  const lazy = node.truncated === true && !forceOpen
  // remote 节点或其后代走纯透传(一次返回,深度不引发 N+1)→ 多拉几层;纯本地目录只拉 1 层。
  const isRemoteScope = underRemote || node.kind === 'remote'
  const lazyDepth = isRemoteScope ? LAZY_DEPTH_REMOTE : LAZY_DEPTH_LOCAL
  const sub = useTree(node.path, lazyDepth, { enabled: effectiveOpen && lazy })
  const lazyKids = lazy && sub.data ? pruneOffline(localizeSubtree(sub.data, node.path)) : undefined
  const kids = lazyKids ?? node.children ?? []
  const expandable = kids.length > 0 || lazy
  const label = node.path.split('/').pop() ?? node.path
  const childrenId = useId()
  const { icon: Icon, className: iconClass } = KIND_ICON[node.kind] ?? KIND_ICON.directory
  return (
    <div>
      <div className="group relative flex items-center">
        {expandable && !forceOpen && (
          <button
            type="button"
            aria-label={`${effectiveOpen ? '收起' : '展开'}节点 ${label}`}
            aria-expanded={effectiveOpen}
            aria-controls={childrenId}
            onClick={() => setOpen((v) => !v)}
            className={cn(
              'absolute left-0 z-10 grid size-6 place-items-center rounded-xs text-muted-foreground/80',
              'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            )}
          >
            <ChevronRight
              className={cn('size-3 transition-transform', effectiveOpen && 'rotate-90')}
            />
          </button>
        )}
        <NavLink
          to={`/nodes/${node.path}`}
          onClick={onNavigate}
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
      </div>
      {effectiveOpen && (
        <div id={childrenId} className="ml-[15px] border-l border-border/50 pl-1">
          {lazy && sub.isPending ? (
            <div className="grid gap-1.5 py-1 pl-5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3.5 w-1/2" />
            </div>
          ) : lazy && sub.isError ? (
            <p className="py-1 pl-5 text-[11px] text-destructive">子树加载失败</p>
          ) : (
            kids.map((k) => (
              <TreeBranch
                key={k.path}
                node={k}
                depth={depth + 1}
                forceOpen={forceOpen}
                underRemote={isRemoteScope}
                onNavigate={onNavigate}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
