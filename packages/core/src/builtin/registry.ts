/**
 * builtin 模块 "registry" → NodeRegistryStore(挂载为 system/registry 节点)。
 *
 * cmd:list/get(scope read)、write/update/delete(scope register)。
 * **反向注册路径判定(registerPaths 收紧 / 保留根 / conflict)不在 dispatch 内做**——
 * 网关在调用点(POST /<path> 与 POST /<path>/~register)统一过 checkRegisterPath 后才 dispatch,
 * 见 gateway/app.ts。dispatch 只做数据结构语义(幂等 upsert、物化、回收),registeredBy=调用者 keyId。
 */

import { TBError } from '../errors'
import type { CmdSpec, HelpModel } from '../htbp/model'
import type { NodeRegistryStore } from '../tree/registry'
import type { ScopeChecker } from '../tree/visibility'
import type {
  CallContext,
  NodeConfig,
  NodeInput,
  NodeKind,
  Page,
  TreeNode,
  TreePath,
  Virtualize,
} from '../types'
import { NODE_KINDS } from '../types'
import type { BuiltinModule } from './types'
import {
  cmdPath,
  LIST_OPTS_SCHEMA,
  optListOptions,
  optString,
  requireObject,
  requireString,
  VOID_ACK,
} from './util'

const DESCRIPTION =
  'Node registry: the single mount surface — everything on the tree (mcp/http/context/device/remote nodes) is mounted, listed and unmounted here'

/** write 的 NodeInput 字段 schema(update.patch 复用,全可选)。 */
const NODE_FIELD_SCHEMAS = {
  path: { type: 'string', description: 'tree path to mount at, e.g. "docs/context7"' },
  kind: {
    type: 'string',
    enum: [...NODE_KINDS],
    description: 'node kind; determines the config shape',
  },
  description: { type: 'string', description: 'one-line description shown in parent ~help' },
  config: {
    type: 'object',
    description:
      'kind-specific config, e.g. mcp: { url, auth?, authRef? } / http: { endpoint, tools } / context: { provider, bucket, … } / remote: { baseUrl, skRef }; credentials go by authRef/skRef name, never inline',
  },
  virtualize: {
    type: 'object',
    description:
      'optional tool virtualization: { prefix?, rename?: {from:to}, hide?: [name], describe?: {name:text} }',
  },
} as const

function registryCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  return [
    {
      name: 'list',
      method: 'POST',
      path,
      h: 'list registered nodes, optionally under a path prefix',
      inputSchema: {
        type: 'object',
        properties: {
          prefix: { type: 'string', description: 'only nodes under this path prefix' },
          opts: LIST_OPTS_SCHEMA,
        },
      },
      returns: 'Page<Node>',
      scope: 'read',
    },
    {
      name: 'get',
      method: 'POST',
      path,
      h: 'fetch one node registration (kind, description, config) by path',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'exact tree path' } },
        required: ['path'],
      },
      returns: 'Node',
      scope: 'read',
    },
    {
      name: 'write',
      method: 'POST',
      path,
      h: 'mount (or replace) a node at a path; idempotent upsert, intermediate directories auto-created',
      inputSchema: {
        type: 'object',
        properties: NODE_FIELD_SCHEMAS,
        required: ['path', 'kind', 'description'],
      },
      returns: 'Node',
      scope: 'register',
    },
    {
      name: 'update',
      method: 'POST',
      path,
      h: 'patch fields of a mounted node (description, config, virtualize, …) without remounting',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'exact tree path' },
          patch: {
            type: 'object',
            description: 'fields to change; same shape as write, all optional',
            properties: NODE_FIELD_SCHEMAS,
          },
        },
        required: ['path', 'patch'],
      },
      returns: 'Node',
      scope: 'register',
    },
    {
      name: 'delete',
      method: 'POST',
      path,
      h: 'unmount a node (and reclaim empty auto-created parents)',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'exact tree path' } },
        required: ['path'],
      },
      returns: 'void',
      scope: 'register',
    },
  ]
}

/**
 * 校验并构造 NodeInput:args 整体即 NodeInput。
 * path 必填非空;kind 必填且须为合法枚举(词表 = types.ts NODE_KINDS,单一真源);
 * description 必填;透传 config/virtualize。
 * 校验失败 → invalid_argument。`~register` 与 system/registry write 复用此函数。
 */
export function parseNodeInput(args: Record<string, unknown>): NodeInput {
  const path = requireString(args, 'path')
  const kind = requireString(args, 'kind') as NodeKind
  if (!NODE_KINDS.includes(kind)) {
    throw new TBError('invalid_argument', `invalid kind '${kind}'`)
  }
  const description = requireString(args, 'description')
  const node: NodeInput = { path, kind, description }
  if (args.config !== undefined) node.config = args.config as NodeConfig
  if (args.virtualize !== undefined) node.virtualize = args.virtualize as Virtualize
  return node
}

/**
 * 构造 registry builtin 模块。
 *
 * `visibility`(可选,网关注入 = auth/scope 的 checkScopes)让**管理通道**(system/registry
 * 数据面)也遵守「可见性即权限 / deny==not_found」:list 结果按 (path,'read') 裁剪;
 * get 对 arguments.path 判 (path,'read'),deny → not_found(不泄露不可见节点的存在性)。
 * 未注入时不裁剪(纯逻辑单测场景;网关装配一律注入)。写面判定仍在网关调用点。
 */
export function createRegistryModule(
  store: NodeRegistryStore,
  now: () => string,
  visibility?: ScopeChecker,
): BuiltinModule {
  return {
    module: 'registry',
    description: DESCRIPTION,
    help(nodePath: TreePath): HelpModel {
      return {
        node: { path: nodePath, kind: 'builtin', description: DESCRIPTION },
        cmds: registryCmds(nodePath),
      }
    },
    async dispatch(cmd: string, args: Record<string, unknown>, ctx: CallContext): Promise<unknown> {
      switch (cmd) {
        case 'list': {
          const page = (await store.list(
            optString(args, 'prefix'),
            optListOptions(args),
          )) as Page<TreeNode>
          if (!visibility) return page
          const items = page.items.filter((n) => visibility(ctx.scopes, n.path, 'read'))
          return page.cursor !== undefined ? { items, cursor: page.cursor } : { items }
        }
        case 'get': {
          const path = requireString(args, 'path')
          // deny==not_found:不可见节点不泄露存在性。
          if (visibility && !visibility(ctx.scopes, path, 'read')) {
            throw new TBError('not_found', `节点不存在:'${path}'`)
          }
          return store.get(path)
        }
        case 'write':
          return store.write(parseNodeInput(args), ctx.keyId, now())
        case 'update':
          return store.update(
            requireString(args, 'path'),
            requireObject(args, 'patch') as Partial<NodeInput>,
            now(),
          )
        case 'delete':
          await store.delete(requireString(args, 'path'))
          return VOID_ACK
        default:
          throw new TBError('invalid_argument', `unknown cmd '${cmd}' on system/registry`)
      }
    },
  }
}
