import { SecretStoreImpl, type StateStore } from '@tool-bridge/core'
import { Hono } from 'hono'
import pkg from '../package.json' with { type: 'json' }
import { ensureBootstrapped } from './bootstrap'
import type { DeviceSession } from './deviceSession'
import { KvStateStore } from './kvStateStore'
import { createR2ObjectStore, type R2PresignCredentials } from './providers/r2Object'
import type { RemoteSettings } from './providers/remote'
import { createTbApp, parseS3Credentials, type TbAppDeps } from './tbApp'

/**
 * Workers 运行时绑定。KV/R2 名称从 TB_NAME_PREFIX 派生(wrangler.jsonc)。
 * TB_SECRET_ENCRYPTION_KEY / TB_BOOTSTRAP_ADMIN_SK 经 wrangler secret 或 .dev.vars 注入。
 */
export interface Env {
  TB_KV: KVNamespace
  TB_R2: R2Bucket
  TB_SECRET_ENCRYPTION_KEY?: string
  TB_BOOTSTRAP_ADMIN_SK?: string
  /** 放行 http:// 上游(仅本地开发,Proto §4.2)。 */
  TB_ALLOW_INSECURE_HTTP?: string
  /** remote baseUrl 的 host 后缀白名单(逗号分隔;空 = 拒一切 remote,Proto §3.4)。 */
  TB_REMOTE_ALLOWLIST?: string
  /** X-TB-Via 跳数上限(默认 4)。 */
  TB_MAX_HOPS?: string
  /** 本实例 X-TB-Via 标识(缺省用入站 host 派生)。 */
  TB_INSTANCE_ID?: string
  /** mcp 工具缓存 TTL 秒(默认 300)。 */
  TB_TOOL_CACHE_TTL?: string
  /** r2 presign 的 S3 兼容端点(https://<account>.r2.cloudflarestorage.com)与 bucket。 */
  TB_R2_S3_ENDPOINT?: string
  TB_R2_BUCKET?: string
  /** r2 presign 凭证链的 env 段(SecretStore 'r2-presign' 优先,Proto §5.2)。 */
  TB_R2_ACCESS_KEY_ID?: string
  TB_R2_SECRET_ACCESS_KEY?: string
  /** context Get 的 $ref 内联阈值(字节,缺省 1 MiB)。 */
  TB_REF_THRESHOLD_BYTES?: string
  /** $ref URL(presign 与 /~ref 中转)有效期秒(缺省 900)。 */
  TB_REF_TTL_SEC?: string
  /** DeviceSession Durable Object(Phase 4 设备 WS hibernation)。 */
  TB_DEVICE: DurableObjectNamespace<DeviceSession>
  /** Dashboard 静态资源(Workers Static Assets,M9;本地测试/未部署 UI 时可缺省)。 */
  ASSETS?: Fetcher
  /** 设备断线后未重连的回收秒数(缺省 24h)。 */
  TB_DEVICE_RECLAIM_SEC?: string
  /** opt-in 集成测试:真实 MCP echo server 的 URL(仅测试注入)。 */
  TB_TEST_MCP_URL?: string
  /** opt-in 集成测试:S3 兼容端点与凭证(仅测试注入)。 */
  TB_TEST_S3_ENDPOINT?: string
  TB_TEST_S3_ACCESS_KEY_ID?: string
  TB_TEST_S3_SECRET_ACCESS_KEY?: string
  TB_TEST_S3_BUCKET?: string
}

/** http:// 上游是否放行(env `TB_ALLOW_INSECURE_HTTP=true`,仅本地开发)。 */
function allowInsecure(env: Env): boolean {
  return env.TB_ALLOW_INSECURE_HTTP === 'true'
}

const DEFAULT_MAX_HOPS = 4

