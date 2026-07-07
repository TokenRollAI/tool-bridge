/**
 * builtin 模块 "sk" → SKRegistryStore(挂载为 system/sk 节点,全 cmd 需 admin)。
 *
 * cmd 名对齐接口方法(list/get/write/update/delete,小写);CLI 的 create/rm 别名在 CLI 层做。
 * write 返回 { key, secret },secret(明文)仅此一次;list/get/update 一律无 hash。
 */

import type { SKRegistryStore, SKUpdatePatch } from '../auth/sk'
import { TBError } from '../errors'
import type { CmdSpec, HelpModel } from '../htbp/model'
import type { CallContext, Scope, SecretKeyInput, TreePath } from '../types'
import type { BuiltinModule } from './types'
import { cmdPath, optListOptions, requireObject, requireString, VOID_ACK } from './util'

const DESCRIPTION = 'SecretKey registry: issue / list / revoke SKs (admin only)'

function skCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  return [
    {
      name: 'list',
      method: 'POST',
      path,
      inputSchema: { type: 'object', properties: { opts: { type: 'object' } } },
      returns: 'Page<SecretKey without hash>',
      scope: 'admin',
    },
    {
      name: 'get',
      method: 'POST',
      path,
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      returns: 'SecretKey without hash',
      scope: 'admin',
    },
    {
      name: 'write',
      method: 'POST',
      path,
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          description: { type: 'string' },
          scopes: { type: 'array' },
          registerPaths: { type: 'array', items: { type: 'string' } },
          expiresAt: { type: 'string' },
        },
        required: ['owner', 'scopes'],
      },
      returns: '{ key: SecretKey without hash, secret } — secret shown once',
      scope: 'admin',
    },
    {
      name: 'update',
      method: 'POST',
      path,
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, patch: { type: 'object' } },
        required: ['id', 'patch'],
      },
      returns: 'SecretKey without hash',
      scope: 'admin',
    },
    {
      name: 'delete',
      method: 'POST',
      path,
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      returns: 'void',
      scope: 'admin',
    },
  ]
}

/** args 整体即 SecretKeyInput;校验 owner/scopes,透传可选字段。 */
function asSecretKeyInput(args: Record<string, unknown>): SecretKeyInput {
  const owner = requireString(args, 'owner')
  if (!Array.isArray(args.scopes)) {
    throw new TBError('invalid_argument', "field 'scopes' must be an array")
  }
  const input: SecretKeyInput = { owner, scopes: args.scopes as Scope[] }
  if (typeof args.description === 'string') input.description = args.description
  if (Array.isArray(args.registerPaths)) input.registerPaths = args.registerPaths as TreePath[]
  if (typeof args.expiresAt === 'string') input.expiresAt = args.expiresAt
  return input
}

export function createSkModule(store: SKRegistryStore, now: () => string): BuiltinModule {
  return {
    module: 'sk',
    description: DESCRIPTION,
    help(nodePath: TreePath): HelpModel {
      return {
        node: { path: nodePath, kind: 'builtin', description: DESCRIPTION },
        cmds: skCmds(nodePath),
      }
    },
    async dispatch(
      cmd: string,
      args: Record<string, unknown>,
      _ctx: CallContext,
    ): Promise<unknown> {
      switch (cmd) {
        case 'list':
          return store.list(optListOptions(args))
        case 'get':
          return store.get(requireString(args, 'id'))
        case 'write':
          return store.write(asSecretKeyInput(args), now())
        case 'update':
          return store.update(
            requireString(args, 'id'),
            requireObject(args, 'patch') as SKUpdatePatch,
          )
        case 'delete':
          await store.delete(requireString(args, 'id'))
          return VOID_ACK
        default:
          throw new TBError('invalid_argument', `unknown cmd '${cmd}' on system/sk`)
      }
    },
  }
}
