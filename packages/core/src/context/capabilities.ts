/**
 * Context 能力推导:从 handler 的**存在性**反推 provider 实际支持什么。
 *
 * 此前 `ContextProvider` 强制四动词(List/Get/Update/Write)全实现,只有 Search/Delete
 * 可选。代价是形态被写死:只读资源实现不了(被迫伪造 Write/Update)、搜索服务被迫伪造
 * List/Get、append-only 存储被迫实现 Update,而挂载期的 `readOnly` 只是隐藏写动词、
 * 并不代表 provider 真的没有写能力。
 *
 * 改为:**全部 handler 可选**,能力由存在性推导 —— `~help` 只列真实存在的操作,
 * 没有任何写动词即自动只读。作者写多少就是多少,不再有"为了满足接口而抛 unimplemented"
 * 的样板。
 */

import type { ContextProvider } from './types'

/** 数据面动词全集(cmd 名 = 方法名;与 help.ts 的 SCOPE_BY_CMD 同源)。 */
export const CONTEXT_METHODS = ['List', 'Get', 'Search', 'Write', 'Update', 'Delete'] as const

export type ContextMethod = (typeof CONTEXT_METHODS)[number]

/** 写动词(判定只读用)。 */
export const CONTEXT_WRITE_METHODS: readonly ContextMethod[] = ['Write', 'Update', 'Delete']

/** 按 handler 存在性推导 provider 实际支持的方法集。 */
export function contextMethodsOf(provider: ContextProvider): Set<ContextMethod> {
  const methods = new Set<ContextMethod>()
  for (const method of CONTEXT_METHODS) {
    if (typeof provider[method] === 'function') methods.add(method)
  }
  return methods
}

/**
 * 无任何写动词 → 只读。挂载期显式 `readOnly` 仍可**额外**收紧一个本可写的 provider,
 * 但一个压根没有写 handler 的 provider 不必再靠配置来声明只读。
 */
export function isReadOnlyProvider(provider: ContextProvider): boolean {
  return !CONTEXT_WRITE_METHODS.some(method => typeof provider[method] === 'function')
}

/**
 * `~describe` 的 capabilities:只报**可选**能力(search/delete),四个核心动词不进
 * capabilities —— 保持既有协议语义不变,避免与 plugin 侧的 capabilities 词表漂移。
 * 真实可用动词的完整信息由 `~help` 的 cmd 列表承载(见 contextHelpModel 的 methods 过滤)。
 */
export function contextCapabilitiesOf(provider: ContextProvider): string[] {
  const capabilities: string[] = []
  if (provider.Search !== undefined) capabilities.push('search')
  if (provider.Delete !== undefined) capabilities.push('delete')
  return capabilities
}
