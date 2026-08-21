/**
 * Node 宿主的 env 配置面。变量名与语义对齐 CF 宿主(gateway/src/app.ts 的 Env),
 * 仅新增宿主形态相关的 TB_PORT / TB_HOST / TB_DATA_DIR / TB_UI_DIR。
 * 解析函数镜像 app.ts 的 allowInsecure / remoteSettingsFromEnv / positiveIntEnv。
 */

import type { PluginBindings } from '@tool-bridge/app'
import { type BuiltinCatalog, normalizeCanonicalOrigin } from '@tool-bridge/core'

const DEFAULT_PORT = 8787
const DEFAULT_MAX_HOPS = 4
const DEFAULT_DEVICE_RECLAIM_SEC = 24 * 60 * 60

export interface ServerConfig {
  /** 首次引导的 Admin SK 明文(须经 TB_BOOTSTRAP_ADMIN_SK 预置;缺省且未开 insecure bootstrap 则 fail closed)。 */
  adminSk?: string
  /**
   * 逃生阀:显式放行"缺 Admin SK 时随机生成并打印明文"的旧行为(仅本地/一次性开发)。
   * 默认 false → 生产/Docker 缺 TB_BOOTSTRAP_ADMIN_SK 时拒绝启动,不把最高权限凭证写日志。
   */
  allowInsecureBootstrap: boolean
  allowInsecureHttp: boolean
  /**
   * 规范网关 origin(TB_CANONICAL_ORIGIN):多域名访问时钉死 OAuth redirect_uri。
   * 与 Workers 宿主同一解析真源(core normalizeCanonicalOrigin);配置了但非法 →
   * configFromEnv 抛错,进程拒绝启动(fail closed,不静默回退到请求期 origin)。
   */
  canonicalOrigin?: string
  /**
   * Postgres 连接串(TB_DATABASE_URL)。给出则 StateStore 与 SearchIndex 都走 PG
   * (ILIKE 子串检索,无扩展依赖);缺省回退到 dataDir 下的 SQLite。ObjectStore 始终用 fs。
   */
  databaseUrl?: string
  /** SQLite 库与 fs 对象根所在目录(state.sqlite3 + objects/)。 */
  dataDir: string
  /** 设备断线后未重连的回收秒数(缺省 24h)。 */
  deviceReclaimSec: number
  /** SecretStore 主密钥 + $ref 中转 token 签名密钥(base64url 32B)。 */
  encryptionKey?: string
  host: string
  /**
   * 进程内插件装配表(binding 名 → fetch handler)。缺省时 bin 入口装配**全量内置目录**
   * (见 `main.ts`);程序化嵌入方可给自己的表来覆盖或裁剪。
   */
  pluginBindings?: PluginBindings
  /**
   * 内置插件目录的 descriptor。与 {@link pluginBindings} 同源装配 —— 只给 bindings
   * 的话插件调得动但解析不出 export(挂载校验会报"未知 provider")。
   */
  pluginCatalog?: BuiltinCatalog
  port: number
  refThresholdBytes?: number
  refTtlSec?: number
  remote: {
    allowInsecure: boolean
    allowlist: string[]
    instanceId?: string
    maxHops: number
  }
  toolCacheTtlSec?: number
  /** Dashboard 静态资源目录覆盖(缺省经 @tool-bridge/dashboard 包解析)。 */
  uiDir?: string
}

/** 正整数 env 解析;非法/缺省 → undefined。 */
function positiveIntEnv(value: string | undefined): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

/** 端口解析:0 合法(系统分配临时端口,测试用);非法/缺省 → undefined。 */
function portEnv(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : undefined
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const allowInsecure = env.TB_ALLOW_INSECURE_HTTP === 'true'
  const allowlist = (env.TB_REMOTE_ALLOWLIST ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
  const config: ServerConfig = {
    port: portEnv(env.TB_PORT) ?? DEFAULT_PORT,
    host: env.TB_HOST !== undefined && env.TB_HOST.length > 0 ? env.TB_HOST : '0.0.0.0',
    dataDir:
      env.TB_DATA_DIR !== undefined && env.TB_DATA_DIR.length > 0 ? env.TB_DATA_DIR : './data',
    allowInsecureHttp: allowInsecure,
    allowInsecureBootstrap: env.TB_ALLOW_INSECURE_BOOTSTRAP === 'true',
    remote: {
      allowlist,
      maxHops: positiveIntEnv(env.TB_MAX_HOPS) ?? DEFAULT_MAX_HOPS,
      ...(env.TB_INSTANCE_ID !== undefined && env.TB_INSTANCE_ID.length > 0
        ? { instanceId: env.TB_INSTANCE_ID }
        : {}),
      allowInsecure,
    },
    deviceReclaimSec: positiveIntEnv(env.TB_DEVICE_RECLAIM_SEC) ?? DEFAULT_DEVICE_RECLAIM_SEC,
  }
  if (env.TB_UI_DIR !== undefined && env.TB_UI_DIR.length > 0) config.uiDir = env.TB_UI_DIR
  if (env.TB_DATABASE_URL !== undefined && env.TB_DATABASE_URL.length > 0) {
    config.databaseUrl = env.TB_DATABASE_URL
  }
  if (env.TB_BOOTSTRAP_ADMIN_SK !== undefined && env.TB_BOOTSTRAP_ADMIN_SK.length > 0) {
    config.adminSk = env.TB_BOOTSTRAP_ADMIN_SK
  }
  // fail closed:配置了但非法直接抛(与 Workers 同一真源),不静默回退。
  const canonicalOrigin = normalizeCanonicalOrigin(env.TB_CANONICAL_ORIGIN)
  if (canonicalOrigin !== undefined) config.canonicalOrigin = canonicalOrigin
  if (env.TB_SECRET_ENCRYPTION_KEY !== undefined && env.TB_SECRET_ENCRYPTION_KEY.length > 0) {
    config.encryptionKey = env.TB_SECRET_ENCRYPTION_KEY
  }
  const ttl = positiveIntEnv(env.TB_TOOL_CACHE_TTL)
  if (ttl !== undefined) config.toolCacheTtlSec = ttl
  const refThreshold = positiveIntEnv(env.TB_REF_THRESHOLD_BYTES)
  if (refThreshold !== undefined) config.refThresholdBytes = refThreshold
  const refTtl = positiveIntEnv(env.TB_REF_TTL_SEC)
  if (refTtl !== undefined) config.refTtlSec = refTtl
  return config
}
