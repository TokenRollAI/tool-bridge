import type { StoreObject, StoreShareResult, StoreUploadStart } from '../objectStoreService/types'
import type { BuiltinDispatchRuntime, BuiltinModule } from './types'
import type { StoreService } from '../objectStoreService/service'
import type { Action, CallContext, TreePath } from '../types'
import type { CmdSpec, HelpModel } from '../htbp/model'
import { cmdPath, LIST_OPTS_SCHEMA, requireString, withCommandPaths } from './util'
import { TBError } from '../errors'

export const STORE_COMMANDS = [
  'create_upload',
  'complete_upload',
  'abort_upload',
  'stat',
  'read',
  'share',
  'revoke_share',
  'delete',
  'list',
] as const

export type StoreCommand = typeof STORE_COMMANDS[number]

const STORE_SCOPE_BY_CMD: Record<StoreCommand, Action> = {
  create_upload: 'write',
  complete_upload: 'write',
  abort_upload: 'write',
  stat: 'read',
  read: 'read',
  share: 'write',
  revoke_share: 'write',
  delete: 'write',
  list: 'read',
}

export function storeScopeForCmd(cmd: string): Action | undefined {
  return STORE_SCOPE_BY_CMD[cmd as StoreCommand]
}

export interface StoreModuleCallbacks {
  /** relay URL / direct signed request 的 wire 组装由宿主完成。 */
  createUpload(
    start: StoreUploadStart,
    runtime: BuiltinDispatchRuntime | undefined,
  ): Promise<unknown> | unknown
  /** 为已鉴权对象签发 relay/presigned GET；不得把 driverKey 回显。 */
  read(
    object: StoreObject,
    runtime: BuiltinDispatchRuntime | undefined,
  ): Promise<unknown> | unknown
  /** 把 share bearer 变成短期 URL/$ref；core 只负责 grant 与撤销状态。 */
  share(
    result: StoreShareResult,
    runtime: BuiltinDispatchRuntime | undefined,
  ): Promise<unknown> | unknown
}

export interface StoreModuleDeps {
  callbacks: StoreModuleCallbacks
  service: StoreService
}

const DESCRIPTION = 'Deployment-level private object Store for uploads, reads and short-lived sharing'

function storeCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  const objectFields = {
    contentType: { type: 'string', description: 'object MIME type' },
    filename: { type: 'string', description: 'display-only filename; never used as a storage key' },
    size: { type: 'number', description: 'expected byte size' },
    checksum: {
      type: 'object',
      description: 'optional sha256 checksum declaration',
      properties: {
        algorithm: { type: 'string', enum: ['sha256'] },
        value: { type: 'string' },
      },
    },
    idempotencyKey: { type: 'string', description: 'owner-scoped create retry key' },
  }
  const uriField = { uri: { type: 'string', description: 'store://default/<objectId>' } }
  const specs: Array<Omit<CmdSpec, 'scope'> & { name: StoreCommand }> = [
    {
      name: 'create_upload',
      method: 'POST',
      path,
      h: 'create a new opaque Store object and bounded upload session',
      inputSchema: {
        type: 'object',
        properties: objectFields,
        required: ['contentType'],
      },
      returns: 'StoreUploadGrant',
    },
    {
      name: 'complete_upload',
      method: 'POST',
      path,
      h: 'verify a direct upload and atomically mark its object ready; idempotent',
      inputSchema: {
        type: 'object',
        properties: {
          uploadId: { type: 'string' },
        },
        required: ['uploadId'],
      },
      returns: 'StoreObject',
    },
    {
      name: 'abort_upload',
      method: 'POST',
      path,
      h: 'abandon an unfinished upload; idempotent until the object is ready',
      inputSchema: {
        type: 'object',
        properties: {
          uploadId: { type: 'string' },
        },
        required: ['uploadId'],
      },
      returns: 'void',
    },
    {
      name: 'stat',
      method: 'POST',
      path,
      h: 'return metadata for a ready object owned by the current principal',
      inputSchema: {
        type: 'object',
        properties: uriField,
        required: ['uri'],
      },
      returns: 'StoreObject',
    },
    {
      name: 'read',
      method: 'POST',
      path,
      h: 'authorize an object read and return a short-lived $ref',
      inputSchema: {
        type: 'object',
        properties: uriField,
        required: ['uri'],
      },
      returns: '{ $ref, contentType, size, expiresAt }',
    },
    {
      name: 'share',
      method: 'POST',
      path,
      h: 'create a short-lived, revocable read share for an owned object',
      inputSchema: {
        type: 'object',
        properties: { ...uriField, ttlSec: { type: 'number' } },
        required: ['uri'],
      },
      returns: 'StoreShare',
    },
    {
      name: 'revoke_share',
      method: 'POST',
      path,
      h: 'revoke a Store share grant',
      inputSchema: {
        type: 'object',
        properties: { shareId: { type: 'string' } },
        required: ['shareId'],
      },
      returns: 'void',
    },
    {
      name: 'delete',
      method: 'POST',
      path,
      h: 'make an owned Store object immediately unreadable and delete its bytes',
      inputSchema: { type: 'object', properties: uriField, required: ['uri'] },
      returns: 'void',
    },
    {
      name: 'list',
      method: 'POST',
      path,
      h: 'list ready Store objects owned by the current principal',
      inputSchema: { type: 'object', properties: { opts: LIST_OPTS_SCHEMA } },
      returns: 'Page<StoreObject>',
    },
  ]
  return withCommandPaths(nodePath, specs.map(spec => ({
    ...spec,
    scope: STORE_SCOPE_BY_CMD[spec.name],
  })))
}

