import type { ConfigStatus, StorageBackendView } from '@tool-bridge/sdk/client'
import { useQuery } from '@tanstack/react-query'
import { useConn } from './session-context'
import { useKeyBase } from './queries'
import { invoke } from './api'

export function useManagedConfig() {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'managed-config'],
    queryFn: async () => (await invoke(conn, 'system/config/get', {})).json as ConfigStatus,
  })
}
export function useConfigSchema() {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'config-schema'],
    queryFn: async () => (await invoke(conn, 'system/config/schema', {})).json as Record<string, unknown>,
  })
}
export function useStorageBackends() {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery({
    queryKey: [...base, 'storage-backends'],
    queryFn: async () => (await invoke(conn, 'system/storage/list', {})).json as { items: StorageBackendView[] },
  })
}
