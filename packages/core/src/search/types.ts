import type { SearchOptions } from '../context/types'
import type { Page, TreePath } from '../types'
import type { ToolSpec } from '../tool/types'

export type SearchCapability = 'search' | 'search:semantic'

/** 全局工具搜索的候选结果；对外返回前仍须由 gateway 做权限与虚拟化后处理。 */
export interface ToolSearchHit {
  path: TreePath
  tool: ToolSpec
}

/** 宿主提供的全局工具索引。实现必须只声明真实可用的 capability。 */
export interface SearchIndex {
  readonly capabilities: readonly SearchCapability[]
  search(query: string, opts?: SearchOptions): Promise<Page<ToolSearchHit>>
}
