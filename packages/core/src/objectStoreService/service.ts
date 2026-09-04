import { z } from 'zod/v4'
import type {
  ObjectBody,
  ObjectBodyStream,
  ObjectMeta,
} from '../context/objectStore'
import {
  type CallUploadCapability,
  DEFAULT_STORE_DRIVER_KEY_ROOT,
  DEFAULT_STORE_NAME,
  type IssueCallUploadCapabilityInput,
  type IssuedCallUploadCapability,
  type RelayCommitInput,
  type ShareGrant,
  type StoreChecksum,
  type StoreCleanupCursors,
  type StoreCleanupOptions,
  type StoreCleanupResult,
  type StoreListOptions,
  type StoreListPage,
  type StoreObject,
  type StoreObjectDescriptor,
  type StoreReadAccess,
  type StoreServiceOptions,
  type StoreShareResult,
  type StoreUploadInput,
  type StoreUploadStart,
  type UploadSession,
} from './types'
import { assertUploadBinding, type StoreIdempotencyBinding as IdempotencyBinding, type StoreBackendResolver, type StoreRecords, type StoreRepository } from './repository'
import {
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  type OwnerRef,
  type Timestamp,
} from '../types'
import { type StoreTokenKeyring, validateStoreTokenKeyring } from '../secret/keyring'
import { normalizeContentType } from '../context/contentType'
import { normalizeExpiresAt, sha256Hex } from '../auth/sk'
import { base64urlEncode } from '../encoding/base64url'
import { crypto, TextEncoder } from '../webGlobals'
import { parseStoreUri, storeUri } from './uri'
import { isTBError, TBError } from '../errors'
import { omit } from '../omit'

const UPLOAD_TTL_SEC_DEFAULT = 15 * 60
const SHARE_TTL_SEC_DEFAULT = 15 * 60
const MAX_OBJECT_BYTES_DEFAULT = 256 * 1024 * 1024
const MAX_REVISION_ATTEMPTS = 32
const CAPABILITY_TTL_SEC_MAX = 7 * 24 * 60 * 60
const TOKEN_PREFIX = {
  call: 'tbc',
  share: 'tbs',
  upload: 'tbu',
} as const

type TokenDomain = keyof typeof TOKEN_PREFIX

interface NormalizedUploadInput {
  checksum?: StoreChecksum
  contentType: string
  filename?: string
  idempotencyKey?: string
  size?: number
}

interface UploadIdentity {
  callCapabilityToken?: string
  originCallId?: string
  owner: OwnerRef
  producer: OwnerRef
}

function stateCorrupt(kind: string): TBError {
  return new TBError('internal', `Store ${kind} 状态损坏`, { retryable: false })
}

const persistedId = z.string().min(1)
const persistedOwner = z.string().min(1).refine(value => !/[\r\n\0]/.test(value))
const persistedTimestamp = z.string().refine(value => Number.isFinite(Date.parse(value)))
const persistedNonNegativeInt = z.number().int().nonnegative().refine(Number.isSafeInteger)
const persistedPositiveInt = persistedNonNegativeInt.refine(value => value > 0)
const persistedHash = z.string().regex(/^[0-9a-f]{64}$/)
const persistedChecksum = z.looseObject({
  algorithm: z.literal('sha256'),
  value: z.string().min(1),
})

/**
 * 持久化记录允许向前增加字段，但所有已知字段都 fail-closed 校验。
 * 只验证主键会让 `Date.parse(undefined) => NaN` 一类脏记录永久保持 active，
 * 或让损坏的 quota/reservation 绕过限制；这比拒绝一条坏记录危险得多。
 */
function stateParser<T>(kind: string, shape: z.ZodRawShape): (value: unknown) => T {
  const schema = z.looseObject({ revision: persistedPositiveInt, ...shape })
  return (value) => {
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw stateCorrupt(kind)
    return parsed.data as T
  }
}

const parseObject = stateParser<StoreObject>('object', {
  backendId: persistedId,
  bytesDeletedAt: persistedTimestamp.optional(),
  checksum: persistedChecksum.optional(),
  contentType: z.string().min(1),
  createdAt: persistedTimestamp,
  driverKey: persistedId,
  etag: z.string().optional(),
  expectedChecksum: persistedChecksum.optional(),
  expectedSize: persistedNonNegativeInt.optional(),
  expiresAt: persistedTimestamp.optional(),
  filename: z.string().optional(),
  id: persistedId,
  originCallId: persistedId.optional(),
  owner: persistedOwner,
  producer: persistedOwner.optional(),
  readyAt: persistedTimestamp.optional(),
  size: persistedNonNegativeInt.optional(),
  status: z.enum(['pending', 'ready', 'failed', 'abandoned', 'deleted']),
  store: z.literal(DEFAULT_STORE_NAME),
  updatedAt: persistedTimestamp,
  uploadId: persistedId,
})
const parseSessionRecord = stateParser<UploadSession>('upload session', {
  revokedAt: persistedTimestamp.optional(),
  signingKeyId: persistedId,
  backendId: persistedId,
  capabilityHash: persistedHash,
  completedAt: persistedTimestamp.optional(),
  contentType: z.string().min(1),
  createdAt: persistedTimestamp,
  expectedChecksum: persistedChecksum.optional(),
  expectedSize: persistedNonNegativeInt.optional(),
  expiresAt: persistedTimestamp,
  id: persistedId,
  maxBytes: persistedPositiveInt,
  objectId: persistedId,
  status: z.enum(['created', 'completed', 'aborted', 'expired', 'failed']),
  terminalAt: persistedTimestamp.optional(),
  transport: z.enum(['relay', 'presigned-put']),
})
const parseCallCapabilityRecord = stateParser<CallUploadCapability>('call capability', {
  signingKeyId: persistedId,
  allowedContentTypes: z.array(z.string().min(1)).min(1),
  callId: persistedId,
  createdAt: persistedTimestamp,
  expiresAt: persistedTimestamp,
  id: persistedId,
  maxBytes: persistedPositiveInt,
  maxObjectBytes: persistedPositiveInt,
  maxObjects: persistedPositiveInt,
  owner: persistedOwner,
  producer: persistedOwner,
  reservations: z.array(z.looseObject({
    maxBytes: persistedPositiveInt,
    objectId: persistedId,
  })),
  reservedBytes: persistedNonNegativeInt,
  status: z.enum(['active', 'exhausted', 'revoked', 'expired']),
  terminalAt: persistedTimestamp.optional(),
  tokenHash: persistedHash,
})
const parseShare = stateParser<ShareGrant>('share grant', {
  signingKeyId: persistedId,
  createdAt: persistedTimestamp,
  createdBy: persistedOwner,
  expiresAt: persistedTimestamp,
  id: persistedId,
  objectId: persistedId,
  status: z.enum(['active', 'revoked', 'expired']),
  terminalAt: persistedTimestamp.optional(),
  tokenHash: persistedHash,
})
const parseIdempotencyBinding = stateParser<IdempotencyBinding>('idempotency binding', {
  createdAt: persistedTimestamp,
  domain: z.enum(['owner', 'call']),
  expiresAt: persistedTimestamp,
  fingerprint: persistedHash,
  objectId: persistedId,
  originCallId: persistedId.optional(),
  owner: persistedOwner,
  producer: persistedOwner,
  uploadId: persistedId,
})

