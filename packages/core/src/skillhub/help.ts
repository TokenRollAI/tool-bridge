/**
 * skillhub 节点的静态 ~help 模型与 cmd→scope 表(与 context/help.ts 同构)。
 *
 * cmd 名首字母大写(Provider 约定);List/Get/Search = read,Publish/Remove = write。
 * readOnly 挂载隐藏写动词。数据面把 skill 当"单位":Get/Publish/Remove 以 id 寻址,
 * SKILL.md 的 frontmatter(name/description)由服务端解析成目录(List)与检索面(Search)。
 */

import type { CmdSpec, HelpModel } from '../htbp/model'
import type { TreePath } from '../types'
import { cmdPath } from '../builtin/util'

/** ~describe 声明的可选能力(本实现提供 Search)。 */
export const SKILLHUB_CAPABILITIES: readonly string[] = ['search']

const SCOPE_BY_CMD: Record<string, 'read' | 'write'> = {
  List: 'read',
  Get: 'read',
  Search: 'read',
  Publish: 'write',
  Remove: 'write',
}

/** 数据面 {tool} → scope;未知(含大小写不符)→ null,由网关按 invalid_argument 处理。 */
export function skillhubScopeForCmd(tool: string): 'read' | 'write' | null {
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

const PUBLISH_FILE_SCHEMA = {
  type: 'object',
  required: ['path', 'content'],
  properties: {
    path: {
      type: 'string',
      description: 'file path relative to the skill root, e.g. \'SKILL.md\', \'scripts/run.sh\'',
    },
    content: { type: 'string', description: 'UTF-8 text content' },
    contentType: { type: 'string', description: 'optional; inferred from extension when omitted' },
  },
} as const

function skillhubCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  return [
    {
      name: 'List',
      method: 'POST',
      path,
      h: 'list published skills (id / name / description from SKILL.md frontmatter, paginated)',
      inputSchema: {
        type: 'object',
        properties: { opts: OPTS_SCHEMA },
      },
      returns: 'Page<SkillSummary>',
      scope: 'read',
    },
    {
      name: 'Get',
      method: 'POST',
      path,
      h: 'read a skill: SKILL.md body + file manifest; pass \'file\' to fetch one bundled file (oversized/binary as { $ref })',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'skill id' },
          file: {
            type: 'string',
            description: 'optional: path of one bundled file to fetch instead of the manifest',
          },
        },
      },
      returns: 'SkillDetail | SkillFile',
      scope: 'read',
    },
    {
      name: 'Search',
      method: 'POST',
      path,
      h: 'keyword search over skill id / name / description',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'substring to match' },
          opts: OPTS_SCHEMA,
        },
      },
      returns: 'Page<SkillSummary>',
      scope: 'read',
    },
    {
      name: 'Publish',
      method: 'POST',
      path,
      h: 'publish/replace a skill from a set of text files (must include SKILL.md with name+description frontmatter)',
      inputSchema: {
        type: 'object',
        required: ['files'],
        properties: {
          id: {
            type: 'string',
            description: 'skill id; defaults to a slug derived from the frontmatter name',
          },
          files: {
            type: 'array',
            description: 'the skill files; whole-skill replace (files not listed are removed)',
            items: PUBLISH_FILE_SCHEMA,
          },
        },
      },
      returns: '{ id, name, description, fileCount }',
      scope: 'write',
    },
    {
      name: 'Remove',
      method: 'POST',
      path,
      h: 'delete a skill and all its files (not_found if it does not exist)',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'skill id' } },
      },
      scope: 'write',
      effect: 'destructive',
    },
  ]
}

export interface SkillhubHelpOptions {
  /** readOnly 挂载隐藏 Publish/Remove。 */
  readOnly?: boolean
}

export function skillhubHelpModel(
  node: { description: string, path: TreePath },
  opts: SkillhubHelpOptions = {},
): HelpModel {
  const cmds = skillhubCmds(node.path)
  return {
    node: { path: node.path, kind: 'skillhub', description: node.description },
    cmds: opts.readOnly ? cmds.filter(c => c.scope === 'read') : cmds,
  }
}
