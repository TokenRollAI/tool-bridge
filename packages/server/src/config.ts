import type { BuiltinCatalog, EncryptionKeyring, RuntimeConfig, RuntimeRemoteSettings, StoreTokenKeyring } from '@tool-bridge/core'
import type { PluginBindings, S3StoreConfig, TbAppDeps } from '@tool-bridge/app'

/** Explicit embedding API. The executable loads managed bootstrap + PG configuration. */
export interface ServerConfig extends Partial<RuntimeConfig> {
  adminAudit?: TbAppDeps['adminAudit']
  adminSk?: string
  allowInsecureHttp: boolean
  databaseUrl: string
  dataDir: string
  deviceReclaimSec: number
  encryptionKey: string
  encryptionKeyring?: EncryptionKeyring
  host: string
  instanceId?: string
  internalS3Origin?: string
  keyManagement?: TbAppDeps['keyManagement']
  maintenanceManagement?: TbAppDeps['maintenanceManagement']
  managedSettings?: RuntimeConfig
  oauthKey?: string
  objectStore?: S3StoreConfig
  pluginBindings?: PluginBindings
  pluginCatalog?: BuiltinCatalog
  port: number
  redisUrl?: string
  remote: RuntimeRemoteSettings
  replicaId?: string
  storeCleanupIntervalSec: number
  storeTokenKeyring?: StoreTokenKeyring
  storeTokenSecret?: string
  uiDir?: string
}

/** A request receives one immutable settings snapshot; old grants retain their own limits. */
export function runtimeAppSettings(settings: RuntimeConfig, instanceId?: string): Partial<TbAppDeps> {
  return {
    ...settings,
    canonicalOrigin: settings.canonicalOrigin || undefined,
    remote: {
      allowInsecure: false,
      allowlist: settings.remoteAllowlist,
      maxHops: settings.maxHops,
      ...(instanceId ? { instanceId } : {}),
      federatedSearch: {
        maxConcurrency: settings.searchConcurrency,
        totalDeadlineMs: settings.searchDeadlineMs,
        maxResponseBodyBytes: settings.searchMaxResponseBytes,
        maxSources: settings.searchMaxSources,
        minChildWorkMs: settings.searchMinChildWorkMs,
        perHopReturnReserveMs: settings.searchReturnReserveMs,
        sessionTtlMs: settings.searchSessionTtlSec * 1000,
      },
    },
  }
}
