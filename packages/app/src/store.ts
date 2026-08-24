/**
 * Deployment-level default Store application assembly.
 *
 * Core owns the object/session state machine. This file owns network grants,
 * capability-only HTTP handlers, short-lived read refs and deployment config.
 */
import {
  type BuiltinDispatchRuntime,
  type BuiltinModule,
  type CallContext,
  createStoreModule,
  type DeviceCallContext,
  type ObjectStore,
  type OwnerRef,
  type StateStore,
  type StoreCleanupCursors,
  type StoreCleanupResult,
  type StoreModuleDeps,
  type StoreObject,
  type StoreObjectDescriptor,
  StoreService,
  type StoreServiceOptions,
  type StoreShareResult,
  type StoreUploadInput,
  type StoreUploadStart,
  storeUri,
  TBError,
} from '@tool-bridge/core'
import type { TbAppDeps } from './deps'
import { signStoreRefToken } from './storeRefToken'

export const STORE_CALL_CAPABILITY_HEADER = 'x-tb-store-capability'
export const STORE_UPLOAD_HEADER = 'x-tb-store-upload'
export const KEY_STORE_TOKEN_SECRET = 'sys:store-token-secret:v1'
export const KEY_STORE_CLEANUP_PROGRESS = 'sys:store-cleanup-progress:v1'

const STORE_READ_TTL_SEC_DEFAULT = 15 * 60
const STORE_CALL_MAX_OBJECTS_DEFAULT = 4
const STORE_CALL_MAX_OBJECT_BYTES_DEFAULT = 256 * 1024 * 1024
const STORE_CALL_MAX_BYTES_DEFAULT = 512 * 1024 * 1024

export interface DefaultStoreRuntime {
  objects: ObjectStore
  service: StoreService
  tokenSecret: string
}

export interface DeviceCallUploadIssue {
  context: DeviceCallContext
  revoke(): Promise<void>
}

export interface CleanupDefaultStoreOptions {
  /** Core 每类记录每页扫描数；缺省 200。 */
  limit?: number
  /** 单次宿主 tick 最多处理页数；缺省 8，后续 cursor 持久化。 */
  maxPages?: number
}

interface CleanupProgress {
  cursors: StoreCleanupCursors
  revision: number
}

function positiveInt(value: number | undefined, fallback: number, field: string): number {
  const actual = value ?? fallback
  if (!Number.isSafeInteger(actual) || actual < 1) {
    throw new TBError('invalid_argument', `${field} must be a positive integer`)
  }
  return actual
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

async function derivedTokenSecret(root: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`tb-store-capability-root:v1:${root}`),
  )
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Resolve a stable Store capability secret without adding a deployment-time
 * secret requirement. CAS makes first boot safe across isolates/replicas.
 */
export async function storeTokenSecret(
  state: StateStore,
  configured?: string,
): Promise<string> {
  if (configured !== undefined) {
    if (configured.length < 16) {
      throw new TBError('invalid_argument', 'storeTokenSecret must contain at least 16 characters')
    }
    // Domain-separate an env/secret root before it is used as an HMAC key.
    // The derived value is never persisted.
    return await derivedTokenSecret(configured)
  }
  const current = await state.get(KEY_STORE_TOKEN_SECRET)
  if (typeof current === 'string' && current.length >= 16) return current
  if (current !== null) {
    throw new TBError('internal', 'default Store token secret state is invalid', {
      retryable: false,
    })
  }
  if (state.compareAndSwap === undefined) {
    throw new TBError('unavailable', 'default Store requires StateStore.compareAndSwap', {
      retryable: false,
    })
  }
  const candidate = randomSecret()
  if (await state.compareAndSwap(KEY_STORE_TOKEN_SECRET, null, candidate)) return candidate
  const winner = await state.get(KEY_STORE_TOKEN_SECRET)
  if (typeof winner !== 'string' || winner.length < 16) {
    throw new TBError('unavailable', 'default Store token secret initialization conflicted', {
      retryable: true,
    })
  }
  return winner
}

function serviceOptions(deps: TbAppDeps, tokenSecret: string): StoreServiceOptions {
  return {
    tokenSecret,
    ...(deps.storeMaxObjectBytes === undefined
      ? {}
      : { maxObjectBytes: deps.storeMaxObjectBytes }),
    ...(deps.storeRelayMaxBytes === undefined
      ? {}
      : { relayMaxBytes: deps.storeRelayMaxBytes }),
    ...(deps.storeUploadTtlSec === undefined ? {} : { uploadTtlSec: deps.storeUploadTtlSec }),
    ...(deps.storeShareTtlSec === undefined ? {} : { shareTtlSec: deps.storeShareTtlSec }),
  }
}

