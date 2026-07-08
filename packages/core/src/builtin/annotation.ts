/**
 * builtin 模块 "annotation" → Path 补充说明管理(挂载为 system/annotation 节点)。
 *
 * 管理员对树上任意 Path(含 mcp/http 的工具子路径,如 `feishu/create-doc`)写补充说明,
 * 由网关注入该 Path 的 `~help`(DSL `note` 行 / JSON `note` 字段 / Markdown Notes 节)。
 * set/remove 需 admin;get/list 为 read(消费面本就在 ~help)。
 * set 校验 path 经 registry 最长前缀 resolve 命中(根路径 '' 放行 = 全树公告)。
 */

import type { AnnotationStore } from '../annotation/store'
import { TBError } from '../errors'
import type { CmdSpec, HelpModel } from '../htbp/model'
import { normalizePath } from '../tree/path'
import type { NodeRegistryStore } from '../tree/registry'
import type { CallContext, TreePath } from '../types'
import type { BuiltinModule } from './types'
import { cmdPath, optString, requireString, VOID_ACK } from './util'

const DESCRIPTION =
  'Path annotations: admin-curated notes shown in ~help of the annotated path (set / get / remove / list)'

function annotationCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  return [
    {
      name: 'set',
      method: 'POST',
      path,
      h: 'upsert the note shown in ~help of <path>; empty path = tree-wide notice',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          text: { type: 'string', maxLength: 2000 },
        },
        required: ['path', 'text'],
      },
      returns: '{ path, text, updatedAt, updatedBy }',
      scope: 'admin',
    },
    {
      name: 'get',
      method: 'POST',
      path,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      returns: '{ path, text, updatedAt, updatedBy }',
      scope: 'read',
    },
    {
      name: 'remove',
      method: 'POST',
      path,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      returns: 'void',
      scope: 'admin',
    },
    {
      name: 'list',
      method: 'POST',
      path,
      h: 'all annotated paths (optionally under a prefix)',
      inputSchema: {
        type: 'object',
        properties: { prefix: { type: 'string' } },
      },
      returns: '{ items: Array<{ path, text, updatedAt, updatedBy }> }',
      scope: 'read',
    },
  ]
}

export interface AnnotationModuleDeps {
  store: AnnotationStore
  /** set 时校验 path 最长前缀命中真实节点(工具子路径天然通过)。 */
  registry: NodeRegistryStore
  now: () => string
}

/** path 必填但允许空串(根 = 全树公告)。 */
function requireRootablePath(args: Record<string, unknown>): string {
  const v = args.path
  if (typeof v !== 'string') {
    throw new TBError('invalid_argument', "field 'path' must be a string")
  }
  return v
}

export function createAnnotationModule(deps: AnnotationModuleDeps): BuiltinModule {
  return {
    module: 'annotation',
    description: DESCRIPTION,
    help(nodePath: TreePath): HelpModel {
      return {
        node: { path: nodePath, kind: 'builtin', description: DESCRIPTION },
        cmds: annotationCmds(nodePath),
      }
    },
    async dispatch(cmd: string, args: Record<string, unknown>, ctx: CallContext): Promise<unknown> {
      switch (cmd) {
        case 'set': {
          const path = requireRootablePath(args)
          // 根路径('')= 全树公告,免 resolve;其余须挂在真实节点(或其工具子路径)下。
          if (normalizePath(path) !== '') {
            await deps.registry.resolve(path)
          }
          return await deps.store.set(path, requireString(args, 'text'), ctx.keyId, deps.now())
        }
        case 'get': {
          const path = requireRootablePath(args)
          const got = await deps.store.get(path)
          if (got === null) {
            throw TBError.notFound(`路径无补充说明:'${path === '' ? '/' : path}'`)
          }
          return got
        }
        case 'remove': {
          await deps.store.remove(requireRootablePath(args))
          return VOID_ACK
        }
        case 'list': {
          const prefix = optString(args, 'prefix')
          return { items: await deps.store.list(prefix) }
        }
        default:
          throw new TBError('invalid_argument', `unknown cmd '${cmd}' on system/annotation`)
      }
    },
  }
}
