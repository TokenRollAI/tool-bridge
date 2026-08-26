import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import type {
  CatalogListItem,
  ContextEntry,
  ContextEntryMeta,
  FederationHost,
  Page,
  PluginManifest,
  RegistryNode,
  SecretKeyInfo,
  SkillDetail,
  SkillFile,
  SkillSummary,
  ToolSearchPage,
} from './types'
import {
  type ApiError,
  feedbackGet,
  feedbackList,
  getHealthz,
  getHelp,
  getHelpMarkdown,
  getTree,
  invoke,
  type InvokeResult,
  searchTools,
  startOAuthAuthorize,
  uploadContextObject,
} from './api'
import {
  historyScope,
  type InvokeRecord,
  loadHistory,
  recordInvoke,
  subscribeHistory,
} from './history'
import {
  resolveToolSearchOptions,
  type ToolSearchOptions,
  toolSearchQueryKey,
} from './toolSearch'
import { useConn, useSession } from './session-context'

/** queryKey 前缀含 profile 标识:切换档案后互不串缓存。 */
export function useKeyBase(): readonly unknown[] {
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

/** root 全局工具搜索；cursor 只作为 pageParam，不混入首屏请求。 */
export function useToolSearch(
  query: string,
  options: ToolSearchOptions = {},
) {
  const conn = useConn()
  const base = useKeyBase()
  const normalized = query.trim()
  const searchOptions = resolveToolSearchOptions(options)
  return useInfiniteQuery<ToolSearchPage>({
    queryKey: toolSearchQueryKey(base, normalized, searchOptions),
    queryFn: ({ pageParam, signal }) => searchTools(conn, normalized, {
      ...searchOptions,
      ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
    }, signal),
    enabled: normalized.length > 0,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.cursor,
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
  accept?: 'json' | 'markdown'
  args: unknown
  /** 完整命令路径(含命令/工具叶子段,如 `docs/ctx7/resolve` 或 `system/status/get`)。 */
  commandPath: string
}

/** 完整命令路径拆成历史记录的 {节点 path, 命令 tool}(末段 = 命令名,仅供历史展示)。 */
function splitCommand(commandPath: string): { path: string, tool: string } {
  const at = commandPath.lastIndexOf('/')
  return at < 0
    ? { path: '', tool: commandPath }
    : { path: commandPath.slice(0, at), tool: commandPath.slice(at + 1) }
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
    mutationFn: ({ commandPath, args, accept }) =>
      invoke(conn, commandPath, args, accept ?? 'json'),
    onSuccess: (r, { commandPath }) =>
      recordInvoke(scope, {
        ...splitCommand(commandPath),
        ok: true,
        ms: r.ms,
        at: new Date().toISOString(),
      }),
    onError: (e, { commandPath }) =>
      recordInvoke(scope, {
        ...splitCommand(commandPath),
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

/**
 * 缓存失效器。**始终限定当前 profile**(queryKey 前缀含 profile 标识),因此绝不再波及其它
 * profile 的查询 —— 这是此前全局 `invalidateQueries({queryKey:['tb']})` 最大的浪费:切 profile
 * 本就隔离缓存,失效别的 profile 纯属白打请求。
 *
 * - `invalidate()` 不带参:失效整个 profile(结构性变更用 —— 挂载/卸载/通用调用,影响面跨域,
 *   宁可多刷不可漏刷)。
 * - `invalidate('sk-list', …)`:只失效列出的域(域段 = queryKey 的第 5 段;支持 `registry-list:<prefix>`
 *   这类带冒号后缀的键)。自成一路由的管理页用它,把"改一条 SK 却重拉工具树/catalog"的浪费砍掉。
 */
export function useInvalidate() {
  const qc = useQueryClient()
  const base = useKeyBase()
  return (...domains: string[]) => {
    if (domains.length === 0) return qc.invalidateQueries({ queryKey: base })
    return qc.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey as unknown[]
        for (let i = 0; i < base.length; i++) if (key[i] !== base[i]) return false
        const domain = key[base.length]
        return typeof domain === 'string'
          && domains.some(d => domain === d || domain.startsWith(`${d}:`))
      },
    })
  }
}

/** 使树与节点级缓存失效(挂载/卸载/SK 变更后);profile 范围。 */
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
      const r = await invoke(conn, `${path}/list`, { ...args, opts })
      return r.json as Page<T>
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.cursor,
  })
  const data = query.data
    ? {
        items: query.data.pages.flatMap(page => page.items),
        ...(query.data.pages.at(-1)?.cursor ? { cursor: query.data.pages.at(-1)?.cursor } : {}),
      }
    : undefined
  return { ...query, data }
}

