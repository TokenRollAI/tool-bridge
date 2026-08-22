import { useCallback, useMemo, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import type { TreeJson } from '@/lib/types'
import { useConn, useSession } from '@/lib/session-context'
import { pruneOfflineNodes } from '@/lib/presence'
import { useTree } from '@/lib/queries'
import { getTree } from '@/lib/api'

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

/**
 * @param expanded 当前展开集合(来自画布状态);只对其中 truncated 的分支发懒加载。
 */
export function useCanvasTree(expanded: ReadonlySet<string>): CanvasTree {
  const conn = useConn()
  const { active, revision } = useSession()
  const root = useTree('', ROOT_DEPTH)

  // 记录哪些路径确实是 truncated 且已展开 —— 只对它们懒加载。
  const truncatedExpanded = useMemo(() => {
    const result: Array<{ path: string, remote: boolean }> = []
    const rootChildren = root.data?.children ?? []
    const index = new Map<string, TreeJson>()
    const walk = (node: TreeJson, remoteScope: boolean) => {
      index.set(node.path, node)
      const remote = remoteScope || node.kind === 'remote'
      if (node.truncated === true && expanded.has(node.path)) {
        result.push({ path: node.path, remote })
      }
      node.children?.forEach(child => walk(child, remote))
    }
    rootChildren.forEach(child => walk(child, child.kind === 'remote'))
    return result
  }, [root.data, expanded])

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

/** 画布展开集合状态:每个 profile 首次拿到根树时默认展开本地首层目录。 */
export function useExpandedPaths(rootChildren: TreeJson[] | undefined, profileId: string) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const initialized = useRef<string | null>(null)

  if (rootChildren && initialized.current !== profileId) {
    initialized.current = profileId
    const next = new Set<string>()
    for (const node of rootChildren) {
      if (node.kind !== 'remote' && node.truncated !== true && (node.children?.length ?? 0) > 0) {
        next.add(node.path)
      }
    }
    setExpanded(next)
  }

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const expand = useCallback((path: string) => {
    setExpanded((prev) => {
      if (prev.has(path)) return prev
      const next = new Set(prev)
      next.add(path)
      return next
    })
  }, [])

  return { expanded, toggle, expand }
}
