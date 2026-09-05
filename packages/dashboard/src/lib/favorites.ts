/** 本机收藏只保存入口身份；调用时仍重新读取实时 help，绝不保存参数或结果。 */
export interface FavoriteTool {
  path: string
  tool: string
}

const PREFIX = 'tb.favorites.v1.'
const CAP = 50
const cache = new Map<string, FavoriteTool[]>()
const listeners = new Set<() => void>()
const keyOf = (scope: string) => `${PREFIX}${encodeURIComponent(scope)}`

function sanitize(value: unknown): FavoriteTool | null {
  if (value === null || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (typeof item.path !== 'string' || typeof item.tool !== 'string' || !item.tool) return null
  return { path: item.path, tool: item.tool }
}

export function loadFavorites(scope: string): FavoriteTool[] {
  const hit = cache.get(scope)
  if (hit) return hit
  let items: FavoriteTool[] = []
  try {
    const raw = localStorage.getItem(keyOf(scope))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) {
      const seen = new Set<string>()
      items = parsed.map(sanitize).filter((item): item is FavoriteTool => {
        if (!item) return false
        const id = JSON.stringify([item.path, item.tool])
        if (seen.has(id)) return false
        seen.add(id)
        return true
      }).slice(0, CAP)
      // 裁剪旧数据中可能混入的额外字段，而不将它们继续留在持久层。
      if (raw) localStorage.setItem(keyOf(scope), JSON.stringify(items))
    }
  } catch {
    // 存储不可用时保留本会话内的收藏。
  }
  cache.set(scope, items)
  return items
}

export function toggleFavorite(scope: string, entry: FavoriteTool): 'added' | 'removed' | 'full' {
  const item = sanitize(entry)
  if (!item) return 'full'
  const current = loadFavorites(scope)
  const exists = current.some(row => row.path === item.path && row.tool === item.tool)
  if (!exists && current.length >= CAP) return 'full'
  const next = exists
    ? current.filter(row => row.path !== item.path || row.tool !== item.tool)
    : [...current, item]
  cache.set(scope, next)
  try {
    localStorage.setItem(keyOf(scope), JSON.stringify(next))
  } catch { /* 内存降级 */ }
  listeners.forEach(listener => listener())
  return exists ? 'removed' : 'added'
}

export function subscribeFavorites(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) {
      cache.clear()
      listener()
    }
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

export function clearProfileFavorites(profileId: string): void {
  for (const scope of cache.keys()) {
    if (scope.startsWith(`${profileId}\n`)) cache.delete(scope)
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith(PREFIX) && decodeURIComponent(key.slice(PREFIX.length)).startsWith(`${profileId}\n`)) {
        localStorage.removeItem(key)
      }
    }
  } catch { /* 内存降级 */ }
  listeners.forEach(listener => listener())
}
