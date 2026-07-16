import { ChevronRight, CircleAlert, Loader2, RefreshCw, Route, SearchX } from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { KIND_ICON } from '@/components/KindBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { useTree } from '@/lib/queries'
import { useSession } from '@/lib/session'
import type { NodeKind, TreeJson } from '@/lib/types'
import { cn } from '@/lib/utils'

/** 离线设备不进导航树（设备管理页仍可见全部）；其余节点原样保留。 */
function pruneOffline(nodes: TreeJson[]): TreeJson[] {
  return nodes
    .filter((node) => node.online !== false)
    .map((node) => (node.children ? { ...node, children: pruneOffline(node.children) } : node))
}

interface FilteredTree {
  nodes: TreeJson[]
  matches: Set<string>
}

/** 保留命中节点及其祖先；节点自身命中时保留其已加载子树作为路径上下文。 */
function filterTree(nodes: TreeJson[], query: string): FilteredTree {
  const needle = query.toLocaleLowerCase()
  const matches = new Set<string>()

  const visit = (node: TreeJson): TreeJson | null => {
    const filteredChildren = (node.children ?? [])
      .map(visit)
      .filter((child): child is TreeJson => child !== null)
    const selfMatch = node.path.toLocaleLowerCase().includes(needle)
    if (selfMatch) matches.add(node.path)
    if (!selfMatch && filteredChildren.length === 0) return null
    return {
      ...node,
      ...(selfMatch
        ? node.children
          ? { children: node.children }
          : {}
        : { children: filteredChildren }),
    }
  }

  return {
    nodes: nodes.map(visit).filter((node): node is TreeJson => node !== null),
    matches,
  }
}

/**
 * 把懒加载返回的子树 path 重挂到本地 `basePath` 下。
 * remote 节点返回远端树内路径，必须补回本地挂载前缀。
 */
function localizeSubtree(root: TreeJson, basePath: string): TreeJson[] {
  const rootPath = root.path
  const rebase = (node: TreeJson): TreeJson => {
    const relative =
      rootPath === '' || rootPath === '/'
        ? node.path.replace(/^\/+/, '')
        : node.path === rootPath
          ? ''
          : node.path.startsWith(`${rootPath}/`)
            ? node.path.slice(rootPath.length + 1)
            : node.path
    const localPath = relative === '' ? basePath : `${basePath}/${relative}`
    return {
      ...node,
      path: localPath,
      ...(node.children ? { children: node.children.map(rebase) } : {}),
    }
  }
  return (root.children ?? []).map(rebase)
}

const ROOT_DEPTH = 1
const LAZY_DEPTH_LOCAL = 1
const LAZY_DEPTH_REMOTE = 3

const KIND_TONE: Record<NodeKind, string> = {
  directory: 'border-border/70 bg-secondary/65 text-muted-foreground',
  builtin: 'border-sky-400/25 bg-sky-400/10 text-sky-400',
  mcp: 'border-violet-400/25 bg-violet-400/10 text-violet-400',
  http: 'border-teal-400/25 bg-teal-400/10 text-teal-400',
  remote: 'border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-400',
  context: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-400',
  skillhub: 'border-indigo-400/25 bg-indigo-400/10 text-indigo-400',
  device: 'border-amber-400/25 bg-amber-400/10 text-amber-400',
  tool: 'border-rose-400/25 bg-rose-400/10 text-rose-400',
}

/**
 * 协议树资源浏览器。
 *
 * 性能硬边界：常态只取 root depth=1；filter 非空才启用 depth=8；本地 lazy=1；
 * remote 及其后代 lazy=3。展开集合集中管理，刷新查询不会重置用户的浏览位置。
 */
