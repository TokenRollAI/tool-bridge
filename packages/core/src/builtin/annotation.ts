/**
 * builtin 模块 "annotation" → Path 补充说明管理(挂载为 system/annotation 节点)。
 *
 * 管理员对树上任意 Path(含 mcp/http 的工具子路径,如 `feishu/create-doc`)写补充说明,
 * 由网关注入该 Path 的 `~help`(DSL `note` 行 / JSON `note` 字段 / Markdown Notes 节)。
 * set/remove 需 admin;get/list 为 read(消费面本就在 ~help)。
 * set 校验 path 经 registry 最长前缀 resolve 命中(根路径 '' 放行 = 全树公告)。
 */

import { z } from 'zod/v4'
import type { NodeRegistryStore } from '../tree/registry'
import type { BuiltinModule } from './types'
import { ANNOTATION_TEXT_MAX, type AnnotationStore } from '../annotation/store'
import { BuiltinCommandRegistry } from './commandRegistry'
import { normalizePath } from '../tree/path'
import { TBError } from '../errors'
import { VOID_ACK } from './util'

const DESCRIPTION
  = 'Path annotations: admin-curated notes shown in ~help of the annotated path (set / get / remove / list)'

export interface AnnotationModuleDeps {
  now: () => string
  /** set 时校验 path 最长前缀命中真实节点(工具子路径天然通过)。 */
  registry: NodeRegistryStore
  store: AnnotationStore
}

const rootablePathSchema = z.string().describe('tree path; "" = tree-wide notice')

const COMMANDS = new BuiltinCommandRegistry<AnnotationModuleDeps>('annotation', DESCRIPTION)
  .register(
    'set',
    {
      h: 'upsert the note shown in ~help of <path>; empty path = tree-wide notice',
      inputSchema: z.strictObject({
        path: z.string().describe(
          'tree path (tool sub-paths like "feishu/create-doc" work); "" = tree-wide',
        ),
        text: z.string().min(1).max(ANNOTATION_TEXT_MAX).describe('the note (max 2000 chars)'),
      }),
      returns: '{ path, text, updatedAt, updatedBy }',
      scope: 'admin',
    },
    async ({ path, text }, { call, deps }) => {
      // 根路径('')= 全树公告,免 resolve;其余须挂在真实节点(或其工具子路径)下。
      if (normalizePath(path) !== '') await deps.registry.resolve(path)
      return await deps.store.set(path, text, call.keyId, deps.now())
    },
  )
  .register(
    'get',
    {
      h: 'read the note of one path (not_found if none)',
      inputSchema: z.strictObject({ path: rootablePathSchema }),
      returns: '{ path, text, updatedAt, updatedBy }',
      scope: 'read',
    },
    async ({ path }, { deps }) => {
      const got = await deps.store.get(path)
      if (got === null) {
        throw TBError.notFound(`路径无补充说明:'${path === '' ? '/' : path}'`)
      }
      return got
    },
  )
  .register(
    'remove',
    {
      h: 'remove the note of a path (idempotent)',
      inputSchema: z.strictObject({ path: rootablePathSchema }),
      returns: 'void',
      scope: 'admin',
    },
    async ({ path }, { deps }) => {
      await deps.store.remove(path)
      return VOID_ACK
    },
  )
  .register(
    'list',
    {
      h: 'all annotated paths (optionally under a prefix)',
      inputSchema: z.strictObject({
        prefix: z.string().optional().describe('only paths under this prefix'),
      }),
      returns: '{ items: Array<{ path, text, updatedAt, updatedBy }> }',
      scope: 'read',
    },
    async ({ prefix }, { deps }) => ({ items: await deps.store.list(prefix) }),
  )

export function createAnnotationModule(deps: AnnotationModuleDeps): BuiltinModule {
  return COMMANDS.module(deps)
}
