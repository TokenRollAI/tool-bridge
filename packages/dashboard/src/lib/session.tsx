import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import type { Connection } from './api'

/**
 * 会话档案(对等 CLI 的 profile 概念:`tb login --profile` / `tb use`)。
 * SK 存 localStorage(与 CLI 明文落 ~/.config/tool-bridge/config.json 同级的信任模型)。
 */
export interface Profile {
  name: string
  baseUrl: string
  sk: string
}

const PROFILES_KEY = 'tb.profiles'
const ACTIVE_KEY = 'tb.activeProfile'

function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Profile[]
    return Array.isArray(parsed) ? parsed.filter((p) => p?.name && p.sk !== undefined) : []
  } catch {
    return []
  }
}

interface SessionState {
  profiles: Profile[]
  active: Profile | null
  /** 当前连接(active 的视图);未登录为 null。 */
  conn: Connection | null
  login: (profile: Profile) => void
  switchTo: (name: string) => void
  removeProfile: (name: string) => void
  logout: () => void
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles)
  const [activeName, setActiveName] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_KEY),
  )

  const persist = useCallback((next: Profile[], nextActive: string | null) => {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(next))
    if (nextActive === null) localStorage.removeItem(ACTIVE_KEY)
    else localStorage.setItem(ACTIVE_KEY, nextActive)
    setProfiles(next)
    setActiveName(nextActive)
  }, [])

  const login = useCallback(
    (profile: Profile) => {
      const next = [...profiles.filter((p) => p.name !== profile.name), profile]
      persist(next, profile.name)
    },
    [profiles, persist],
  )

  const switchTo = useCallback(
    (name: string) => {
      if (profiles.some((p) => p.name === name)) persist(profiles, name)
    },
    [profiles, persist],
  )

  const removeProfile = useCallback(
    (name: string) => {
      const next = profiles.filter((p) => p.name !== name)
      persist(next, activeName === name ? (next[0]?.name ?? null) : activeName)
    },
    [profiles, activeName, persist],
  )

  const logout = useCallback(() => persist(profiles, null), [profiles, persist])

  const value = useMemo<SessionState>(() => {
    const active = profiles.find((p) => p.name === activeName) ?? null
    return {
      profiles,
      active,
      conn: active ? { baseUrl: active.baseUrl, sk: active.sk } : null,
      login,
      switchTo,
      removeProfile,
      logout,
    }
  }, [profiles, activeName, login, switchTo, removeProfile, logout])

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
