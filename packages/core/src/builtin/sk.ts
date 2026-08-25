/**
 * builtin 模块 "sk" → SKRegistryStore(挂载为 system/sk 节点,全 cmd 需 admin)。
 *
 * cmd 名对齐接口方法(list/get/write/update/delete,小写);CLI 的 create/rm 别名在 CLI 层做。
 * write 返回 { key, secret },secret(明文)仅此一次;list/get/update 一律无 hash。
 */

import { z } from 'zod/v4'
import type { Scope, SecretKeyInput } from '../types'
import type { BuiltinModule } from './types'
import { normalizeExpiresAt, type SKRegistryStore, type SKUpdatePatch } from '../auth/sk'
import { BuiltinCommandRegistry } from './commandRegistry'
import { LIST_OPTS_ZOD_SCHEMA, VOID_ACK } from './util'

const DESCRIPTION
  = 'Secret Key registry: issue / list / update / revoke access keys (the only credential form; admin only)'

interface SkModuleDeps {
  now: () => string
  store: SKRegistryStore
}

const actionSchema = z.enum(['read', 'write', 'call', 'register', 'admin'])
const scopeSchema = z.strictObject({
  pattern: z.string().describe('tree path glob, e.g. "**" (everything) or "docs/**"'),
  actions: z.array(actionSchema),
  effect: z.enum(['allow', 'deny']).optional().describe('default "allow"'),
})

const ownerSchema = z.string().min(1).describe(
  'owner ref: "user:<name>" | "agent:<name>" | "device:<id>"',
)
const descriptionSchema = z.string().optional().describe('what this key is for (shown in list)')
const scopesSchema = z.array(scopeSchema).describe(
  'permission grants; deny wins over allow, no match = denied',
)
const registerPathsSchema = z.array(z.string()).optional().describe(
  'path prefixes this key may self-register nodes under (via ~register)',
)
const expiresAtSchema = z.string().optional().describe(
  'expiry, ISO 8601 timestamp with timezone; omit = never',
)

const writeSchema = z.strictObject({
  owner: ownerSchema,
  description: descriptionSchema,
  scopes: scopesSchema,
  registerPaths: registerPathsSchema,
  expiresAt: expiresAtSchema,
})

const patchSchema = z.strictObject({
  owner: ownerSchema.optional(),
  description: descriptionSchema,
  scopes: scopesSchema.optional(),
  registerPaths: registerPathsSchema,
  expiresAt: expiresAtSchema,
  disabled: z.boolean().optional().describe('true = key rejected until re-enabled'),
}).describe('fields to change; same shape as write (all optional) plus disabled')

function toSecretKeyInput(input: z.infer<typeof writeSchema>): SecretKeyInput {
  return {
    owner: input.owner,
    scopes: input.scopes as Scope[],
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.registerPaths !== undefined ? { registerPaths: input.registerPaths } : {}),
    ...(input.expiresAt !== undefined ? { expiresAt: normalizeExpiresAt(input.expiresAt) } : {}),
  }
}

function toUpdatePatch(input: z.infer<typeof patchSchema>): SKUpdatePatch {
  return {
    ...(input.owner !== undefined ? { owner: input.owner } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.scopes !== undefined ? { scopes: input.scopes as Scope[] } : {}),
    ...(input.registerPaths !== undefined ? { registerPaths: input.registerPaths } : {}),
    ...(input.expiresAt !== undefined ? { expiresAt: normalizeExpiresAt(input.expiresAt) } : {}),
    ...(input.disabled !== undefined ? { disabled: input.disabled } : {}),
  }
}

const COMMANDS = new BuiltinCommandRegistry<SkModuleDeps>('sk', DESCRIPTION)
  .register(
    'list',
    {
      h: 'list issued keys (id, owner, scopes; the secret itself is never returned)',
      inputSchema: z.strictObject({ opts: LIST_OPTS_ZOD_SCHEMA.optional() }),
      returns: 'Page<SecretKey without hash>',
      scope: 'admin',
    },
    ({ opts }, { deps }) => deps.store.list(opts),
  )
  .register(
    'get',
    {
      h: 'fetch one key by id',
      inputSchema: z.strictObject({
        id: z.string().min(1).describe('key id (from list or the issue response)'),
      }),
      returns: 'SecretKey without hash',
      scope: 'admin',
    },
    ({ id }, { deps }) => deps.store.get(id),
  )
  .register(
    'write',
    {
      h: 'issue a new key — the response carries the plaintext secret exactly once, store it immediately',
      inputSchema: writeSchema,
      returns: '{ key: SecretKey without hash, secret } — secret shown once',
      scope: 'admin',
    },
    (input, { deps }) => deps.store.write(toSecretKeyInput(input), deps.now()),
  )
  .register(
    'update',
    {
      h: 'patch fields of an issued key (scopes, expiresAt, disabled, …); takes effect immediately',
      inputSchema: z.strictObject({
        id: z.string().min(1).describe('key id'),
        patch: patchSchema,
      }),
      returns: 'SecretKey without hash',
      scope: 'admin',
    },
    ({ id, patch }, { deps }) => deps.store.update(id, toUpdatePatch(patch)),
  )
  .register(
    'delete',
    {
      h: 'revoke a key permanently; takes effect immediately',
      inputSchema: z.strictObject({ id: z.string().min(1).describe('key id') }),
      returns: 'void',
      scope: 'admin',
    },
    async ({ id }, { deps }) => {
      await deps.store.delete(id)
      return VOID_ACK
    },
  )

export function createSkModule(store: SKRegistryStore, now: () => string): BuiltinModule {
  return COMMANDS.module({ store, now })
}
