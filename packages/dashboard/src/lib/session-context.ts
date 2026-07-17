import { createContext, useContext } from 'react'
import type { Connection } from './api'

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

export interface SessionState {
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

export const SessionContext = createContext<SessionState | null>(null)

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
