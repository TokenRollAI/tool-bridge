import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import {
  type ApiError,
  getHealthz,
  getHelp,
  getHelpDsl,
  getTree,
  type InvokeResult,
  invoke,
} from './api'
import { type InvokeRecord, loadHistory, recordInvoke, subscribeHistory } from './history'
import { useConn, useSession } from './session'
import type {
  ContextEntry,
  ContextEntryMeta,
  Page,
  PluginManifest,
  RegistryNode,
  SecretKeyInfo,
} from './types'

/** queryKey 前缀含 profile 标识:切换档案后互不串缓存。 */
function useKeyBase(): readonly unknown[] {
  const { active } = useSession()
  return ['tb', active?.name ?? '', active?.baseUrl ?? ''] as const
}

export function useTree(path = '', depth = 8) {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'tree', path, depth],
    queryFn: ({ signal }) => getTree(conn, path, depth, signal),
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

export function useHelpDsl(path: string, enabled = true) {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'helpDsl', path],
    queryFn: ({ signal }) => getHelpDsl(conn, path, signal),
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
  const profile = active?.name ?? ''
  return useMutation<InvokeResult, Error, InvokeInput>({
    mutationFn: ({ path, tool, args, accept, direct }) =>
      invoke(conn, path, tool, args, accept ?? 'json', direct ?? false),
    onSuccess: (r, { path, tool, args }) =>
      recordInvoke(profile, {
        path,
        tool,
        args,
        ok: true,
        ms: r.ms,
        at: new Date().toISOString(),
      }),
    onError: (e, { path, tool, args }) =>
      recordInvoke(profile, {
        path,
        tool,
        args,
        ok: false,
        code: (e as ApiError).code ?? 'internal',
        ms: 0,
        at: new Date().toISOString(),
      }),
  })
}

/** 当前 profile 的调用历史(响应式)。 */
export function useHistory(): InvokeRecord[] {
  const { active } = useSession()
  const profile = active?.name ?? ''
  return useSyncExternalStore(subscribeHistory, () => loadHistory(profile))
}

/** 使树与节点级缓存失效(挂载/卸载/SK 变更后)。 */
export function useInvalidateTree() {
  const qc = useQueryClient()
  const base = useKeyBase()
  return () => qc.invalidateQueries({ queryKey: base })
}

// ---- system/* 结构化便捷查询(管理视图消费;与通用调用同一数据面)----

export function useSkList() {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'sk-list'],
    queryFn: async () => {
      const r = await invoke(conn, 'system/sk', 'list', {})
      return r.json as Page<SecretKeyInfo>
    },
  })
}

export function useSecretList() {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'secret-list'],
    queryFn: async () => {
      const r = await invoke(conn, 'system/secret', 'list', {})
      return r.json as Page<{ name: string; updatedAt: string }>
    },
  })
}

export function usePluginList() {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'plugin-list'],
    queryFn: async () => {
      const r = await invoke(conn, 'system/plugin', 'list', {})
      return r.json as Page<PluginManifest>
    },
  })
}

export function useRegistryList(prefix?: string) {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'registry-list', prefix ?? ''],
    queryFn: async () => {
      const r = await invoke(conn, 'system/registry', 'list', prefix ? { prefix } : {})
      return r.json as Page<RegistryNode>
    },
  })
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
