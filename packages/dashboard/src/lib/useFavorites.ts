import { useSyncExternalStore } from 'react'
import { loadFavorites, subscribeFavorites } from './favorites'
import { useSession } from './session-context'
import { historyScope } from './history'

export function useFavorites() {
  const { active } = useSession()
  const scope = active ? historyScope(active) : ''
  const favorites = useSyncExternalStore(subscribeFavorites, () => loadFavorites(scope))
  return { favorites, scope }
}
