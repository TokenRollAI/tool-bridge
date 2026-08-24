import {
  createTbApp,
  ensureBootstrapped,
  parseS3Credentials,
  type PluginBindings,
  type RemoteSettings,
  type TbAppDeps,
} from '@tool-bridge/app'
import {
  type BuiltinCatalog,
  normalizeCanonicalOrigin,
  SecretStoreImpl,
  type StateStore,
} from '@tool-bridge/core'
import { Hono } from 'hono'
import type { DeviceSession } from './deviceSession'
import { createR2ObjectStore, type R2PresignCredentials } from './providers/r2Object'
import { createD1SearchSchema, D1SearchIndex } from './search/d1SearchIndex'
import { createD1StateSchema, D1StateStore } from './d1StateStore'
import { D1RequestMetrics, type D1SchemaGate } from './d1Runtime'
import pkg from '../package.json' with { type: 'json' }

/**
 * Workers 运行时绑定。D1/R2 名称从 TB_NAME_PREFIX 派生(wrangler.jsonc)。
 * TB_SECRET_ENCRYPTION_KEY / TB_BOOTSTRAP_ADMIN_SK 经 wrangler secret 或 .dev.vars 注入。
 */
export interface Env {
  /** Dashboard 静态资源(Workers Static Assets;本地测试/未部署 UI 时可缺省)。 */
  ASSETS?: Fetcher
  /** 放行 http:// 上游(仅本地开发)。 */
  TB_ALLOW_INSECURE_HTTP?: string
  TB_BOOTSTRAP_ADMIN_SK?: string
  /**
   * 规范网关 origin(如 https://tool-bridge.example.com)。多域名部署时钉死 OAuth
   * redirect_uri,防授权 code 跨域互换;缺省用请求期 origin(单域名行为不变)。
   */
  TB_CANONICAL_ORIGIN?: string
  /** DeviceSession Durable Object(设备 WS hibernation)。 */
  TB_DEVICE: DurableObjectNamespace<DeviceSession>
  /** 设备断线后未重连的回收秒数(缺省 24h)。 */
  TB_DEVICE_RECLAIM_SEC?: string
  /** 本实例 X-TB-Via 标识(缺省用入站 host 派生)。 */
  TB_INSTANCE_ID?: string
  /** X-TB-Via 跳数上限(默认 4)。 */
  TB_MAX_HOPS?: string
  TB_R2: R2Bucket
  /** r2 presign 凭证链的 env 段(SecretStore 'r2-presign' 优先)。 */
  TB_R2_ACCESS_KEY_ID?: string
  TB_R2_BUCKET?: string
  /** r2 presign 的 S3 兼容端点(https://<account>.r2.cloudflarestorage.com)与 bucket。 */
  TB_R2_S3_ENDPOINT?: string
  TB_R2_SECRET_ACCESS_KEY?: string
  /** context Get 的 $ref 内联阈值(字节,缺省 1 MiB)。 */
  TB_REF_THRESHOLD_BYTES?: string
  /** $ref URL(presign 与 /~ref 中转)有效期秒(缺省 900)。 */
  TB_REF_TTL_SEC?: string
  /** remote baseUrl 的 host 后缀白名单(逗号分隔;空 = 拒一切 remote)。 */
  TB_REMOTE_ALLOWLIST?: string
  /** 纯 LIKE 工具搜索索引；发布包宿主未配置 binding 时不暴露 search capability。 */
  TB_SEARCH?: D1Database
  TB_SECRET_ENCRYPTION_KEY?: string
  /** 权威 StateStore(D1;ADR-001 从 KV 迁入,强一致 + 原子 putIfAbsent)。 */
  TB_STATE: D1Database
  /** opt-in 集成测试:真实 MCP echo server 的 URL(仅测试注入)。 */
  TB_TEST_MCP_URL?: string
  TB_TEST_S3_ACCESS_KEY_ID?: string
  TB_TEST_S3_BUCKET?: string
  /** opt-in 集成测试:S3 兼容端点与凭证(仅测试注入)。 */
  TB_TEST_S3_ENDPOINT?: string
  TB_TEST_S3_SECRET_ACCESS_KEY?: string
  /** mcp 工具缓存 TTL 秒(默认 300)。 */
  TB_TOOL_CACHE_TTL?: string
}

/** http:// 上游是否放行(env `TB_ALLOW_INSECURE_HTTP=true`,仅本地开发)。 */
function allowInsecure(env: Env): boolean {
  return env.TB_ALLOW_INSECURE_HTTP === 'true'
}

const DEFAULT_MAX_HOPS = 4
const SLOW_REQUEST_MS = 500

interface SharedEnvResources {
  pluginBindings?: PluginBindings
  searchSchema?: D1SchemaGate
  stateSchema: D1SchemaGate
}

