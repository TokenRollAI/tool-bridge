import { z } from 'zod'
import { DEFAULT_MAX_HOPS } from './runtimeConfig'
declare const URL: { new (value: string): { protocol: string } }

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const ttl = positive.max(604800)

/** Plain public output types; schema conformance is checked below without leaking Zod into SDK declarations. */
export type RuntimeConfig = {
  canonicalOrigin: string
  deviceReclaimSec: number
  maxHops: number
  refThresholdBytes: number
  refTtlSec: number
  remoteAllowlist: string[]
  searchConcurrency: number
  searchDeadlineMs: number
  searchMaxResponseBytes: number
  searchMaxSources: number
  searchMinChildWorkMs: number
  searchReturnReserveMs: number
  searchSessionTtlSec: number
  shutdownDrainSec: number
  storeCallAllowedContentTypes: string[]
  storeCallMaxBytes: number
  storeCallMaxObjectBytes: number
  storeCallMaxObjects: number
  storeCleanupIntervalSec: number
  storeMaxObjectBytes: number
  storeReadTtlSec: number
  storeRelayMaxBytes: number
  storeShareTtlSec: number
  storeUploadTtlSec: number
  toolCacheTtlSec: number
  uploadGrantTtlSec: number
}
export type SetupInput = {
  databaseUrl?: string
  redisUrl?: string
  settings: RuntimeConfig
  storage?: { accessKeyId: string, bucket: string, endpoint: string, region: string, secretAccessKey: string }
}

/** Product settings have one runtime schema; environment variables are not a second authority. */
export const runtimeConfigSchema = z.strictObject({
  canonicalOrigin: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]).default('').describe('公开访问地址'),
  remoteAllowlist: z.array(z.string().min(1)).default([]).describe('允许联邦连接的主机'),
  maxHops: positive.max(16).default(DEFAULT_MAX_HOPS).describe('联邦最大跳数'),
  deviceReclaimSec: positive.max(2147483).default(86400).describe('离线设备回收等待（秒）'),
  toolCacheTtlSec: positive.default(300).describe('工具缓存有效期（秒）'),
  refThresholdBytes: positive.default(1048576).describe('Context 内联阈值（字节）'),
  refTtlSec: ttl.default(900).describe('Context 引用有效期（秒）'),
  uploadGrantTtlSec: ttl.default(900).describe('Context 上传授权有效期（秒）'),
  storeMaxObjectBytes: positive.max(1073741824).default(268435456).describe('对象最大大小（字节）'),
  storeRelayMaxBytes: positive.max(1073741824).default(268435456).describe('中转上传最大大小（字节）'),
  storeCallMaxBytes: positive.default(536870912).describe('单次调用累计上传大小（字节）'),
  storeCallMaxObjectBytes: positive.max(1073741824).default(268435456).describe('调用内单个对象最大大小（字节）'),
  storeCallMaxObjects: positive.default(4).describe('单次调用最多对象数'),
  storeCallAllowedContentTypes: z.array(z.string().min(1)).min(1).default(['*/*']).describe('调用上传允许的 MIME 类型'),
  storeUploadTtlSec: ttl.default(900).describe('上传会话有效期（秒）'),
  storeShareTtlSec: ttl.default(900).describe('分享有效期（秒）'),
  storeReadTtlSec: ttl.default(900).describe('下载引用有效期（秒）'),
  storeCleanupIntervalSec: positive.max(2147483).default(900).describe('存储维护周期（秒）'),
  searchConcurrency: positive.max(64).default(4).describe('联邦搜索并发数'),
  searchDeadlineMs: positive.default(2500).describe('联邦搜索总时限（毫秒）'),
  searchMaxResponseBytes: positive.default(524288).describe('联邦搜索响应上限（字节）'),
  searchMaxSources: positive.max(256).default(16).describe('联邦搜索最多来源'),
  searchMinChildWorkMs: positive.default(200).describe('子搜索最少工作时间（毫秒）'),
  searchReturnReserveMs: positive.default(100).describe('搜索返回预留时间（毫秒）'),
  searchSessionTtlSec: positive.default(300).describe('搜索快照有效期（秒）'),
  shutdownDrainSec: z.number().int().min(0).max(300).default(0).describe('关停排空等待（秒）'),
}) satisfies z.ZodType<RuntimeConfig>

export const configUpdateSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  settings: runtimeConfigSchema,
})
export const revisionSchema = z.strictObject({ expectedRevision: z.number().int().nonnegative() })

