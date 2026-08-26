import {
  cleanupDefaultStore,
  createTbApp,
  ensureBootstrapped,
  parseS3Credentials,
  type PluginBindings,
  type TbAppDeps,
} from '@tool-bridge/app'
import {
  type BuiltinCatalog,
  parseRuntimeEnv,
  type RuntimeEnvConfig,
  SecretStoreImpl,
  type StateStore,
} from '@tool-bridge/core'
import { createGuardedFetch } from '@tool-bridge/plugins/guarded-fetch'
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
  /** 联邦搜索并发上限（默认 4）。 */
  TB_SEARCH_FEDERATION_CONCURRENCY?: string
  /** 联邦搜索总 deadline 毫秒（默认 2500）。 */
  TB_SEARCH_FEDERATION_DEADLINE_MS?: string
  /** 单个远端联邦响应体字节上限（默认 512 KiB）。 */
  TB_SEARCH_FEDERATION_MAX_RESPONSE_BYTES?: string
  /** 整棵查询可参与的 source 总数（默认 16）。 */
  TB_SEARCH_FEDERATION_MAX_SOURCES?: string
  /** 发起 child 查询所需最小剩余工作时间（默认 200ms）。 */
  TB_SEARCH_FEDERATION_MIN_CHILD_WORK_MS?: string
  /** 每跳为响应回传预留的时间（默认 100ms）。 */
  TB_SEARCH_FEDERATION_RETURN_RESERVE_MS?: string
  /** 联邦 continuation session TTL 秒（默认 300）。 */
  TB_SEARCH_FEDERATION_SESSION_TTL_SEC?: string
  TB_SECRET_ENCRYPTION_KEY?: string
  /** 权威 StateStore(D1;ADR-001 从 KV 迁入,强一致 + 原子 putIfAbsent)。 */
  TB_STATE: D1Database
  /** Store 设备调用 capability 允许的 MIME pattern（逗号分隔）。 */
  TB_STORE_CALL_ALLOWED_CONTENT_TYPES?: string
  /** Store 设备调用 capability 的总字节上限。 */
  TB_STORE_CALL_MAX_BYTES?: string
  /** Store 设备调用单对象字节上限。 */
  TB_STORE_CALL_MAX_OBJECT_BYTES?: string
  /** Store 设备调用最多上传对象数。 */
  TB_STORE_CALL_MAX_OBJECTS?: string
  /** Store 对象统一上限；有 signer 的 direct upload 可使用完整值。 */
  TB_STORE_MAX_OBJECT_BYTES?: string
  TB_STORE_READ_TTL_SEC?: string
  /** Worker relay 的有效 body 上限；缺省保守低于最低公开 plan 上限。 */
  TB_STORE_RELAY_MAX_BYTES?: string
  TB_STORE_SHARE_TTL_SEC?: string
  /** 显式 Store token 根密钥；缺省在 D1 原子生成并持久化。 */
  TB_STORE_TOKEN_SECRET?: string
  TB_STORE_UPLOAD_TTL_SEC?: string
  /** opt-in 集成测试:真实 MCP echo server 的 URL(仅测试注入)。 */
  TB_TEST_MCP_URL?: string
  TB_TEST_S3_ACCESS_KEY_ID?: string
  TB_TEST_S3_BUCKET?: string
  /** opt-in 集成测试:S3 兼容端点与凭证(仅测试注入)。 */
  TB_TEST_S3_ENDPOINT?: string
  TB_TEST_S3_SECRET_ACCESS_KEY?: string
  /** mcp 工具缓存 TTL 秒(默认 300)。 */
  TB_TOOL_CACHE_TTL?: string
  /** create_upload 写入 grant 有效期秒；缺省 min(TB_REF_TTL_SEC, 900)。 */
  TB_UPLOAD_GRANT_TTL_SEC?: string
}

const SLOW_REQUEST_MS = 500
const providerOAuthFetch = createGuardedFetch({ crossOriginRedirect: 'error' })
// Workers 最低公开 plan 的请求 body 上限为 100 MB；保留协议/平台余量。
const DEFAULT_WORKER_STORE_RELAY_MAX_BYTES = 90 * 1024 * 1024