function optionalPositiveInt(args: Record<string, unknown>, field: string): number | undefined {
  const value = args[field]
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TBError('invalid_argument', `${field} 必须是正整数`)
  }
  return value as number
}

function rejectUnknown(args: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(args).filter(key => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new TBError('invalid_argument', `未知字段:${unknown.join(',')}`)
  }
}

export function createStoreModule(deps: StoreModuleDeps): BuiltinModule {
  return {
    module: 'store',
    description: DESCRIPTION,
    help(nodePath: TreePath): HelpModel {
      return {
        node: { path: nodePath, kind: 'builtin', description: DESCRIPTION },
        cmds: storeCmds(nodePath),
      }
    },
    async dispatch(
      cmd: string,
      args: Record<string, unknown>,
      ctx: CallContext,
      runtime?: BuiltinDispatchRuntime,
    ): Promise<unknown> {
      switch (cmd) {
        case 'create_upload': {
          rejectUnknown(args, ['contentType', 'filename', 'size', 'checksum', 'idempotencyKey'])
          const input = {
            contentType: requireString(args, 'contentType'),
            ...(args.filename !== undefined ? { filename: args.filename as string } : {}),
            ...(args.size !== undefined ? { size: args.size as number } : {}),
            ...(args.checksum !== undefined ? { checksum: args.checksum as never } : {}),
            ...(args.idempotencyKey !== undefined
              ? { idempotencyKey: args.idempotencyKey as string }
              : {}),
          }
          const start = await deps.service.beginUpload(input, {
            owner: ctx.owner,
            producer: ctx.owner,
          })
          return deps.callbacks.createUpload(start, runtime)
        }
        case 'complete_upload':
          rejectUnknown(args, ['uploadId'])
          return deps.service.completeUpload(requireString(args, 'uploadId'), ctx.owner)
        case 'abort_upload':
          rejectUnknown(args, ['uploadId'])
          return deps.service.abortUpload(requireString(args, 'uploadId'), ctx.owner)
        case 'stat':
          rejectUnknown(args, ['uri'])
          return deps.service.stat(requireString(args, 'uri'), { owner: ctx.owner })
        case 'read': {
          rejectUnknown(args, ['uri'])
          const object = await deps.service.authorizeRead(requireString(args, 'uri'), {
            owner: ctx.owner,
          })
          return deps.callbacks.read(object, runtime)
        }
        case 'share': {
          rejectUnknown(args, ['uri', 'ttlSec'])
          const ttlSec = optionalPositiveInt(args, 'ttlSec')
          const result = ttlSec === undefined
            ? await deps.service.share(requireString(args, 'uri'), ctx.owner)
            : await deps.service.share(requireString(args, 'uri'), ctx.owner, ttlSec)
          return deps.callbacks.share(result, runtime)
        }
        case 'revoke_share':
          rejectUnknown(args, ['shareId'])
          return deps.service.revokeShare(requireString(args, 'shareId'), ctx.owner)
        case 'delete':
          rejectUnknown(args, ['uri'])
          return deps.service.delete(requireString(args, 'uri'), { owner: ctx.owner })
        case 'list': {
          rejectUnknown(args, ['opts'])
          const raw = args.opts
          if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) {
            throw new TBError('invalid_argument', 'opts 必须是对象')
          }
          return deps.service.list(ctx.owner, (raw ?? {}) as { cursor?: string, limit?: number })
        }
        default:
          throw new TBError('invalid_argument', `unknown cmd '${cmd}' on system/store`)
      }
    },
  }
}
