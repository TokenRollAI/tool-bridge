/**
 * Node 宿主的 env 配置面。变量名与语义对齐 CF 宿主(gateway/src/app.ts 的 Env),
 * 仅新增宿主形态相关的 TB_PORT / TB_HOST / TB_DATA_DIR / TB_UI_DIR / TB_DATABASE_URL。
 * 端口额外兜底平台注入的 PORT(PaaS 通行约定)。
 * 解析函数镜像 app.ts 的 allowInsecure / remoteSettingsFromEnv / positiveIntEnv。
 */

import type { PluginBindings } from '@tool-bridge/app'
import {
  type BuiltinCatalog,
  normalizeCanonicalOrigin,
  PRESIGN_TTL_SEC_MAX,
} from '@tool-bridge/core'

const DEFAULT_PORT = 8787
const DEFAULT_MAX_HOPS = 4
const DEFAULT_DEVICE_RECLAIM_SEC = 24 * 60 * 60
const DEFAULT_STORE_CLEANUP_INTERVAL_SEC = 15 * 60

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
   * (ILIKE 子串检索,无扩展依赖);缺省回退到 dataDir 下的 SQLite。
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
   * 平台对象存储(default Store + context `$ref` 大对象落点)。给出则用 S3/R2 兼容端点,
   * 缺省回退 dataDir 下的本地 FS。配 S3 后容器可无状态横向扩容 —— FS 落点
   * 在多副本间互不可见、容器重建即丢。
   */
  objectStore?: {
    accessKeyId: string
    bucket: string
    endpoint: string
    region?: string
    secretAccessKey: string
  }
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
  /**
   * 多副本设备通道路由的 Redis 连接串(TB_REDIS_URL)。
   *
   * 设备的 WebSocket 是活 socket、只存在于接受它的进程里,故多副本时打给"连在别的
   * 副本上的设备"的调用必须跨副本转发。配上即启用路由表 + pub/sub 转发;
   * 单副本部署不需要配(本地直连恒命中)。
   */
  redisUrl?: string
  refThresholdBytes?: number
  refTtlSec?: number
  remote: {
    allowInsecure: boolean
    allowlist: string[]
    instanceId?: string
    maxHops: number
  }
  /**
   * 本副本标识(TB_REPLICA_ID),路由表的 value。缺省用 hostname —— 容器平台上
   * 每个副本的 hostname 天然唯一;同机多进程需显式区分。
   */
  replicaId?: string
  /**
   * SIGTERM 后先置 draining(/readyz 转 503)再关停的等待秒数(TB_SHUTDOWN_DRAIN_SEC,
   * 缺省 0)。k8s 滚动更新时 endpoint 摘除有传播延迟,不等一拍就关会把仍被路由过来的
   * 请求吃闭门羹;单机/本地开发保持 0,关停立即进行。
   */
  shutdownDrainSec?: number
  /** 设备调用允许上传的 MIME pattern；缺省由应用使用安全默认值。 */
  storeCallAllowedContentTypes?: string[]
  /** 设备调用所签发 Store capability 的总字节上限。 */
  storeCallMaxBytes?: number
  /** 设备调用单个 Store 对象的字节上限。 */
  storeCallMaxObjectBytes?: number
  /** 设备调用最多可创建的 Store 对象数。 */
  storeCallMaxObjects?: number
  /** Store 孤儿字节、过期 session/share/call capability 的周期清理间隔。 */
  storeCleanupIntervalSec: number
  /** Store 对象统一上限；direct upload 可使用完整值。 */
  storeMaxObjectBytes?: number
  /** Store owner read ref 的有效期。 */
  storeReadTtlSec?: number
  /** relay upload 的宿主有效上限；缺省等于对象统一上限。 */
  storeRelayMaxBytes?: number
  /** Store 匿名可撤销 share 的有效期。 */
  storeShareTtlSec?: number
  /** 显式 Store token 根密钥；缺省由应用在 StateStore 原子生成并持久化。 */
  storeTokenSecret?: string
  /** Store upload session 的有效期。 */
  storeUploadTtlSec?: number
  toolCacheTtlSec?: number
  /** Dashboard 静态资源目录覆盖(缺省经 @tool-bridge/dashboard 包解析)。 */
  uiDir?: string
  /** create_upload 写入 grant 有效期秒；缺省 min(refTtlSec, 900)。 */
  uploadGrantTtlSec?: number
}

/** 正整数 env 解析;非法/缺省 → undefined。 */
function positiveIntEnv(value: string | undefined): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

