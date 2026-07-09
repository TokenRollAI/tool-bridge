/**
 * context 节点的静态 ~help 模型与 cmd→scope 表。
 *
 * cmd 名 = 接口方法名首字母大写(仅 system/* builtin 小写);
 * List/Get/Search = read,Write/Update/Delete = write(规范性)。
 * cmd 表静态声明(区别于 mcp/http 的上游发现);readOnly 挂载隐藏三个写动词(决策 D11)。
 */

import { cmdPath } from '../builtin/util'
import type { CmdSpec, HelpModel } from '../htbp/model'
import type { TreePath } from '../types'

/** ~describe 声明的可选能力(本实现提供 Search 与 Delete)。 */
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
  description: 'pagination options',
  properties: {
    cursor: { type: 'string', description: 'opaque cursor returned by the previous page' },
    limit: { type: 'number', description: 'page size (default 50, max 200)' },
  },
} as const

const SEARCH_OPTS_SCHEMA = {
  type: 'object',
  description: 'pagination + search mode',
  properties: {
    cursor: { type: 'string', description: 'opaque cursor returned by the previous page' },
    limit: { type: 'number', description: 'page size (default 50, max 200)' },
    mode: { type: 'string', enum: ['keyword', 'semantic'], description: 'default "keyword"' },
  },
} as const

const METADATA_SCHEMA = {
  type: 'object',
  description: 'string-to-string metadata map',
  additionalProperties: { type: 'string' },
} as const

/** ContextEntryInput;contentType 可缺省仅限非字符串 content(落 application/json)。 */
const ENTRY_SCHEMA = {
  type: 'object',
  required: ['content'],
  properties: {
    contentType: {
      type: 'string',
      description:
        'required when content is a string; defaults to application/json for non-string content',
    },
    content: { description: 'entry body: string, or any JSON value' },
    metadata: METADATA_SCHEMA,
    ifVersion: { type: 'string', description: 'optimistic concurrency: expected current version' },
  },
} as const

const PATCH_SCHEMA = {
  type: 'object',
  description: 'partial update; omitted fields keep their current value',
  properties: {
    content: { description: 'replacement content' },
    metadata: METADATA_SCHEMA,
    ifVersion: { type: 'string', description: 'optimistic concurrency: expected current version' },
  },
} as const

function contextCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  return [
    {
      name: 'List',
      method: 'POST',
      path,
      h: 'list entries directly under a path (shallow, paginated)',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'entry path prefix inside the namespace' },
          opts: OPTS_SCHEMA,
        },
      },
      returns: 'Page<ContextEntryMeta>',
      scope: 'read',
    },
    {
      name: 'Get',
      method: 'POST',
      path,
      h: 'read one entry with content (oversized content comes back as { $ref: <download URL> })',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'entry path inside the namespace' },
        },
      },
      returns: 'ContextEntry',
      scope: 'read',
    },
    {
      name: 'Write',
      method: 'POST',
      path,
      h: 'create or fully replace an entry (idempotent upsert)',
      inputSchema: {
        type: 'object',
        required: ['path', 'entry'],
        properties: {
          path: { type: 'string', description: 'entry path inside the namespace' },
          entry: ENTRY_SCHEMA,
        },
      },
      returns: 'ContextEntryMeta',
      scope: 'write',
    },
    {
      name: 'Update',
      method: 'POST',
      path,
      h: 'partially update content and/or metadata (shallow merge); not_found if the entry does not exist',
      inputSchema: {
        type: 'object',
        required: ['path', 'patch'],
        properties: {
          path: { type: 'string', description: 'entry path inside the namespace' },
          patch: PATCH_SCHEMA,
        },
      },
      returns: 'ContextEntryMeta',
      scope: 'write',
    },
    {
      name: 'Delete',
      method: 'POST',
      path,
      h: 'delete an entry (idempotent)',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'entry path inside the namespace' },
        },
      },
      scope: 'write',
      effect: 'destructive',
    },
    {
      name: 'Search',
      method: 'POST',
      path,
      h: 'keyword search: substring match on entry paths and metadata values',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'substring to match' },
          opts: SEARCH_OPTS_SCHEMA,
        },
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
