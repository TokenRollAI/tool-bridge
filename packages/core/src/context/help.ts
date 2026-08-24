/**
 * context 节点的静态 ~help 模型与 cmd→scope 表。
 *
 * cmd 名 = 接口方法名首字母大写(仅 system/* builtin 小写);
 * List/Get/Search = read,Write/Update/Delete = write(规范性)。
 * cmd 表静态声明(区别于 mcp/http 的上游发现);readOnly 挂载隐藏三个写动词(决策 D11)。
 */

import type { CmdSpec, HelpModel } from '../htbp/model'
import type { TreePath } from '../types'
import { cmdPath, withCommandPaths } from '../builtin/util'

/** ~describe 声明的可选能力(本实现提供 Search 与 Delete)。 */
export const CONTEXT_CAPABILITIES: readonly string[] = ['search', 'delete']
/** 内置对象存储可选扩展：定路径、限时 PUT 直传。 */
export const CONTEXT_DIRECT_UPLOAD_CAPABILITY = 'direct-upload'

const SCOPE_BY_CMD: Record<string, 'read' | 'write'> = {
  list: 'read',
  get: 'read',
  search: 'read',
  write: 'write',
  update: 'write',
  delete: 'write',
  create_upload: 'write',
}

/** 数据面路径的命令叶子 → scope;未知(含大小写不符)→ null,由网关按 invalid_argument 处理。 */
export function contextScopeForCmd(command: string): 'read' | 'write' | null {
  return SCOPE_BY_CMD[command] ?? null
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
  const cmds: CmdSpec[] = [
    {
      name: 'list',
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
      name: 'get',
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
      name: 'write',
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
      name: 'update',
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
      name: 'delete',
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
      name: 'search',
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
  return withCommandPaths(nodePath, cmds)
}

/** 对象存储直传扩展命令；仅在底层确实具备 PUT 签名能力时由宿主追加。 */
export function contextUploadCmd(nodePath: TreePath): CmdSpec {
  return withCommandPaths(nodePath, [{
    name: 'create_upload',
    method: 'POST',
    path: cmdPath(nodePath),
    h: 'create a short-lived, path-scoped direct-upload grant; persist the returned uri, not url',
    inputSchema: {
      type: 'object',
      required: ['path', 'contentType'],
      properties: {
        path: { type: 'string', description: 'target entry path inside the namespace' },
        contentType: { type: 'string', description: 'media type signed into the PUT request' },
        overwrite: {
          type: 'boolean',
          description: 'allow replacing an existing object; default false',
        },
      },
    },
    returns: 'ContextUploadGrant',
    scope: 'write',
    effect: 'write',
  }])[0]!
}

export interface ContextHelpOptions {
  /**
   * provider 真实支持的动词集(按 handler 存在性推导,见 context/capabilities.ts)。
   * 给出时 `~help` 只列这些 cmd —— 作者写多少就展示多少;缺省则列全动词表。
   */
  methods?: ReadonlySet<string>
  /** readOnly 挂载额外隐藏 Write/Update/Delete(决策 D11)。 */
  readOnly?: boolean
}

export function contextHelpModel(
  node: { description: string, path: TreePath },
  opts: ContextHelpOptions = {},
): HelpModel {
  const all = contextCmds(node.path)
  // methods 给出时只列真实存在的动词(按 handler 存在性推导);未给出则沿用全动词表
  // (内置 r2/s3 与 plugin-backed 节点仍按声明的 capabilities 过滤)。
  const present = opts.methods === undefined ? all : all.filter(c => opts.methods?.has(c.name))
  return {
    node: { path: node.path, kind: 'context', description: node.description },
    cmds: opts.readOnly ? present.filter(c => c.scope === 'read') : present,
  }
}
