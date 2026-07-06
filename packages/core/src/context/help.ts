/**
 * context 节点的静态 ~help 模型与 cmd→scope 表(Proto §1.3/§2.2)。
 *
 * cmd 名 = 接口方法名首字母大写(Proto §1.3;仅 system/* builtin 小写);
 * List/Get/Search = read,Write/Update/Delete = write(Proto §2.2 规范性)。
 * cmd 表静态声明(区别于 mcp/http 的上游发现);readOnly 挂载隐藏三个写动词(决策 D11)。
 */

import { cmdPath } from '../builtin/util'
import type { CmdSpec, HelpModel } from '../htbp/model'
import type { TreePath } from '../types'

/** ~describe 声明的可选能力(Proto §5.1:本实现提供 Search 与 Delete)。 */
export const CONTEXT_CAPABILITIES: readonly string[] = ['search', 'delete']

const SCOPE_BY_CMD: Record<string, 'read' | 'write'> = {
  List: 'read',
  Get: 'read',
  Search: 'read',
  Write: 'write',
  Update: 'write',
  Delete: 'write',
}

/** 数据面 {tool} → scope;未知(含大小写不符)→ null,由网关按 invalid_argument 处理。 */
export function contextScopeForCmd(tool: string): 'read' | 'write' | null {
  return SCOPE_BY_CMD[tool] ?? null
}

const OPTS_SCHEMA = {
  type: 'object',
  properties: {
    cursor: { type: 'string' },
    limit: { type: 'number' },
  },
} as const

const SEARCH_OPTS_SCHEMA = {
  type: 'object',
  properties: {
    cursor: { type: 'string' },
    limit: { type: 'number' },
    mode: { type: 'string', enum: ['keyword', 'semantic'] },
  },
} as const

const METADATA_SCHEMA = {
  type: 'object',
  additionalProperties: { type: 'string' },
} as const

/** ContextEntryInput;contentType 可缺省仅限非字符串 content(落 application/json)。 */
const ENTRY_SCHEMA = {
  type: 'object',
  required: ['content'],
  properties: {
    contentType: { type: 'string' },
    content: {},
    metadata: METADATA_SCHEMA,
    ifVersion: { type: 'string' },
  },
} as const

const PATCH_SCHEMA = {
  type: 'object',
  properties: {
    content: {},
    metadata: METADATA_SCHEMA,
    ifVersion: { type: 'string' },
  },
} as const

function contextCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  return [
    {
      name: 'List',
      method: 'POST',
      path,
      h: '枚举条目(浅层列表 + 分页)',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, opts: OPTS_SCHEMA },
      },
      returns: 'Page<ContextEntryMeta>',
      scope: 'read',
    },
    {
      name: 'Get',
      method: 'POST',
      path,
      h: '读取单个条目(含内容;大对象 content = { $ref })',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: { path: { type: 'string' } },
      },
      returns: 'ContextEntry',
      scope: 'read',
    },
    {
      name: 'Write',
      method: 'POST',
      path,
      h: '创建或整体替换条目(幂等 upsert)',
      inputSchema: {
        type: 'object',
        required: ['path', 'entry'],
        properties: { path: { type: 'string' }, entry: ENTRY_SCHEMA },
      },
      returns: 'ContextEntryMeta',
      scope: 'write',
    },
    {
      name: 'Update',
      method: 'POST',
      path,
      h: '部分更新内容或 metadata(浅合并);不存在 → not_found',
      inputSchema: {
        type: 'object',
        required: ['path', 'patch'],
        properties: { path: { type: 'string' }, patch: PATCH_SCHEMA },
      },
      returns: 'ContextEntryMeta',
      scope: 'write',
    },
    {
      name: 'Delete',
      method: 'POST',
      path,
      h: '删除条目(幂等)',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: { path: { type: 'string' } },
      },
      scope: 'write',
      effect: 'destructive',
    },
    {
      name: 'Search',
      method: 'POST',
      path,
      h: 'keyword 检索(路径名与 metadata 值子串匹配)',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: { query: { type: 'string' }, opts: SEARCH_OPTS_SCHEMA },
      },
      returns: 'Page<ContextEntryMeta>',
      scope: 'read',
    },
  ]
}

export interface ContextHelpOptions {
  /** readOnly 挂载隐藏 Write/Update/Delete(决策 D11)。 */
  readOnly?: boolean
}

export function contextHelpModel(
  node: { path: TreePath; description: string },
  opts: ContextHelpOptions = {},
): HelpModel {
  const cmds = contextCmds(node.path)
  return {
    node: { path: node.path, kind: 'context', description: node.description },
    cmds: opts.readOnly ? cmds.filter((c) => c.scope === 'read') : cmds,
  }
}
