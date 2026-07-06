/**
 * builtin 模块 "secret" → SecretStoreImpl(Proto §2.5;挂载为 system/secret 节点,需 admin)。
 *
 * 只写不读(Proto §2.5):cmd 表只有 set/list/delete。`set` 返回不回显 value;
 * `list` 只出 name + updatedAt;`resolve` 不出现在 cmd 表(仅供网关内部 Provider 解析引用名)。
 */

import { TBError } from '../errors'
import type { CmdSpec, HelpModel } from '../htbp/model'
import type { SecretStoreImpl } from '../secret/secretStore'
import type { CallContext, TreePath } from '../types'
import type { BuiltinModule } from './types'
import { cmdPath, optListOptions, requireString, VOID_ACK } from './util'

const DESCRIPTION = 'Upstream credential store: write-only (set / list / delete), admin only'

function secretCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  return [
    {
      name: 'set',
      method: 'POST',
      path,
      body: { name: 'string', value: 'string' },
      returns: 'void — value never echoed',
      scope: 'admin',
    },
    {
      name: 'list',
      method: 'POST',
      path,
      body: { opts: 'ListOptions?' },
      returns: 'Page<{ name, updatedAt }>',
      scope: 'admin',
    },
    {
      name: 'delete',
      method: 'POST',
      path,
      body: { name: 'string' },
      returns: 'void',
      scope: 'admin',
    },
  ]
}

export function createSecretModule(store: SecretStoreImpl, now: () => string): BuiltinModule {
  return {
    module: 'secret',
    description: DESCRIPTION,
    help(nodePath: TreePath): HelpModel {
      return {
        node: { path: nodePath, kind: 'builtin', description: DESCRIPTION },
        cmds: secretCmds(nodePath),
      }
    },
    async dispatch(
      cmd: string,
      args: Record<string, unknown>,
      _ctx: CallContext,
    ): Promise<unknown> {
      switch (cmd) {
        case 'set':
          await store.set(requireString(args, 'name'), requireString(args, 'value'), now())
          return VOID_ACK
        case 'list':
          return store.list(optListOptions(args))
        case 'delete':
          await store.delete(requireString(args, 'name'))
          return VOID_ACK
        default:
          throw new TBError('invalid_argument', `unknown cmd '${cmd}' on system/secret`)
      }
    },
  }
}