interface SharedEnvResources {
  pluginBindings?: PluginBindings
  runtime: RuntimeEnvConfig
  searchSchema?: D1SchemaGate
  stateSchema: D1SchemaGate
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

/**
 * 请求级异步工厂 memoize。depsFromEnv 每个 HTTP 请求重建，因此闭包绝不跨请求持有
 * D1/R2 I/O 对象；同请求的 help/describe/invoke 则共享一次 secret 解析与 store 构造。
 */
export function memoizeRequestFactory<T>(
  factory: () => Promise<T> | T,
): () => Promise<T> {
  let pending: Promise<T> | undefined
  return () => {
    pending ??= Promise.resolve().then(factory)
    return pending
  }
}

/** Env + 请求级 D1 session → TbAppDeps(D1 SearchIndex 是第五个宿主注入点)。 */
export function depsFromEnv(
  env: Env,
  state: StateStore,
  search: D1SearchIndex | undefined,
  runtime: RuntimeEnvConfig,
): TbAppDeps {
  const secrets = new SecretStoreImpl(state, env.TB_SECRET_ENCRYPTION_KEY)
  const objects = memoizeRequestFactory(async () =>
    createR2ObjectStore(env.TB_R2, await r2PresignCredentials(env, secrets)))
  const {
    deviceReclaimSec: _deviceReclaimSec,
    storeCleanupIntervalSec: _storeCleanupIntervalSec,
    ...appRuntime
  } = runtime
  // 这两项属于宿主调度，不进入请求级 TbAppDeps；显式消费以保持其余配置可直接展开。
  void _deviceReclaimSec
  void _storeCleanupIntervalSec
  const deps: TbAppDeps = {
    ...appRuntime,
    state,
    secrets,
    providerOAuthFetch,
    version: pkg.version,
    ensureReady: () => ensureBootstrapped(state, env),
    objects,
    device: {
      invoke: (deviceId, req) => env.TB_DEVICE.getByName(deviceId).invoke(req),
      ws: async (deviceId, request) => await env.TB_DEVICE.getByName(deviceId).fetch(request),
    },
    storeRelayMaxBytes:
      runtime.storeRelayMaxBytes ?? DEFAULT_WORKER_STORE_RELAY_MAX_BYTES,
  }
  if (search !== undefined) deps.search = search
  if (env.TB_SECRET_ENCRYPTION_KEY !== undefined) deps.encryptionKey = env.TB_SECRET_ENCRYPTION_KEY
  const assets = env.ASSETS
  if (assets !== undefined) deps.assets = request => assets.fetch(request)
  return deps
}

/** Workers Cron Trigger 入口：按请求同构方式创建短生命周期 D1/R2 adapter 后清理 Store。 */
export async function cleanupDefaultStoreFromEnv(env: Env): Promise<void> {
  const metrics = new D1RequestMetrics()
  const state = new D1StateStore(env.TB_STATE.withSession('first-primary'), {
    metrics,
    schema: createD1StateSchema(env.TB_STATE),
  })
  await cleanupDefaultStore(depsFromEnv(env, state, undefined, parseRuntimeEnv(env)))
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

/** Capability-bearing path segments must never enter platform logs. */
export function safeRequestLogPath(requestUrl: string): string {
  const path = new URL(requestUrl).pathname
  if (/^\/~ref\/[^/]+$/.test(path)) return '/~ref/<redacted>'
  if (/^\/~store\/(?:refs|shares)\/[^/]+$/.test(path)) {
    const family = path.startsWith('/~store/refs/') ? 'refs' : 'shares'
    return `/~store/${family}/<redacted>`
  }
  return path
}

function logSlowRequest(request: Request, metrics: D1RequestMetrics, totalMs: number): void {
  if (totalMs < SLOW_REQUEST_MS) return
  console.warn(JSON.stringify({
    event: 'tool_bridge_slow_request',
    colo: request.cf?.colo,
    d1: metrics.snapshot(),
    durationMs: Number(totalMs.toFixed(1)),
    method: request.method,
    path: safeRequestLogPath(request.url),
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
        runtime: parseRuntimeEnv(env),
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
      ...depsFromEnv(env, state, search, shared.runtime),
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
