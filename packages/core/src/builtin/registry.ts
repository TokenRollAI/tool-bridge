/**
 * builtin 模块 "registry" → NodeRegistryStore(挂载为 system/registry 节点)。
 *
 * cmd:list/get(scope read)、write/update/delete(scope register)。反向注册路径判定
 * (registerPaths / 保留根 / conflict)仍在 app 的统一调用点；本模块只负责
 * 严格 NodeInput 形状、可见性裁剪与存储语义。
 */

import { z } from 'zod/v4'
import type { NodeRegistryStore } from '../tree/registry'
import type { ScopeChecker } from '../tree/visibility'
import type { BuiltinModule } from './types'
import {
  type NodeInput,
  type Page,
  type TreeNode,
} from '../types'
import { BuiltinCommandRegistry } from './commandRegistry'
import { LIST_OPTS_ZOD_SCHEMA, VOID_ACK } from './util'
import { nodeInputSchema } from '../protocol/wire'
import { TBError } from '../errors'

const DESCRIPTION
  = 'Node registry: the single mount surface — everything on the tree (mcp/http/context/device/remote nodes) is mounted, listed and unmounted here'

const nodePatchSchema = nodeInputSchema.partial().describe(
  'fields to change; same shape as write, all optional',
)

/**
 * `~register` 与 system/registry write 共用的严格 NodeInput 校验。
 * kind 词表直接来自 NODE_KINDS；未知顶层字段不再静默落盘。
 */
export function parseNodeInput(args: Record<string, unknown>): NodeInput {
  const parsed = nodeInputSchema.safeParse(args)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new TBError(
      'invalid_argument',
      `invalid NodeInput${issue?.path.length ? ` at '${issue.path.join('.')}'` : ''}: ${issue?.message ?? 'unknown validation error'}`,
    )
  }
  return parsed.data as NodeInput
}

interface RegistryModuleDeps {
  now: () => string
  store: NodeRegistryStore
  visibility?: ScopeChecker
}

const COMMANDS = new BuiltinCommandRegistry<RegistryModuleDeps>('registry', DESCRIPTION)
  .register(
    'list',
    {
      h: 'list registered nodes, optionally under a path prefix',
      inputSchema: z.strictObject({
        prefix: z.string().optional().describe('only nodes under this path prefix'),
        opts: LIST_OPTS_ZOD_SCHEMA.optional(),
      }),
      returns: 'Page<Node>',
      scope: 'read',
    },
    async ({ opts, prefix }, { call, deps }) => {
      const page = (await deps.store.list(prefix, opts)) as Page<TreeNode>
      if (!deps.visibility) return page
      const items = page.items.filter(n => deps.visibility?.(call.scopes, n.path, 'read') === true)
      return page.cursor !== undefined ? { items, cursor: page.cursor } : { items }
    },
  )
  .register(
    'get',
    {
      h: 'fetch one node registration (kind, description, config) by path',
      inputSchema: z.strictObject({
        path: z.string().min(1).describe('exact tree path'),
      }),
      returns: 'Node',
      scope: 'read',
    },
    ({ path }, { call, deps }) => {
      // deny==not_found:不可见节点不泄露存在性。
      if (deps.visibility && !deps.visibility(call.scopes, path, 'read')) {
        throw new TBError('not_found', `节点不存在:'${path}'`)
      }
      return deps.store.get(path)
    },
  )
  .register(
    'write',
    {
      h: 'mount (or replace) a node at a path; idempotent upsert, intermediate directories auto-created',
      inputSchema: nodeInputSchema,
      returns: 'Node',
      scope: 'register',
    },
    (input, { call, deps }) => deps.store.write(input as NodeInput, call.keyId, deps.now()),
  )
  .register(
    'update',
    {
      h: 'patch fields of a mounted node (description, config, virtualize, …) without remounting',
      inputSchema: z.strictObject({
        path: z.string().min(1).describe('exact tree path'),
        patch: nodePatchSchema,
      }),
      returns: 'Node',
      scope: 'register',
    },
    ({ patch, path }, { deps }) =>
      deps.store.update(path, patch as Partial<NodeInput>, deps.now()),
  )
  .register(
    'delete',
    {
      h: 'unmount a node (and reclaim empty auto-created parents); a node registered by another key can only be removed by its registrar or by a key holding the \'admin\' scope on that path',
      inputSchema: z.strictObject({
        path: z.string().min(1).describe('exact tree path'),
      }),
      returns: 'void',
      scope: 'register',
    },
    async ({ path }, { deps }) => {
      await deps.store.delete(path)
      return VOID_ACK
    },
  )

/**
 * `visibility` 让管理通道也遵守可见性即权限:list 裁剪、get deny→not_found。
 * 写面的 registerPaths/conflict 判定仍在网关调用点。
 */
export function createRegistryModule(
  store: NodeRegistryStore,
  now: () => string,
  visibility?: ScopeChecker,
): BuiltinModule {
  return COMMANDS.module({ store, now, ...(visibility !== undefined ? { visibility } : {}) })
}
