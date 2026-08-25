import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import {
  deleteStoreObject,
  listStoreObjects,
  readStoreObject,
  revokeStoreShare,
  shareStoreObject,
  statStoreObject,
  type StoreObjectDescriptor,
  uploadStoreObject,
} from './store'
import { useConn } from './session-context'
import { useKeyBase } from './queries'

/** Store 独立于 Context authoring，且只随懒加载的管理页进入浏览器。 */
export function useStoreObjects() {
  const conn = useConn()
  const base = useKeyBase()
  return useInfiniteQuery({
    queryKey: [...base, 'store-list'],
    queryFn: ({ pageParam, signal }) => listStoreObjects(conn, {
      limit: 50,
      ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
    }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.cursor,
  })
}

export function useStoreStat(uri: string | null) {
  const conn = useConn()
  const base = useKeyBase()
  return useQuery<StoreObjectDescriptor>({
    queryKey: [...base, 'store-stat', uri ?? ''],
    queryFn: ({ signal }) => statStoreObject(conn, uri ?? '', signal),
    enabled: uri !== null,
  })
}

export function useStoreUpload() {
  const conn = useConn()
  return useMutation({
    gcTime: 1_000,
    mutationFn: ({ file, filename }: { file: File, filename?: string }) =>
      uploadStoreObject(conn, file, { ...(filename ? { filename } : {}) }),
  })
}

export function useStoreRead() {
  const conn = useConn()
  return useMutation({
    gcTime: 1_000,
    mutationFn: (uri: string) => readStoreObject(conn, uri),
  })
}

export function useStoreShare() {
  const conn = useConn()
  return useMutation({
    gcTime: 1_000,
    mutationFn: ({ uri, ttlSec }: { ttlSec?: number, uri: string }) =>
      shareStoreObject(conn, uri, ttlSec),
  })
}

export function useStoreRevokeShare() {
  const conn = useConn()
  return useMutation({
    mutationFn: (shareId: string) => revokeStoreShare(conn, shareId),
  })
}

export function useStoreDelete() {
  const conn = useConn()
  return useMutation({
    mutationFn: (uri: string) => deleteStoreObject(conn, uri),
  })
}
