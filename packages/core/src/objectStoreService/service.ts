import type {
  ObjectBody,
  ObjectBodyStream,
  ObjectMeta,
  ObjectStore,
} from '../context/objectStore'
import type { StateStore } from '../store'
import {
  type CallUploadCapability,
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
import {
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  type OwnerRef,
  type Timestamp,
} from '../types'
import { parseStoreUri, STORE_OBJECT_ID_RE, storeUri } from './uri'
import { normalizeExpiresAt, sha256Hex } from '../auth/sk'
import { base64urlEncode } from '../encoding/base64url'
import { TBError } from '../errors'
import { omit } from '../omit'

declare const crypto: {
  getRandomValues(array: Uint8Array): Uint8Array
  subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
    importKey(
      format: 'raw',
      keyData: Uint8Array,
      algorithm: { hash: string, name: 'HMAC' },
      extractable: false,
      usages: ['sign'],
    ): Promise<unknown>
    sign(algorithm: 'HMAC', key: unknown, data: Uint8Array): Promise<ArrayBuffer>
  }
}
declare class TextEncoder {
  encode(input?: string): Uint8Array
}

export const KEY_STORE_OBJECT = 'store:object:'
export const KEY_STORE_UPLOAD = 'store:upload:'
export const KEY_STORE_CALL_CAPABILITY = 'store:call-capability:'
export const KEY_STORE_SHARE = 'store:share:'
export const KEY_STORE_IDEMPOTENCY = 'store:idempotency:'

const UPLOAD_TTL_SEC_DEFAULT = 15 * 60
const SHARE_TTL_SEC_DEFAULT = 15 * 60
const MAX_OBJECT_BYTES_DEFAULT = 256 * 1024 * 1024
const MAX_CAS_ATTEMPTS = 32
const CAPABILITY_TTL_SEC_MAX = 7 * 24 * 60 * 60
const TOKEN_PREFIX = {
  call: 'tbc',
  share: 'tbs',
  upload: 'tbu',
} as const

type TokenDomain = keyof typeof TOKEN_PREFIX

interface IdempotencyBinding {
  createdAt: Timestamp
  expiresAt: Timestamp
  fingerprint: string
  objectId: string
  owner: OwnerRef
  revision: number
  uploadId: string
}

interface ResolvedIdempotencyBinding {
  binding: IdempotencyBinding
  created: boolean
  key?: string
}

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

function asRecord(value: unknown, kind: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw stateCorrupt(kind)
  }
  return value as Record<string, unknown>
}

function assertRevisioned(value: unknown, kind: string): Record<string, unknown> {
  const record = asRecord(value, kind)
  if (!Number.isInteger(record.revision) || (record.revision as number) < 1) {
    throw stateCorrupt(kind)
  }
  return record
}

function parseObject(value: unknown): StoreObject {
  const record = assertRevisioned(value, 'object')
  if (
    typeof record.id !== 'string'
    || record.store !== DEFAULT_STORE_NAME
    || typeof record.driverKey !== 'string'
    || typeof record.owner !== 'string'
    || typeof record.contentType !== 'string'
    || typeof record.uploadId !== 'string'
    || typeof record.status !== 'string'
  ) throw stateCorrupt('object')
  return value as StoreObject
}

function parseSession(value: unknown): UploadSession {
  const record = assertRevisioned(value, 'upload session')
  if (
    typeof record.id !== 'string'
    || typeof record.objectId !== 'string'
    || typeof record.capabilityHash !== 'string'
    || typeof record.status !== 'string'
  ) throw stateCorrupt('upload session')
  return value as UploadSession
}

function parseCallCapability(value: unknown): CallUploadCapability {
  const record = assertRevisioned(value, 'call capability')
  if (
    typeof record.id !== 'string'
    || typeof record.tokenHash !== 'string'
    || typeof record.owner !== 'string'
    || typeof record.producer !== 'string'
    || !Array.isArray(record.reservations)
  ) throw stateCorrupt('call capability')
  return value as CallUploadCapability
}

function parseShare(value: unknown): ShareGrant {
  const record = assertRevisioned(value, 'share grant')
  if (
    typeof record.id !== 'string'
    || typeof record.objectId !== 'string'
    || typeof record.tokenHash !== 'string'
    || typeof record.createdBy !== 'string'
  ) throw stateCorrupt('share grant')
  return value as ShareGrant
}

function parseIdempotencyBinding(value: unknown): IdempotencyBinding {
  const record = assertRevisioned(value, 'idempotency binding')
  if (
    typeof record.owner !== 'string'
    || typeof record.fingerprint !== 'string'
    || typeof record.objectId !== 'string'
    || typeof record.uploadId !== 'string'
  ) throw stateCorrupt('idempotency binding')
  return value as IdempotencyBinding
}

