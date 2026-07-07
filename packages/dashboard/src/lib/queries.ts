import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getHealthz, getHelp, getHelpDsl, getTree, type InvokeResult, invoke } from './api'
import { useConn, useSession } from './session'
import type { Page, RegistryNode, SecretKeyInfo } from './types'

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
 * 工具级 `~help`(Proto §4.2 两级披露的细节级):mcp/http 节点级 ~help 是索引形态
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
}

/** 数据面调用(变更型;成功后由调用方决定失效哪些查询)。 */
export function useInvoke() {
  const conn = useConn()
  return useMutation<InvokeResult, Error, InvokeInput>({
    mutationFn: ({ path, tool, args, accept }) => invoke(conn, path, tool, args, accept ?? 'json'),
  })
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
