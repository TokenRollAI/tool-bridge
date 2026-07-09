import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import {
  type ApiError,
  feedbackGet,
  feedbackList,
  getHealthz,
  getHelp,
  getHelpMarkdown,
  getTree,
  type InvokeResult,
  invoke,
  startOAuthAuthorize,
} from './api'
import {
  historyScope,
  type InvokeRecord,
  loadHistory,
  recordInvoke,
  subscribeHistory,
} from './history'
import { useConn, useSession } from './session'
import type {
  ContextEntry,
  ContextEntryMeta,
  FederationHost,
  Page,
  PluginManifest,
  RegistryNode,
  SecretKeyInfo,
} from './types'

/** queryKey 前缀含 profile 标识:切换档案后互不串缓存。 */
function useKeyBase(): readonly unknown[] {
  const { active, revision } = useSession()
  return ['tb', active?.id ?? '', active?.baseUrl ?? '', revision] as const
}

export function useTree(path = '', depth = 8, options?: { enabled?: boolean }) {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'tree', path, depth],
    queryFn: ({ signal }) => getTree(conn, path, depth, signal),
    enabled: options?.enabled ?? true,
  })
}

export function useHelp(path: string) {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'help', path],
    queryFn: ({ signal }) => getHelp(conn, path, signal),
  })
}

/**
 * 工具级 `~help`(两级披露的细节级):mcp/http 节点级 ~help 是索引形态
 * (cmd 不含 inputSchema),面板展开时按需取 `GET /<path>/<tool>/~help` 补水 schema。
 * 网关侧命中同一 toolcache,不额外打上游。
 */
export function useToolHelp(path: string, tool: string, enabled: boolean) {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'help', `${path}/${tool}`],
    queryFn: ({ signal }) => getHelp(conn, `${path}/${tool}`, signal),
    enabled,
  })
}

export function useHelpMarkdown(path: string, enabled = true) {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'helpMarkdown', path],
    queryFn: ({ signal }) => getHelpMarkdown(conn, path, signal),
    enabled,
  })
}

export function useHealthz() {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'healthz'],
    queryFn: () => getHealthz(conn.baseUrl),
    refetchInterval: 30_000,
  })
}

export interface InvokeInput {
  path: string
  tool: string
  args: unknown
  accept?: 'json' | 'markdown'
  /** 直连工具调用(mcp/http/tool 工具):POST /<path>/<tool>,body 即 arguments。 */
  direct?: boolean
}

/** 数据面调用(变更型;成功后由调用方决定失效哪些查询)。全部调用落 per-profile 历史。 */
export function useInvoke() {
  const conn = useConn()
  const { active } = useSession()
  const scope = active ? historyScope(active) : ''
  return useMutation<InvokeResult, Error, InvokeInput>({
    // variables/data 可含凭证、Context 正文或一次性 token。observer 存活时保留
    // 结果供 UI 展示;reset/卸载后最多保留 1s(而非默认 5min)。不用 0,
    // 避免长调用 pending 期卸载 observer 后 query-core 持续重排 0ms GC timer。
    gcTime: 1_000,
    mutationFn: ({ path, tool, args, accept, direct }) =>
      invoke(conn, path, tool, args, accept ?? 'json', direct ?? false),
    onSuccess: (r, { path, tool }) =>
      recordInvoke(scope, {
        path,
        tool,
        ok: true,
        ms: r.ms,
        at: new Date().toISOString(),
      }),
    onError: (e, { path, tool }) =>
      recordInvoke(scope, {
        path,
        tool,
        ok: false,
        code: (e as ApiError).code ?? 'internal',
        ms: 0,
        at: new Date().toISOString(),
      }),
  })
}

/** mcp 托管 OAuth 发起(POST /<path>/~authorize;对等 `tb tool auth`)。 */
export function useOAuthAuthorize() {
  const conn = useConn()
  return useMutation({
    mutationFn: (path: string) => startOAuthAuthorize(conn, path),
  })
}

/** 当前 profile 的调用历史(响应式)。 */
export function useHistory(): InvokeRecord[] {
  const { active } = useSession()
  const scope = active ? historyScope(active) : ''
  return useSyncExternalStore(subscribeHistory, () => loadHistory(scope))
}

/** 使树与节点级缓存失效(挂载/卸载/SK 变更后)。 */
export function useInvalidateTree() {
  const qc = useQueryClient()
  const base = useKeyBase()
  return () => qc.invalidateQueries({ queryKey: base })
}

