/**
 * createTbServer:Node 宿主装配(对位 gateway/src/app.ts 的 depsFromEnv)。
 *
 * StateStore/SearchIndex 后端二选一:给 TB_DATABASE_URL 走 Postgres,
 * 否则走 dataDir 下的 SQLite。ObjectStore 始终是 fs。HTTP 用 @hono/node-server;
 * 引导在 start() 时直调宿主中立 runBootstrap(Node 有真实启动点,不需要 Workers 的
 * per-request once,故不注入 deps.ensureReady)。设备通道(DeviceHub)与 /ui 静态托管
 * 由后续装配点注入(deps.device / deps.assets)。
 */

import type * as http from 'node:http'
import {
  cleanupDefaultStore,
  createS3ObjectStore,
  createTbApp,
  type ReadinessReport,
  runBootstrap,
  type TbAppDeps,
} from '@tool-bridge/app'
import { type MutableSearchIndex, SecretStoreImpl, type StateStore } from '@tool-bridge/core'
import { serve, type ServerType } from '@hono/node-server'
import postgres, { type Sql } from 'postgres'
import { mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { ServerConfig } from './config'
import { RedisDeviceRouterBackend } from './redisDeviceRouter'
import pkg from '../package.json' with { type: 'json' }
import { SqliteSearchIndex } from './sqliteSearchIndex'
import { SqliteStateStore } from './sqliteStateStore'
import { createDataObjectStore } from './objects'
import { PgSearchIndex } from './pgSearchIndex'
import { PgStateStore } from './pgStateStore'
import { DeviceRouter } from './deviceRouter'
import { resolveUiAssets } from './assets'
import { DeviceHub } from './deviceHub'

export interface TbServer {
  app: ReturnType<typeof createTbApp>
  close(): Promise<void>
  deviceHub: DeviceHub
  search: MutableSearchIndex
  /** 引导(幂等)+ 孤儿设备回收排程 + 监听;返回实际端口(config.port=0 时由系统分配)。 */
  start(): Promise<{ port: number }>
  /**
   * 进入 draining:/readyz 立即转 503(编排器摘流量),但继续服务既有与新到请求。
   * SIGTERM 处理器先调它、等一拍(TB_SHUTDOWN_DRAIN_SEC)再 close(),避免 k8s
   * endpoint 摘除传播期间仍被路由过来的请求吃闭门羹。幂等。
   */
  startDraining(): void
  state: StateStore
}

/**
 * 单个后端资源的生命周期句柄。
 *
 * state 与 search 各自独立成一个 —— 它们是**两个**注入点,不该被绑成"全 PG / 全
 * SQLite"两条路:那样就没法组合"PG 状态 + 外部搜索引擎"或"SQLite 状态 + PG 搜索"。
 * `SqlSearchDialect` 只是 SQL 实现之间的复用层,不是后端选择的边界。
 */
interface BackendResource<T> {
  close: () => Promise<void>
  /** 异步建表等就绪动作;必须早于任何读写(SQLite 构造时已建好,故为 no-op)。 */
  ensureReady: () => Promise<void>
  /** 连通性探测(/readyz);缺省 = 无长连接可断(SQLite 进程内文件),恒视为 ok。 */
  ping?: () => Promise<void>
  value: T
}

/** 共享一个 PG 连接池的 state + search(同库时只开一个池)。 */
function pgBackends(databaseUrl: string): {
  search: BackendResource<MutableSearchIndex>
  state: BackendResource<StateStore>
} {
  const sql: Sql = postgres(databaseUrl, { onnotice: () => {} })
  const state = new PgStateStore(sql)
  const search = new PgSearchIndex(sql)
  // 池由两者共用:只在 state 侧关闭,search 侧不重复 end()。
  return {
    state: {
      value: state,
      ensureReady: async () => await state.ensureSchema(),
      ping: async () => {
        await sql`SELECT 1`
      },
      close: async () => await sql.end({ timeout: 5 }),
    },
    search: {
      value: search,
      ensureReady: async () => {
        await search.initialized()
      },
      close: async () => {},
    },
  }
}

function sqliteStateBackend(dataDir: string): BackendResource<StateStore> {
  const store = new SqliteStateStore(join(dataDir, 'state.sqlite3'))
  return {
    value: store,
    ensureReady: async () => {},
    close: async () => store.close(),
  }
}

function sqliteSearchBackend(dataDir: string): BackendResource<MutableSearchIndex> {
  const index = new SqliteSearchIndex(join(dataDir, 'state.sqlite3'))
  return {
    value: index,
    ensureReady: async () => {},
    close: async () => index.close(),
  }
}

/**
 * 按 config 解析出 state 与 search 两个后端。
 *
 * 当前组合:同一个 `TB_DATABASE_URL` 同时驱动两者(共用连接池),或都落在 dataDir
 * 的 SQLite。两者已各自独立,后续接外部搜索引擎(OpenSearch/Meili 等)只需在 search
 * 侧加分支,不动 state 侧。
 */
function resolveBackends(config: ServerConfig): {
  search: BackendResource<MutableSearchIndex>
  state: BackendResource<StateStore>
} {
  if (config.databaseUrl !== undefined) return pgBackends(config.databaseUrl)
  const state = sqliteStateBackend(config.dataDir)
  try {
    return { search: sqliteSearchBackend(config.dataDir), state }
  } catch (error) {
    // search 构造失败不能泄漏已开的 state 句柄(SQLite 打开会真的持有文件)。
    // close() 的 rejection 必须就地吞掉:这里已在抛原始错误的路上,
    // 悬空的 Promise 会变成 unhandled rejection 污染其它测试/进程。
    state.close().catch(() => {})
    throw error
  }
}

export function createTbServer(config: ServerConfig): TbServer {
  mkdirSync(config.dataDir, { recursive: true })
  const backends = resolveBackends(config)
  const state = backends.state.value
  const search = backends.search.value
  const secrets = new SecretStoreImpl(state, config.encryptionKey)
  // 部署级对象存储(default Store 与对象 Context 共用):配了 S3/R2 就用它
  // (可无状态横向扩容、支持 presign 直连),
  // 否则回退 dataDir 下的本地 FS(单副本;容器重建即丢)。
  const objects = config.objectStore === undefined
    ? createDataObjectStore(config.dataDir)
    : createS3ObjectStore(config.objectStore, { allowInsecure: config.allowInsecureHttp })
  // Redis backend 提出来单独持有:readiness 探测要 ping 它,不能埋在 router 工厂闭包里。
  const redisBackend = config.redisUrl === undefined
    ? undefined
    : new RedisDeviceRouterBackend(config.redisUrl)
  const hub = new DeviceHub({
    store: state,
    search,
    reclaimSec: config.deviceReclaimSec,
    // 配了 Redis 才启用多副本路由;缺省单副本,设备调用恒走本地 socket。
    ...(redisBackend === undefined
      ? {}
      : {
          router: onLocalCall => new DeviceRouter(
            config.replicaId ?? hostname(),
            redisBackend,
            { onLocalCall },
          ),
        }),
  })

  // draining:SIGTERM 后置位,/readyz 立即转 503;进程仍继续服务到 close()。
  let draining = false

  /** 单项探测:限时 1s——探针不能反过来拖垮进程(PG 挂起时探测也会挂起)。 */
  const probeOne = async (fn: () => Promise<void>): Promise<{ detail?: string, ok: boolean }> => {
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout after 1000ms')), 1000)
          timer.unref?.()
        }),
      ])
      return { ok: true }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : 'probe failed' }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  const readiness = async (): Promise<ReadinessReport> => {
    const checks: ReadinessReport['checks'] = {}
    const probes: Array<Promise<void>> = []
    const statePing = backends.state.ping
    if (statePing !== undefined) {
      probes.push(probeOne(statePing).then((r) => {
        checks.state = r
      }))
    }
    if (redisBackend !== undefined) {
      probes.push(probeOne(async () => await redisBackend.ping()).then((r) => {
        checks.redis = r
      }))
    }
    await Promise.all(probes)
    if (draining) checks.draining = { ok: false, detail: 'shutting down' }
    return { checks, ready: !draining && Object.values(checks).every(c => c.ok) }
  }

  const deps: TbAppDeps = {
    state,
    secrets,
    version: pkg.version,
    remote: config.remote,
    search,
    allowInsecureHttp: config.allowInsecureHttp,
    objects: () => objects,
    device: hub,
    readiness,
  }
  if (config.encryptionKey !== undefined) deps.encryptionKey = config.encryptionKey
  if (config.pluginBindings !== undefined) deps.pluginBindings = config.pluginBindings
  if (config.pluginCatalog !== undefined) deps.pluginCatalog = config.pluginCatalog
  // 规范 origin(与 Workers app.ts 对等):给出即钉死 OAuth redirect_uri。
  if (config.canonicalOrigin !== undefined) deps.canonicalOrigin = config.canonicalOrigin
  const assets = resolveUiAssets(config.uiDir)
  if (assets !== undefined) deps.assets = assets
  if (config.toolCacheTtlSec !== undefined) deps.toolCacheTtlSec = config.toolCacheTtlSec
  if (config.refThresholdBytes !== undefined) deps.refThresholdBytes = config.refThresholdBytes
  if (config.refTtlSec !== undefined) deps.refTtlSec = config.refTtlSec
  if (config.uploadGrantTtlSec !== undefined) {
    deps.uploadGrantTtlSec = config.uploadGrantTtlSec
  }
  if (config.storeTokenSecret !== undefined) deps.storeTokenSecret = config.storeTokenSecret
  if (config.storeMaxObjectBytes !== undefined) {
    deps.storeMaxObjectBytes = config.storeMaxObjectBytes
  }
  if (config.storeRelayMaxBytes !== undefined) {
    deps.storeRelayMaxBytes = config.storeRelayMaxBytes
  }
  if (config.storeUploadTtlSec !== undefined) deps.storeUploadTtlSec = config.storeUploadTtlSec
  if (config.storeShareTtlSec !== undefined) deps.storeShareTtlSec = config.storeShareTtlSec
  if (config.storeReadTtlSec !== undefined) deps.storeReadTtlSec = config.storeReadTtlSec
  if (config.storeCallMaxBytes !== undefined) deps.storeCallMaxBytes = config.storeCallMaxBytes
  if (config.storeCallMaxObjectBytes !== undefined) {
    deps.storeCallMaxObjectBytes = config.storeCallMaxObjectBytes
  }
  if (config.storeCallMaxObjects !== undefined) {
    deps.storeCallMaxObjects = config.storeCallMaxObjects
  }
  if (config.storeCallAllowedContentTypes !== undefined) {
    deps.storeCallAllowedContentTypes = config.storeCallAllowedContentTypes
  }

  const app = createTbApp(deps)

  let server: ServerType | undefined
  let storeCleanupTimer: NodeJS.Timeout | undefined
  let storeCleanupInFlight = false
  const runStoreCleanup = async (): Promise<void> => {
    if (storeCleanupInFlight) return
    storeCleanupInFlight = true
    try {
      await cleanupDefaultStore(deps)
    } finally {
      storeCleanupInFlight = false
    }
  }
  const reportStoreCleanupFailure = (): void => {
    // 固定事件名，不把可能含 driver key 的底层错误写进日志。
    console.warn(JSON.stringify({ event: 'tool_bridge_store_cleanup_failed' }))
  }
  const scheduleStoreCleanup = (): void => {
    // 首次 cleanup 在端口就绪后异步执行；历史对象多时不得阻塞 readiness。
    void runStoreCleanup().catch(reportStoreCleanupFailure)
    storeCleanupTimer = setInterval(() => {
      void runStoreCleanup().catch(reportStoreCleanupFailure)
    }, config.storeCleanupIntervalSec * 1000)
    storeCleanupTimer.unref?.()
  }
  return {
    app,
    search,
    state,
    deviceHub: hub,
    async start(): Promise<{ port: number }> {
      // 两个后端各自就绪(PG 建表 / SQLite no-op);state 必须早于 runBootstrap 的读写。
      await backends.state.ensureReady()
      await backends.search.ensureReady()
      // 多副本路由必须在开始服务前订阅完成,否则早期转发调用会丢。
      await hub.startRouter()
      // fail closed:缺 TB_BOOTSTRAP_ADMIN_SK 时默认拒绝启动(不随机生成 Admin SK 写 stdout);
      // 仅 TB_ALLOW_INSECURE_BOOTSTRAP=true 的本地/一次性开发保留旧的随机生成+打印一次路径。
      await runBootstrap(state, {
        ...(config.adminSk !== undefined ? { adminSk: config.adminSk } : {}),
        requireAdminSk: !config.allowInsecureBootstrap,
      })
      await hub.sweepOrphans()
      return await new Promise((resolve) => {
        server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
          // 并发 tick 直接跳过，避免慢后端堆积 cleanup 扫描。
          scheduleStoreCleanup()
          resolve({ port: info.port })
        })
        hub.attach(server as http.Server)
      })
    },
    startDraining(): void {
      draining = true
    },
    async close(): Promise<void> {
      // 顺序即关停语义:先停止接受新连接(既有请求继续跑完),再终止设备 WS,最后等
      // HTTP 排空、关后端。反过来(旧序:先杀 hub)会出现"设备通道已死、HTTP 还在收
      // 新请求"的窗口——期间到达的设备调用一律误报离线。
      draining = true
      if (storeCleanupTimer !== undefined) {
        clearInterval(storeCleanupTimer)
        storeCleanupTimer = undefined
      }
      let closed: Promise<void> | undefined
      if (server !== undefined) {
        const s = server
        closed = new Promise<void>((resolve, reject) => {
          s.close(err => (err ? reject(err) : resolve()))
        })
        // keep-alive 空闲连接会让 close 永远等不完;设备 WS 由 hub.close() 终止。
        ;(s as http.Server).closeIdleConnections?.()
      }
      await hub.close()
      if (closed !== undefined) await closed
      server = undefined
      // search 先关(可能依赖 state 侧的连接池),再关 state。
      await backends.search.close()
      await backends.state.close()
    },
  }
}