export function TreeNav({ filter = '', onNavigate }: { filter?: string; onNavigate?: () => void }) {
  const query = filter.trim()
  const filtering = query !== ''
  const root = useTree('', ROOT_DEPTH)
  const deep = useTree('', 8, { enabled: filtering })
  const { active } = useSession()
  const location = useLocation()
  const activePath = nodePathFromLocation(location.pathname)
  const initializedProfile = useRef<string | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [tabStopPath, setTabStopPath] = useState<string | null>(null)

  // 深树尚未返回时保留 root 树，避免输入筛选后导航瞬间清空。
  const source = filtering ? (deep.data ?? root.data) : root.data
  const pruned = useMemo(() => pruneOffline(source?.children ?? []), [source])
  const filtered = useMemo(
    () => (filtering ? filterTree(pruned, query) : { nodes: pruned, matches: new Set<string>() }),
    [filtering, pruned, query],
  )
  const loadedPaths = useMemo(() => collectPaths(pruned), [pruned])
  const firstVisiblePath = filtered.nodes[0]?.path ?? null

  // 首批结果或首个匹配根变化时把唯一 Tab 入口放到第一个可见节点；树内移动由 focus 更新。
  useEffect(() => {
    setTabStopPath(firstVisiblePath)
  }, [firstVisiblePath])

  // 每个 profile 第一次拿到根树时，展开首层已随 root 返回的本地目录；remote/truncated 不预取。
  useEffect(() => {
    if (!root.data) return
    const profileId = active?.id ?? ''
    if (initializedProfile.current === profileId) return
    initializedProfile.current = profileId
    setExpandedPaths(
      new Set(
        (root.data.children ?? [])
          .filter(
            (node) =>
              node.kind !== 'remote' && node.truncated !== true && (node.children?.length ?? 0) > 0,
          )
          .map((node) => node.path),
      ),
    )
  }, [active?.id, root.data])

  // direct URL 只展开已经加载的祖先，不因为“定位”静默触发 remote/depth=8 请求。
  useEffect(() => {
    if (activePath === null || activePath === '') return
    const ancestors = pathAncestors(activePath).filter((path) => loadedPaths.has(path))
    if (ancestors.length === 0) return
    setExpandedPaths((previous) => {
      const next = new Set(previous)
      let changed = false
      for (const path of ancestors) {
        if (!next.has(path)) {
          next.add(path)
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [activePath, loadedPaths])

  const toggleExpanded = (path: string) => {
    setTabStopPath((current) =>
      current?.startsWith(`${path}/`) && expandedPaths.has(path) ? path : current,
    )
    setExpandedPaths((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  if (root.isPending && !root.data) return <TreeSkeleton />

  if (root.isError && !root.data) {
    return (
      <div
        className="mx-2 rounded-lg border border-destructive/30 bg-destructive/8 p-3"
        role="alert"
      >
        <div className="flex items-start gap-2 text-xs text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <p className="min-w-0 break-words">资源树加载失败：{root.error.message}</p>
        </div>
        <button
          type="button"
          className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => root.refetch()}
        >
          <RefreshCw className="size-3.5" />
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      {filtering && (
        <div className="mx-2 mb-2 flex min-h-7 items-center gap-2 rounded-md border bg-background/35 px-2 text-[10px] text-muted-foreground">
          {deep.isFetching ? (
            <>
              <Loader2 className="size-3 animate-spin text-primary" />
              <span>正在搜索完整可见树…</span>
              {filtered.matches.size > 0 && (
                <span className="ml-auto font-mono">≥ {filtered.matches.size}</span>
              )}
            </>
          ) : (
            <>
              <Route className="size-3 text-primary" />
              <span>
                {filtered.matches.size} 个匹配
                {source?.truncated ? ' · 结果已截断' : ''}
              </span>
            </>
          )}
        </div>
      )}

      {filtering && deep.isError && (
        <div
          className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-2 py-1.5 text-[10px] text-destructive"
          role="alert"
        >
          <span className="min-w-0 flex-1 truncate">完整树搜索失败，当前仅显示已加载结果</span>
          <button
            type="button"
            className="shrink-0 underline underline-offset-2"
            onClick={() => deep.refetch()}
          >
            重试
          </button>
        </div>
      )}

      {filtered.nodes.length === 0 ? (
        <TreeEmpty filtering={filtering} onRefresh={() => root.refetch()} />
      ) : (
        <nav aria-label="节点资源树" className="px-1.5">
          <div
            role="tree"
            aria-label="工具与上下文资源"
            className="grid gap-0.5"
            onKeyDown={handleTreeKeyDown}
          >
            {filtered.nodes.map((node) => (
              <TreeBranch
                key={node.path}
                node={node}
                depth={0}
                activePath={activePath}
                filter={query}
                filtering={filtering}
                matches={filtered.matches}
                expandedPaths={expandedPaths}
                tabStopPath={tabStopPath}
                onToggle={toggleExpanded}
                onItemFocus={setTabStopPath}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </nav>
      )}

      {!filtering && source?.truncated && (
        <p className="mx-3 mt-2 border-t pt-2 text-[10px] leading-4 text-muted-foreground">
          根视图按深度加载；展开节点可继续浏览。
        </p>
      )}
    </div>
  )
}

function TreeBranch({
  node,
  depth,
  activePath,
  filter,
  filtering,
  matches,
  expandedPaths,
  tabStopPath,
  onToggle,
  onItemFocus,
  underRemote = false,
  onNavigate,
}: {
  node: TreeJson
  depth: number
  activePath: string | null
  filter: string
  filtering: boolean
  matches: Set<string>
  expandedPaths: Set<string>
  tabStopPath: string | null
  onToggle: (path: string) => void
  onItemFocus: (path: string) => void
  underRemote?: boolean
  onNavigate?: () => void
}) {
  const manuallyOpen = expandedPaths.has(node.path)
  const effectiveOpen = filtering || manuallyOpen
  const lazy = node.truncated === true && !filtering
  const remoteScope = underRemote || node.kind === 'remote'
  const lazyDepth = remoteScope ? LAZY_DEPTH_REMOTE : LAZY_DEPTH_LOCAL
  const subtree = useTree(node.path, lazyDepth, { enabled: effectiveOpen && lazy })
  const lazyChildren =
    lazy && subtree.data ? pruneOffline(localizeSubtree(subtree.data, node.path)) : undefined
  const children = lazyChildren ?? node.children ?? []
  const expandable = children.length > 0 || lazy
  const label = node.path.split('/').pop() ?? node.path
  const isActive = activePath === node.path
  const isActiveAncestor =
    activePath !== null && activePath !== '' && activePath.startsWith(`${node.path}/`)
  const matched = matches.has(node.path)
  const { icon: Icon } = KIND_ICON[node.kind] ?? KIND_ICON.directory

  return (
    <div className="min-w-0" data-tree-branch>
      <div
        data-tree-row
        className={cn(
          'group/tree-row relative flex min-w-0 items-center rounded-md',
          'h-11 lg:h-9',
          isActive
            ? 'bg-primary/12 text-foreground shadow-[inset_3px_0_0_var(--primary)]'
            : isActiveAncestor
              ? 'bg-primary/[0.045] text-foreground'
              : 'text-foreground/82 hover:bg-secondary/65',
          filtering && !matched && !isActive && 'text-foreground/55',
        )}
      >
        {expandable ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${effectiveOpen ? '收起' : '展开'}节点 ${label}`}
            aria-expanded={effectiveOpen}
            disabled={filtering}
            title={filtering ? '筛选期间自动展开匹配路径' : undefined}
            onClick={(event) => {
              onItemFocus(node.path)
              event.currentTarget.parentElement
                ?.querySelector<HTMLElement>('[role="treeitem"]')
                ?.focus()
              onToggle(node.path)
            }}
            className={cn(
              'grid h-full w-8 shrink-0 place-items-center rounded-l-md text-muted-foreground',
              'hover:text-foreground focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              filtering && 'cursor-default opacity-55',
            )}
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform', effectiveOpen && 'rotate-90')}
            />
          </button>
        ) : (
          <span className="h-full w-8 shrink-0" aria-hidden="true" />
        )}

        <NavLink
          end
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={expandable ? effectiveOpen : undefined}
          aria-selected={isActive}
          tabIndex={node.path === tabStopPath ? 0 : -1}
          to={`/nodes/${node.path}`}
          onClick={onNavigate}
          onFocus={() => onItemFocus(node.path)}
          aria-current={isActive ? 'page' : undefined}
          aria-label={`${label}，${node.kind}`}
          title={`${node.path} · ${node.description}`}
          className={cn(
            'flex h-full min-w-0 flex-1 items-center gap-2 pr-2 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            isActive && 'text-foreground',
          )}
        >
          <span
            className={cn(
              'grid size-6 shrink-0 place-items-center rounded-md border',
              KIND_TONE[node.kind] ?? KIND_TONE.directory,
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] leading-none">
            <HighlightedLabel label={label} query={filter} matched={matched} />
          </span>
          {node.kind === 'remote' && (
            <span className="shrink-0 rounded-sm border border-fuchsia-400/25 bg-fuchsia-400/8 px-1 font-mono text-[7px] leading-3 text-fuchsia-400/90">
              REMOTE
            </span>
          )}
          {node.online === true && (
            <span
              title="online"
              className="size-1.5 shrink-0 rounded-full bg-ok shadow-[0_0_5px_var(--ok)]"
            />
          )}
          {node.truncated === true && !subtree.isFetching && (
            <span
              title={remoteScope ? '远端子树按需加载' : '子树按需加载'}
              className={cn(
                'size-1.5 shrink-0 rounded-full ring-2 ring-background',
                remoteScope ? 'bg-fuchsia-400' : 'bg-primary',
              )}
            />
          )}
          {lazy && subtree.isFetching && (
            <Loader2
              aria-label="正在加载子树"
              className="size-3.5 shrink-0 animate-spin text-primary"
            />
          )}
        </NavLink>
      </div>

      {effectiveOpen && expandable && (
        <fieldset
          data-tree-group
          className={cn(
            'ml-4 min-w-0 border-l pl-1.5',
            isActiveAncestor ? 'border-primary/40' : 'border-border/65',
            remoteScope && 'border-fuchsia-400/25',
          )}
        >
          {lazy && subtree.isPending ? (
            <div className="grid gap-0.5 py-0.5" role="status" aria-label="正在加载子树">
              <TreeRowSkeleton width="72%" />
              <TreeRowSkeleton width="54%" />
            </div>
          ) : lazy && subtree.isError ? (
            <div
              className="my-1 mr-1 flex min-h-10 items-center gap-2 rounded-md border border-destructive/25 bg-destructive/7 px-2 text-[10px] text-destructive"
              role="alert"
            >
              <CircleAlert className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">子树加载失败</span>
              <button
                type="button"
                className="shrink-0 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => subtree.refetch()}
              >
                重试
              </button>
            </div>
          ) : (
            children.map((child) => (
              <TreeBranch
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                filter={filter}
                filtering={filtering}
                matches={matches}
                expandedPaths={expandedPaths}
                tabStopPath={tabStopPath}
                onToggle={onToggle}
                onItemFocus={onItemFocus}
                underRemote={remoteScope}
                onNavigate={onNavigate}
              />
            ))
          )}
        </fieldset>
      )}
    </div>
  )
}

/** ARIA tree 键盘模型:方向键在可见节点间移动,左右键展开/收起或进入/返回层级。 */
function handleTreeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')
  if (!target) return

  const visible = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'),
  ).filter((item) => item.offsetParent !== null)
  const index = visible.indexOf(target)
  const focusAt = (next: number) => {
    const item = visible[next]
    if (!item) return
    event.preventDefault()
    item.focus()
  }

  if (event.key === 'ArrowDown') focusAt(Math.min(index + 1, visible.length - 1))
  if (event.key === 'ArrowUp') focusAt(Math.max(index - 1, 0))
  if (event.key === 'Home') focusAt(0)
  if (event.key === 'End') focusAt(visible.length - 1)
  if (event.key === ' ') {
    event.preventDefault()
    target.click()
    return
  }

  const branch = target.closest<HTMLElement>('[data-tree-branch]')
  const toggle = branch?.querySelector<HTMLButtonElement>(
    ':scope > [data-tree-row] > button[aria-expanded]',
  )
  const expanded = target.getAttribute('aria-expanded')

  if (event.key === 'ArrowRight') {
    if (expanded === 'false' && toggle && !toggle.disabled) {
      event.preventDefault()
      toggle.click()
      return
    }
    if (expanded === 'true') {
      const child = branch?.querySelector<HTMLElement>(
        ':scope > [data-tree-group] > [data-tree-branch] > [data-tree-row] [role="treeitem"]',
      )
      if (child) {
        event.preventDefault()
        child.focus()
      }
    }
  }

  if (event.key === 'ArrowLeft') {
    if (expanded === 'true' && toggle && !toggle.disabled) {
      event.preventDefault()
      toggle.click()
      return
    }
    const parentGroup = branch?.parentElement?.closest<HTMLElement>('[data-tree-group]')
    const parentItem = parentGroup?.parentElement?.querySelector<HTMLElement>(
      ':scope > [data-tree-row] [role="treeitem"]',
    )
    if (parentItem) {
      event.preventDefault()
      parentItem.focus()
    }
  }
}

function HighlightedLabel({
  label,
  query,
  matched,
}: {
  label: string
  query: string
  matched: boolean
}) {
  if (!matched || query === '') return label
  const index = label.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  if (index < 0) {
    return <span className="text-primary">{label}</span>
  }
  return (
    <>
      {label.slice(0, index)}
      <mark className="rounded-sm bg-primary/20 px-0.5 text-primary">
        {label.slice(index, index + query.length)}
      </mark>
      {label.slice(index + query.length)}
    </>
  )
}

function TreeSkeleton() {
  return (
    <div className="grid gap-1 px-2" role="status" aria-label="正在加载资源树">
      <TreeRowSkeleton width="76%" />
      <TreeRowSkeleton width="58%" />
      <TreeRowSkeleton width="68%" />
      <TreeRowSkeleton width="48%" />
    </div>
  )
}

function TreeRowSkeleton({ width }: { width: string }) {
  return (
    <div className="flex h-11 items-center gap-2 px-2 lg:h-9">
      <Skeleton className="size-6 shrink-0 rounded-md" />
      <Skeleton className="h-3" style={{ width }} />
    </div>
  )
}

function TreeEmpty({ filtering, onRefresh }: { filtering: boolean; onRefresh: () => void }) {
  return (
    <div className="mx-2 rounded-lg border border-dashed bg-background/25 px-4 py-6 text-center">
      <SearchX className="mx-auto size-6 text-muted-foreground/60" />
      <p className="mt-2 text-sm font-medium">{filtering ? '没有匹配资源' : '资源树为空'}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {filtering ? '换一个路径关键词，或按 Esc 清除筛选。' : '注册或挂载节点后会显示在这里。'}
      </p>
      {!filtering && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <RefreshCw className="size-3.5" />
            刷新
          </button>
          <Link
            to="/manage/registry"
            className="inline-flex h-8 items-center rounded-md bg-primary px-2.5 text-xs text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            节点注册
          </Link>
        </div>
      )}
    </div>
  )
}

function collectPaths(nodes: TreeJson[]): Set<string> {
  const paths = new Set<string>()
  const visit = (node: TreeJson) => {
    paths.add(node.path)
    node.children?.forEach(visit)
  }
  nodes.forEach(visit)
  return paths
}

function pathAncestors(path: string): string[] {
  const segments = path.split('/').filter(Boolean)
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'))
}

function nodePathFromLocation(pathname: string): string | null {
  if (pathname === '/') return ''
  if (!pathname.startsWith('/nodes/')) return null
  const encoded = pathname.slice('/nodes/'.length).replace(/\/+$/, '')
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}