/** env → remote 透传配置(TB_REMOTE_ALLOWLIST 逗号分隔;TB_MAX_HOPS 缺省 4)。 */
function remoteSettingsFromEnv(env: Env): RemoteSettings {
  const allowlist = (env.TB_REMOTE_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const hops = Number(env.TB_MAX_HOPS)
  return {
    allowlist,
    maxHops: Number.isFinite(hops) && hops > 0 ? hops : DEFAULT_MAX_HOPS,
    ...(env.TB_INSTANCE_ID !== undefined && env.TB_INSTANCE_ID.length > 0
      ? { instanceId: env.TB_INSTANCE_ID }
      : {}),
    allowInsecure: allowInsecure(env),
  }
}

/** 正整数 env 解析(TB_TOOL_CACHE_TTL / TB_REF_THRESHOLD_BYTES / TB_REF_TTL_SEC);非法/缺省 → undefined。 */
function positiveIntEnv(value: string | undefined): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

/**
 * r2 presign 凭证链(Proto §5.2,按序):SecretStore 保留名 'r2-presign' →
 * env TB_R2_ACCESS_KEY_ID/TB_R2_SECRET_ACCESS_KEY → 均缺则 undefined($ref 走 /~ref 中转)。
 * endpoint/bucket 亦缺则无从 presign。
 */
async function r2PresignCredentials(
  env: Env,
  secrets: SecretStoreImpl,
): Promise<R2PresignCredentials | undefined> {
  const endpoint = env.TB_R2_S3_ENDPOINT
  const bucket = env.TB_R2_BUCKET
  if (endpoint === undefined || bucket === undefined) return undefined
  const stored = await secrets.resolve('r2-presign')
  if (stored !== undefined) {
    return { endpoint, bucket, ...parseS3Credentials(stored, 'r2-presign') }
  }
  if (env.TB_R2_ACCESS_KEY_ID !== undefined && env.TB_R2_SECRET_ACCESS_KEY !== undefined) {
    return {
      endpoint,
      bucket,
      accessKeyId: env.TB_R2_ACCESS_KEY_ID,
      secretAccessKey: env.TB_R2_SECRET_ACCESS_KEY,
    }
  }
  return undefined
}

/** Env → TbAppDeps(Workers 宿主适配:KV/R2/DO/Static Assets → Proto §7 四注入点)。 */
function depsFromEnv(env: Env): TbAppDeps {
  const state: StateStore = new KvStateStore(env.TB_KV)
  const secrets = new SecretStoreImpl(state, env.TB_SECRET_ENCRYPTION_KEY)
  const deps: TbAppDeps = {
    state,
    secrets,
    version: pkg.version,
    ensureReady: () => ensureBootstrapped(state, env),
    remote: remoteSettingsFromEnv(env),
    allowInsecureHttp: allowInsecure(env),
    objects: async () => createR2ObjectStore(env.TB_R2, await r2PresignCredentials(env, secrets)),
    device: {
      invoke: (deviceId, req) => env.TB_DEVICE.getByName(deviceId).invoke(req),
      ws: async (deviceId, request) => await env.TB_DEVICE.getByName(deviceId).fetch(request),
    },
  }
  if (env.TB_SECRET_ENCRYPTION_KEY !== undefined) deps.encryptionKey = env.TB_SECRET_ENCRYPTION_KEY
  const assets = env.ASSETS
  if (assets !== undefined) deps.assets = (request) => assets.fetch(request)
  const ttl = positiveIntEnv(env.TB_TOOL_CACHE_TTL)
  if (ttl !== undefined) deps.toolCacheTtlSec = ttl
  const refThreshold = positiveIntEnv(env.TB_REF_THRESHOLD_BYTES)
  if (refThreshold !== undefined) deps.refThresholdBytes = refThreshold
  const refTtl = positiveIntEnv(env.TB_REF_TTL_SEC)
  if (refTtl !== undefined) deps.refTtlSec = refTtl
  return deps
}

/**
 * Workers 入口的 Hono app。Workers 的 env 只在请求期可得,故每 isolate 按 env 惰性
 * 装配一次 tb app(env 对象在同一 isolate 内稳定,WeakMap 命中;跨 isolate 各自装配)。
 */
export function createApp(): Hono<{ Bindings: Env }> {
  const apps = new WeakMap<Env, ReturnType<typeof createTbApp>>()
  const appFor = (env: Env): ReturnType<typeof createTbApp> => {
    let app = apps.get(env)
    if (app === undefined) {
      app = createTbApp(depsFromEnv(env))
      apps.set(env, app)
    }
    return app
  }
  const outer = new Hono<{ Bindings: Env }>()
  outer.all('*', (c) => appFor(c.env).fetch(c.req.raw))
  return outer
}
