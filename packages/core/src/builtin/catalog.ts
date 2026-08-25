/**
 * builtin 模块 "catalog" → **内置插件目录的只读浏览面**(挂载为 system/catalog 节点)。
 *
 * 与 `system/plugin` 的分工:那个是 external plugin 的**注册面**(admin,有副作用);
 * 这个是平台自带能力的**目录**(read,纯读)。内置 provider 只从此处发现,不进入注册表。
 *
 * **scope=read 而非 admin**:descriptor 里没有敏感信息(provider 名、export id、
 * 凭证**字段名**与它们要不要遮蔽;没有任何凭证值)。挂载需要 register scope,浏览不该
 * 比它更严 —— 否则渐进式发现在这条路上断掉。判定仍走 Authorizer.Check(读得到这个节点
 * 才能列),没有旁路。
 */

import { z } from 'zod/v4'
import type { PluginCredentialField, PluginExport, PluginMountConfigField } from '../plugin/contract'
import type { BuiltinCatalog, BuiltinCatalogEntry } from '../plugin/catalog'
import type { BuiltinModule } from './types'
import { BuiltinCommandRegistry } from './commandRegistry'
import { LIST_OPTS_ZOD_SCHEMA } from './util'
import { LIST_LIMIT_MAX } from '../types'
import { TBError } from '../errors'

const DESCRIPTION = 'Built-in integration catalog (read-only; mount one via system/registry)'

/**
 * 目录项的对外投影。**刻意不回 describe 全文**:列表要的是"有什么、要配什么",
 * 而 `~describe` 里还有 methods/capabilities 这类挂载后才用得上的细节。
 * 要全文走 `get`。
 */
export interface CatalogListItem {
  description?: string
  /** descriptor 指纹;升级检测与三宿主对拍用。 */
  digest: string
  /**
   * export id → 它能挂成的节点 kind。选定 export 后 kind 是**确定**的 —— `nodeKinds` 只说
   * "这个 provider 涉及哪些 kind",挂哪个 kind 取决于挂的是哪个 export。多 export 跨 kind 的
   * provider(如 notes:actions=tool / notes=context)靠它把选中的 export 挂到对的 kind,
   * 而不是落到默认值。
   */
  /** 每个 export 的精确挂载契约;新客户端必须以选中的 export 为准。 */
  exportDetails: Record<string, CatalogExportDetails>
  /** 可挂载的 export id(单 export 时挂载可省略 config.export)。 */
  exports: string[]
  id: string
  /** 这些 export 能挂成什么 kind 的节点。 */
  nodeKinds: Array<'tool' | 'context'>
}

export type CatalogExportAuth
  = | { fields: PluginCredentialField[], kind: 'fields' }
    | { kind: 'none' }
    | { kind: 'oauth' }
    | { description?: string, kind: 'single', label?: string, required: boolean }

export interface CatalogExportDetails {
  auth: CatalogExportAuth
  description?: string
  id: string
  kind: 'tool' | 'context'
  mountConfigFields?: PluginMountConfigField[]
}

const NODE_KIND_BY_PROFILE: Record<string, 'tool' | 'context'> = {
  'tools/v1': 'tool',
  'context/v1': 'context',
}

function projectExportAuth(exported: PluginExport): CatalogExportAuth {
  if (exported.oauth !== undefined) return { kind: 'oauth' }
  if (exported.credentialFields !== undefined) {
    return { kind: 'fields', fields: exported.credentialFields }
  }
  if (exported.auth?.kind === 'none') return { kind: 'none' }
  if (exported.auth?.kind !== 'single') {
    throw new TBError(
      'invalid_argument',
      `catalog export '${exported.id}' 必须显式声明 auth、oauth 或 credentialFields`,
    )
  }
  return {
    kind: 'single',
    required: exported.auth.required ?? false,
    ...(exported.auth.label !== undefined ? { label: exported.auth.label } : {}),
    ...(exported.auth.description !== undefined
      ? { description: exported.auth.description }
      : {}),
  }
}

