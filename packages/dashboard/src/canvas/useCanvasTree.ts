import { useCallback, useMemo, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import type { HelpCmd, TreeJson } from '@/lib/types'
import { useConn, useSession } from '@/lib/session-context'
import { pruneOfflineNodes } from '@/lib/presence'
import { getHelp, getTree } from '@/lib/api'
import { useTree } from '@/lib/queries'

/**
 * 画布的数据编排:根树 depth=1 常驻,展开某个 truncated 分支时按需拉它的子树,
 * 把结果就地合并回本地树。与 TreeNav 同样的性能边界(root depth=1、本地 lazy=1、
 * remote lazy=3),只是这里要同时持有多个展开分支的懒加载查询。
 *
 * 合并策略:一棵"叠加树"—— 根来自 depth=1,每个已展开且 truncated 的分支用它自己的
 * 懒加载结果替换 children。remote 子树返回远端树内路径,需重挂回本地挂载前缀。
 */

const ROOT_DEPTH = 1
const LAZY_DEPTH_LOCAL = 1
const LAZY_DEPTH_REMOTE = 3

/** 把懒加载子树的远端路径重挂到本地 basePath(镜像 TreeNav.localizeSubtree)。 */
function localizeSubtree(root: TreeJson, basePath: string): TreeJson[] {
  const rootPath = root.path
  const rebase = (node: TreeJson): TreeJson => {
    const relative
      = rootPath === '' || rootPath === '/'
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

export interface CanvasTree {
  error: Error | null
  isError: boolean
  isPending: boolean
  /** 某个 truncated 分支是否正在懒加载(画布上转圈)。 */
  loadingPaths: ReadonlySet<string>
  refetchRoot: () => void
  /** 已剪掉 offline 的根子节点数组(buildGraph 的输入)。 */
  roots: TreeJson[]
}

export interface CanvasCommands {
  commandsByPath: ReadonlyMap<string, readonly HelpCmd[]>
  errorPaths: ReadonlySet<string>
  loadingPaths: ReadonlySet<string>
  refetch: (path: string) => void
}

/**
 * 只为用户明确打开的、当前仍可见的 owner 订阅 `~help`。query key 与 `useHelp`
 * 完全一致，因此 Inspector 与画布共享缓存；真正打开命令时 schema 仍由 CmdPanel 按需补水。
 */
export function useCanvasCommands(ownerPaths: ReadonlySet<string>): CanvasCommands {
  const conn = useConn()
  const { active, revision } = useSession()
  const paths = useMemo(() => [...ownerPaths].sort(), [ownerPaths])
  const base = ['tb', active?.id ?? '', active?.baseUrl ?? '', revision] as const
  const results = useQueries({
    queries: paths.map(path => ({
      queryKey: [...base, 'help', path] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => getHelp(conn, path, signal),
    })),
  })

  return useMemo(() => {
    const commandsByPath = new Map<string, readonly HelpCmd[]>()
    const loadingPaths = new Set<string>()
    const errorPaths = new Set<string>()
    paths.forEach((path, index) => {
      const result = results[index]
      if (result?.data) commandsByPath.set(path, result.data.cmds)
      else if (result?.isError) errorPaths.add(path)
      else if (result?.isPending) loadingPaths.add(path)
    })
    return {
      commandsByPath,
      loadingPaths,
      errorPaths,
      refetch: (path: string) => {
        const index = paths.indexOf(path)
        if (index >= 0) void results[index]?.refetch()
      },
    }
  }, [paths, results])
}

/**
 * @param expanded 当前展开集合(来自画布状态)。
 * @param lazyPaths 用户点开的 truncated 分支及其 remote 作用域；显式记录后，懒加载
 * 结果里新出现的深层 truncated 节点也能继续请求，而不局限于根查询返回的第一层。
 */
export function useCanvasTree(
  expanded: ReadonlySet<string>,
  lazyPaths: ReadonlyMap<string, boolean>,
): CanvasTree {
  const conn = useConn()
  const { active, revision } = useSession()
  const root = useTree('', ROOT_DEPTH)

  // 只保留当前仍展开的显式懒加载入口；折叠时停止订阅，缓存仍由 Query 保留。
  const truncatedExpanded = useMemo(() => {
    return [...lazyPaths]
      .filter(([path]) => expanded.has(path))
      .map(([path, remote]) => ({ path, remote }))
  }, [expanded, lazyPaths])

  const base = ['tb', active?.id ?? '', active?.baseUrl ?? '', revision] as const
  const subtrees = useQueries({
    queries: truncatedExpanded.map(({ path, remote }) => ({
      queryKey: [...base, 'tree', path, remote ? LAZY_DEPTH_REMOTE : LAZY_DEPTH_LOCAL] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getTree(conn, path, remote ? LAZY_DEPTH_REMOTE : LAZY_DEPTH_LOCAL, signal),
    })),
  })

  const loadedByPath = useMemo(() => {
    const map = new Map<string, TreeJson[]>()
    truncatedExpanded.forEach(({ path }, i) => {
      const data = subtrees[i]?.data
      if (data) map.set(path, pruneOfflineNodes(localizeSubtree(data, path)))
    })
    return map
  }, [truncatedExpanded, subtrees])

  const loadingPaths = useMemo(() => {
    const set = new Set<string>()
    truncatedExpanded.forEach(({ path }, i) => {
      if (subtrees[i]?.isPending) set.add(path)
    })
    return set
  }, [truncatedExpanded, subtrees])

  // 把懒加载结果就地合并回根树。
  const roots = useMemo(() => {
    const graft = (node: TreeJson): TreeJson => {
      const loaded = loadedByPath.get(node.path)
      if (loaded !== undefined) {
        return { ...node, children: loaded.map(graft) }
      }
      return node.children ? { ...node, children: node.children.map(graft) } : node
    }
    return pruneOfflineNodes(root.data?.children ?? []).map(graft)
  }, [root.data, loadedByPath])

  const refetchRoot = useCallback(() => void root.refetch(), [root])

  return {
    roots,
    isPending: root.isPending && !root.data,
    isError: root.isError && !root.data,
    error: root.error,
    loadingPaths,
    refetchRoot,
  }
}

/** 画布展开集合状态:每个 profile 默认只展开虚拟 `/` 总根，分支由用户按需展开。 */
export function useExpandedPaths(rootChildren: TreeJson[] | undefined, profileId: string) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const initialized = useRef<string | null>(null)

  if (rootChildren && initialized.current !== profileId) {
    initialized.current = profileId
    const next = new Set<string>([''])
    setExpanded(next)
  }

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        // 折叠父分支时同步清掉后代展开态，避免隐藏子树继续订阅懒加载请求。
        for (const candidate of next) {
          if (candidate === path || path === '' || candidate.startsWith(`${path}/`)) {
            next.delete(candidate)
          }
        }
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  return { expanded, toggle }
}
