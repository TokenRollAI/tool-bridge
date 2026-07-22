/**
 * builtin 模块 "sk" → SKRegistryStore(挂载为 system/sk 节点,全 cmd 需 admin)。
 *
 * cmd 名对齐接口方法(list/get/write/update/delete,小写);CLI 的 create/rm 别名在 CLI 层做。
 * write 返回 { key, secret },secret(明文)仅此一次;list/get/update 一律无 hash。
 */

import type { Scope, SecretKeyInput, TreePath } from '../types'
import type { CmdSpec, HelpModel } from '../htbp/model'
import type { BuiltinModule } from './types'
import {
  cmdPath,
  LIST_OPTS_SCHEMA,
  optListOptions,
  requireObject,
  requireString,
  VOID_ACK,
} from './util'
import { normalizeExpiresAt, type SKRegistryStore, type SKUpdatePatch } from '../auth/sk'
import { TBError } from '../errors'

const DESCRIPTION
  = 'Secret Key registry: issue / list / update / revoke access keys (the only credential form; admin only)'

/** write 与 update.patch 共用的 SK 字段 schema(update 全可选,另加 disabled)。 */
const SK_FIELD_SCHEMAS = {
  owner: {
    type: 'string',
    description: 'owner ref: "user:<name>" | "agent:<name>" | "device:<id>"',
  },
  description: { type: 'string', description: 'what this key is for (shown in list)' },
  scopes: {
    type: 'array',
    description: 'permission grants; deny wins over allow, no match = denied',
    items: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'tree path glob, e.g. "**" (everything) or "docs/**"',
        },
        actions: {
          type: 'array',
          items: { type: 'string', enum: ['read', 'write', 'call', 'register', 'admin'] },
        },
        effect: { type: 'string', enum: ['allow', 'deny'], description: 'default "allow"' },
      },
      required: ['pattern', 'actions'],
    },
  },
  registerPaths: {
    type: 'array',
    items: { type: 'string' },
    description: 'path prefixes this key may self-register nodes under (via ~register)',
  },
  expiresAt: {
    type: 'string',
    description: 'expiry, ISO 8601 timestamp with timezone; omit = never',
  },
} as const

function skCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  return [
    {
      name: 'list',
      method: 'POST',
      path,
      h: 'list issued keys (id, owner, scopes; the secret itself is never returned)',
      inputSchema: { type: 'object', properties: { opts: LIST_OPTS_SCHEMA } },
      returns: 'Page<SecretKey without hash>',
      scope: 'admin',
    },
    {
      name: 'get',
      method: 'POST',
      path,
      h: 'fetch one key by id',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'key id (from list or the issue response)' },
        },
        required: ['id'],
      },
      returns: 'SecretKey without hash',
      scope: 'admin',
    },
    {
      name: 'write',
      method: 'POST',
      path,
      h: 'issue a new key — the response carries the plaintext secret exactly once, store it immediately',
      inputSchema: {
        type: 'object',
        properties: SK_FIELD_SCHEMAS,
        required: ['owner', 'scopes'],
      },
      returns: '{ key: SecretKey without hash, secret } — secret shown once',
      scope: 'admin',
    },
    {
      name: 'update',
      method: 'POST',
      path,
      h: 'patch fields of an issued key (scopes, expiresAt, disabled, …); takes effect immediately',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'key id' },
          patch: {
            type: 'object',
            description: 'fields to change; same shape as write (all optional) plus disabled',
            properties: {
              ...SK_FIELD_SCHEMAS,
              disabled: { type: 'boolean', description: 'true = key rejected until re-enabled' },
            },
          },
        },
        required: ['id', 'patch'],
      },
      returns: 'SecretKey without hash',
      scope: 'admin',
    },
    {
      name: 'delete',
      method: 'POST',
      path,
      h: 'revoke a key permanently; takes effect immediately',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'key id' } },
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
    throw new TBError('invalid_argument', 'field \'scopes\' must be an array')
  }
  const input: SecretKeyInput = { owner, scopes: args.scopes as Scope[] }
  if (typeof args.description === 'string') input.description = args.description
  if (Array.isArray(args.registerPaths)) input.registerPaths = args.registerPaths as TreePath[]
  if ('expiresAt' in args) input.expiresAt = normalizeExpiresAt(args.expiresAt)
  return input
}

function asSkUpdatePatch(args: Record<string, unknown>): SKUpdatePatch {
  const patch = { ...args } as SKUpdatePatch
  if ('expiresAt' in args) patch.expiresAt = normalizeExpiresAt(args.expiresAt)
  return patch
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
    async dispatch(cmd: string, args: Record<string, unknown>): Promise<unknown> {
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
            asSkUpdatePatch(requireObject(args, 'patch')),
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
