/**
 * 调用历史(per profile + gateway,localStorage,封顶 50 条)。
 *
 * 安全边界:持久层只存调用元数据,绝不存 args。工具参数可能包含密钥、PII、
 * Context 正文或自定义 header,无法靠 path/tool 黑名单完整判断。任意工具参数都可能敏感,
 * 因此也不设跨组件的内存回放缓存;当前表单自身的 state
 * 仍会在面板存活期内保留未提交输入。
 */

export interface InvokeRecord {
  path: string
  tool: string
  ok: boolean
  /** TBError code(失败时)。 */
  code?: string
  ms: number
  /** ISO 时间戳。 */
  at: string
}

const CAP = 50
const KEY_PREFIX = 'tb.history.v2.'
const LEGACY_PREFIX = 'tb.history.'

export interface HistoryProfile {
  id: string
  baseUrl: string
}

/** 同名 profile 改连接地址时不串历史;同源用明确占位符。 */
export function historyScope(profile: HistoryProfile): string {
  return `${profile.id}\n${profile.baseUrl || 'same-origin'}`
}

const keyOf = (scope: string) => `${KEY_PREFIX}${encodeURIComponent(scope)}`
let listeners: Array<() => void> = []
/** useSyncExternalStore 要求 getSnapshot 引用稳定;按 profile 缓存解析结果。 */
const cache = new Map<string, InvokeRecord[]>()

function sanitizeRecord(value: unknown): InvokeRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (
    typeof v.path !== 'string' ||
    typeof v.tool !== 'string' ||
    typeof v.ok !== 'boolean' ||
    typeof v.ms !== 'number' ||
    typeof v.at !== 'string'
  ) {
    return null
  }
  // 显式 allowlist,旧记录或损坏数据里的 args/任意 extra 都不得穿透回持久层。
  return {
    path: v.path,
    tool: v.tool,
    ok: v.ok,
    ms: v.ms,
    at: v.at,
    ...(typeof v.code === 'string' ? { code: v.code } : {}),
  }
}

/**
 * v1 以 profile 名为 key 且持久化 args,无法安全映射到新 profile id + BaseURL。
 * 启动时删除 v1;对可能由早期 v2 预览产生的记录再做一次去 args 防御。
 */
function sanitizeStoredHistory(): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(
      (key): key is string => key?.startsWith(LEGACY_PREFIX) === true,
    )
    for (const key of keys) {
      if (!key.startsWith(KEY_PREFIX)) {
        localStorage.removeItem(key)
        continue
      }
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw) as unknown
        const safe = Array.isArray(parsed)
          ? parsed
              .map(sanitizeRecord)
              .filter((record): record is InvokeRecord => record !== null)
              .slice(0, CAP)
          : []
        localStorage.setItem(key, JSON.stringify(safe))
      } catch {
        localStorage.removeItem(key)
      }
    }
  } catch {
    // localStorage 被禁用时,历史自然降级为内存态。
  }
}

sanitizeStoredHistory()

export function loadHistory(scope: string): InvokeRecord[] {
  const hit = cache.get(scope)
  if (hit) return hit
  let parsed: InvokeRecord[] = []
  try {
    const raw = localStorage.getItem(keyOf(scope))
    if (raw) {
      const v = JSON.parse(raw) as unknown
      if (Array.isArray(v)) {
        parsed = v
          .map(sanitizeRecord)
          .filter((record): record is InvokeRecord => record !== null)
          .slice(0, CAP)
      }
    }
  } catch {
    // 损坏的历史直接弃置
  }
  cache.set(scope, parsed)
  return parsed
}

export function recordInvoke(scope: string, rec: InvokeRecord): void {
  const safe = sanitizeRecord(rec)
  if (!safe) return
  const next = [safe, ...loadHistory(scope)].slice(0, CAP)
  cache.set(scope, next)
  try {
    localStorage.setItem(keyOf(scope), JSON.stringify(next))
  } catch {
    // 配额满时静默放弃持久化(内存态仍生效)
  }
  for (const l of listeners) l()
}

export function clearHistory(scope: string): void {
  cache.set(scope, [])
  localStorage.removeItem(keyOf(scope))
  for (const l of listeners) l()
}

/** 删除档案时清理该稳定 id 下所有 BaseURL 的历史。 */
export function clearProfileHistory(profileId: string): void {
  for (const scope of cache.keys()) {
    if (scope.startsWith(`${profileId}\n`)) cache.delete(scope)
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i)
      if (!key?.startsWith(KEY_PREFIX)) continue
      const scope = decodeURIComponent(key.slice(KEY_PREFIX.length))
      if (scope.startsWith(`${profileId}\n`)) localStorage.removeItem(key)
    }
  } catch {
    // 降级为内存态
  }
  for (const l of listeners) l()
}

export function subscribeHistory(cb: () => void): () => void {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}