// ---- system/* 结构化便捷查询(管理视图消费;与通用调用同一数据面)----

/**
 * builtin list 的 cursor 分页适配。对页面仍暴露合并后的 `data.items`,
 * 同时保留 `hasNextPage/fetchNextPage/isFetchingNextPage`,避免管理面静默只显示前 50 条。
 */
function usePagedBuiltin<T>(key: string, path: string, args: Record<string, unknown> = {}) {
  const conn = useConn()
  const base = useKeyBase()
  const query = useInfiniteQuery({
    queryKey: [...base, key, args],
    queryFn: async ({ pageParam }) => {
      const opts = pageParam ? { cursor: pageParam } : {}
      const r = await invoke(conn, path, 'list', { ...args, opts })
      return r.json as Page<T>
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.cursor,
  })
  const data = query.data
    ? {
        items: query.data.pages.flatMap((page) => page.items),
        ...(query.data.pages.at(-1)?.cursor ? { cursor: query.data.pages.at(-1)?.cursor } : {}),
      }
    : undefined
  return { ...query, data }
}

export function useSkList() {
  return usePagedBuiltin<SecretKeyInfo>('sk-list', 'system/sk')
}

export function useSecretList() {
  return usePagedBuiltin<{ name: string; updatedAt: string }>('secret-list', 'system/secret')
}

export function usePluginList() {
  return usePagedBuiltin<PluginManifest>('plugin-list', 'system/plugin')
}

/** remote 联邦 host 白名单合并视图(env 基线 + 运行时条目;对等 `tb federation ls`)。 */
export function useFederationList() {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'federation-list'],
    queryFn: async () => {
      const r = await invoke(conn, 'system/federation', 'list', {})
      return r.json as { items: FederationHost[] }
    },
  })
}

/** 某 path 的全部反馈(~feedback 保留段,含隐藏条目;对等 `tb feedback ls --hidden`)。 */
export function useFeedbackList(path: string, options?: { enabled?: boolean }) {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'feedback-list', path],
    queryFn: ({ signal }) => feedbackList(conn, path, true, signal),
    enabled: options?.enabled ?? path !== '',
  })
}

/** 单条反馈详情(含 detail;展开时懒取,对等 `tb feedback get`)。 */
export function useFeedbackDetail(path: string, id: string | null) {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'feedback-detail', path, id ?? ''],
    queryFn: ({ signal }) => feedbackGet(conn, path, id ?? '', signal),
    enabled: id !== null,
  })
}

export function useRegistryList(prefix?: string) {
  return usePagedBuiltin<RegistryNode>(
    `registry-list:${prefix ?? ''}`,
    'system/registry',
    prefix ? { prefix } : {},
  )
}

export function useStatus() {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'status'],
    queryFn: async () => {
      const r = await invoke(conn, 'system/status', 'get', {})
      return r.json as { healthy: boolean; version: string; nodeCount: number }
    },
    refetchInterval: 30_000,
  })
}

// ---- context 浏览器(条目枚举/读取;与 CLI `tb ctx ls|cat` 同一数据面)----

/**
 * context 条目分页枚举:query 非空走 Search(mode = keyword | semantic,对等
 * `tb ctx search --mode`),否则走 List(prefix 过滤)。
 * cursor 分页交给 useInfiniteQuery(Page 语义)。
 */
export function useCtxEntries(
  nodePath: string,
  prefix: string,
  query: string,
  mode: 'keyword' | 'semantic' = 'keyword',
) {
  const conn = useConn()
  const base = useKeyBase()
  return useInfiniteQuery({
    queryKey: [...base, 'ctx-entries', nodePath, prefix, query, query ? mode : ''],
    queryFn: async ({ pageParam }) => {
      const opts = pageParam ? { cursor: pageParam } : {}
      const r = query
        ? await invoke(conn, nodePath, 'Search', { query, opts: { ...opts, mode } })
        : await invoke(conn, nodePath, 'List', { path: prefix, opts })
      return r.json as Page<ContextEntryMeta>
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.cursor,
  })
}

/** 单条目读取(查看/编辑对话框按需取;大对象 content = { $ref })。 */
export function useCtxEntry(nodePath: string, entryPath: string | null) {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'ctx-entry', nodePath, entryPath ?? ''],
    queryFn: async () => {
      const r = await invoke(conn, nodePath, 'Get', { path: entryPath })
      return r.json as ContextEntry
    },
    enabled: entryPath !== null,
  })
}
