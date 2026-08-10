import type { Page, TreePath } from '../types'
import type { ToolSpec } from '../tool/types'
import { normalizePath, validatePath } from '../tree/path'
import { TBError } from '../errors'

export type SearchCapability = 'search' | 'search:semantic'

/** 正式 cursor/over-fetch 契约落地前，防止候选后处理产生无界宿主 I/O。 */
export const TOOL_SEARCH_CANDIDATE_LIMIT = 40

/** 全局工具搜索的候选结果；对外返回前仍须由 gateway 做权限与虚拟化后处理。 */
export interface ToolSearchHit {
  path: TreePath
  tool: ToolSpec
}

/** 全局工具搜索当前只声明 mode；分页/filter 在 Phase 4 item 5 定义后再扩展。 */
export interface ToolSearchOptions {
  mode?: 'keyword' | 'semantic'
}

/** 宿主提供的全局工具索引。实现必须只声明真实可用的 capability。 */
export interface SearchIndex {
  readonly capabilities: readonly SearchCapability[]
  search(query: string, opts?: ToolSearchOptions): Promise<Page<ToolSearchHit>>
}

/** 仅声明 keyword capability 的 adapter 在 JS runtime 也须拒绝 semantic/未知 mode。 */
export function assertKeywordToolSearchMode(opts?: ToolSearchOptions): void {
  if (opts?.mode !== undefined && opts.mode !== 'keyword') {
    throw new TBError('invalid_argument', `SearchIndex 不支持 mode '${String(opts.mode)}'`)
  }
}

/** 索引持久层使用的规范化工具记录；JSON 是 raw ToolSpec 的完整存储形态。 */
export interface SerializedToolSearchRecord {
  description: string
  name: string
  path: TreePath
  toolJson: string
}

/**
 * 可变索引的宿主契约。写入单位是节点快照，避免逐条 upsert 遗留已删除工具；
 * rebuild 用于启动校验或运维修复索引漂移。
 */
export interface MutableSearchIndex extends SearchIndex {
  rebuild(hits: readonly ToolSearchHit[]): Promise<void>
  remove(path: TreePath): Promise<void>
  replace(path: TreePath, tools: readonly ToolSpec[]): Promise<void>
}

function serializedRecord(path: TreePath, tool: ToolSpec): SerializedToolSearchRecord {
  if (typeof tool.name !== 'string' || tool.name.length === 0) {
    throw new TBError('invalid_argument', '工具索引条目的 name 必须是非空字符串')
  }
  if (tool.description !== undefined && typeof tool.description !== 'string') {
    throw new TBError('invalid_argument', `工具 '${tool.name}' 的 description 必须是字符串`)
  }
  let toolJson: string | undefined
  try {
    toolJson = JSON.stringify(tool)
  } catch {
    throw new TBError('invalid_argument', `工具 '${tool.name}' 不能序列化为 JSON`)
  }
  if (toolJson === undefined) {
    throw new TBError('invalid_argument', `工具 '${tool.name}' 不能序列化为 JSON`)
  }
  return {
    description: tool.description ?? '',
    name: tool.name,
    path,
    toolJson,
  }
}

/** 把索引路径规范化为 registry 使用的无首尾斜杠形态。 */
export function normalizeToolSearchPath(path: TreePath): TreePath {
  const canonical = normalizePath(path)
  const pathError = validatePath(canonical)
  if (pathError !== null) throw pathError
  return canonical
}

/** 校验并序列化一个节点的完整 raw ToolSpec 快照；重复工具名 fail closed。 */
export function serializeToolSearchSnapshot(
  path: TreePath,
  tools: readonly ToolSpec[],
): SerializedToolSearchRecord[] {
  const canonical = normalizeToolSearchPath(path)
  const names = new Set<string>()
  return tools.map((tool) => {
    const record = serializedRecord(canonical, tool)
    if (names.has(record.name)) {
      throw new TBError(
        'invalid_argument',
        `工具索引快照 '${canonical}' 含重复工具名 '${record.name}'`,
      )
    }
    names.add(record.name)
    return record
  })
}

/** 校验并序列化全量 rebuild 输入；规范化后相同 path/name 视为冲突。 */
export function serializeToolSearchHits(
  hits: readonly ToolSearchHit[],
): SerializedToolSearchRecord[] {
  const identities = new Set<string>()
  return hits.map(({ path, tool }) => {
    const [record] = serializeToolSearchSnapshot(path, [tool])
    if (record === undefined) {
      throw new TBError('internal', '工具索引序列化未产生记录')
    }
    const identity = JSON.stringify([record.path, record.name])
    if (identities.has(identity)) {
      throw new TBError(
        'invalid_argument',
        `工具索引 rebuild 含重复条目 '${record.path}/${record.name}'`,
      )
    }
    identities.add(identity)
    return record
  })
}

/** 把用户输入变成只含 literal phrase 的 FTS5 MATCH 表达式，不开放查询语法。 */
export function literalToolSearchQuery(query: string): string {
  if (query.includes('\0')) {
    throw new TBError('invalid_argument', '搜索 query 不得包含 NUL 字符')
  }
  const terms = query.trim().split(/\s+/u).filter(Boolean)
  if (terms.length === 0) {
    throw new TBError('invalid_argument', '搜索 query 不能为空')
  }
  return terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' ')
}