function parseSession(value: unknown): UploadSession {
  const session = parseSessionRecord(value)
  if (
    (session.expectedSize !== undefined && session.expectedSize > session.maxBytes)
    || (session.transport === 'presigned-put' && session.expectedSize === undefined)
  ) throw stateCorrupt('upload session')
  return session
}

function parseCallCapability(value: unknown): CallUploadCapability {
  const capability = parseCallCapabilityRecord(value)
  const reservedBytes = capability.reservations.reduce(
    (total, reservation) => total + reservation.maxBytes,
    0,
  )
  const ids = new Set(capability.reservations.map(reservation => reservation.objectId))
  if (
    capability.maxObjectBytes > capability.maxBytes
    || capability.reservations.length > capability.maxObjects
    || ids.size !== capability.reservations.length
    || capability.reservations.some(reservation => reservation.maxBytes > capability.maxObjectBytes)
    || !Number.isSafeInteger(reservedBytes)
    || reservedBytes !== capability.reservedBytes
    || reservedBytes > capability.maxBytes
  ) throw stateCorrupt('call capability')
  return capability
}

function requireOwner(owner: unknown, field = 'owner'): OwnerRef {
  if (
    typeof owner !== 'string'
    || owner.trim() === ''
    || /[\r\n\0]/.test(owner)
  ) {
    throw new TBError('invalid_argument', `${field} 必须是非空 OwnerRef`)
  }
  return owner
}

function requirePositiveInt(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TBError('invalid_argument', `${field} 必须是正整数`)
  }
  return value as number
}

function requireCapabilityTtl(value: unknown, field: string): number {
  const ttl = requirePositiveInt(value, field)
  if (ttl > CAPABILITY_TTL_SEC_MAX) {
    throw new TBError('invalid_argument', `${field} 不能超过 ${CAPABILITY_TTL_SEC_MAX} 秒`)
  }
  return ttl
}

function normalizeTimestamp(value: unknown, field: string): Timestamp {
  try {
    return normalizeExpiresAt(value)
  } catch (error) {
    if (isTBError(error) && error.code === 'invalid_argument') {
      throw new TBError('invalid_argument', `${field} 必须是带时区的 ISO 8601 timestamp`)
    }
    throw error
  }
}

function normalizeChecksum(value: unknown): StoreChecksum | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TBError('invalid_argument', 'checksum 仅支持 sha256')
  }
  const record = value as Record<string, unknown>
  if (record.algorithm !== 'sha256' || typeof record.value !== 'string') {
    throw new TBError('invalid_argument', 'checksum 仅支持 sha256')
  }
  const digest = record.value.toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TBError('invalid_argument', 'sha256 checksum 必须是 64 位十六进制')
  }
  return { algorithm: 'sha256', value: digest }
}