/** SigV4 presign TTL 同时钳制到协议上限。 */
function presignTtlEnv(value: string | undefined): number | undefined {
  const ttl = positiveIntEnv(value)
  return ttl === undefined ? undefined : Math.min(ttl, PRESIGN_TTL_SEC_MAX)
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
    // TB_PORT 优先,PORT 兜底:Railway / Fly / Cloud Run / CF Container 等 PaaS 只注入
    // PORT,不认识 TB_PORT —— 不兜底的话容器会监听 8787 而平台探活另一个端口,部署直接失败。
    port: portEnv(env.TB_PORT) ?? portEnv(env.PORT) ?? DEFAULT_PORT,
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
    storeCleanupIntervalSec:
      positiveIntEnv(env.TB_STORE_CLEANUP_INTERVAL_SEC) ?? DEFAULT_STORE_CLEANUP_INTERVAL_SEC,
    // 0 合法(立即关停,本地/单机默认);positiveIntEnv 拒 0,故单独解析。
    shutdownDrainSec: (() => {
      const n = Number(env.TB_SHUTDOWN_DRAIN_SEC)
      return Number.isInteger(n) && n >= 0 ? n : 0
    })(),
  }
  if (env.TB_UI_DIR !== undefined && env.TB_UI_DIR.length > 0) config.uiDir = env.TB_UI_DIR
  if (env.TB_DATABASE_URL !== undefined && env.TB_DATABASE_URL.length > 0) {
    config.databaseUrl = env.TB_DATABASE_URL
  }
  if (env.TB_REDIS_URL !== undefined && env.TB_REDIS_URL.length > 0) {
    config.redisUrl = env.TB_REDIS_URL
  }
  if (env.TB_REPLICA_ID !== undefined && env.TB_REPLICA_ID.length > 0) {
    config.replicaId = env.TB_REPLICA_ID
  }
  // 平台对象存储:四项必给,缺一即 fail closed —— 半套凭证静默回退到本地 FS 的话,
  // 运维以为对象在 S3、实际写进容器层,重建即丢且多副本互不可见。
  const s3Vars = [
    ['TB_OBJECT_STORE_ENDPOINT', env.TB_OBJECT_STORE_ENDPOINT],
    ['TB_OBJECT_STORE_BUCKET', env.TB_OBJECT_STORE_BUCKET],
    ['TB_OBJECT_STORE_ACCESS_KEY_ID', env.TB_OBJECT_STORE_ACCESS_KEY_ID],
    ['TB_OBJECT_STORE_SECRET_ACCESS_KEY', env.TB_OBJECT_STORE_SECRET_ACCESS_KEY],
  ] as const
  const present = s3Vars.filter(([, value]) => value !== undefined && value.length > 0)
  if (present.length > 0) {
    if (present.length < s3Vars.length) {
      const missing = s3Vars
        .filter(([, value]) => value === undefined || value.length === 0)
        .map(([name]) => name)
      throw new Error(
        `平台对象存储配置不完整(给了 ${present.length}/${s3Vars.length} 项),缺少:${missing.join(', ')}`,
      )
    }
    config.objectStore = {
      accessKeyId: env.TB_OBJECT_STORE_ACCESS_KEY_ID as string,
      bucket: env.TB_OBJECT_STORE_BUCKET as string,
      endpoint: env.TB_OBJECT_STORE_ENDPOINT as string,
      secretAccessKey: env.TB_OBJECT_STORE_SECRET_ACCESS_KEY as string,
      ...(env.TB_OBJECT_STORE_REGION !== undefined && env.TB_OBJECT_STORE_REGION.length > 0
        ? { region: env.TB_OBJECT_STORE_REGION }
        : {}),
    }
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
  const refTtl = presignTtlEnv(env.TB_REF_TTL_SEC)
  if (refTtl !== undefined) config.refTtlSec = refTtl
  const uploadGrantTtl = presignTtlEnv(env.TB_UPLOAD_GRANT_TTL_SEC)
  if (uploadGrantTtl !== undefined) config.uploadGrantTtlSec = uploadGrantTtl
  const storeMaxObjectBytes = positiveIntEnv(env.TB_STORE_MAX_OBJECT_BYTES)
  if (storeMaxObjectBytes !== undefined) config.storeMaxObjectBytes = storeMaxObjectBytes
  const storeRelayMaxBytes = positiveIntEnv(env.TB_STORE_RELAY_MAX_BYTES)
  if (storeRelayMaxBytes !== undefined) config.storeRelayMaxBytes = storeRelayMaxBytes
  const storeUploadTtlSec = presignTtlEnv(env.TB_STORE_UPLOAD_TTL_SEC)
  if (storeUploadTtlSec !== undefined) config.storeUploadTtlSec = storeUploadTtlSec
  const storeShareTtlSec = presignTtlEnv(env.TB_STORE_SHARE_TTL_SEC)
  if (storeShareTtlSec !== undefined) config.storeShareTtlSec = storeShareTtlSec
  const storeReadTtlSec = presignTtlEnv(env.TB_STORE_READ_TTL_SEC)
  if (storeReadTtlSec !== undefined) config.storeReadTtlSec = storeReadTtlSec
  const storeCallMaxBytes = positiveIntEnv(env.TB_STORE_CALL_MAX_BYTES)
  if (storeCallMaxBytes !== undefined) config.storeCallMaxBytes = storeCallMaxBytes
  const storeCallMaxObjectBytes = positiveIntEnv(env.TB_STORE_CALL_MAX_OBJECT_BYTES)
  if (storeCallMaxObjectBytes !== undefined) {
    config.storeCallMaxObjectBytes = storeCallMaxObjectBytes
  }
  const storeCallMaxObjects = positiveIntEnv(env.TB_STORE_CALL_MAX_OBJECTS)
  if (storeCallMaxObjects !== undefined) config.storeCallMaxObjects = storeCallMaxObjects
  const storeCallAllowedContentTypes = (env.TB_STORE_CALL_ALLOWED_CONTENT_TYPES ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(value => value.length > 0)
  if (storeCallAllowedContentTypes.length > 0) {
    config.storeCallAllowedContentTypes = storeCallAllowedContentTypes
  }
  if (env.TB_STORE_TOKEN_SECRET !== undefined && env.TB_STORE_TOKEN_SECRET.length > 0) {
    if (env.TB_STORE_TOKEN_SECRET.length < 16) {
      throw new Error('TB_STORE_TOKEN_SECRET 至少需要 16 个字符')
    }
    config.storeTokenSecret = env.TB_STORE_TOKEN_SECRET
  }
  return config
}