export const s3ConnectionSchema = z.strictObject({
  endpoint: z.url(),
  bucket: z.string().min(1).max(255),
  region: z.string().min(1).default('us-east-1'),
  accessKeyId: z.string().min(1).max(4096),
  secretAccessKey: z.string().min(1).max(4096),
})
export const storageWriteSchema = z.strictObject({
  name: z.string().min(1).max(120),
  connection: s3ConnectionSchema,
})
export const storageIdSchema = z.strictObject({ id: z.string().min(1).max(128) })
export const storageRevisionSchema = storageIdSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
})
export const storageActivateSchema = storageRevisionSchema.extend({
  expectedActiveRevision: z.number().int().nonnegative(),
})
export const storageRotateSchema = storageRevisionSchema.extend({
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
})

export const setupInputSchema = z.strictObject({
  databaseUrl: z.string().min(1).refine((value) => {
    try {
      return ['postgres:', 'postgresql:'].includes(new URL(value).protocol)
    } catch {
      return false
    }
  }, '需要 PostgreSQL 连接地址').optional(),
  storage: s3ConnectionSchema.optional(),
  redisUrl: z.string().optional(),
  settings: runtimeConfigSchema.default(() => runtimeConfigSchema.parse({})),
}) satisfies z.ZodType<SetupInput>

export interface ConfigStatus {
  appliedRevision: number
  desired: RuntimeConfig
  effective: RuntimeConfig
  lastError?: string
  revision: number
  state: 'applied' | 'pending' | 'applying' | 'failed'
}

export interface StorageBackendView {
  active: boolean
  activeRevision: number
  bucket: string
  credentialConfigured: boolean
  credentialGeneration: number
  endpoint: string
  id: string
  name: string
  region: string
  revision: number
  validated: boolean
  validation?: { at: string, checks: Record<string, boolean>, cleanupSucceeded: boolean }
}

export interface ConfigManagement {
  apply(input: z.infer<typeof revisionSchema>): Promise<ConfigStatus>
  get(): Promise<ConfigStatus>
  update(input: z.infer<typeof configUpdateSchema>): Promise<ConfigStatus>
}
export interface StorageManagement {
  activate(input: z.infer<typeof storageActivateSchema>): Promise<StorageBackendView>
  delete(input: z.infer<typeof storageRevisionSchema>): Promise<{ ok: true }>
  get(input: z.infer<typeof storageIdSchema>): Promise<StorageBackendView>
  list(): Promise<{ items: StorageBackendView[] }>
  test(input: z.infer<typeof storageRevisionSchema>): Promise<StorageBackendView>
  update(input: z.infer<typeof storageRotateSchema>): Promise<StorageBackendView>
  write(input: z.infer<typeof storageWriteSchema>): Promise<StorageBackendView>
}

export interface SetupStatus {
  instanceId: string
  pairingRequired: boolean
  state: 'setup' | 'installing' | 'ready' | 'recovery'
}
export interface SetupDefaults {
  databaseConfigured: boolean
  databaseHost?: string
  redisConfigured: boolean
  storage?: { bucket: string, endpoint: string, region: string }
  storageConfigured: boolean
}
export interface SetupResult {
  adminSk: string
  baseUrl: string
  state: 'ready'
}
export const setupStatusSchema: z.ZodType<SetupStatus> = z.object({
  state: z.enum(['setup', 'installing', 'ready', 'recovery']),
  instanceId: z.string().min(1),
  pairingRequired: z.boolean(),
})
export const setupDefaultsSchema: z.ZodType<SetupDefaults> = z.object({
  databaseConfigured: z.boolean(), databaseHost: z.string().optional(),
  redisConfigured: z.boolean(), storageConfigured: z.boolean(),
  storage: z.object({ endpoint: z.string(), bucket: z.string(), region: z.string() }).optional(),
})
export const setupResultSchema: z.ZodType<SetupResult> = z.object({
  state: z.literal('ready'), adminSk: z.string().min(1), baseUrl: z.string(),
})

export type RecoveryInput = SetupInput & { backup?: import('./keyManagement').KeyBackup }
export interface RecoveryResult { adminSk?: string, baseUrl: string, state: 'ready' }
const backupKeyringSchema = z.strictObject({ activeKeyId: z.string().min(1), keys: z.record(z.string(), z.string()) })
export const recoveryInputSchema = setupInputSchema.extend({
  backup: z.strictObject({
    version: z.literal(1), instanceId: z.string().min(1), exportedAt: z.string().min(1),
    keyring: backupKeyringSchema, storeTokenKeyring: backupKeyringSchema,
    oauthKey: z.string().min(1), signingRetireAfter: z.record(z.string(), z.string()).optional(),
  }).optional(),
}) satisfies z.ZodType<RecoveryInput>
export const recoveryResultSchema: z.ZodType<RecoveryResult> = z.object({
  state: z.literal('ready'), baseUrl: z.string(), adminSk: z.string().min(1).optional(),
})
