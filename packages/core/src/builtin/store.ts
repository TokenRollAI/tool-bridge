import { z } from 'zod/v4'
import type {
  StoreObject,
  StoreShareResult,
  StoreUploadInput,
  StoreUploadStart,
} from '../objectStoreService/types'
import type { BuiltinDispatchRuntime, BuiltinModule } from './types'
import type { StoreService } from '../objectStoreService/service'
import type { Action } from '../types'
import { BuiltinCommandRegistry } from './commandRegistry'
import { LIST_OPTS_ZOD_SCHEMA } from './util'

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

const contentTypeSchema = z.string().min(1).describe('object MIME type')
const filenameSchema = z.string().optional().describe(
  'display-only filename; never used as a storage key',
)
const checksumSchema = z.strictObject({
  algorithm: z.literal('sha256'),
  value: z.string(),
}).optional().describe('optional sha256 checksum declaration')
const uriSchema = z.string().describe('store://default/<objectId>')

const COMMANDS = new BuiltinCommandRegistry<StoreModuleDeps>('store', DESCRIPTION)
  .register(
    'create_upload',
    {
      h: 'create a new opaque Store object and bounded upload session',
      inputSchema: z.strictObject({
        contentType: contentTypeSchema,
        filename: filenameSchema,
        size: z.number().optional().describe('expected byte size'),
        checksum: checksumSchema,
        idempotencyKey: z.string().optional().describe('owner-scoped create retry key'),
      }),
      returns: 'StoreUploadGrant',
      scope: 'write',
    },
    async (
      { checksum, contentType, filename, idempotencyKey, size },
      { call, deps, runtime },
    ) => {
      const input: StoreUploadInput = {
        contentType,
        ...(filename !== undefined ? { filename } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(checksum !== undefined ? { checksum } : {}),
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      }
      const start = await deps.service.beginUpload(input, {
        owner: call.owner,
        producer: call.owner,
      })
      return deps.callbacks.createUpload(start, runtime)
    },
  )
  .register(
    'complete_upload',
    {
      h: 'verify a direct upload and atomically mark its object ready; idempotent',
      inputSchema: z.strictObject({ uploadId: z.string().min(1) }),
      returns: 'StoreObject',
      scope: 'write',
    },
    ({ uploadId }, { call, deps }) => deps.service.completeUpload(uploadId, call.owner),
  )
  .register(
    'abort_upload',
    {
      h: 'abandon an unfinished upload; idempotent until the object is ready',
      inputSchema: z.strictObject({ uploadId: z.string().min(1) }),
      returns: 'void',
      scope: 'write',
    },
    ({ uploadId }, { call, deps }) => deps.service.abortUpload(uploadId, call.owner),
  )
  .register(
    'stat',
    {
      h: 'return metadata for a ready object owned by the current principal',
      inputSchema: z.strictObject({ uri: uriSchema }),
      returns: 'StoreObject',
      scope: 'read',
    },
    ({ uri }, { call, deps }) => deps.service.stat(uri, { owner: call.owner }),
  )
  .register(
    'read',
    {
      h: 'authorize an object read and return a short-lived $ref',
      inputSchema: z.strictObject({ uri: uriSchema }),
      returns: '{ $ref, contentType, size, expiresAt }',
      scope: 'read',
    },
    async ({ uri }, { call, deps, runtime }) => {
      const object = await deps.service.authorizeRead(uri, { owner: call.owner })
      return deps.callbacks.read(object, runtime)
    },
  )
  .register(
    'share',
    {
      h: 'create a short-lived, revocable read share for an owned object',
      inputSchema: z.strictObject({
        uri: uriSchema,
        ttlSec: z.number().int().positive().optional(),
      }),
      returns: 'StoreShare',
      scope: 'write',
    },
    async ({ ttlSec, uri }, { call, deps, runtime }) => {
      const result = ttlSec === undefined
        ? await deps.service.share(uri, call.owner)
        : await deps.service.share(uri, call.owner, ttlSec)
      return deps.callbacks.share(result, runtime)
    },
  )
  .register(
    'revoke_share',
    {
      h: 'revoke a Store share grant',
      inputSchema: z.strictObject({ shareId: z.string().min(1) }),
      returns: 'void',
      scope: 'write',
    },
    ({ shareId }, { call, deps }) => deps.service.revokeShare(shareId, call.owner),
  )
  .register(
    'delete',
    {
      h: 'make an owned Store object immediately unreadable and delete its bytes',
      inputSchema: z.strictObject({ uri: uriSchema }),
      returns: 'void',
      scope: 'write',
    },
    ({ uri }, { call, deps }) => deps.service.delete(uri, { owner: call.owner }),
  )
  .register(
    'list',
    {
      h: 'list ready Store objects owned by the current principal',
      inputSchema: z.strictObject({ opts: LIST_OPTS_ZOD_SCHEMA.optional() }),
      returns: 'Page<StoreObject>',
      scope: 'read',
    },
    ({ opts }, { call, deps }) => deps.service.list(call.owner, opts ?? {}),
  )

/** 权威 scope 直接来自同一条命令注册定义。 */
export function storeScopeForCmd(cmd: string): Action | undefined {
  return COMMANDS.scopeFor(cmd)
}

export function createStoreModule(deps: StoreModuleDeps): BuiltinModule {
  return COMMANDS.module(deps)
}
