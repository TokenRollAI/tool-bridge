/**
 * builtin 模块 "catalog" → **内置插件目录的只读浏览面**(挂载为 system/catalog 节点)。
 *
 * 与 `system/plugin` 的分工:那个是 external plugin 的**注册面**(admin,有副作用);
 * 这个是平台自带能力的**目录**(read,纯读)。此前"有哪些内置 provider 可用"只能经
 * `system/plugin catalog`(admin)看,于是一个只有 register scope 的用户想挂载内置插件,
 * 却看不到有哪些可挂 —— 能力可用而不可发现。
 *
 * **scope=read 而非 admin**:descriptor 里没有敏感信息(provider 名、export id、
 * 凭证**字段名**与它们要不要遮蔽;没有任何凭证值)。挂载需要 register scope,浏览不该
 * 比它更严 —— 否则渐进式发现在这条路上断掉。判定仍走 Authorizer.Check(读得到这个节点
 * 才能列),没有旁路。
 */

import type { PluginCredentialField, PluginMountConfigField } from '../plugin/contract'
import type { BuiltinCatalog, BuiltinCatalogEntry } from '../plugin/catalog'
import type { CmdSpec, HelpModel } from '../htbp/model'
import type { BuiltinModule } from './types'
import { cmdPath, LIST_OPTS_SCHEMA, requireString } from './util'
import { LIST_LIMIT_MAX, type TreePath } from '../types'
import { TBError } from '../errors'

const DESCRIPTION = 'Built-in integration catalog (read-only; mount one via system/registry)'

/**
 * 目录项的对外投影。**刻意不回 describe 全文**:列表要的是"有什么、要配什么",
 * 而 `~describe` 里还有 methods/capabilities 这类挂载后才用得上的细节。
 * 要全文走 `get`。
 */
export interface CatalogListItem {
  /** 声明了多字段凭证时给出字段名(不含值);单值凭证为 undefined。 */
  credentialFields?: PluginCredentialField[]
  description?: string
  /** descriptor 指纹;升级检测与三宿主对拍用。 */
  digest: string
  /** 可挂载的 export id(单 export 时挂载可省略 config.export)。 */
  exports: string[]
  id: string
  /**
   * 声明了非凭证挂载配置(如 baseUrl)时给出字段名与是否必填(不含值)。挂载向导据此
   * 渲染带标签的输入框;未声明为 undefined。
   */
  mountConfigFields?: PluginMountConfigField[]
  /** 声明了 oauth → 挂载后还要授权一步。 */
  needsOAuth: boolean
  /** 这些 export 能挂成什么 kind 的节点。 */
  nodeKinds: Array<'tool' | 'context'>
}

const NODE_KIND_BY_PROFILE: Record<string, 'tool' | 'context'> = {
  'tools/v1': 'tool',
  'context/v1': 'context',
}

function projectListItem(entry: BuiltinCatalogEntry): CatalogListItem {
  const exports = entry.describe.exports
  const kinds = new Set<'tool' | 'context'>()
  for (const e of exports) {
    const kind = NODE_KIND_BY_PROFILE[e.profile]
    if (kind !== undefined) kinds.add(kind)
  }
  // 多 export 时字段声明可能各不相同;列表取第一个声明了凭证字段的那个作为提示,
  // 精确形状由 get 给出(挂载表单也该按选定的 export 取)。
  const withFields = exports.find(e => e.credentialFields !== undefined)
  const withMountConfig = exports.find(e => e.mountConfigFields !== undefined)
  const description = exports.find(e => e.description !== undefined)?.description
  return {
    id: entry.id,
    digest: entry.digest,
    exports: exports.map(e => e.id),
    nodeKinds: [...kinds].sort(),
    needsOAuth: exports.some(e => e.oauth !== undefined),
    ...(description !== undefined ? { description } : {}),
    ...(withFields?.credentialFields !== undefined
      ? { credentialFields: withFields.credentialFields }
      : {}),
    ...(withMountConfig?.mountConfigFields !== undefined
      ? { mountConfigFields: withMountConfig.mountConfigFields }
      : {}),
  }
}