/** env → remote 透传配置(TB_REMOTE_ALLOWLIST 逗号分隔;TB_MAX_HOPS 缺省 4)。 */
function remoteSettingsFromEnv(env: Env): RemoteSettings {
  const allowlist = (env.TB_REMOTE_ALLOWLIST ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
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
 * r2 presign 凭证链(按序):SecretStore 保留名 'r2-presign' →
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

/** Env + 请求级 D1 session → TbAppDeps(D1 SearchIndex 是第五个宿主注入点)。 */
function depsFromEnv(
  env: Env,
  state: StateStore,
  search: D1SearchIndex | undefined,
): TbAppDeps {
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
  if (search !== undefined) deps.search = search
  if (env.TB_SECRET_ENCRYPTION_KEY !== undefined) deps.encryptionKey = env.TB_SECRET_ENCRYPTION_KEY
  const canonicalOrigin = normalizeCanonicalOrigin(env.TB_CANONICAL_ORIGIN)
  if (canonicalOrigin !== undefined) deps.canonicalOrigin = canonicalOrigin
  const assets = env.ASSETS
  if (assets !== undefined) deps.assets = request => assets.fetch(request)
  const ttl = positiveIntEnv(env.TB_TOOL_CACHE_TTL)
  if (ttl !== undefined) deps.toolCacheTtlSec = ttl
  const refThreshold = positiveIntEnv(env.TB_REF_THRESHOLD_BYTES)
  if (refThreshold !== undefined) deps.refThresholdBytes = refThreshold
  const refTtl = positiveIntEnv(env.TB_REF_TTL_SEC)
  if (refTtl !== undefined) deps.refTtlSec = refTtl
  return deps
}

function withServerTiming(response: Response, metrics: D1RequestMetrics, totalMs: number): Response {
  // 101 Response 不能由 Web Response 构造器重建，否则会丢失 webSocket 句柄。
  if (response.status === 101) return response
  const headers = new Headers(response.headers)
  const d1 = metrics.serverTiming()
  if (d1 !== undefined) headers.append('server-timing', d1)
  headers.append('server-timing', `tb-worker;dur=${totalMs.toFixed(1)}`)
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

function logSlowRequest(request: Request, metrics: D1RequestMetrics, totalMs: number): void {
  if (totalMs < SLOW_REQUEST_MS) return
  console.warn(JSON.stringify({
    event: 'tool_bridge_slow_request',
    colo: request.cf?.colo,
    d1: metrics.snapshot(),
    durationMs: Number(totalMs.toFixed(1)),
    method: request.method,
    path: new URL(request.url).pathname,
  }))
}

/**
 * Workers 入口的 Hono app。Workers 的 env 只在请求期可得,故 schema gate 与插件 binding
 * 每 isolate 按 env 惰性装配一次；tb app / StateStore / SearchIndex 则按请求创建，从而让
 * 一个 HTTP 请求内的权威 State 操作共享一个 bookmark、Search 操作共享另一个 bookmark，
 * 且不把任何 session 跨请求复用。
 *
 * `opts.pluginBindings`:进程内插件装配表(构建期打包进 Worker 的插件集合按名直调)。
 * 可以直接给一张表,也可以给一个 **`(env) => 表`** 的工厂 —— 后者是内置目录需要的形态:
 * `builtinPluginBindings(env)` 要读 env(它内部按白名单收窄后递给插件),而 env 在
 * `createApp()` 调用时还不存在。工厂结果按 env 缓存,每 isolate 只建一次。
 *
 * `opts.pluginCatalog`:那些插件的 descriptor(编译期常量,不读 env,故不需要工厂)。
 * 与 bindings **应当同源装配** —— 只给 bindings 的话插件调得动但解析不出 export。
 */
export function createApp(
  opts: {
    pluginBindings?: PluginBindings | ((env: Env) => PluginBindings)
    pluginCatalog?: BuiltinCatalog
  } = {},
): Hono<{ Bindings: Env }> {
  const resources = new WeakMap<Env, SharedEnvResources>()
  const resourcesFor = (env: Env): SharedEnvResources => {
    let shared = resources.get(env)
    if (shared === undefined) {
      const pluginBindings
        = typeof opts.pluginBindings === 'function' ? opts.pluginBindings(env) : opts.pluginBindings
      shared = {
        stateSchema: createD1StateSchema(env.TB_STATE),
        ...(env.TB_SEARCH === undefined
          ? {}
          : { searchSchema: createD1SearchSchema(env.TB_SEARCH) }),
        ...(pluginBindings === undefined ? {} : { pluginBindings }),
      }
      resources.set(env, shared)
    }
    return shared
  }
  const outer = new Hono<{ Bindings: Env }>()
  outer.all('*', async (c) => {
    const started = performance.now()
    const env = c.env
    const shared = resourcesFor(env)
    const metrics = new D1RequestMetrics()
    // State 首读必须命中 primary：SK 吊销与权限收紧仍保持立即生效。Search 也从
    // primary 起步，避免首次惰性建表尚未复制时命中旧副本；两边后续查询都可由满足
    // bookmark 的副本服务。
    const state = new D1StateStore(env.TB_STATE.withSession('first-primary'), {
      metrics,
      schema: shared.stateSchema,
    })
    const search = env.TB_SEARCH === undefined || shared.searchSchema === undefined
      ? undefined
      : new D1SearchIndex(env.TB_SEARCH.withSession('first-primary'), {
          metrics,
          schema: shared.searchSchema,
        })
    const app = createTbApp({
      ...depsFromEnv(env, state, search),
      ...(shared.pluginBindings !== undefined ? { pluginBindings: shared.pluginBindings } : {}),
      ...(opts.pluginCatalog !== undefined ? { pluginCatalog: opts.pluginCatalog } : {}),
    })
    const response = await app.fetch(c.req.raw)
    const totalMs = performance.now() - started
    logSlowRequest(c.req.raw, metrics, totalMs)
    return withServerTiming(response, metrics, totalMs)
  })
  return outer
}
