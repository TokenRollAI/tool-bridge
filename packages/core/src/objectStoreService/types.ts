import type { ObjectBody, ObjectPresignedPut } from '../context/objectStore'
import type { OwnerRef, Timestamp, URI } from '../types'

export const DEFAULT_STORE_NAME = 'default' as const
/** Store 在共享 ObjectStore driver 中独占的物理 key root。 */
export const DEFAULT_STORE_DRIVER_KEY_ROOT = '__tool_bridge_internal__/store/v1' as const

export type StoreObjectStatus = 'pending' | 'ready' | 'failed' | 'abandoned' | 'deleted'
export type UploadSessionStatus = 'created' | 'completed' | 'aborted' | 'expired' | 'failed'
export type StoreUploadTransport = 'relay' | 'presigned-put'
export type CallUploadCapabilityStatus = 'active' | 'exhausted' | 'revoked' | 'expired'
export type ShareGrantStatus = 'active' | 'revoked' | 'expired'

export interface StoreChecksum {
  algorithm: 'sha256'
  value: string
}

/** StateStore 内的权威对象记录；driverKey 绝不进入公开 descriptor。 */
export interface StoreObject {
  /** terminal object 的 driver 字节已完成幂等删除；cleanup 以此避免每轮重复 DELETE。 */
  bytesDeletedAt?: Timestamp
  checksum?: StoreChecksum
  contentType: string
  createdAt: Timestamp
  driverKey: string
  etag?: string
  expectedChecksum?: StoreChecksum
  expectedSize?: number
  expiresAt?: Timestamp
  filename?: string
  id: string
  originCallId?: string
  owner: OwnerRef
  producer?: OwnerRef
  readyAt?: Timestamp
  revision: number
  size?: number
  status: StoreObjectStatus
  store: typeof DEFAULT_STORE_NAME
  updatedAt: Timestamp
  uploadId: string
}

/** 每个上传会话都有独立 bearer；StateStore 只保存其 sha256。 */
export interface UploadSession {
  attempts: number
  capabilityHash: string
  completedAt?: Timestamp
  contentType: string
  createdAt: Timestamp
  expectedChecksum?: StoreChecksum
  expectedSize?: number
  expiresAt: Timestamp
  id: string
  idempotencyKeyHash?: string
  maxBytes: number
  objectId: string
  revision: number
  status: UploadSessionStatus
  /** 进入 completed/aborted/expired/failed 的时间，作为幂等保留窗口起点。 */
  terminalAt?: Timestamp
  transport: StoreUploadTransport
}

/** 远程设备调用的窄上传权限；owner 与 producer 都是稳定 OwnerRef，而不是 SK keyId。 */
export interface CallUploadCapability {
  allowedContentTypes: string[]
  callId: string
  createdAt: Timestamp
  expiresAt: Timestamp
  id: string
  maxBytes: number
  maxObjectBytes: number
  maxObjects: number
  owner: OwnerRef
  producer: OwnerRef
  reservations: Array<{ maxBytes: number, objectId: string }>
  reservedBytes: number
  revision: number
  status: CallUploadCapabilityStatus
  /** 进入 revoked/expired 的时间；exhausted 仍须保留到 expiresAt 供幂等 replay。 */
  terminalAt?: Timestamp
  tokenHash: string
}

/** 首期 share 是匿名、短期、可撤销的 read capability。 */
export interface ShareGrant {
  createdAt: Timestamp
  createdBy: OwnerRef
  expiresAt: Timestamp
  id: string
  objectId: string
  revision: number
  status: ShareGrantStatus
  /** 进入 revoked/expired 的时间，作为撤销传播后的安全保留窗口起点。 */
  terminalAt?: Timestamp
  tokenHash: string
}

export interface StoreObjectDescriptor {
  checksum?: StoreChecksum
  contentType: string
  createdAt: Timestamp
  etag?: string
  expiresAt?: Timestamp
  filename?: string
  originCallId?: string
  owner: OwnerRef
  producer?: OwnerRef
  readyAt: Timestamp
  size: number
  status: 'ready'
  updatedAt: Timestamp
  uri: URI
}

export interface StoreUploadInput {
  checksum?: StoreChecksum
  contentType: string
  filename?: string
  idempotencyKey?: string
  size?: number
}

export interface StoreUploadStart {
  alreadyCompleted: boolean
  descriptor?: StoreObjectDescriptor
  expiresAt: Timestamp
  maxBytes: number
  objectUri: URI
  signedRequest?: ObjectPresignedPut
  transport: StoreUploadTransport
  uploadId: string
  /** 仅返回给宿主组装 Authorization header；不得写日志或持久化。 */
  uploadToken: string
}

export interface StoreUploadGrant {
  alreadyCompleted?: true
  descriptor?: StoreObjectDescriptor
  expiresAt: Timestamp
  headers: Record<string, string>
  maxBytes: number
  method: 'PUT'
  objectUri: URI
  transport: StoreUploadTransport
  uploadId: string
  /** Returned once in the grant; clients send it only via x-tb-store-upload. */
  uploadToken: string
  url: string
}

export interface StoreShareResult {
  expiresAt: Timestamp
  shareId: string
  /** 短期 bearer，仅签发响应返回；持久层只存 hash。 */
  token: string
  uri: URI
}

export interface StoreReadAccess {
  admin?: boolean
  owner?: OwnerRef
}

export interface StoreListOptions {
  cursor?: string
  limit?: number
}

export interface StoreListPage {
  cursor?: string
  items: StoreObjectDescriptor[]
}

export interface StoreCleanupResult {
  abandonedObjects: number
  /** 存在时宿主必须把它传给下一次 cleanup，直到缺省；避免大规模记录饿死。 */
  cursors?: StoreCleanupCursors
  deletedBytes: number
  deletedOrphans: number
  deletedStaging: number
  expiredCallCapabilities: number
  expiredIdempotencyBindings: number
  expiredShares: number
  expiredUploads: number
}

export interface StoreCleanupCursors {
  callCapabilities: string | null
  driverObjects: string | null
  idempotencyBindings: string | null
  objects: string | null
  shares: string | null
  uploads: string | null
}

export interface StoreCleanupOptions {
  cursors?: StoreCleanupCursors
  /** 每类权威记录单步最多扫描多少条；缺省 200。 */
  limit?: number
  /** 一次宿主 cleanup tick 只在第一页运行 staging 等非分页 driver 维护；缺省 true。 */
  runDriverMaintenance?: boolean
}

export interface StoreServiceOptions {
  maxObjectBytes?: number
  now?: () => Timestamp
  /** relay 数据面受宿主 request-body 上限约束；缺省与 maxObjectBytes 相同。 */
  relayMaxBytes?: number
  shareTtlSec?: number
  tokenSecret: string
  uploadTtlSec?: number
}

export interface RelayCommitInput {
  body: ObjectBody
  uploadToken: string
}

export interface IssueCallUploadCapabilityInput {
  allowedContentTypes: string[]
  callId: string
  expiresAt: Timestamp
  maxBytes: number
  maxObjectBytes: number
  maxObjects: number
  owner: OwnerRef
  producer: OwnerRef
}

export interface IssuedCallUploadCapability {
  capability: Omit<CallUploadCapability, 'tokenHash'>
  /** 明文只随签发结果出现。 */
  token: string
}