export async function defaultStoreRuntime(deps: TbAppDeps): Promise<DefaultStoreRuntime> {
  if (deps.objects === undefined) {
    throw new TBError('unavailable', 'default Store object driver is not configured', {
      retryable: false,
    })
  }
  const [objects, tokenSecret] = await Promise.all([
    deps.objects(),
    storeTokenSecret(deps.state, deps.storeTokenSecret ?? deps.encryptionKey),
  ])
  return {
    objects,
    tokenSecret,
    service: new StoreService(deps.state, objects, serviceOptions(deps, tokenSecret)),
  }
}

function requestOrigin(runtime: BuiltinDispatchRuntime | undefined, deps: TbAppDeps): string {
  const raw = deps.canonicalOrigin ?? runtime?.requestOrigin
  if (raw === undefined) {
    throw new TBError('unavailable', 'request origin is unavailable', { retryable: false })
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new TBError('unavailable', 'request origin is invalid', { retryable: false })
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:')
    || url.username !== ''
    || url.password !== ''
  ) {
    throw new TBError('unavailable', 'request origin is invalid', { retryable: false })
  }
  return url.origin
}

export function storeUploadGrant(start: StoreUploadStart, origin: string): Record<string, unknown> {
  const useRelay = start.alreadyCompleted || start.signedRequest === undefined
  const url = useRelay
    ? `${origin}/~store/uploads/${encodeURIComponent(start.uploadId)}`
    : start.signedRequest!.url
  const headers = useRelay
    ? { [STORE_UPLOAD_HEADER]: start.uploadToken }
    : start.signedRequest!.headers
  return {
    uploadId: start.uploadId,
    objectUri: start.objectUri,
    transport: useRelay ? 'relay' : 'presigned-put',
    method: 'PUT',
    url,
    headers,
    expiresAt: start.expiresAt,
    maxBytes: start.maxBytes,
    uploadToken: start.uploadToken,
    ...(start.alreadyCompleted && start.descriptor !== undefined
      ? { alreadyCompleted: true, descriptor: start.descriptor }
      : {}),
  }
}

function readTtlSec(deps: TbAppDeps): number {
  return positiveInt(
    deps.storeReadTtlSec,
    deps.refTtlSec ?? STORE_READ_TTL_SEC_DEFAULT,
    'storeReadTtlSec',
  )
}

async function ownerReadGrant(
  object: StoreObject,
  runtime: BuiltinDispatchRuntime | undefined,
  deps: TbAppDeps,
  tokenSecret: string,
): Promise<Record<string, unknown>> {
  if (object.status !== 'ready' || object.size === undefined) {
    throw TBError.notFound('Store object not found')
  }
  const ttlSec = readTtlSec(deps)
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString()
  const token = await signStoreRefToken({
    v: 1,
    objectId: object.id,
    exp: Math.floor(Date.parse(expiresAt) / 1000),
  }, tokenSecret)
  return {
    $ref: `${requestOrigin(runtime, deps)}/~store/refs/${encodeURIComponent(token)}`,
    uri: storeUri(object.id),
    contentType: object.contentType,
    size: object.size,
    expiresAt,
  }
}

function shareReadGrant(
  result: StoreShareResult,
  runtime: BuiltinDispatchRuntime | undefined,
  deps: TbAppDeps,
): Record<string, unknown> {
  return {
    shareId: result.shareId,
    uri: result.uri,
    expiresAt: result.expiresAt,
    $ref: `${requestOrigin(runtime, deps)}/~store/shares/${encodeURIComponent(result.token)}`,
  }
}

export function defaultStoreModuleDeps(
  deps: TbAppDeps,
  store: DefaultStoreRuntime,
): StoreModuleDeps {
  return {
    service: store.service,
    callbacks: {
      createUpload: (start, runtime) => storeUploadGrant(start, requestOrigin(runtime, deps)),
      read: async (object, runtime) => await ownerReadGrant(
        object,
        runtime,
        deps,
        store.tokenSecret,
      ),
      share: (result, runtime) => shareReadGrant(result, runtime, deps),
    },
  }
}

/**
 * Help stays available without touching the driver or CAS state. The concrete
 * service is constructed only when a Store command is dispatched, so legacy
 * custom hosts fail closed on Store while unrelated builtins keep working.
 */
