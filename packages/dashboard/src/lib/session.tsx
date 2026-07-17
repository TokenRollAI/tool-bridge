import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Connection } from './api'
import { clearProfileHistory } from './history'

/**
 * 会话档案(对等 CLI 的 profile 概念:`tb login --profile` / `tb use`)。
 * SK 存 localStorage(与 CLI 明文落 ~/.config/tool-bridge/config.json 同级的信任模型)。
 */
export interface Profile {
  baseUrl: string
  /** 本机稳定标识,用于隔离同名档案的历史与缓存。 */
  id: string
  name: string
  sk: string
}

export type ProfileInput = Omit<Profile, 'id'>

const PROFILES_KEY = 'tb.profiles'
const ACTIVE_KEY = 'tb.activeProfile'

function createProfileId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Array<Partial<Profile>>
    if (!Array.isArray(parsed)) return []
    let migrated = false
    const seenIds = new Set<string>()
    const profiles = parsed
      .filter(
        (p): p is Partial<Profile> & Pick<Profile, 'name' | 'sk'> =>
          typeof p?.name === 'string' && p.name.length > 0 && typeof p.sk === 'string',
      )
      .map((p) => {
        const validId
          = typeof p.id === 'string' && p.id.length > 0 && !seenIds.has(p.id) ? p.id : null
        const id = validId ?? createProfileId()
        const baseUrl = typeof p.baseUrl === 'string' ? p.baseUrl : ''
        if (validId === null || baseUrl !== p.baseUrl) migrated = true
        seenIds.add(id)
        return { id, name: p.name, baseUrl, sk: p.sk }
      })
    if (migrated) localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
    return profiles
  } catch {
    return []
  }
}

interface SessionState {
  active: Profile | null
  /** 当前连接(active 的视图);未登录为 null。 */
  conn: Connection | null
  login: (profile: ProfileInput) => void
  logout: () => void
  profiles: Profile[]
  removeProfile: (name: string) => void
  /** 档案/凭据每次切换都递增,让 query key 无需包含 SK 明文也能隔离。 */
  revision: number
  switchTo: (name: string) => void
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles)
  const [activeName, setActiveName] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_KEY),
  )
  const [revision, setRevision] = useState(0)

  const persist = useCallback(
    (next: Profile[], nextActive: string | null) => {
      localStorage.setItem(PROFILES_KEY, JSON.stringify(next))
      if (nextActive === null) localStorage.removeItem(ACTIVE_KEY)
      else localStorage.setItem(ACTIVE_KEY, nextActive)
      // Query 与 Mutation 都可带旧权限结果/一次性密钥响应,切凭据时统一清理。
      queryClient.clear()
      setProfiles(next)
      setActiveName(nextActive)
      setRevision(value => value + 1)
    },
    [queryClient],
  )

  const login = useCallback(
    (profile: ProfileInput) => {
      const previous = profiles.find(p => p.name === profile.name)
      const nextProfile: Profile = { ...profile, id: previous?.id ?? createProfileId() }
      const next = [...profiles.filter(p => p.name !== profile.name), nextProfile]
      persist(next, nextProfile.name)
    },
    [profiles, persist],
  )

  const switchTo = useCallback(
    (name: string) => {
      if (profiles.some(p => p.name === name)) persist(profiles, name)
    },
    [profiles, persist],
  )

  const removeProfile = useCallback(
    (name: string) => {
      const removed = profiles.find(p => p.name === name)
      const next = profiles.filter(p => p.name !== name)
      if (removed) clearProfileHistory(removed.id)
      persist(next, activeName === name ? (next[0]?.name ?? null) : activeName)
    },
    [profiles, activeName, persist],
  )

  const logout = useCallback(() => persist(profiles, null), [profiles, persist])

  const value = useMemo<SessionState>(() => {
    const active = profiles.find(p => p.name === activeName) ?? null
    return {
      profiles,
      active,
      revision,
      conn: active ? { baseUrl: active.baseUrl, sk: active.sk } : null,
      login,
      switchTo,
      removeProfile,
      logout,
    }
  }, [profiles, activeName, revision, login, switchTo, removeProfile, logout])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}

/** 已登录门内使用:conn 一定存在。 */
export function useConn(): Connection {
  const { conn } = useSession()
  if (!conn) throw new Error('useConn called while logged out')
  return conn
}
