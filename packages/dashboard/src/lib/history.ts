/**
 * 调用历史(per profile,localStorage,封顶 50 条)。
 * 与 theme.ts 同款极简 pub/sub:CmdPanel/ContextBrowser 写入,Overview 订阅展示。
 */

export interface InvokeRecord {
  path: string
  tool: string
  args: unknown
  ok: boolean
  /** TBError code(失败时)。 */
  code?: string
  ms: number
  /** ISO 时间戳。 */
  at: string
}

const CAP = 50
const keyOf = (profile: string) => `tb.history.${profile}`

let listeners: Array<() => void> = []
/** useSyncExternalStore 要求 getSnapshot 引用稳定;按 profile 缓存解析结果。 */
const cache = new Map<string, InvokeRecord[]>()

export function loadHistory(profile: string): InvokeRecord[] {
  const hit = cache.get(profile)
  if (hit) return hit
  let parsed: InvokeRecord[] = []
  try {
    const raw = localStorage.getItem(keyOf(profile))
    if (raw) {
      const v = JSON.parse(raw) as InvokeRecord[]
      if (Array.isArray(v)) parsed = v
    }
  } catch {
    // 损坏的历史直接弃置
  }
  cache.set(profile, parsed)
  return parsed
}

export function recordInvoke(profile: string, rec: InvokeRecord): void {
  const next = [rec, ...loadHistory(profile)].slice(0, CAP)
  cache.set(profile, next)
  try {
    localStorage.setItem(keyOf(profile), JSON.stringify(next))
  } catch {
    // 配额满时静默放弃持久化(内存态仍生效)
  }
  for (const l of listeners) l()
}

export function clearHistory(profile: string): void {
  cache.set(profile, [])
  localStorage.removeItem(keyOf(profile))
  for (const l of listeners) l()
}

export function subscribeHistory(cb: () => void): () => void {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}

/** 最近一次对 (path, tool) 的调用参数(重放起点);无记录返回 undefined。 */
export function lastArgsFor(profile: string, path: string, tool: string): unknown {
  return loadHistory(profile).find((r) => r.path === path && r.tool === tool)?.args
}