function normalizeUploadInput(input: StoreUploadInput): NormalizedUploadInput {
  const contentType = normalizeContentType(input?.contentType, 'contentType 不合法')
  let filename: string | undefined
  if (input.filename !== undefined) {
    if (
      typeof input.filename !== 'string'
      || input.filename.trim() === ''
      || input.filename.length > 1024
      || /[\r\n\0]/.test(input.filename)
    ) throw new TBError('invalid_argument', 'filename 不合法')
    filename = input.filename
  }
  let size: number | undefined
  if (input.size !== undefined) {
    if (!Number.isSafeInteger(input.size) || input.size < 0) {
      throw new TBError('invalid_argument', 'size 必须是非负整数')
    }
    size = input.size
  }
  let idempotencyKey: string | undefined
  if (input.idempotencyKey !== undefined) {
    if (
      typeof input.idempotencyKey !== 'string'
      || input.idempotencyKey.length < 1
      || input.idempotencyKey.length > 255
      || /[\r\n\0]/.test(input.idempotencyKey)
    ) throw new TBError('invalid_argument', 'idempotencyKey 不合法')
    idempotencyKey = input.idempotencyKey
  }
  const checksum = normalizeChecksum(input.checksum)
  return {
    contentType,
    ...(filename !== undefined ? { filename } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    ...(checksum !== undefined ? { checksum } : {}),
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  let diff = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    diff |= (left.charCodeAt(i % Math.max(1, left.length)) || 0)
      ^ (right.charCodeAt(i % Math.max(1, right.length)) || 0)
  }
  return diff === 0
}

function normalizeContentTypePattern(value: unknown): string {
  if (value === '*/*') return value
  if (typeof value === 'string' && value.endsWith('/*')) {
    const prefix = value.slice(0, -1)
    if (prefix.length > 1 && !/[\r\n\0]/.test(value)) return value.toLowerCase()
  }
  return normalizeContentType(value, 'contentType 不合法')
}

function descriptorOf(object: StoreObject): StoreObjectDescriptor {
  if (
    object.status !== 'ready'
    || object.readyAt === undefined
    || object.size === undefined
  ) throw stateCorrupt('ready object')
  return {
    uri: storeUri(object.id),
    status: 'ready',
    contentType: object.contentType,
    size: object.size,
    owner: object.owner,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
    readyAt: object.readyAt,
    ...(object.etag !== undefined ? { etag: object.etag } : {}),
    ...(object.filename !== undefined ? { filename: object.filename } : {}),
    ...(object.producer !== undefined ? { producer: object.producer } : {}),
    ...(object.originCallId !== undefined ? { originCallId: object.originCallId } : {}),
    ...(object.checksum !== undefined ? { checksum: object.checksum } : {}),
    ...(object.expiresAt !== undefined ? { expiresAt: object.expiresAt } : {}),
  }
}

/**
 * 部署级 default Store 的宿主中立状态机。
 *
 * StoreRepository owns atomic metadata transitions; immutable backend identities select byte storage.
 */
export class StoreService {
  private readonly maxObjectBytes: number
  private readonly now: () => Timestamp
  private readonly relayMaxBytes: number
  private readonly shareTtlSec: number
  private readonly tokenKeyring: StoreTokenKeyring
  private readonly uploadTtlSec: number
  private readonly repository: StoreRepository
  private readonly backends: StoreBackendResolver

  constructor(
    repository: StoreRepository,
    backends: StoreBackendResolver,
    opts: StoreServiceOptions,
  ) {
    this.repository = repository
    this.backends = backends
    if (typeof repository?.beginUpload !== 'function' || typeof repository.finishUpload !== 'function') {
      throw new TBError('unavailable', 'StoreService 要求显式 StoreRepository 原子领域存储')
    }
    this.tokenKeyring = validateStoreTokenKeyring(opts.tokenKeyring ?? opts.tokenSecret ?? '')
    this.now = opts.now ?? (() => new Date().toISOString())
    this.maxObjectBytes = requirePositiveInt(
      opts.maxObjectBytes ?? MAX_OBJECT_BYTES_DEFAULT,
      'maxObjectBytes',
    )
    this.relayMaxBytes = Math.min(
      requirePositiveInt(opts.relayMaxBytes ?? this.maxObjectBytes, 'relayMaxBytes'),
      this.maxObjectBytes,
    )
    this.uploadTtlSec = requireCapabilityTtl(
      opts.uploadTtlSec ?? UPLOAD_TTL_SEC_DEFAULT,
      'uploadTtlSec',
    )
    this.shareTtlSec = requireCapabilityTtl(
      opts.shareTtlSec ?? SHARE_TTL_SEC_DEFAULT,
      'shareTtlSec',
    )
  }

  /** 单记录条件更新共用 revision 期望，并拒绝错误的版本跃迁。 */
  private async compareRecord<T extends { revision: number }>(
    records: StoreRecords<T>,
    key: string,
    current: T,
    next: T | null,
  ): Promise<boolean> {
    if (next !== null && next.revision !== current.revision + 1)
      throw stateCorrupt('revision transition')
    return await records.compare(key, current.revision, next)
  }

  async issueCallUploadCapability(
    input: IssueCallUploadCapabilityInput,
  ): Promise<IssuedCallUploadCapability> {
    const now = this.nowIso()
    const expiresAt = normalizeTimestamp(input.expiresAt, 'expiresAt')
    if (Date.parse(expiresAt) <= Date.parse(now)) {
      throw new TBError('invalid_argument', 'call capability expiresAt 必须在未来')
    }
    const owner = requireOwner(input.owner)
    const producer = requireOwner(input.producer, 'producer')
    const callId = requireOwner(input.callId, 'callId')
    const maxObjects = requirePositiveInt(input.maxObjects, 'maxObjects')
    const maxBytes = requirePositiveInt(input.maxBytes, 'maxBytes')
    const maxObjectBytes = Math.min(
      requirePositiveInt(input.maxObjectBytes, 'maxObjectBytes'),
      maxBytes,
      this.maxObjectBytes,
    )
    if (!Array.isArray(input.allowedContentTypes) || input.allowedContentTypes.length === 0) {
      throw new TBError('invalid_argument', 'allowedContentTypes 不能为空')
    }
    const allowedContentTypes = input.allowedContentTypes.map(normalizeContentTypePattern)
    const id = this.randomId()
    const token = await this.tokenFor('call', id)
    const capability: CallUploadCapability = {
      signingKeyId: this.tokenKeyring.activeKeyId,
      id,
      revision: 1,
      tokenHash: await sha256Hex(token),
      status: 'active',
      owner,
      producer,
      callId,
      expiresAt,
      maxObjects,
      maxBytes,
      maxObjectBytes,
      allowedContentTypes,
      reservations: [],
      reservedBytes: 0,
      createdAt: now,
    }
    if (!await this.repository.callCapabilities.compare(id, null, capability)) {
      throw new TBError('conflict', 'call capability id 冲突')
    }
    return { capability: omit(capability, 'tokenHash'), token }
  }

  async verifyCallUploadCapability(token: string): Promise<CallUploadCapability> {
    const id = this.tokenId(token, 'call')
    const raw = await this.repository.callCapabilities.get(id)
    if (raw === null) throw new TBError('permission_denied', 'call upload capability 无效')
    const capability = parseCallCapability(raw)
    if (!Object.hasOwn(this.tokenKeyring.keys, capability.signingKeyId)) throw new TBError('permission_denied', 'Store capability signing key 已撤销')
    await this.assertTokenHash(token, capability.tokenHash, 'call upload capability 无效')
    if (Date.parse(capability.expiresAt) <= Date.parse(this.nowIso())) {
      await this.expireCallCapability(capability)
      throw new TBError('permission_denied', 'call upload capability 已过期')
    }
    if (capability.status === 'revoked' || capability.status === 'expired') {
      throw new TBError('permission_denied', 'call upload capability 已失效')
    }
    return capability
  }

  async revokeCallUploadCapability(token: string): Promise<void> {
    const id = this.tokenId(token, 'call')
    for (let attempt = 0; attempt < MAX_REVISION_ATTEMPTS; attempt++) {
      const raw = await this.repository.callCapabilities.get(id)
      if (raw === null) throw new TBError('permission_denied', 'call upload capability 无效')
      const capability = parseCallCapability(raw)
      await this.assertTokenHash(token, capability.tokenHash, 'call upload capability 无效')
      if (capability.status === 'revoked') return
      const next: CallUploadCapability = {
        ...capability,
        status: 'revoked',
        terminalAt: this.nowIso(),
        revision: capability.revision + 1,
      }
      if (await this.compareRecord(this.repository.callCapabilities, capability.id, capability, next)) {
        return
      }
    }
    throw new TBError('conflict', 'call capability 并发更新冲突')
  }

  async beginUpload(
    input: StoreUploadInput,
    identity: { owner: OwnerRef, producer?: OwnerRef },
  ): Promise<StoreUploadStart> {
    const owner = requireOwner(identity.owner)
    const producer = requireOwner(identity.producer ?? identity.owner, 'producer')
    return this.beginNormalized(normalizeUploadInput(input), { owner, producer })
  }

  async beginCallUpload(input: StoreUploadInput, capabilityToken: string): Promise<StoreUploadStart> {
    const capability = await this.verifyCallUploadCapability(capabilityToken)
    return this.beginNormalized(normalizeUploadInput(input), {
      owner: capability.owner,
      producer: capability.producer,
      originCallId: capability.callId,
      callCapabilityToken: capabilityToken,
    })
  }

  async verifyUploadToken(token: string): Promise<UploadSession> {
    const id = this.tokenId(token, 'upload')
    const raw = await this.repository.uploads.get(id)
    if (raw === null) throw new TBError('permission_denied', 'upload capability 无效')
    const session = parseSession(raw)
    if (!Object.hasOwn(this.tokenKeyring.keys, session.signingKeyId)) throw new TBError('permission_denied', 'Store capability signing key 已撤销')
    if (session.revokedAt !== undefined) throw new TBError('permission_denied', 'upload capability 已撤销')
    await this.assertTokenHash(token, session.capabilityHash, 'upload capability 无效')
    if (Date.parse(session.expiresAt) <= Date.parse(this.nowIso())) {
      if (session.status !== 'completed') await this.expireUpload(session)
      throw new TBError('permission_denied', 'upload capability 已过期')
    }
    if (session.status === 'aborted' || session.status === 'expired' || session.status === 'failed') {
      throw new TBError('permission_denied', 'upload capability 已失效')
    }
    return session
  }

  /** relay PUT 成功即在同一调用内把对象推进 ready；后续 complete 仅作幂等确认。 */
  async commitRelayUpload(input: RelayCommitInput): Promise<StoreObjectDescriptor> {
    const session = await this.verifyUploadToken(input.uploadToken)
    if (session.status === 'completed') return descriptorOf(await this.requireObject(session.objectId))
    if (session.transport !== 'relay') {
      throw new TBError('invalid_argument', '该 upload session 不是 relay transport')
    }
    const object = await this.requireObject(session.objectId)
    if (object.status === 'ready') {
      return descriptorOf(object)
    }
    if (object.status !== 'pending') {
      throw new TBError('conflict', `对象状态不允许上传:${object.status}`)
    }

    let meta: ObjectMeta
    try {
      meta = await (await this.backends.resolveBackend(object.backendId)).put(object.driverKey, this.boundedBody(input.body, session.maxBytes), {
        contentType: object.contentType,
        ifNoneMatch: '*',
      })
    } catch (error) {
      if (isTBError(error) && error.code === 'conflict') {
        const existing = await (await this.backends.resolveBackend(object.backendId)).head(object.driverKey)
        if (existing === null) throw error
        meta = existing
      } else {
        if (isTBError(error) && error.code === 'rate_limited') {
          await (await this.backends.resolveBackend(object.backendId)).delete(object.driverKey)
          await this.failUpload(session, object)
        }
        throw error
      }
    }
    try {
      this.assertObserved(session, meta)
    } catch (error) {
      await (await this.backends.resolveBackend(object.backendId)).delete(object.driverKey)
      await this.failUpload(session, object)
      throw error
    }
    return this.markReady(session, meta)
  }

  /** 普通管理面 complete：只接受稳定 owner，不接受 capability body 字段。 */
  async completeUpload(uploadId: string, actor: OwnerRef): Promise<StoreObjectDescriptor> {
    const { session, object } = await this.authorizeOwnerUploadMutation(uploadId, actor)
    return this.completeAuthorizedUpload(session, object)
  }

  /** capability-only complete：宿主从 Authorization header 取 token 后调用。 */
  async completeUploadWithToken(
    uploadId: string,
    uploadToken: string,
  ): Promise<StoreObjectDescriptor> {
    const session = await this.verifyUploadToken(uploadToken)
    if (session.id !== uploadId) {
      throw new TBError('permission_denied', 'upload capability 与 session 不匹配')
    }
    return this.completeAuthorizedUpload(session, await this.requireObject(session.objectId))
  }

  private async completeAuthorizedUpload(
    session: UploadSession,
    object: StoreObject,
  ): Promise<StoreObjectDescriptor> {
    if (session.status === 'completed' || object.status === 'ready') {
      if (object.status !== 'ready') return descriptorOf(await this.requireObject(object.id))
      return descriptorOf(object)
    }
    if (Date.parse(session.expiresAt) <= Date.parse(this.nowIso())) {
      await this.expireUpload(session)
      throw new TBError('conflict', 'upload session 已过期')
    }
    if (session.transport !== 'presigned-put') {
      throw new TBError('conflict', 'relay upload 尚未成功提交字节')
    }
    if (object.status !== 'pending') {
      throw new TBError('conflict', `对象状态不允许 complete:${object.status}`)
    }
    const meta = await (await this.backends.resolveBackend(object.backendId)).head(object.driverKey)
    if (meta === null) throw new TBError('conflict', '直传对象尚不存在')
    try {
      this.assertObserved(session, meta)
    } catch (error) {
      await (await this.backends.resolveBackend(object.backendId)).delete(object.driverKey)
      await this.failUpload(session, object)
      throw error
    }
    return this.markReady(session, meta)
  }

  /** 普通管理面 abort：owner 路径。 */
  async abortUpload(uploadId: string, actor: OwnerRef): Promise<{ ok: true }> {
    const { object, session } = await this.authorizeOwnerUploadMutation(uploadId, actor)
    return this.abortAuthorizedUpload(session, object)
  }

  /** capability-only abort：token 只应来自 Authorization header。 */
  async abortUploadWithToken(uploadId: string, uploadToken: string): Promise<{ ok: true }> {
    const session = await this.verifyUploadToken(uploadToken)
    if (session.id !== uploadId) {
      throw new TBError('permission_denied', 'upload capability 与 session 不匹配')
    }
    return this.abortAuthorizedUpload(session, await this.requireObject(session.objectId))
  }

  private async abortAuthorizedUpload(
    sessionInput: UploadSession,
    objectInput: StoreObject,
  ): Promise<{ ok: true }> {
    const object = await this.terminateUpload(sessionInput, objectInput, 'aborted')
    if (object.status === 'ready') throw new TBError('conflict', 'ready 对象不能 abort')
    await (await this.backends.resolveBackend(object.backendId)).delete(object.driverKey)
    await this.markBytesDeleted(object.id, object.driverKey)
    return { ok: true }
  }

  async stat(uri: string, access: StoreReadAccess): Promise<StoreObjectDescriptor> {
    const object = await this.authorizeReadyObject(uri, access)
    return descriptorOf(object)
  }

  /** 宿主 read callback 在拿到此结果后签发 relay/presigned GET；core 不构造网络 URL。 */
  async authorizeRead(uri: string, access: StoreReadAccess): Promise<StoreObject> {
    return this.authorizeReadyObject(uri, access)
  }

  /** share token 由宿主从 header 取出，不进入普通 builtin arguments。 */
  async authorizeSharedRead(uri: string, shareToken: string): Promise<StoreObject> {
    await this.verifyShareToken(shareToken, uri)
    const object = await this.requireObject(parseStoreUri(uri).objectId)
    if (object.status !== 'ready') throw new TBError('not_found', 'Store 对象不存在')
    return object
  }

  async list(owner: OwnerRef, opts: StoreListOptions = {}): Promise<StoreListPage> {
    const wantedOwner = requireOwner(owner)
    const limit = Math.min(Math.max(1, opts.limit ?? LIST_LIMIT_DEFAULT), LIST_LIMIT_MAX)
    const page = await this.repository.listReadyObjects(wantedOwner, { ...opts, limit })
    return { items: page.items.map(value => descriptorOf(parseObject(value))),
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }) }
  }

  async delete(uri: string, actor: { admin?: boolean, owner: OwnerRef }): Promise<{ ok: true }> {
    const { objectId } = parseStoreUri(uri)
    for (let attempt = 0; attempt < MAX_REVISION_ATTEMPTS; attempt++) {
      const object = await this.requireObject(objectId)
      if (!actor.admin && object.owner !== actor.owner) {
        throw new TBError('not_found', 'Store 对象不存在')
      }
      if (object.status === 'deleted') return { ok: true }
      const next: StoreObject = {
        ...object,
        status: 'deleted',
        updatedAt: this.nowIso(),
        revision: object.revision + 1,
      }
      if (!await this.compareRecord(this.repository.objects, object.id, object, next)) continue
      await (await this.backends.resolveBackend(object.backendId)).delete(object.driverKey)
      await this.markBytesDeleted(object.id, object.driverKey)
      return { ok: true }
    }
    throw new TBError('conflict', 'Store 对象并发删除冲突')
  }

  async share(uri: string, actor: OwnerRef, ttlSec = this.shareTtlSec): Promise<StoreShareResult> {
    const owner = requireOwner(actor)
    const object = await this.authorizeReadyObject(uri, { owner })
    const ttl = requireCapabilityTtl(ttlSec, 'ttlSec')
    if (ttl > this.shareTtlSec) {
      throw new TBError('invalid_argument', `ttlSec 不能超过 ${this.shareTtlSec}`)
    }
    const now = this.nowIso()
    const id = this.randomId()
    const token = await this.tokenFor('share', id)
    const grant: ShareGrant = {
      signingKeyId: this.tokenKeyring.activeKeyId,
      id,
      objectId: object.id,
      tokenHash: await sha256Hex(token),
      status: 'active',
      createdBy: owner,
      createdAt: now,
      expiresAt: this.afterSeconds(now, ttl),
      revision: 1,
    }
    if (!await this.repository.shares.compare(id, null, grant)) {
      throw new TBError('conflict', 'share id 冲突')
    }
    return { shareId: id, token, uri: storeUri(object.id), expiresAt: grant.expiresAt }
  }

  async verifyShareToken(token: string, expectedUri?: string): Promise<ShareGrant> {
    const id = this.tokenId(token, 'share')
    const raw = await this.repository.shares.get(id)
    if (raw === null) throw new TBError('permission_denied', 'share capability 无效')
    const grant = parseShare(raw)
    if (!Object.hasOwn(this.tokenKeyring.keys, grant.signingKeyId)) throw new TBError('permission_denied', 'Store capability signing key 已撤销')
    await this.assertTokenHash(token, grant.tokenHash, 'share capability 无效')
    if (expectedUri !== undefined && parseStoreUri(expectedUri).objectId !== grant.objectId) {
      throw new TBError('permission_denied', 'share capability 与对象不匹配')
    }
    if (Date.parse(grant.expiresAt) <= Date.parse(this.nowIso())) {
      await this.expireShare(grant)
      throw new TBError('permission_denied', 'share capability 已过期')
    }
    if (grant.status !== 'active') {
      throw new TBError('permission_denied', 'share capability 已失效')
    }
    return grant
  }

  async revokeShare(shareId: string, actor: OwnerRef): Promise<{ ok: true }> {
    const owner = requireOwner(actor)
    for (let attempt = 0; attempt < MAX_REVISION_ATTEMPTS; attempt++) {
      const raw = await this.repository.shares.get(shareId)
      if (raw === null) throw new TBError('not_found', 'share grant 不存在')
      const grant = parseShare(raw)
      const object = await this.requireObject(grant.objectId)
      if (object.owner !== owner) throw new TBError('not_found', 'share grant 不存在')
      if (grant.status === 'revoked') return { ok: true }
      const next: ShareGrant = {
        ...grant,
        status: 'revoked',
        terminalAt: this.nowIso(),
        revision: grant.revision + 1,
      }
      if (await this.compareRecord(this.repository.shares, grant.id, grant, next)) {
        return { ok: true }
      }
    }
    throw new TBError('conflict', 'share grant 并发撤销冲突')
  }

  /**
   * 宿主定时器/Cron 调用的幂等清理步。终态记录先保留一个 capability TTL 窗口，
   * 再以版本条件物理删除；无 metadata 的 driver 对象可能属于 Context，绝不猜测为 orphan。
   * 返回 cursor 时宿主必须续调，直到 cursor 缺省。
   */
  async cleanup(opts: StoreCleanupOptions = {}): Promise<StoreCleanupResult> {
    const pageLimit = Math.min(Math.max(1, opts.limit ?? LIST_LIMIT_MAX), LIST_LIMIT_MAX)
    const result: StoreCleanupResult = {
      expiredUploads: 0,
      abandonedObjects: 0,
      deletedBytes: 0,
      expiredCallCapabilities: 0,
      expiredIdempotencyBindings: 0,
      expiredShares: 0,
    }
    const now = this.nowIso()
    const nowMs = Date.parse(now)

    const uploads = opts.cursors?.uploads === null
      ? { items: [] }
      : await this.repository.uploads.list({
          limit: pageLimit,
          ...(opts.cursors?.uploads !== undefined ? { cursor: opts.cursors.uploads } : {}),
        })
    for (const item of uploads.items) {
      let session = parseSession(item.value)
      if (session.status === 'created' && Date.parse(session.expiresAt) <= nowMs) {
        await this.expireUpload(session)
        const currentRaw = await this.repository.uploads.get(item.key)
        if (currentRaw === null) continue
        session = parseSession(currentRaw)
        // expire 事务输给并发 complete 时 current 是 completed，不能误报或回收。
        if (session.status === 'expired') result.expiredUploads++
      }
      if (
        this.uploadSessionIsTerminal(session)
        && this.retentionElapsed(this.uploadSessionTerminalAt(session), this.uploadTtlSec, nowMs)
      ) {
        await this.compareRecord(this.repository.uploads, item.key, session, null)
      }
    }

    const shares = opts.cursors?.shares === null
      ? { items: [] }
      : await this.repository.shares.list({
          limit: pageLimit,
          ...(opts.cursors?.shares !== undefined ? { cursor: opts.cursors.shares } : {}),
        })
    for (const item of shares.items) {
      let grant = parseShare(item.value)
      if (grant.status === 'active' && Date.parse(grant.expiresAt) <= nowMs) {
        await this.expireShare(grant)
        const currentRaw = await this.repository.shares.get(item.key)
        if (currentRaw === null) continue
        grant = parseShare(currentRaw)
        if (grant.status === 'expired') result.expiredShares++
      }
      if (
        grant.status !== 'active'
        && this.retentionElapsed(grant.terminalAt ?? grant.expiresAt, this.shareTtlSec, nowMs)
      ) {
        await this.compareRecord(this.repository.shares, item.key, grant, null)
      }
    }

    const capabilities = opts.cursors?.callCapabilities === null
      ? { items: [] }
      : await this.repository.callCapabilities.list({
          limit: pageLimit,
          ...(opts.cursors?.callCapabilities !== undefined
            ? { cursor: opts.cursors.callCapabilities }
            : {}),
        })
    for (const item of capabilities.items) {
      let capability = parseCallCapability(item.value)
      if (
        (capability.status === 'active' || capability.status === 'exhausted')
        && Date.parse(capability.expiresAt) <= nowMs
      ) {
        await this.expireCallCapability(capability)
        const currentRaw = await this.repository.callCapabilities.get(item.key)
        if (currentRaw === null) continue
        capability = parseCallCapability(currentRaw)
        if (capability.status === 'expired') result.expiredCallCapabilities++
      }
      if (
        (capability.status === 'expired' || capability.status === 'revoked')
        && this.retentionElapsed(
          capability.terminalAt ?? capability.expiresAt,
          this.uploadTtlSec,
          nowMs,
        )
      ) {
        await this.compareRecord(this.repository.callCapabilities, item.key, capability, null)
      }
    }

    const idempotencyBindings = opts.cursors?.idempotencyBindings === null
      ? { items: [] }
      : await this.repository.idempotencyBindings.list({
          limit: pageLimit,
          ...(opts.cursors?.idempotencyBindings !== undefined
            ? { cursor: opts.cursors.idempotencyBindings }
            : {}),
        })
    for (const item of idempotencyBindings.items) {
      const binding = parseIdempotencyBinding(item.value)
      if (Date.parse(binding.expiresAt) > nowMs) continue
      if (await this.compareRecord(this.repository.idempotencyBindings, item.key, binding, null)) {
        result.expiredIdempotencyBindings++
      }
    }

    const objectRecords = opts.cursors?.objects === null
      ? { items: [] }
      : await this.repository.objects.list({
          limit: pageLimit,
          ...(opts.cursors?.objects !== undefined ? { cursor: opts.cursors.objects } : {}),
        })
    for (const item of objectRecords.items) {
      let object = parseObject(item.value)
      if (object.status === 'ready' && object.expiresAt !== undefined
        && Date.parse(object.expiresAt) <= nowMs) {
        const deleted: StoreObject = {
          ...object,
          status: 'deleted',
          updatedAt: now,
          revision: object.revision + 1,
        }
        if (await this.compareRecord(this.repository.objects, object.id, object, deleted)) {
          object = deleted
        } else {
          const currentRaw = await this.repository.objects.get(item.key)
          if (currentRaw === null) continue
          object = parseObject(currentRaw)
        }
      } else if (
        object.status === 'pending'
        && Date.parse(object.updatedAt) + this.uploadTtlSec * 1000 <= nowMs
      ) {
        const sessionRaw = await this.repository.uploads.get(object.uploadId)
        const session = sessionRaw === null ? undefined : parseSession(sessionRaw)
        const uploadEnded = session === undefined
          || session.status !== 'created'
          || Date.parse(session.expiresAt) <= nowMs
        if (uploadEnded) {
          const abandoned: StoreObject = {
            ...object,
            status: 'abandoned',
            updatedAt: now,
            revision: object.revision + 1,
          }
          if (await this.compareRecord(this.repository.objects, object.id, object, abandoned)) {
            object = abandoned
            result.abandonedObjects++
          } else {
            const currentRaw = await this.repository.objects.get(item.key)
            if (currentRaw === null) continue
            object = parseObject(currentRaw)
          }
        }
      }
      if (this.objectIsTerminal(object) && object.bytesDeletedAt === undefined) {
        await (await this.backends.resolveBackend(object.backendId)).delete(object.driverKey)
        result.deletedBytes++
        await this.markBytesDeleted(object.id, object.driverKey)
        const currentRaw = await this.repository.objects.get(item.key)
        if (currentRaw === null) continue
        object = parseObject(currentRaw)
      }
      if (
        this.objectIsTerminal(object)
        && object.bytesDeletedAt !== undefined
        && this.retentionElapsed(object.bytesDeletedAt, this.uploadTtlSec, nowMs)
      ) {
        await this.compareRecord(this.repository.objects, item.key, object, null)
      }
    }

    const cursors: StoreCleanupCursors = {
      uploads: uploads.cursor ?? null,
      shares: shares.cursor ?? null,
      callCapabilities: capabilities.cursor ?? null,
      idempotencyBindings: idempotencyBindings.cursor ?? null,
      objects: objectRecords.cursor ?? null,
    }
    return Object.values(cursors).some(cursor => cursor !== null) ? { ...result, cursors } : result
  }

  private async beginNormalized(
    input: NormalizedUploadInput,
    identity: UploadIdentity,
  ): Promise<StoreUploadStart> {
    const now = this.nowIso()
    const domain = identity.originCallId === undefined ? 'owner' : 'call'
    const binding: IdempotencyBinding = {
      owner: identity.owner, producer: identity.producer, domain,
      objectId: this.randomId(), uploadId: this.randomId(),
      fingerprint: await sha256Hex(JSON.stringify([input.contentType, input.filename ?? null,
        input.size ?? null, input.checksum ?? null])),
      createdAt: now, expiresAt: this.afterSeconds(now, this.uploadTtlSec), revision: 1,
      ...(identity.originCallId !== undefined ? { originCallId: identity.originCallId } : {}),
    }
    const bindingId = input.idempotencyKey === undefined
      ? undefined
      : [
          await sha256Hex(identity.owner), domain,
          await sha256Hex(JSON.stringify([domain, ...(domain === 'call' ? [identity.producer, identity.originCallId] : [])])),
          await sha256Hex(input.idempotencyKey),
        ].join(':')
    if (bindingId !== undefined) {
      const previousRaw = await this.repository.idempotencyBindings.get(bindingId)
      if (previousRaw !== null) {
        const previous = parseIdempotencyBinding(previousRaw)
        assertUploadBinding(previous, binding, now)
        return this.startFor(await this.requireSession(previous.uploadId))
      }
    }
    if (input.size !== undefined && input.size > this.maxObjectBytes) {
      throw new TBError('rate_limited', `对象超过部署上限 ${this.maxObjectBytes} bytes`)
    }
    const capability = identity.callCapabilityToken === undefined
      ? undefined
      : {
          id: this.tokenId(identity.callCapabilityToken, 'call'), tokenHash: await sha256Hex(identity.callCapabilityToken),
        }
    const uploadToken = await this.tokenFor('upload', binding.uploadId)
    for (let attempt = 0; attempt < MAX_REVISION_ATTEMPTS; attempt++) {
      const backend = await this.backends.defaultBackend()
      const driverKey = this.driverKey(binding.objectId)
      let transport: UploadSession['transport'] = 'relay'
      let maxBytes = this.relayMaxBytes
      let signedRequest: StoreUploadStart['signedRequest']
      // Signing is outside the DB transaction. beginUpload rechecks the active backend identity.
      if (input.size !== undefined && backend.objects.presignPutExact !== undefined) {
        try {
          signedRequest = await backend.objects.presignPutExact(driverKey, this.uploadTtlSec, {
            contentType: input.contentType, contentLength: input.size, ifNoneMatch: '*',
          })
          transport = 'presigned-put'
          maxBytes = this.maxObjectBytes
        } catch { /* A backend without an exact signer uses bounded relay. */ }
      }
      if (input.size !== undefined && input.size > maxBytes) {
        throw new TBError('rate_limited', `对象超过本次上传上限 ${maxBytes} bytes`)
      }
      const object: StoreObject = {
        id: binding.objectId, backendId: backend.id, store: DEFAULT_STORE_NAME, driverKey,
        uploadId: binding.uploadId, status: 'pending', owner: binding.owner, producer: binding.producer,
        contentType: input.contentType, createdAt: now, updatedAt: now, revision: 1,
        ...(input.filename !== undefined ? { filename: input.filename } : {}),
        ...(input.size !== undefined ? { expectedSize: input.size } : {}),
        ...(input.checksum !== undefined ? { expectedChecksum: input.checksum } : {}),
        ...(binding.originCallId !== undefined ? { originCallId: binding.originCallId } : {}),
      }
      const session: UploadSession = {
        signingKeyId: this.tokenKeyring.activeKeyId,
        id: binding.uploadId, backendId: backend.id, objectId: object.id, status: 'created',
        capabilityHash: await sha256Hex(uploadToken), transport, contentType: input.contentType,
        maxBytes, expiresAt: binding.expiresAt, createdAt: now, revision: 1,
        ...(input.size !== undefined ? { expectedSize: input.size } : {}),
        ...(input.checksum !== undefined ? { expectedChecksum: input.checksum } : {}),
      }
      const result = await this.repository.beginUpload({ object, session, now,
        ...(capability === undefined ? {} : { capability }),
        ...(bindingId === undefined ? {} : { binding: { id: bindingId, record: binding } }) })
      if (result === 'backend_changed') continue
      if (result.session.id === session.id) {
        return { uploadId: session.id, objectUri: storeUri(object.id), uploadToken, transport,
          expiresAt: session.expiresAt, maxBytes: result.session.maxBytes, alreadyCompleted: false,
          ...(signedRequest === undefined ? {} : { signedRequest }) }
      }
      return this.startFor(parseSession(result.session))
    }
    throw new TBError('conflict', '默认存储后端正在切换，请重试')
  }

  private async startFor(session: UploadSession): Promise<StoreUploadStart> {
    if (session.revokedAt !== undefined) throw new TBError('conflict', 'upload capability 已撤销')
    const object = await this.requireObject(session.objectId)
    const uploadToken = await this.tokenFor('upload', session.id, session.signingKeyId)
    // object 是生命周期权威；complete 已线性化但 session 收敛落后时仍返回同 descriptor。
    if (object.status === 'ready') {
      return {
        uploadId: session.id,
        objectUri: storeUri(object.id),
        uploadToken,
        transport: session.transport,
        expiresAt: session.expiresAt,
        maxBytes: session.maxBytes,
        alreadyCompleted: true,
        descriptor: descriptorOf(object),
      }
    }
    if (session.status !== 'created' || object.status !== 'pending') {
      throw new TBError('conflict', `upload session 不可恢复:${session.status}/${object.status}`)
    }
    const remainingMs = Date.parse(session.expiresAt) - Date.parse(this.nowIso())
    if (remainingMs <= 0) {
      await this.expireUpload(session)
      throw new TBError('conflict', 'upload session 已过期')
    }
    let signedRequest: StoreUploadStart['signedRequest']
    if (session.transport === 'presigned-put') {
      if (session.expectedSize === undefined) throw stateCorrupt('direct upload size')
      const objects = await this.backends.resolveBackend(object.backendId)
      if (objects.presignPutExact === undefined) {
        throw new TBError('unavailable', 'direct upload signer 当前不可用', { retryable: true })
      }
      signedRequest = await objects.presignPutExact(
        object.driverKey,
        Math.max(1, Math.floor(remainingMs / 1000)),
        {
          contentType: object.contentType,
          contentLength: session.expectedSize,
          ifNoneMatch: '*',
        },
      )
    }
    return {
      uploadId: session.id,
      objectUri: storeUri(object.id),
      uploadToken,
      transport: session.transport,
      expiresAt: session.expiresAt,
      maxBytes: session.maxBytes,
      alreadyCompleted: false,
      ...(signedRequest !== undefined ? { signedRequest } : {}),
    }
  }

  private uploadSessionIsTerminal(session: UploadSession): boolean {
    return session.status === 'completed'
      || session.status === 'aborted'
      || session.status === 'expired'
      || session.status === 'failed'
  }

  private uploadSessionTerminalAt(session: UploadSession): Timestamp {
    return session.terminalAt ?? session.completedAt ?? session.expiresAt
  }

  private objectIsTerminal(object: StoreObject): boolean {
    return object.status === 'failed'
      || object.status === 'abandoned'
      || object.status === 'deleted'
  }

  private retentionElapsed(timestamp: Timestamp, ttlSec: number, nowMs: number): boolean {
    return Date.parse(timestamp) + ttlSec * 1000 <= nowMs
  }

  /** driver DELETE 成功后持久化证据；后续 cleanup 只收 tombstone，不再重复外部 DELETE。 */
  private async markBytesDeleted(objectId: string, expectedDriverKey: string): Promise<void> {
    for (let attempt = 0; attempt < MAX_REVISION_ATTEMPTS; attempt++) {
      const raw = await this.repository.objects.get(objectId)
      if (raw === null) return
      const object = parseObject(raw)
      if (object.driverKey !== expectedDriverKey) throw stateCorrupt('object driver key')
      if (!this.objectIsTerminal(object) || object.bytesDeletedAt !== undefined) return
      const next: StoreObject = {
        ...object,
        bytesDeletedAt: this.nowIso(),
        revision: object.revision + 1,
      }
      if (await this.compareRecord(this.repository.objects, object.id, object, next)) return
    }
    throw new TBError('conflict', 'Store 对象字节删除状态并发更新冲突')
  }

  private async authorizeOwnerUploadMutation(
    uploadId: string,
    actorInput: OwnerRef,
  ): Promise<{ object: StoreObject, session: UploadSession }> {
    const session = await this.requireSession(uploadId)
    const object = await this.requireObject(session.objectId)
    const actor = requireOwner(actorInput, 'actor')
    if (actor !== object.owner) {
      throw new TBError('not_found', 'upload session 不存在')
    }
    return { session, object }
  }

  private async authorizeReadyObject(uri: string, access: StoreReadAccess): Promise<StoreObject> {
    const { objectId } = parseStoreUri(uri)
    const object = await this.requireObject(objectId)
    if (object.status !== 'ready') throw new TBError('not_found', 'Store 对象不存在')
    if (access.admin === true || (access.owner !== undefined && access.owner === object.owner)) {
      return object
    }
    throw new TBError('not_found', 'Store 对象不存在')
  }

  private assertObserved(session: UploadSession, meta: ObjectMeta): void {
    if (!Number.isSafeInteger(meta.size) || meta.size < 0 || meta.size > session.maxBytes) {
      throw new TBError('rate_limited', `上传对象超过 ${session.maxBytes} bytes`)
    }
    if (session.expectedSize !== undefined && meta.size !== session.expectedSize) {
      throw new TBError('conflict', '上传对象 size 与 create_upload 声明不一致')
    }
    if (session.expectedChecksum !== undefined) {
      const actual = meta.metadata?.['checksum-sha256']?.toLowerCase()
      if (actual !== undefined && actual !== session.expectedChecksum.value) {
        throw new TBError('conflict', '上传对象 checksum 不一致')
      }
    }
  }

  /**
   * relay 的权威流中限额。已知内存 body 先快速拒绝；未知流逐 chunk 累计，
   * 越界立刻 cancel。driver 必须在源流抛错时删除自己的临时文件。
   */
  private boundedBody(body: ObjectBody, maxBytes: number): ObjectBody {
    let knownBytes: number | undefined
    if (typeof body === 'string') knownBytes = new TextEncoder().encode(body).byteLength
    else if (body instanceof Uint8Array) knownBytes = body.byteLength
    else if (body instanceof ArrayBuffer) knownBytes = body.byteLength
    if (knownBytes !== undefined) {
      if (knownBytes > maxBytes) {
        throw new TBError('rate_limited', `上传对象超过 ${maxBytes} bytes`)
      }
      return body
    }

    const source = body as ObjectBodyStream
    const bounded: ObjectBodyStream = {
      async cancel(reason?: unknown): Promise<void> {
        await source.cancel?.(reason)
      },
      getReader() {
        const reader = source.getReader()
        let consumed = 0
        return {
          async read() {
            const chunk = await reader.read()
            if (!chunk.done && chunk.value !== undefined) {
              consumed += chunk.value.byteLength
              if (consumed > maxBytes) {
                try {
                  if (reader.cancel !== undefined) await reader.cancel('Store upload size limit')
                  else await source.cancel?.('Store upload size limit')
                } catch {
                  // 限额错误是权威结果；取消失败由 driver 临时文件清理兜底。
                }
                throw new TBError('rate_limited', `上传对象超过 ${maxBytes} bytes`)
              }
            }
            return chunk
          },
          releaseLock() {
            reader.releaseLock()
          },
          async cancel(reason?: unknown): Promise<void> {
            if (reader.cancel !== undefined) await reader.cancel(reason)
            else await source.cancel?.(reason)
          },
        }
      },
    }
    return bounded
  }

  private async markReady(
    sessionInput: UploadSession,
    meta: ObjectMeta,
  ): Promise<StoreObjectDescriptor> {
    const actualChecksum = sessionInput.expectedChecksum !== undefined
      && meta.metadata?.['checksum-sha256']?.toLowerCase() === sessionInput.expectedChecksum.value
      ? sessionInput.expectedChecksum
      : undefined
    for (let attempt = 0; attempt < MAX_REVISION_ATTEMPTS; attempt++) {
      const object = await this.requireObject(sessionInput.objectId)
      if (object.status === 'ready') {
        return descriptorOf(object)
      }
      if (object.status !== 'pending') {
        await (await this.backends.resolveBackend(object.backendId)).delete(object.driverKey)
        await this.markBytesDeleted(object.id, object.driverKey)
        const detail = attempt === 0 ? '状态不允许 ready' : '并发状态冲突'
        throw new TBError('conflict', `对象${detail}:${object.status}`)
      }
      const now = this.nowIso()
      const ready: StoreObject = {
        ...object,
        status: 'ready',
        size: meta.size,
        etag: meta.etag,
        readyAt: now,
        updatedAt: now,
        revision: object.revision + 1,
        ...(actualChecksum !== undefined ? { checksum: actualChecksum } : {}),
      }
      const session = await this.requireSession(sessionInput.id)
      const result = await this.repository.finishUpload(ready, {
        ...session, status: 'completed', completedAt: now, terminalAt: now,
        revision: session.revision + 1,
      })
      if (result === null) continue
      return descriptorOf(parseObject(result))
    }
    // 事务可能因版本竞争或后端暂态失败返回空；没有终态 winner 时字节仍可供重试 complete。
    throw new TBError('conflict', '对象并发状态冲突:pending')
  }

  private async terminateUpload(
    sessionInput: UploadSession,
    objectInput: StoreObject,
    status: 'aborted' | 'expired' | 'failed',
  ): Promise<StoreObject> {
    let object = objectInput
    let session = sessionInput
    for (let attempt = 0; attempt < MAX_REVISION_ATTEMPTS; attempt++) {
      if (object.status === 'ready' || session.status !== 'created') return object
      const now = this.nowIso()
      const nextObject: StoreObject = { ...object,
        status: status === 'failed' ? 'failed' : 'abandoned', updatedAt: now,
        revision: object.revision + 1 }
      const nextSession: UploadSession = { ...session, status, terminalAt: now, revision: session.revision + 1 }
      if (await this.repository.terminateUpload(nextObject, nextSession)) return nextObject
      object = await this.requireObject(object.id)
      session = await this.requireSession(session.id)
    }
    throw new TBError('conflict', 'upload 终态转换并发冲突')
  }

  private async failUpload(session: UploadSession, object: StoreObject): Promise<void> {
    await this.terminateUpload(session, object, 'failed')
    await this.markBytesDeleted(object.id, object.driverKey)
  }

  private async expireUpload(session: UploadSession): Promise<void> {
    await this.terminateUpload(session, await this.requireObject(session.objectId), 'expired')
  }

  private async expireCallCapability(capability: CallUploadCapability): Promise<void> {
    if (capability.status === 'expired' || capability.status === 'revoked') return
    const next: CallUploadCapability = {
      ...capability,
      status: 'expired',
      terminalAt: this.nowIso(),
      revision: capability.revision + 1,
    }
    await this.compareRecord(this.repository.callCapabilities, capability.id, capability, next)
  }

  private async expireShare(grant: ShareGrant): Promise<void> {
    if (grant.status !== 'active') return
    const next: ShareGrant = {
      ...grant,
      status: 'expired',
      terminalAt: this.nowIso(),
      revision: grant.revision + 1,
    }
    await this.compareRecord(this.repository.shares, grant.id, grant, next)
  }

  private async requireObject(id: string): Promise<StoreObject> {
    const raw = await this.repository.objects.get(id)
    if (raw === null) throw new TBError('not_found', 'Store 对象不存在')
    return parseObject(raw)
  }

  private async requireSession(id: string): Promise<UploadSession> {
    const raw = await this.repository.uploads.get(id)
    if (raw === null) throw new TBError('not_found', 'upload session 不存在')
    return parseSession(raw)
  }

  private async assertTokenHash(token: string, expected: string, message: string): Promise<void> {
    if (!constantTimeEqual(await sha256Hex(token), expected)) {
      throw new TBError('permission_denied', message)
    }
  }

  private tokenId(token: unknown, domain: TokenDomain): string {
    if (typeof token !== 'string') throw new TBError('permission_denied', 'capability token 无效')
    const prefix = TOKEN_PREFIX[domain]
    const match = new RegExp(`^${prefix}_([A-Za-z0-9_-]{22,64})\\.([A-Za-z0-9_-]{43})$`).exec(token)
    if (match?.[1] === undefined) {
      throw new TBError('permission_denied', 'capability token 无效')
    }
    return match[1]
  }

  private async tokenFor(domain: TokenDomain, id: string, signingKeyId = this.tokenKeyring.activeKeyId): Promise<string> {
    const root = this.tokenKeyring.keys[signingKeyId]
    if (root === undefined) throw new TBError('unavailable', 'Store signing key is unavailable')
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(root),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`store:${domain}:${id}`))
    return `${TOKEN_PREFIX[domain]}_${id}.${base64urlEncode(new Uint8Array(signature))}`
  }

  private randomId(): string {
    return base64urlEncode(crypto.getRandomValues(new Uint8Array(18)))
  }

  private driverKey(objectId: string): string {
    return `${DEFAULT_STORE_DRIVER_KEY_ROOT}/${objectId.slice(0, 2)}/${objectId}`
  }

  private nowIso(): Timestamp {
    return normalizeTimestamp(this.now(), 'now')
  }

  private afterSeconds(now: Timestamp, seconds: number): Timestamp {
    return new Date(Date.parse(now) + seconds * 1000).toISOString()
  }
}