export function useSkList() {
  return usePagedBuiltin<SecretKeyInfo>('sk-list', 'system/sk')
}

export function useSecretList() {
  return usePagedBuiltin<{ name: string, updatedAt: string }>('secret-list', 'system/secret')
}

export function usePluginList() {
  return usePagedBuiltin<PluginManifest>('plugin-list', 'system/plugin')
}

/**
 * 内置集成目录(`system/catalog`,对等 `tb integration catalog`)。
 *
 * 挂载向导要的是后者:只有它能把"该填什么"从 descriptor 直接渲染成表单,而且 read scope
 * 意味着非 admin 的用户也看得见(挂载只要 register scope,浏览不该更严)。
 */
export function useIntegrationCatalog() {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'integration-catalog'],
    queryFn: async () => {
      const r = await invoke(conn, 'system/catalog/list', { opts: { limit: 200 } })
      return (r.json as { items: CatalogListItem[] }).items ?? []
    },
    // descriptor 是编译期常量:同一部署内不会变,没必要反复拉。
    staleTime: 5 * 60 * 1000,
  })
}

/** remote 联邦 host 白名单合并视图(env 基线 + 运行时条目;对等 `tb federation ls`)。 */
export function useFederationList() {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'federation-list'],
    queryFn: async () => {
      const r = await invoke(conn, 'system/federation/list', {})
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
      const r = await invoke(conn, 'system/status/get', {})
      return r.json as { healthy: boolean, nodeCount: number, version: string }
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
        ? await invoke(conn, `${nodePath}/search`, { query, opts: { ...opts, mode } })
        : await invoke(conn, `${nodePath}/list`, { path: prefix, opts })
      return r.json as Page<ContextEntryMeta>
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.cursor,
  })
}

/** 单条目读取(查看/编辑对话框按需取;大对象 content = { $ref })。 */
export function useCtxEntry(nodePath: string, entryPath: string | null) {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'ctx-entry', nodePath, entryPath ?? ''],
    queryFn: async () => {
      const r = await invoke(conn, `${nodePath}/get`, { path: entryPath })
      return r.json as ContextEntry
    },
    enabled: entryPath !== null,
  })
}

/** 浏览器文件直传：grant 响应与临时 URL 最多在 observer 生命周期内短暂存在。 */
export function useCtxUpload(nodePath: string) {
  const conn = useConn()
  return useMutation({
    gcTime: 1_000,
    mutationFn: ({ entryPath, file, overwrite = false }: {
      entryPath: string
      file: File
      overwrite?: boolean
    }) => uploadContextObject(conn, nodePath, entryPath, file, overwrite),
  })
}

// ---- skillhub 浏览器(技能目录枚举/读取;与 CLI `tb skill ls|cat` 同一数据面)----

/**
 * skillhub 技能分页枚举:query 非空走 Search(对等 `tb skill search`),否则走 List。
 * cursor 分页交给 useInfiniteQuery(Page 语义)。
 */
export function useSkills(nodePath: string, query: string) {
  const conn = useConn()
  const base = useKeyBase()
  return useInfiniteQuery({
    queryKey: [...base, 'skills', nodePath, query],
    queryFn: async ({ pageParam }) => {
      const opts = pageParam ? { cursor: pageParam } : {}
      const r = query
        ? await invoke(conn, `${nodePath}/search`, { query, opts })
        : await invoke(conn, `${nodePath}/list`, { opts })
      return r.json as Page<SkillSummary>
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.cursor,
  })
}

/** 单个技能读取(选中技能后取 SKILL.md 正文 + 文件清单)。 */
export function useSkill(nodePath: string, id: string | null) {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'skill', nodePath, id ?? ''],
    queryFn: async () => {
      const r = await invoke(conn, `${nodePath}/get`, { id })
      return r.json as SkillDetail
    },
    enabled: id !== null,
  })
}

/** 技能内单文件读取(点击文件时按需取;大对象 content = { $ref })。 */
export function useSkillFile(nodePath: string, id: string | null, file: string | null) {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'skill-file', nodePath, id ?? '', file ?? ''],
    queryFn: async () => {
      const r = await invoke(conn, `${nodePath}/get`, { id, file })
      return r.json as SkillFile
    },
    enabled: id !== null && file !== null,
  })
}
