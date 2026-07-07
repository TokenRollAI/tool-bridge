/**
 * mcp `~help` 缓存:上游 `tools/list` 结果缓存于 StateStore。
 *
 * key `toolcache:<path>` → `{ tools, fetchedAt }`;TTL 默认 300s(env `TB_TOOL_CACHE_TTL`,秒)。
 * 失效触发三者:TTL 到期、该节点的 NodeRegistry Write/Update/Delete(gateway 注册点调
 * `invalidateToolCache`)、`GET <path>/~help?refresh=1`(调用点传 `refresh:true`)。
 *
 * 缓存的是**虚拟化前的原始 ToolSpec[]**——虚拟化是纯函数、改 Virtualize 立即生效,不入缓存。
 */

import type { StateStore, ToolSpec } from '@tool-bridge/core'

const KEY_PREFIX = 'toolcache:'
const DEFAULT_TTL_SECONDS = 300

interface CachedTools {
  tools: ToolSpec[]
  /** ISO 8601 写入时刻。 */
  fetchedAt: string
}

function keyOf(path: string): string {
  return `${KEY_PREFIX}${path}`
}

/** 解析缓存 TTL(秒):env `TB_TOOL_CACHE_TTL` 为正数则用之,否则默认 300。 */
export function toolCacheTtl(env: { TB_TOOL_CACHE_TTL?: string }): number {
  const n = Number(env.TB_TOOL_CACHE_TTL)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SECONDS
}

function isCached(v: unknown): v is CachedTools {
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as CachedTools).tools) &&
    typeof (v as CachedTools).fetchedAt === 'string'
  )
}

/** 缓存未过期?age = now - fetchedAt(秒),0 ≤ age < ttl 为新鲜。 */
function isFresh(fetchedAt: string, ttl: number, now: string): boolean {
  const age = (Date.parse(now) - Date.parse(fetchedAt)) / 1000
  return Number.isFinite(age) && age >= 0 && age < ttl
}

/** 删除某节点的工具缓存(注册变更时调用)。 */
export async function invalidateToolCache(store: StateStore, path: string): Promise<void> {
  await store.delete(keyOf(path))
}

/**
 * 取工具列表:命中未过期缓存直接返回;否则调 `fetch()` 回填缓存后返回。
 * `refresh:true`(`?refresh=1`)跳过读缓存、强制重取并回填。
 */
export async function getTools(
  store: StateStore,
  path: string,
  fetchList: () => Promise<ToolSpec[]>,
  opts: { refresh: boolean; ttl: number; now: string },
): Promise<ToolSpec[]> {
  if (!opts.refresh) {
    const raw = await store.get(keyOf(path))
    if (isCached(raw) && isFresh(raw.fetchedAt, opts.ttl, opts.now)) {
      return raw.tools
    }
  }
  const tools = await fetchList()
  const record: CachedTools = { tools, fetchedAt: opts.now }
  await store.put(keyOf(path), record)
  return tools
}