function projectListItem(entry: BuiltinCatalogEntry): CatalogListItem {
  const exports = entry.describe.exports
  const kinds = new Set<'tool' | 'context'>()
  const exportDetails: Record<string, CatalogExportDetails> = {}
  for (const e of exports) {
    const kind = NODE_KIND_BY_PROFILE[e.profile]
    if (kind !== undefined) {
      kinds.add(kind)
      exportDetails[e.id] = {
        id: e.id,
        kind,
        auth: projectExportAuth(e),
        ...(e.description !== undefined ? { description: e.description } : {}),
        ...(e.mountConfigFields !== undefined
          ? { mountConfigFields: e.mountConfigFields }
          : {}),
      }
    }
  }
  const description = exports.find(e => e.description !== undefined)?.description
  return {
    id: entry.id,
    digest: entry.digest,
    exports: exports.map(e => e.id),
    exportDetails,
    nodeKinds: [...kinds].sort(),
    ...(description !== undefined ? { description } : {}),
  }
}

/**
 * 搜索:按 id 与 description 子串匹配(大小写不敏感)。
 *
 * 刻意不做分词/打分:目录规模由宿主装配决定,而这里的用途是"我记得有个
 * 叫 tavily 的" —— 子串够用。全局工具搜索是另一条路(`/~search`,有索引与权重)。
 */
function matches(item: CatalogListItem, query: string): boolean {
  const q = query.toLowerCase()
  return (
    item.id.toLowerCase().includes(q)
    || (item.description?.toLowerCase().includes(q) ?? false)
  )
}

export interface CatalogModuleDeps {
  /** 宿主装配的内置目录(编译期常量)。缺省空目录 → list 回空页,不报错。 */
  catalog: () => BuiltinCatalog
}

/** 分页:目录是内存里的有序数组,cursor 就是下一条的 id(不透明性无意义,规模有界)。 */
function paginate(
  items: CatalogListItem[],
  opts?: { cursor?: string, limit?: number },
): { cursor?: string, items: CatalogListItem[] } {
  const limit
    = typeof opts?.limit === 'number' && opts.limit > 0 ? Math.min(opts.limit, LIST_LIMIT_MAX) : 50
  let start = 0
  if (opts?.cursor !== undefined && opts.cursor !== '') {
    const idx = items.findIndex(i => i.id === opts.cursor)
    // cursor 指向的条目可能已随宿主重新装配消失:从头开始而不是报错
    // (目录是派生视图,不该让一个失效 cursor 变成不可恢复的错误)。
    start = idx >= 0 ? idx : 0
  }
  const page = items.slice(start, start + limit)
  const next = items[start + limit]
  return { items: page, ...(next !== undefined ? { cursor: next.id } : {}) }
}

function sortedItems(deps: CatalogModuleDeps): CatalogListItem[] {
  return Object.values(deps.catalog())
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(projectListItem)
}

const COMMANDS = new BuiltinCommandRegistry<CatalogModuleDeps>('catalog', DESCRIPTION)
  .register(
    'list',
    {
      h: 'list built-in integrations available on this host (no credentials, read scope)',
      inputSchema: z.strictObject({ opts: LIST_OPTS_ZOD_SCHEMA.optional() }),
      returns: 'Page<CatalogListItem> — id, exports, nodeKinds, exportDetails',
      scope: 'read',
    },
    ({ opts }, { deps }) => paginate(sortedItems(deps), opts),
  )
  .register(
    'get',
    {
      h: 'fetch one catalog entry including its full /~describe descriptor',
      inputSchema: z.strictObject({
        id: z.string().min(1).describe('catalog entry id (= provider id)'),
      }),
      returns: 'CatalogEntry — id, endpoint, digest, describe',
      scope: 'read',
    },
    ({ id }, { deps }) => {
      const entry = deps.catalog()[id]
      if (entry === undefined) throw new TBError('not_found', `no catalog entry '${id}'`)
      return entry
    },
  )
  .register(
    'search',
    {
      h: 'substring search over catalog id and description',
      inputSchema: z.strictObject({
        q: z.string().min(1).describe('case-insensitive substring'),
        opts: LIST_OPTS_ZOD_SCHEMA.optional(),
      }),
      returns: 'Page<CatalogListItem>',
      scope: 'read',
    },
    ({ opts, q }, { deps }) => paginate(sortedItems(deps).filter(i => matches(i, q)), opts),
  )

export function createCatalogModule(deps: CatalogModuleDeps): BuiltinModule {
  return COMMANDS.module(deps)
}
