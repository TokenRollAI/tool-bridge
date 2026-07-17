/**
 * builtin 模块 "secret" → SecretStoreImpl(挂载为 system/secret 节点,需 admin)。
 *
 * 只写不读:cmd 表只有 set/list/delete。`set` 返回不回显 value;
 * `list` 只出 name + updatedAt;`resolve` 不出现在 cmd 表(仅供网关内部 Provider 解析引用名)。
 */

import type { SecretStoreImpl } from '../secret/secretStore'
import type { CmdSpec, HelpModel } from '../htbp/model'
import type { CallContext, TreePath } from '../types'
import type { BuiltinModule } from './types'
import { cmdPath, LIST_OPTS_SCHEMA, optListOptions, requireString, VOID_ACK } from './util'
import { TBError } from '../errors'

const DESCRIPTION
  = 'Upstream credential vault: write-only; mounts reference entries by name (authRef), values can never be read back (admin only)'

/**
 * cmd 面的 name 守卫:含 ':' 的名字是平台内部保留命名空间(如 `plugin-token:<id>`),
 * 节点面不得创建/删除——防止伪造或误删平台托管凭证。
 */
function assertUserSecretName(name: string): void {
  if (name.includes(':')) {
    throw new TBError(
      'invalid_argument',
      `secret name must not contain ':' (reserved for platform-internal entries)`,
    )
  }
}

function secretCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  return [
    {
      name: 'set',
      method: 'POST',
      path,
      h: 'store or rotate a credential under a name; mount configs reference it as authRef',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'reference name used as authRef in mount configs (":" is reserved)',
          },
          value: {
            type: 'string',
            description: 'the credential (token / key / JSON); encrypted at rest, never echoed',
          },
        },
        required: ['name', 'value'],
      },
      returns: 'void — value never echoed',
      scope: 'admin',
    },
    {
      name: 'list',
      method: 'POST',
      path,
      h: 'list stored credential names (names and timestamps only, never values)',
      inputSchema: { type: 'object', properties: { opts: LIST_OPTS_SCHEMA } },
      returns: 'Page<{ name, updatedAt }>',
      scope: 'admin',
    },
    {
      name: 'delete',
      method: 'POST',
      path,
      h: 'delete a credential; mounts still referencing it will fail to resolve',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'reference name' } },
        required: ['name'],
      },
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
        case 'set': {
          const name = requireString(args, 'name')
          assertUserSecretName(name)
          await store.set(name, requireString(args, 'value'), now())
          return VOID_ACK
        }
        case 'list':
          return store.list(optListOptions(args))
        case 'delete': {
          const name = requireString(args, 'name')
          assertUserSecretName(name)
          await store.delete(name)
          return VOID_ACK
        }
        default:
          throw new TBError('invalid_argument', `unknown cmd '${cmd}' on system/secret`)
      }
    },
  }
}