export function lazyDefaultStoreModule(deps: TbAppDeps): BuiltinModule {
  const helpOnly = createStoreModule({
    // createStoreModule.help is static and never reads these placeholders.
    service: undefined as unknown as StoreService,
    callbacks: {
      createUpload: () => { throw new TBError('unavailable', 'default Store is unavailable') },
      read: () => { throw new TBError('unavailable', 'default Store is unavailable') },
      share: () => { throw new TBError('unavailable', 'default Store is unavailable') },
    },
  })
  return {
    module: helpOnly.module,
    description: helpOnly.description,
    help: path => helpOnly.help(path),
    async dispatch(
      cmd: string,
      args: Record<string, unknown>,
      ctx: CallContext,
      runtime?: BuiltinDispatchRuntime,
    ): Promise<unknown> {
      const store = await defaultStoreRuntime(deps)
      return await createStoreModule(defaultStoreModuleDeps(deps, store)).dispatch(
        cmd,
        args,
        ctx,
        runtime,
      )
    },
  }
}

export async function beginCapabilityUpload(
  deps: TbAppDeps,
  input: StoreUploadInput,
  capabilityToken: string,
  origin: string,
): Promise<Record<string, unknown>> {
  const store = await defaultStoreRuntime(deps)
  const start = await store.service.beginCallUpload(input, capabilityToken)
  return storeUploadGrant(start, origin)
}

export async function completeCapabilityUpload(
  deps: TbAppDeps,
  uploadId: string,
  uploadToken: string,
): Promise<StoreObjectDescriptor> {
  return await (await defaultStoreRuntime(deps)).service.completeUploadWithToken(
    uploadId,
    uploadToken,
  )
}

export async function abortCapabilityUpload(
  deps: TbAppDeps,
  uploadId: string,
  uploadToken: string,
): Promise<{ ok: true }> {
  return await (await defaultStoreRuntime(deps)).service.abortUploadWithToken(
    uploadId,
    uploadToken,
  )
}

export async function relayStoreUpload(
  deps: TbAppDeps,
  uploadId: string,
  uploadToken: string,
  body: ReadableStream<Uint8Array> | null,
): Promise<StoreObjectDescriptor> {
  const store = await defaultStoreRuntime(deps)
  const session = await store.service.verifyUploadToken(uploadToken)
  if (session.id !== uploadId) {
    throw new TBError('permission_denied', 'upload capability does not match the URL')
  }
  return await store.service.commitRelayUpload({
    uploadToken,
    body: body ?? new Uint8Array(),
  })
}

export async function storeObjectResponse(
  objects: ObjectStore,
  object: StoreObject,
): Promise<Response> {
  const got = await objects.get(object.driverKey)
  if (got === null) throw TBError.notFound('not found')
  const reader = got.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          reader.releaseLock()
          controller.close()
        } else if (chunk.value !== undefined) {
          controller.enqueue(chunk.value)
        }
      } catch (error) {
        try {
          reader.releaseLock()
        } catch {
          // The source may already have released the lock while failing.
        }
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        if (reader.cancel !== undefined) await reader.cancel(reason)
        else await got.body.cancel?.(reason)
      } finally {
        try {
          reader.releaseLock()
        } catch {
          // cancel may release the lock in the source implementation.
        }
      }
    },
  })
  return new Response(body, {
    headers: {
      'content-type': object.contentType,
      'content-length': String(got.meta.size),
      'cache-control': 'private, no-store',
    },
  })
}

export async function issueDeviceCallUpload(
  deps: TbAppDeps,
  deviceId: string,
  callId: string,
  context: DeviceCallContext,
): Promise<DeviceCallUploadIssue | null> {
  // Embedded legacy hosts may intentionally omit the Store. Standard hosts
  // always inject it and therefore always get the call-scoped capability.
  if (deps.objects === undefined) return null
  const store = await defaultStoreRuntime(deps)
  const maxObjects = positiveInt(
    deps.storeCallMaxObjects,
    STORE_CALL_MAX_OBJECTS_DEFAULT,
    'storeCallMaxObjects',
  )
  const maxBytes = positiveInt(
    deps.storeCallMaxBytes,
    STORE_CALL_MAX_BYTES_DEFAULT,
    'storeCallMaxBytes',
  )
  const maxObjectBytes = Math.min(
    positiveInt(
      deps.storeCallMaxObjectBytes,
      deps.storeMaxObjectBytes ?? STORE_CALL_MAX_OBJECT_BYTES_DEFAULT,
      'storeCallMaxObjectBytes',
    ),
    maxBytes,
  )
  const issued = await store.service.issueCallUploadCapability({
    callId,
    owner: context.caller.owner as OwnerRef,
    producer: `device:${deviceId}`,
    expiresAt: context.expiresAt,
    maxObjects,
    maxBytes,
    maxObjectBytes,
    allowedContentTypes: deps.storeCallAllowedContentTypes ?? ['*/*'],
  })
  return {
    context: {
      ...context,
      upload: {
        token: issued.token,
        expiresAt: issued.capability.expiresAt,
        // The SDK uses this as an early per-object check; the server remains
        // authoritative for the aggregate call budget.
        maxBytes: issued.capability.maxObjectBytes,
        maxObjects: issued.capability.maxObjects,
      },
    },
    revoke: async () => await store.service.revokeCallUploadCapability(issued.token),
  }
}