function requireOwner(owner: unknown, field = 'owner'): OwnerRef {
  if (
    typeof owner !== 'string'
    || owner.trim() === ''
    || owner.length > 255
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
    if (error instanceof TBError && error.code === 'invalid_argument') {
      throw new TBError('invalid_argument', `${field} 必须是带时区的 ISO 8601 timestamp`)
    }
    throw error
  }
}

function normalizeContentType(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.trim() === ''
    || value.length > 255
    || !value.includes('/')
    || /[\r\n\0]/.test(value)
  ) {
    throw new TBError('invalid_argument', 'contentType 不合法')
  }
  return value.trim().toLowerCase()
}

function normalizeChecksum(value: unknown): StoreChecksum | undefined {
  if (value === undefined) return undefined
  const record = asRecord(value, 'checksum')
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
  const contentType = normalizeContentType(input?.contentType)
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

function contentTypeAllowed(contentType: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = pattern.toLowerCase()
    if (normalized === '*/*') return true
    if (normalized.endsWith('/*')) return contentType.startsWith(normalized.slice(0, -1))
    return normalized === contentType
  })
}

function normalizeContentTypePattern(value: unknown): string {
  if (value === '*/*') return value
  if (typeof value === 'string' && value.endsWith('/*')) {
    const prefix = value.slice(0, -1)
    if (prefix.length > 1 && !/[\r\n\0]/.test(value)) return value.toLowerCase()
  }
  return normalizeContentType(value)
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
 * StateStore 保存权威元数据，ObjectStore 只保存字节。所有竞争状态转换都依赖
 * compareAndSwap；缺失 CAS 的自定义 StateStore 会在构造时 fail closed。
 */
export class StoreService {
  private readonly maxObjectBytes: number
  private readonly now: () => Timestamp
  private readonly relayMaxBytes: number
  private readonly shareTtlSec: number
  private readonly tokenSecret: string
  private readonly uploadTtlSec: number
  private readonly cas: NonNullable<StateStore['compareAndSwap']>

  constructor(
    private readonly state: StateStore,
    private readonly objects: ObjectStore,
    opts: StoreServiceOptions,
  ) {
    if (state.compareAndSwap === undefined) {
      throw new TBError('unavailable', 'StoreService 要求 StateStore.compareAndSwap', {
        retryable: false,
      })
    }
    if (typeof opts?.tokenSecret !== 'string' || opts.tokenSecret.length < 16) {
      throw new TBError('invalid_argument', 'Store tokenSecret 至少需要 16 个字符')
    }
    this.cas = state.compareAndSwap.bind(state)
    this.tokenSecret = opts.tokenSecret
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
    if (!await this.cas(`${KEY_STORE_CALL_CAPABILITY}${id}`, null, capability)) {
      throw new TBError('conflict', 'call capability id 冲突')
    }
    return { capability: omit(capability, 'tokenHash'), token }
  }

  async verifyCallUploadCapability(token: string): Promise<CallUploadCapability> {
    const id = this.tokenId(token, 'call')
    const raw = await this.state.get(`${KEY_STORE_CALL_CAPABILITY}${id}`)
    if (raw === null) throw new TBError('permission_denied', 'call upload capability 无效')
    const capability = parseCallCapability(raw)
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
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const raw = await this.state.get(`${KEY_STORE_CALL_CAPABILITY}${id}`)
      if (raw === null) throw new TBError('permission_denied', 'call upload capability 无效')
      const capability = parseCallCapability(raw)
      await this.assertTokenHash(token, capability.tokenHash, 'call upload capability 无效')
      if (capability.status === 'revoked') return
      const next: CallUploadCapability = {
        ...capability,
        status: 'revoked',
        revision: capability.revision + 1,
      }
      if (await this.cas(`${KEY_STORE_CALL_CAPABILITY}${capability.id}`, capability.revision, next)) {
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
    const raw = await this.state.get(`${KEY_STORE_UPLOAD}${id}`)
    if (raw === null) throw new TBError('permission_denied', 'upload capability 无效')
    const session = parseSession(raw)
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
    if (session.status === 'completed') return this.readyDescriptor(session.objectId)
    if (session.transport !== 'relay') {
      throw new TBError('invalid_argument', '该 upload session 不是 relay transport')
    }
    const object = await this.requireObject(session.objectId)
    if (object.status === 'ready') {
      await this.completeSessionBestEffort(session)
      return descriptorOf(object)
    }
    if (object.status !== 'pending') {
      throw new TBError('conflict', `对象状态不允许上传:${object.status}`)
    }

    let meta: ObjectMeta
    try {
      meta = await this.objects.put(object.driverKey, this.boundedBody(input.body, session.maxBytes), {
        contentType: object.contentType,
        ifNoneMatch: '*',
      })
    } catch (error) {
      if (error instanceof TBError && error.code === 'conflict') {
        const existing = await this.objects.head(object.driverKey)
        if (existing === null) throw error
        meta = existing
      } else {
        if (error instanceof TBError && error.code === 'rate_limited') {
          await this.objects.delete(object.driverKey)
          await this.failUpload(session, object)
        }
        throw error
      }
    }
    try {
      this.assertObserved(session, meta)
    } catch (error) {
      await this.objects.delete(object.driverKey)
      await this.failUpload(session, object)
      throw error
    }
    return this.markReady(session, object, meta)
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
      if (object.status !== 'ready') return this.readyDescriptor(object.id)
      await this.completeSessionBestEffort(session)
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
    const meta = await this.objects.head(object.driverKey)
    if (meta === null) throw new TBError('conflict', '直传对象尚不存在')
    try {
      this.assertObserved(session, meta)
    } catch (error) {
      await this.objects.delete(object.driverKey)
      await this.failUpload(session, object)
      throw error
    }
    return this.markReady(session, object, meta)
  }

  /** 普通管理面 abort：owner 路径。 */
  async abortUpload(uploadId: string, actor: OwnerRef): Promise<{ ok: true }> {
    const { object, session } = await this.authorizeOwnerUploadMutation(uploadId, actor)
    return this.abortAuthorizedUpload(session, object)
  }

  /** capability-only abort：token 只应来自 Authorization header。 */
  async abortUploadWithToken(uploadId: string, uploadToken: string): Promise<{ ok: true }> {
    const id = this.tokenId(uploadToken, 'upload')
    const session = await this.requireSession(id)
    await this.assertTokenHash(uploadToken, session.capabilityHash, 'upload capability 无效')
    if (session.id !== uploadId) {
      throw new TBError('permission_denied', 'upload capability 与 session 不匹配')
    }
    return this.abortAuthorizedUpload(session, await this.requireObject(session.objectId))
  }

  private async abortAuthorizedUpload(
    sessionInput: UploadSession,
    objectInput: StoreObject,
  ): Promise<{ ok: true }> {
    let object = objectInput
    let session = sessionInput
    if (object.status === 'ready' || session.status === 'completed') {
      throw new TBError('conflict', 'ready 对象不能 abort')
    }
    if (object.status === 'pending') {
      const next: StoreObject = {
        ...object,
        status: 'abandoned',
        updatedAt: this.nowIso(),
        revision: object.revision + 1,
      }
      if (await this.cas(`${KEY_STORE_OBJECT}${object.id}`, object.revision, next)) object = next
      else object = await this.requireObject(object.id)
    }
    if (object.status === 'ready') throw new TBError('conflict', 'ready 对象不能 abort')
    if (session.status === 'created') {
      const next: UploadSession = {
        ...session,
        status: 'aborted',
        revision: session.revision + 1,
      }
      if (await this.cas(`${KEY_STORE_UPLOAD}${session.id}`, session.revision, next)) session = next
      else session = await this.requireSession(session.id)
    }
    if (session.status === 'completed') throw new TBError('conflict', 'ready 对象不能 abort')
    await this.objects.delete(object.driverKey)
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
    const page = await this.state.list(KEY_STORE_OBJECT, {
      limit: Math.min(LIST_LIMIT_MAX, limit * 4),
      ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
    })
    const items: StoreObjectDescriptor[] = []
    for (let index = 0; index < page.items.length; index++) {
      const item = page.items[index]
      if (item === undefined) continue
      const object = parseObject(item.value)
      if (object.owner !== wantedOwner || object.status !== 'ready') continue
      items.push(descriptorOf(object))
      if (items.length >= limit) {
        const hasUnscanned = index < page.items.length - 1 || page.cursor !== undefined
        return hasUnscanned ? { items, cursor: item.key } : { items }
      }
    }
    return page.cursor !== undefined ? { items, cursor: page.cursor } : { items }
  }

  async delete(uri: string, actor: { admin?: boolean, owner: OwnerRef }): Promise<{ ok: true }> {
    const { objectId } = parseStoreUri(uri)
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
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
      if (!await this.cas(`${KEY_STORE_OBJECT}${object.id}`, object.revision, next)) continue
      await this.objects.delete(object.driverKey)
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
      id,
      objectId: object.id,
      tokenHash: await sha256Hex(token),
      status: 'active',
      createdBy: owner,
      createdAt: now,
      expiresAt: this.afterSeconds(now, ttl),
      revision: 1,
    }
    if (!await this.cas(`${KEY_STORE_SHARE}${id}`, null, grant)) {
      throw new TBError('conflict', 'share id 冲突')
    }
    return { shareId: id, token, uri: storeUri(object.id), expiresAt: grant.expiresAt }
  }

  async verifyShareToken(token: string, expectedUri?: string): Promise<ShareGrant> {
    const id = this.tokenId(token, 'share')
    const raw = await this.state.get(`${KEY_STORE_SHARE}${id}`)
    if (raw === null) throw new TBError('permission_denied', 'share capability 无效')
    const grant = parseShare(raw)
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
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const raw = await this.state.get(`${KEY_STORE_SHARE}${shareId}`)
      if (raw === null) throw new TBError('not_found', 'share grant 不存在')
      const grant = parseShare(raw)
      const object = await this.requireObject(grant.objectId)
      if (object.owner !== owner) throw new TBError('not_found', 'share grant 不存在')
      if (grant.status === 'revoked') return { ok: true }
      const next: ShareGrant = {
        ...grant,
        status: 'revoked',
        revision: grant.revision + 1,
      }
      if (await this.cas(`${KEY_STORE_SHARE}${grant.id}`, grant.revision, next)) {
        return { ok: true }
      }
    }
    throw new TBError('conflict', 'share grant 并发撤销冲突')
  }

  /**
   * 宿主定时器/Cron 调用的幂等清理步：过期权威记录、driver orphan 与可选 staging
   * hook 同轮处理。返回 cursor 时宿主必须续调，直到 cursor 缺省。
   */
  async cleanup(opts: StoreCleanupOptions = {}): Promise<StoreCleanupResult> {
    const pageLimit = Math.min(Math.max(1, opts.limit ?? LIST_LIMIT_MAX), LIST_LIMIT_MAX)
    const result: StoreCleanupResult = {
      expiredUploads: 0,
      abandonedObjects: 0,
      deletedBytes: 0,
      deletedOrphans: 0,
      deletedStaging: 0,
      expiredCallCapabilities: 0,
      expiredIdempotencyBindings: 0,
      expiredShares: 0,
    }
    const nowMs = Date.parse(this.nowIso())
    const olderThan = new Date(nowMs - this.uploadTtlSec * 1000).toISOString()
    if (this.objects.cleanupStaging !== undefined) {
      result.deletedStaging = await this.objects.cleanupStaging('store/v1/', olderThan)
    }

    const uploads = opts.cursors?.uploads === null
      ? { items: [] }
      : await this.state.list(KEY_STORE_UPLOAD, {
          limit: pageLimit,
          ...(opts.cursors?.uploads !== undefined ? { cursor: opts.cursors.uploads } : {}),
        })
    for (const item of uploads.items) {
      const session = parseSession(item.value)
      if (session.status !== 'created' || Date.parse(session.expiresAt) > nowMs) continue
      await this.expireUpload(session)
      const currentSession = await this.requireSession(session.id)
      if (currentSession.status !== 'expired') continue
      result.expiredUploads++
      const object = await this.requireObject(session.objectId)
      // expire CAS 可能输给并发 complete。ready/pending 都不能由旧 cleanup 观察删除；
      // pending 会在 object/driver 扫描中重新判定 session 后再收敛。
      if (object.status === 'abandoned') {
        result.abandonedObjects++
        await this.objects.delete(object.driverKey)
        result.deletedBytes++
      } else if (object.status === 'failed' || object.status === 'deleted') {
        await this.objects.delete(object.driverKey)
        result.deletedBytes++
      }
    }

    const shares = opts.cursors?.shares === null
      ? { items: [] }
      : await this.state.list(KEY_STORE_SHARE, {
          limit: pageLimit,
          ...(opts.cursors?.shares !== undefined ? { cursor: opts.cursors.shares } : {}),
        })
    for (const item of shares.items) {
      const grant = parseShare(item.value)
      if (grant.status !== 'active' || Date.parse(grant.expiresAt) > nowMs) continue
      await this.expireShare(grant)
      result.expiredShares++
    }

    const capabilities = opts.cursors?.callCapabilities === null
      ? { items: [] }
      : await this.state.list(KEY_STORE_CALL_CAPABILITY, {
          limit: pageLimit,
          ...(opts.cursors?.callCapabilities !== undefined
            ? { cursor: opts.cursors.callCapabilities }
            : {}),
        })
    for (const item of capabilities.items) {
      const capability = parseCallCapability(item.value)
      if (
        (capability.status !== 'active' && capability.status !== 'exhausted')
        || Date.parse(capability.expiresAt) > nowMs
      ) continue
      await this.expireCallCapability(capability)
      result.expiredCallCapabilities++
    }

    const idempotencyBindings = opts.cursors?.idempotencyBindings === null
      ? { items: [] }
      : await this.state.list(KEY_STORE_IDEMPOTENCY, {
          limit: pageLimit,
          ...(opts.cursors?.idempotencyBindings !== undefined
            ? { cursor: opts.cursors.idempotencyBindings }
            : {}),
        })
    for (const item of idempotencyBindings.items) {
      const binding = parseIdempotencyBinding(item.value)
      if (Date.parse(binding.expiresAt) > nowMs) continue
      if (await this.cas(item.key, binding.revision, null)) {
        result.expiredIdempotencyBindings++
      }
    }

    const objectRecords = opts.cursors?.objects === null
      ? { items: [] }
      : await this.state.list(KEY_STORE_OBJECT, {
          limit: pageLimit,
          ...(opts.cursors?.objects !== undefined ? { cursor: opts.cursors.objects } : {}),
        })
    for (const item of objectRecords.items) {
      const object = parseObject(item.value)
      if (object.status === 'ready' && object.expiresAt !== undefined
        && Date.parse(object.expiresAt) <= nowMs) {
        const deleted: StoreObject = {
          ...object,
          status: 'deleted',
          updatedAt: this.nowIso(),
          revision: object.revision + 1,
        }
        if (await this.cas(`${KEY_STORE_OBJECT}${object.id}`, object.revision, deleted)) {
          await this.objects.delete(object.driverKey)
          result.deletedBytes++
        }
      } else if (
        object.status === 'pending'
        && Date.parse(object.updatedAt) + this.uploadTtlSec * 1000 <= nowMs
      ) {
        const abandoned: StoreObject = {
          ...object,
          status: 'abandoned',
          updatedAt: this.nowIso(),
          revision: object.revision + 1,
        }
        if (await this.cas(`${KEY_STORE_OBJECT}${object.id}`, object.revision, abandoned)) {
          result.abandonedObjects++
          await this.objects.delete(object.driverKey)
          result.deletedBytes++
        }
      } else if (
        object.status === 'failed'
        || object.status === 'abandoned'
        || object.status === 'deleted'
      ) {
        await this.objects.delete(object.driverKey)
        result.deletedBytes++
      }
    }

    const driverObjects = opts.cursors?.driverObjects === null
      ? { items: [] }
      : await this.objects.list('store/v1/', {
          limit: pageLimit,
          ...(opts.cursors?.driverObjects !== undefined
            ? { cursor: opts.cursors.driverObjects }
            : {}),
        })
    for (const item of driverObjects.items) {
      if (!('key' in item)) continue
      const objectId = this.objectIdFromDriverKey(item.key)
      if (objectId === undefined) continue
      const raw = await this.state.get(`${KEY_STORE_OBJECT}${objectId}`)
      if (raw === null) {
        await this.objects.delete(item.key)
        result.deletedOrphans++
        continue
      }
      let object = parseObject(raw)
      if (object.status === 'ready') continue
      if (object.status === 'pending') {
        const sessionRaw = await this.state.get(`${KEY_STORE_UPLOAD}${object.uploadId}`)
        const session = sessionRaw === null ? undefined : parseSession(sessionRaw)
        const expired = session === undefined
          || session.status !== 'created'
          || Date.parse(session.expiresAt) <= nowMs
        if (!expired) continue
        const abandoned: StoreObject = {
          ...object,
          status: 'abandoned',
          updatedAt: this.nowIso(),
          revision: object.revision + 1,
        }
        if (!await this.cas(`${KEY_STORE_OBJECT}${object.id}`, object.revision, abandoned)) {
          object = await this.requireObject(object.id)
          if (object.status === 'ready' || object.status === 'pending') continue
        } else {
          object = abandoned
          result.abandonedObjects++
        }
      }
      if (
        object.status === 'failed'
        || object.status === 'abandoned'
        || object.status === 'deleted'
      ) {
        await this.objects.delete(item.key)
        result.deletedOrphans++
      }
    }
    const cursors: StoreCleanupCursors = {
      uploads: uploads.cursor ?? null,
      shares: shares.cursor ?? null,
      callCapabilities: capabilities.cursor ?? null,
      idempotencyBindings: idempotencyBindings.cursor ?? null,
      objects: objectRecords.cursor ?? null,
      driverObjects: driverObjects.cursor ?? null,
    }
    return Object.values(cursors).some(cursor => cursor !== null) ? { ...result, cursors } : result
  }

  private async beginNormalized(
    input: NormalizedUploadInput,
    identity: UploadIdentity,
  ): Promise<StoreUploadStart> {
    // 全局硬上限在创建 idempotency binding 前拒绝，非法声明不能占住 key。
    if (input.size !== undefined && input.size > this.maxObjectBytes) {
      throw new TBError('rate_limited', `对象超过部署上限 ${this.maxObjectBytes} bytes`)
    }
    const resolved = await this.resolveBinding(identity.owner, input)
    const binding = resolved.binding
    const existingRaw = await this.state.get(`${KEY_STORE_UPLOAD}${binding.uploadId}`)
    if (existingRaw !== null) {
      const existing = parseSession(existingRaw)
      if (existing.objectId !== binding.objectId) throw stateCorrupt('idempotent upload')
      return this.startFor(existing)
    }

    const now = this.nowIso()
    const driverKey = this.driverKey(binding.objectId)
    let transport: UploadSession['transport'] = 'relay'
    let effectiveMaxBytes = this.relayMaxBytes
    let signedRequest: StoreUploadStart['signedRequest']
    if (this.objects.presignPut !== undefined) {
      try {
        signedRequest = await this.objects.presignPut(driverKey, this.uploadTtlSec, {
          contentType: input.contentType,
          ifNoneMatch: '*',
        })
        transport = 'presigned-put'
        effectiveMaxBytes = this.maxObjectBytes
      } catch {
        // signer 临时不可用时，宿主仍可用 relay；effective body limit 由上层收紧 maxBytes。
      }
    }
    let maxBytes = effectiveMaxBytes
    if (identity.callCapabilityToken !== undefined) {
      try {
        maxBytes = await this.reserveCallCapability(
          identity.callCapabilityToken,
          binding.objectId,
          input,
          effectiveMaxBytes,
        )
      } catch (error) {
        await this.releaseFreshBinding(resolved)
        throw error
      }
    }
    if (input.size !== undefined && input.size > maxBytes) {
      await this.releaseFreshBinding(resolved)
      throw new TBError('rate_limited', `对象超过本次上传上限 ${maxBytes} bytes`)
    }
    const object: StoreObject = {
      id: binding.objectId,
      store: DEFAULT_STORE_NAME,
      driverKey,
      uploadId: binding.uploadId,
      status: 'pending',
      owner: identity.owner,
      producer: identity.producer,
      contentType: input.contentType,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      ...(input.filename !== undefined ? { filename: input.filename } : {}),
      ...(input.size !== undefined ? { expectedSize: input.size } : {}),
      ...(input.checksum !== undefined ? { expectedChecksum: input.checksum } : {}),
      ...(identity.originCallId !== undefined ? { originCallId: identity.originCallId } : {}),
    }
    const uploadToken = await this.tokenFor('upload', binding.uploadId)
    const session: UploadSession = {
      id: binding.uploadId,
      objectId: object.id,
      status: 'created',
      capabilityHash: await sha256Hex(uploadToken),
      transport,
      contentType: input.contentType,
      maxBytes,
      expiresAt: this.afterSeconds(now, this.uploadTtlSec),
      attempts: 0,
      createdAt: now,
      revision: 1,
      ...(input.size !== undefined ? { expectedSize: input.size } : {}),
      ...(input.checksum !== undefined ? { expectedChecksum: input.checksum } : {}),
      ...(input.idempotencyKey !== undefined
        ? { idempotencyKeyHash: await sha256Hex(input.idempotencyKey) }
        : {}),
    }
    const objectCreated = await this.cas(`${KEY_STORE_OBJECT}${object.id}`, null, object)
    if (!objectCreated) {
      const current = await this.requireObject(object.id)
      if (current.owner !== object.owner || current.contentType !== object.contentType) {
        throw new TBError('conflict', 'Store object id 冲突')
      }
    }
    if (!await this.cas(`${KEY_STORE_UPLOAD}${session.id}`, null, session)) {
      const current = await this.requireSession(session.id)
      if (current.objectId !== object.id) throw new TBError('conflict', 'upload id 冲突')
      return this.startFor(current)
    }
    return {
      uploadId: session.id,
      objectUri: storeUri(object.id),
      uploadToken,
      transport,
      expiresAt: session.expiresAt,
      maxBytes,
      alreadyCompleted: false,
      ...(signedRequest !== undefined ? { signedRequest } : {}),
    }
  }

  private async resolveBinding(
    owner: OwnerRef,
    input: NormalizedUploadInput,
  ): Promise<ResolvedIdempotencyBinding> {
    const now = this.nowIso()
    const fresh = (): IdempotencyBinding => ({
      owner,
      objectId: this.randomId(),
      uploadId: this.randomId(),
      fingerprint: '',
      createdAt: now,
      expiresAt: this.afterSeconds(now, this.uploadTtlSec),
      revision: 1,
    })
    if (input.idempotencyKey === undefined) return { binding: fresh(), created: false }
    const fingerprint = await sha256Hex(JSON.stringify([
      input.contentType,
      input.filename ?? null,
      input.size ?? null,
      input.checksum ?? null,
    ]))
    const ownerHash = await sha256Hex(owner)
    const keyHash = await sha256Hex(input.idempotencyKey)
    const key = `${KEY_STORE_IDEMPOTENCY}${ownerHash}:${keyHash}`
    const candidate = { ...fresh(), fingerprint }
    if (await this.cas(key, null, candidate)) return { binding: candidate, created: true, key }
    const raw = await this.state.get(key)
    if (raw === null) throw new TBError('conflict', 'idempotency binding 并发创建冲突')
    const existing = parseIdempotencyBinding(raw)
    if (existing.owner !== owner || existing.fingerprint !== fingerprint) {
      throw new TBError('conflict', 'idempotencyKey 已绑定到不同上传声明')
    }
    if (Date.parse(existing.expiresAt) <= Date.parse(now)) {
      throw new TBError('conflict', 'idempotencyKey 对应的 upload session 已过期')
    }
    return { binding: existing, created: false, key }
  }

  private async releaseFreshBinding(resolved: ResolvedIdempotencyBinding): Promise<void> {
    if (!resolved.created || resolved.key === undefined) return
    // 只释放本次刚创建且还没有 session 的 binding；并发 winner 已开始落 session
    // 时保留绑定，让同 key 重试恢复同一对象。
    if (await this.state.get(`${KEY_STORE_UPLOAD}${resolved.binding.uploadId}`) !== null) return
    await this.cas(resolved.key, resolved.binding.revision, null)
  }

  private async reserveCallCapability(
    token: string,
    objectId: string,
    input: NormalizedUploadInput,
    transportMaxBytes: number,
  ): Promise<number> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const capability = await this.verifyCallUploadCapability(token)
      const previous = capability.reservations.find(r => r.objectId === objectId)
      if (previous !== undefined) return previous.maxBytes
      if (capability.status !== 'active') {
        throw new TBError('rate_limited', 'call upload capability 配额已耗尽')
      }
      if (!contentTypeAllowed(input.contentType, capability.allowedContentTypes)) {
        throw new TBError('permission_denied', `call 不允许上传 ${input.contentType}`)
      }
      if (capability.reservations.length >= capability.maxObjects) {
        throw new TBError('rate_limited', 'call upload object 数量已达上限')
      }
      const remaining = capability.maxBytes - capability.reservedBytes
      const maxBytes = Math.min(
        capability.maxObjectBytes,
        input.size ?? capability.maxObjectBytes,
        remaining,
        transportMaxBytes,
      )
      if (maxBytes < 1 || (input.size !== undefined && input.size > maxBytes)) {
        throw new TBError('rate_limited', 'call upload bytes 配额不足')
      }
      const reservations = [...capability.reservations, { objectId, maxBytes }]
      const reservedBytes = capability.reservedBytes + maxBytes
      const exhausted = reservations.length >= capability.maxObjects
        || reservedBytes >= capability.maxBytes
      const next: CallUploadCapability = {
        ...capability,
        reservations,
        reservedBytes,
        status: exhausted ? 'exhausted' : 'active',
        revision: capability.revision + 1,
      }
      if (await this.cas(
        `${KEY_STORE_CALL_CAPABILITY}${capability.id}`,
        capability.revision,
        next,
      )) return maxBytes
    }
    throw new TBError('conflict', 'call upload capability 并发消费冲突')
  }

  private async startFor(session: UploadSession): Promise<StoreUploadStart> {
    const object = await this.requireObject(session.objectId)
    const uploadToken = await this.tokenFor('upload', session.id)
    if (session.status === 'completed' && object.status === 'ready') {
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
    if (session.transport === 'presigned-put' && this.objects.presignPut !== undefined) {
      signedRequest = await this.objects.presignPut(object.driverKey, Math.max(1, Math.floor(remainingMs / 1000)), {
        contentType: object.contentType,
        ifNoneMatch: '*',
      })
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
    objectInput: StoreObject,
    meta: ObjectMeta,
  ): Promise<StoreObjectDescriptor> {
    let object = await this.requireObject(objectInput.id)
    if (object.status === 'ready') {
      const currentSession = await this.requireSession(sessionInput.id)
      await this.completeSessionBestEffort(currentSession)
      return descriptorOf(object)
    }
    if (object.status !== 'pending') {
      await this.objects.delete(object.driverKey)
      throw new TBError('conflict', `对象状态不允许 ready:${object.status}`)
    }
    const now = this.nowIso()
    const actualChecksum = sessionInput.expectedChecksum !== undefined
      && meta.metadata?.['checksum-sha256']?.toLowerCase() === sessionInput.expectedChecksum.value
      ? sessionInput.expectedChecksum
      : undefined
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
    if (!await this.cas(`${KEY_STORE_OBJECT}${object.id}`, object.revision, ready)) {
      object = await this.requireObject(object.id)
      if (object.status !== 'ready') {
        await this.objects.delete(object.driverKey)
        throw new TBError('conflict', `对象并发状态冲突:${object.status}`)
      }
    } else {
      object = ready
    }
    const session = await this.requireSession(sessionInput.id)
    await this.completeSessionBestEffort(session)
    return descriptorOf(object)
  }

  private async completeSessionBestEffort(session: UploadSession): Promise<void> {
    if (session.status === 'completed') return
    if (session.status !== 'created') return
    const next: UploadSession = {
      ...session,
      status: 'completed',
      completedAt: this.nowIso(),
      revision: session.revision + 1,
    }
    await this.cas(`${KEY_STORE_UPLOAD}${session.id}`, session.revision, next)
  }

  private async failUpload(session: UploadSession, object: StoreObject): Promise<void> {
    if (object.status === 'pending') {
      const failed: StoreObject = {
        ...object,
        status: 'failed',
        updatedAt: this.nowIso(),
        revision: object.revision + 1,
      }
      await this.cas(`${KEY_STORE_OBJECT}${object.id}`, object.revision, failed)
    }
    if (session.status === 'created') {
      const failed: UploadSession = {
        ...session,
        status: 'failed',
        revision: session.revision + 1,
      }
      await this.cas(`${KEY_STORE_UPLOAD}${session.id}`, session.revision, failed)
    }
  }

  private async expireUpload(session: UploadSession): Promise<void> {
    if (session.status !== 'created') return
    const next: UploadSession = {
      ...session,
      status: 'expired',
      revision: session.revision + 1,
    }
    if (!await this.cas(`${KEY_STORE_UPLOAD}${session.id}`, session.revision, next)) return
    const object = await this.requireObject(session.objectId)
    if (object.status === 'pending') {
      const abandoned: StoreObject = {
        ...object,
        status: 'abandoned',
        updatedAt: this.nowIso(),
        revision: object.revision + 1,
      }
      await this.cas(`${KEY_STORE_OBJECT}${object.id}`, object.revision, abandoned)
    }
  }

  private async expireCallCapability(capability: CallUploadCapability): Promise<void> {
    if (capability.status === 'expired' || capability.status === 'revoked') return
    const next: CallUploadCapability = {
      ...capability,
      status: 'expired',
      revision: capability.revision + 1,
    }
    await this.cas(`${KEY_STORE_CALL_CAPABILITY}${capability.id}`, capability.revision, next)
  }

  private async expireShare(grant: ShareGrant): Promise<void> {
    if (grant.status !== 'active') return
    const next: ShareGrant = {
      ...grant,
      status: 'expired',
      revision: grant.revision + 1,
    }
    await this.cas(`${KEY_STORE_SHARE}${grant.id}`, grant.revision, next)
  }

  private async readyDescriptor(objectId: string): Promise<StoreObjectDescriptor> {
    return descriptorOf(await this.requireObject(objectId))
  }

  private async requireObject(id: string): Promise<StoreObject> {
    const raw = await this.state.get(`${KEY_STORE_OBJECT}${id}`)
    if (raw === null) throw new TBError('not_found', 'Store 对象不存在')
    return parseObject(raw)
  }

  private async requireSession(id: string): Promise<UploadSession> {
    const raw = await this.state.get(`${KEY_STORE_UPLOAD}${id}`)
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

  private async tokenFor(domain: TokenDomain, id: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.tokenSecret),
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
    return `store/v1/${objectId.slice(0, 2)}/${objectId}`
  }

  private objectIdFromDriverKey(key: string): string | undefined {
    const match = /^store\/v1\/([A-Za-z0-9_-]{2})\/([A-Za-z0-9_-]{22,64})$/.exec(key)
    const shard = match?.[1]
    const objectId = match?.[2]
    if (
      shard === undefined
      || objectId === undefined
      || !STORE_OBJECT_ID_RE.test(objectId)
      || shard !== objectId.slice(0, 2)
    ) return undefined
    return objectId
  }

  private nowIso(): Timestamp {
    return normalizeTimestamp(this.now(), 'now')
  }

  private afterSeconds(now: Timestamp, seconds: number): Timestamp {
    return new Date(Date.parse(now) + seconds * 1000).toISOString()
  }
}
