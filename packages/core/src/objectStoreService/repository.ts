import type { CallUploadCapability, ShareGrant, StoreObject, UploadSession } from './types'
import type { ObjectStore } from '../context/objectStore'
import { TBError } from '../errors'

export interface StoreIdempotencyBinding {
  createdAt: string
  domain: 'call' | 'owner'
  expiresAt: string
  fingerprint: string
  objectId: string
  originCallId?: string
  owner: string
  producer: string
  revision: number
  uploadId: string
}

/** Typed entity access; multi-record transitions belong to the domain operations below. */
export interface StoreRecords<T extends { revision: number }> {
  compare(id: string, revision: number | null, next: T | null): Promise<boolean>
  get(id: string): Promise<T | null>
  list(opts: { cursor?: string, limit: number }): Promise<{ cursor?: string, items: Array<{ key: string, value: T }> }>
}

export interface BeginStoreUpload {
  binding?: { id: string, record: StoreIdempotencyBinding }
  capability?: { id: string, tokenHash: string }
  now: string
  object: StoreObject
  session: UploadSession
}

export interface StoreRepository {
  /** Atomically binds identity, checks/reserves cumulative quota and creates both records. */
  beginUpload(input: BeginStoreUpload): Promise<{ object: StoreObject, session: UploadSession } | 'backend_changed'>
  callCapabilities: StoreRecords<CallUploadCapability>
  /** Object readiness and session completion commit together; reservations remain consumed. */
  finishUpload(object: StoreObject, session: UploadSession): Promise<StoreObject | null>
  idempotencyBindings: StoreRecords<StoreIdempotencyBinding>
  listReadyObjects(owner: string, opts: { cursor?: string, limit: number }): Promise<{ cursor?: string, items: StoreObject[] }>
  objects: StoreRecords<StoreObject>
  shares: StoreRecords<ShareGrant>
  /** Aborting/expiring/failing cannot race a ready object into an inconsistent session. */
  terminateUpload(object: StoreObject, session: UploadSession): Promise<boolean>
  uploads: StoreRecords<UploadSession>
}

export interface StoreBackendResolver {
  defaultBackend(): Promise<{ id: string, objects: ObjectStore }>
  resolveBackend(id: string): Promise<ObjectStore>
}

/** Executed only while the repository holds its capability lock. */
export function reserveUploadQuota(input: BeginStoreUpload, capability: CallUploadCapability): CallUploadCapability {
  if (capability.tokenHash !== input.capability?.tokenHash
    || capability.owner !== input.object.owner || capability.producer !== input.object.producer
    || capability.callId !== input.object.originCallId
    || Date.parse(capability.expiresAt) <= Date.parse(input.now)
    || capability.status === 'revoked' || capability.status === 'expired') {
    throw new TBError('permission_denied', 'call upload capability 无效或已过期')
  }
  if (capability.status !== 'active' || capability.reservations.length >= capability.maxObjects) {
    throw new TBError('rate_limited', 'call upload object 数量已达上限')
  }
  const type = input.object.contentType
  if (!capability.allowedContentTypes.some(allowed => allowed === '*/*' || allowed === type
    || (allowed.endsWith('/*') && type.startsWith(allowed.slice(0, -1))))) {
    throw new TBError('permission_denied', `call 不允许上传 ${type}`)
  }
  const maxBytes = Math.min(input.session.maxBytes, capability.maxObjectBytes,
    input.session.expectedSize ?? capability.maxObjectBytes, capability.maxBytes - capability.reservedBytes)
  if (maxBytes < 1 || (input.session.expectedSize !== undefined && input.session.expectedSize > maxBytes)) {
    throw new TBError('rate_limited', 'call upload bytes 配额不足')
  }
  input.session.maxBytes = maxBytes
  const reservations = [...capability.reservations, { objectId: input.object.id, maxBytes }]
  const reservedBytes = capability.reservedBytes + maxBytes
  return { ...capability, reservations, reservedBytes, revision: capability.revision + 1,
    status: reservations.length >= capability.maxObjects || reservedBytes >= capability.maxBytes ? 'exhausted' : 'active' }
}

export function assertUploadBinding(existing: StoreIdempotencyBinding, requested: StoreIdempotencyBinding, now: string): void {
  if (existing.owner !== requested.owner || existing.producer !== requested.producer
    || existing.originCallId !== requested.originCallId || existing.domain !== requested.domain
    || existing.fingerprint !== requested.fingerprint) {
    throw new TBError('conflict', 'idempotencyKey 已绑定到不同上传声明')
  }
  if (Date.parse(existing.expiresAt) <= Date.parse(now)) throw new TBError('conflict', 'idempotencyKey 对应的 upload session 已过期')
}