/**
 * 搜索:按 id 与 description 子串匹配(大小写不敏感)。
 *
 * 刻意不做分词/打分:目录规模是宿主装配数(当前 99),而这里的用途是"我记得有个
 * 叫 tavily 的" —— 子串够用。全局工具搜索是另一条路(`/~search`,有索引与权重)。
 */
function matches(item: CatalogListItem, query: string): boolean {
  const q = query.toLowerCase()
  return (
    item.id.toLowerCase().includes(q)
    || (item.description?.toLowerCase().includes(q) ?? false)
  )
}

function catalogCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  return [
    {
      name: 'list',
      method: 'POST',
      path,
      h: 'list built-in integrations available on this host (no credentials, read scope)',
      inputSchema: { type: 'object', properties: { opts: LIST_OPTS_SCHEMA } },
      returns: 'Page<CatalogListItem> — id, exports, nodeKinds, credential field names',
      scope: 'read',
    },
    {
      name: 'get',
      method: 'POST',
      path,
      h: 'fetch one catalog entry including its full /~describe descriptor',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'catalog entry id (= provider id)' } },
        required: ['id'],
      },
      returns: 'CatalogEntry — id, endpoint, digest, describe',
      scope: 'read',
    },
    {
      name: 'search',
      method: 'POST',
      path,
      h: 'substring search over catalog id and description',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'case-insensitive substring' },
          opts: LIST_OPTS_SCHEMA,
        },
        required: ['q'],
      },
      returns: 'Page<CatalogListItem>',
      scope: 'read',
    },
  ]
}

export interface CatalogModuleDeps {
  /** 宿主装配的内置目录(编译期常量)。缺省空目录 → list 回空页,不报错。 */
  catalog: () => BuiltinCatalog
}

/** 分页:目录是内存里的有序数组,cursor 就是下一条的 id(不透明性无意义,规模有界)。 */
function paginate(
  items: CatalogListItem[],
  opts: unknown,
): { cursor?: string, items: CatalogListItem[] } {
  const o = (typeof opts === 'object' && opts !== null ? opts : {}) as {
    cursor?: unknown
    limit?: unknown
  }
  const limit
    = typeof o.limit === 'number' && o.limit > 0 ? Math.min(o.limit, LIST_LIMIT_MAX) : 50
  let start = 0
  if (typeof o.cursor === 'string' && o.cursor !== '') {
    const idx = items.findIndex(i => i.id === o.cursor)
    // cursor 指向的条目可能已随宿主重新装配消失:从头开始而不是报错
    // (目录是派生视图,不该让一个失效 cursor 变成不可恢复的错误)。
    start = idx >= 0 ? idx : 0
  }
  const page = items.slice(start, start + limit)
  const next = items[start + limit]
  return { items: page, ...(next !== undefined ? { cursor: next.id } : {}) }
}

export function createCatalogModule(deps: CatalogModuleDeps): BuiltinModule {
  const sortedItems = (): CatalogListItem[] =>
    Object.values(deps.catalog())
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(projectListItem)

  return {
    module: 'catalog',
    description: DESCRIPTION,
    help(nodePath: TreePath): HelpModel {
      return {
        node: { path: nodePath, kind: 'builtin', description: DESCRIPTION },
        cmds: catalogCmds(nodePath),
      }
    },
    async dispatch(cmd: string, args: Record<string, unknown>): Promise<unknown> {
      switch (cmd) {
        case 'list':
          return paginate(sortedItems(), args.opts)
        case 'get': {
          const id = requireString(args, 'id')
          const entry = deps.catalog()[id]
          if (entry === undefined) {
            throw new TBError('not_found', `no catalog entry '${id}'`)
          }
          return entry
        }
        case 'search': {
          const q = requireString(args, 'q')
          return paginate(sortedItems().filter(i => matches(i, q)), args.opts)
        }
        default:
          throw new TBError('invalid_argument', `unknown cmd '${cmd}' on system/catalog`)
      }
    },
  }
}
