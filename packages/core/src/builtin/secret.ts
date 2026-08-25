/**
 * builtin 模块 "secret" → SecretStoreImpl(挂载为 system/secret 节点,需 admin)。
 *
 * 只写不读:cmd 表只有 set/list/delete。`set` 返回不回显 value;
 * `list` 只出 name + updatedAt;`resolve` 不出现在 cmd 表(仅供网关内部 Provider 解析引用名)。
 */

import { z } from 'zod/v4'
import type { SecretStoreImpl } from '../secret/secretStore'
import type { BuiltinModule } from './types'
import { BuiltinCommandRegistry } from './commandRegistry'
import { LIST_OPTS_ZOD_SCHEMA, VOID_ACK } from './util'
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

interface SecretModuleDeps {
  now: () => string
  store: SecretStoreImpl
}

const COMMANDS = new BuiltinCommandRegistry<SecretModuleDeps>('secret', DESCRIPTION)
  .register(
    'set',
    {
      h: 'store or rotate a credential under a name; mount configs reference it as authRef',
      inputSchema: z.strictObject({
        name: z.string().min(1).describe(
          'reference name used as authRef in mount configs (":" is reserved)',
        ),
        value: z.string().min(1).describe(
          'the credential (token / key / JSON); encrypted at rest, never echoed',
        ),
      }),
      returns: 'void — value never echoed',
      scope: 'admin',
    },
    async ({ name, value }, { deps }) => {
      assertUserSecretName(name)
      await deps.store.set(name, value, deps.now())
      return VOID_ACK
    },
  )
  .register(
    'list',
    {
      h: 'list stored credential names (names and timestamps only, never values)',
      inputSchema: z.strictObject({ opts: LIST_OPTS_ZOD_SCHEMA.optional() }),
      returns: 'Page<{ name, updatedAt }>',
      scope: 'admin',
    },
    ({ opts }, { deps }) => deps.store.list(opts),
  )
  .register(
    'delete',
    {
      h: 'delete a credential; mounts still referencing it will fail to resolve',
      inputSchema: z.strictObject({
        name: z.string().min(1).describe('reference name'),
      }),
      returns: 'void',
      scope: 'admin',
    },
    async ({ name }, { deps }) => {
      assertUserSecretName(name)
      await deps.store.delete(name)
      return VOID_ACK
    },
  )

export function createSecretModule(store: SecretStoreImpl, now: () => string): BuiltinModule {
  return COMMANDS.module({ store, now })
}
