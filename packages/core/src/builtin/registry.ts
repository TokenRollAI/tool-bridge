/**
 * builtin 模块 "registry" → NodeRegistryStore(Proto §3.3;挂载为 system/registry 节点)。
 *
 * cmd:list/get(scope read)、write/update/delete(scope register)。
 * **§2.4 反向注册路径判定(registerPaths 收紧 / 保留根 / conflict)不在 dispatch 内做**——
 * 网关在调用点(POST /<path> 与 POST /<path>/~register)统一过 checkRegisterPath 后才 dispatch,
 * 见 gateway/app.ts。dispatch 只做数据结构语义(幂等 upsert、物化、回收),registeredBy=调用者 keyId。
 */

import { TBError } from '../errors'
import type { CmdSpec, HelpModel } from '../htbp/model'
import type { NodeRegistryStore } from '../tree/registry'
import type { CallContext, NodeConfig, NodeInput, NodeKind, TreePath, Virtualize } from '../types'
import type { BuiltinModule } from './types'
import { cmdPath, optListOptions, optString, requireObject, requireString, VOID_ACK } from './util'

const DESCRIPTION = 'Node registry: mount / list / unmount tree nodes'

function registryCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  return [
    {
      name: 'list',
      method: 'POST',
      path,
      body: { prefix: 'TreePath?', opts: 'ListOptions?' },
      returns: 'Page<Node>',
      scope: 'read',
    },
    {
      name: 'get',
      method: 'POST',
      path,
      body: { path: 'TreePath' },
      returns: 'Node',
      scope: 'read',
    },
    {
      name: 'write',
      method: 'POST',
      path,
      body: { path: 'TreePath', kind: 'NodeKind', description: 'string', config: 'NodeConfig?' },
      returns: 'Node',
      scope: 'register',
    },
    {
      name: 'update',
      method: 'POST',
      path,
      body: { path: 'TreePath', patch: 'Partial<NodeInput>' },
      returns: 'Node',
      scope: 'register',
    },
    {
      name: 'delete',
      method: 'POST',
      path,
      body: { path: 'TreePath' },
      returns: 'void',
      scope: 'register',
    },
  ]
}

/** args 整体即 NodeInput(Proto §1.4);校验 path/kind,透传 config/virtualize。 */
function asNodeInput(args: Record<string, unknown>): NodeInput {
  const path = requireString(args, 'path')
  const kind = requireString(args, 'kind') as NodeKind
  const description = typeof args.description === 'string' ? args.description : ''
  const node: NodeInput = { path, kind, description }
  if (args.config !== undefined) node.config = args.config as NodeConfig
  if (args.virtualize !== undefined) node.virtualize = args.virtualize as Virtualize
  return node
}

export function createRegistryModule(store: NodeRegistryStore, now: () => string): BuiltinModule {
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
        case 'list':
          return store.list(optString(args, 'prefix'), optListOptions(args))
        case 'get':
          return store.get(requireString(args, 'path'))
        case 'write':
          return store.write(asNodeInput(args), ctx.keyId, now())
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