/** Host timer/Cron entry point. Normal requests never trigger a global scan. */
function cleanupProgress(value: unknown): CleanupProgress {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TBError('internal', 'default Store cleanup progress is invalid')
  }
  const record = value as Record<string, unknown>
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1) {
    throw new TBError('internal', 'default Store cleanup progress is invalid')
  }
  const cursors = record.cursors
  if (cursors === null || typeof cursors !== 'object' || Array.isArray(cursors)) {
    throw new TBError('internal', 'default Store cleanup progress is invalid')
  }
  for (const field of [
    'uploads',
    'objects',
    'shares',
    'callCapabilities',
    'driverObjects',
    'idempotencyBindings',
  ] as const) {
    const cursor = (cursors as Record<string, unknown>)[field]
    if (cursor !== null && typeof cursor !== 'string') {
      throw new TBError('internal', 'default Store cleanup progress is invalid')
    }
  }
  return value as CleanupProgress
}

function emptyCleanupResult(): StoreCleanupResult {
  return {
    abandonedObjects: 0,
    deletedBytes: 0,
    deletedOrphans: 0,
    deletedStaging: 0,
    expiredCallCapabilities: 0,
    expiredIdempotencyBindings: 0,
    expiredShares: 0,
    expiredUploads: 0,
  }
}

function addCleanupResult(target: StoreCleanupResult, page: StoreCleanupResult): void {
  target.abandonedObjects += page.abandonedObjects
  target.deletedBytes += page.deletedBytes
  target.deletedOrphans += page.deletedOrphans
  target.deletedStaging += page.deletedStaging
  target.expiredCallCapabilities += page.expiredCallCapabilities
  target.expiredIdempotencyBindings += page.expiredIdempotencyBindings
  target.expiredShares += page.expiredShares
  target.expiredUploads += page.expiredUploads
}

/**
 * One bounded host cleanup tick. Cursor progress is itself CAS-protected and
 * durable, so later pages are not starved across Cron/Node timer invocations.
 */
export async function cleanupDefaultStore(
  deps: TbAppDeps,
  opts: CleanupDefaultStoreOptions = {},
): Promise<StoreCleanupResult> {
  await deps.ensureReady?.()
  const store = await defaultStoreRuntime(deps)
  const maxPages = Math.min(positiveInt(opts.maxPages, 8, 'maxPages'), 64)
  const limit = opts.limit === undefined ? undefined : positiveInt(opts.limit, 200, 'limit')
  const rawProgress = await deps.state.get(KEY_STORE_CLEANUP_PROGRESS)
  let progress = rawProgress === null ? null : cleanupProgress(rawProgress)
  let cursors = progress?.cursors
  const aggregate = emptyCleanupResult()

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const page = await store.service.cleanup({
      ...(limit === undefined ? {} : { limit }),
      ...(cursors === undefined ? {} : { cursors }),
    })
    addCleanupResult(aggregate, page)
    if (page.cursors === undefined) {
      if (progress !== null) {
        await deps.state.compareAndSwap!(
          KEY_STORE_CLEANUP_PROGRESS,
          progress.revision,
          null,
        )
      }
      return aggregate
    }

    const next: CleanupProgress = {
      cursors: page.cursors,
      revision: (progress?.revision ?? 0) + 1,
    }
    const advanced = await deps.state.compareAndSwap!(
      KEY_STORE_CLEANUP_PROGRESS,
      progress?.revision ?? null,
      next,
    )
    if (!advanced) {
      // Another cleaner advanced the durable cursor. Work is idempotent; do
      // not overwrite the winner or continue from stale progress.
      return aggregate
    }
    progress = next
    cursors = next.cursors
  }

  return { ...aggregate, ...(cursors === undefined ? {} : { cursors }) }
}
