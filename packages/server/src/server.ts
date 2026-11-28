import type * as http from 'node:http'
import {
  type MutableSearchIndex,
  type RuntimeConfig,
  runtimeConfigSchema,
  SecretStoreImpl,
  type StateStore,
  TBError,
} from '@tool-bridge/core'
import {
  cleanupDefaultStore,
  cleanupDeviceMailbox,
  createTbApp,
  type ReadinessReport,
  runBootstrap,
  type TbAppDeps,
} from '@tool-bridge/app'
import { createGuardedFetch } from '@tool-bridge/plugins/guarded-fetch'
import { AsyncLocalStorage } from 'node:async_hooks'
import postgres, { type Sql } from 'postgres'
import { serve } from '@hono/node-server'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { acquireRuntimeLease, assertRuntimeAuthority, type RuntimeLease } from './pgMaintenanceFence'
import { runtimeAppSettings, type ServerConfig } from './config'
import { RedisDeviceRouterBackend } from './redisDeviceRouter'
import { PgMailboxRepository } from './pgMailboxRepository'
import { pluginRunnerClient } from './pluginRunnerClient'
import { PgEventRepository } from './pgEventRepository'
import { DeploymentManager } from './deploymentManager'
import { PgStoreRepository } from './pgStoreRepository'
import pkg from '../package.json' with { type: 'json' }
import { trackResponseBody } from './responseLifecycle'
import { StorageManager } from './storageManager'
import { createS3ObjectStore } from './s3Objects'
import { ConfigManager } from './configManager'
import { PgSearchIndex } from './pgSearchIndex'
import { PgStateStore } from './pgStateStore'
import { DeviceRouter } from './deviceRouter'
import { createMcpOAuth } from './mcpOAuth'
import { resolveUiAssets } from './assets'
import { DeviceHub } from './deviceHub'

const providerOAuthFetch = createGuardedFetch({ crossOriginRedirect: 'error' })
const chatGptMetadataFetch = createGuardedFetch({ maxRedirects: 0 })

export interface TbServer {
  app: Hono
  close(options?: { excludeCurrentRequest?: boolean }): Promise<void>
  deviceHub: DeviceHub
  prepare(): Promise<void>
  search: MutableSearchIndex
  settings: ConfigManager
  readonly shutdownDrainSec: number
  /** 引导(幂等)+ 孤儿设备回收排程 + 监听;返回实际端口(config.port=0 时由系统分配)。 */
  start(): Promise<{ port: number }>
  /**
   * 进入 draining:/readyz 立即转 503(编排器摘流量),但继续服务既有与新到请求。
   * SIGTERM 处理器先调它、等已应用的 shutdownDrainSec 再 close(),避免 k8s
   * endpoint 摘除传播期间仍被路由过来的请求吃闭门羹。幂等。
   */
  startDraining(): void
  state: StateStore
  storage: StorageManager
}

export function createTbServer(config: ServerConfig, onOwnershipLost?: () => void): TbServer {
  if (!config.databaseUrl)
    throw new TBError(
      'unavailable',
      'PostgreSQL must be configured before starting business services',
    )
  const sql: Sql = postgres(config.databaseUrl, {
    onnotice: () => {},
    connect_timeout: 5,
  })
  const state = new PgStateStore(sql)
  const search = new PgSearchIndex(sql)
  const secrets = new SecretStoreImpl(
    state,
    config.encryptionKeyring ?? config.encryptionKey,
  )
  if (!secrets.available)
    throw new TBError('unavailable', 'a valid encryption root is required')
  const replicaId = config.replicaId ?? randomUUID()
  const deployment = new DeploymentManager(
    sql,
    config.instanceId ?? 'embedded',
  )
  const storeRepository = new PgStoreRepository(sql)
  const eventRepository = new PgEventRepository(sql)
  const eventStreamShutdown = new AbortController()
  const shutdown = new AbortController()
  const mailboxRepository = new PgMailboxRepository(sql)
  const storage = new StorageManager(sql, secrets, {
    ...(config.internalS3Origin
      ? { internalOrigin: config.internalS3Origin }
      : {}),
  })
  // Redis backend 提出来单独持有:readiness 探测要 ping 它,不能埋在 router 工厂闭包里。
  const redisBackend
    = config.redisUrl === undefined
      ? undefined
      : new RedisDeviceRouterBackend(config.redisUrl)
  const hub = new DeviceHub({
    store: state,
    search,
    reclaimSec: config.deviceReclaimSec,
    publishedReclaimSec: async () => {
      const [row] = await sql<{ seconds: number }[]>`SELECT (effective->>'deviceReclaimSec')::integer AS seconds
        FROM tb_runtime_config WHERE id=1`
      if (!row) throw new Error('no effective device retention')
      return row.seconds
    },
    // 配了 Redis 才启用多副本路由;缺省单副本,设备调用恒走本地 socket。
    ...(redisBackend === undefined
      ? {}
      : {
          router: onLocalCall =>
            new DeviceRouter(replicaId, redisBackend, { onLocalCall }),
        }),
  })

  // draining:SIGTERM 后置位,/readyz 立即转 503;进程仍继续服务到 close()。
  let draining = false
  let closing = false
  let preparedForTraffic = false
  const ownershipLost = new AbortController()
  const accepting = () => preparedForTraffic && !closing && !ownershipLost.signal.aborted
  const assertOpen = () => {
    if (closing || ownershipLost.signal.aborted)
      throw new TBError('unavailable', 'runtime is closed')
  }

  /** 单项探测:限时 1s——探针不能反过来拖垮进程(PG 挂起时探测也会挂起)。 */
  const probeOne = async (
    fn: () => Promise<void>,
  ): Promise<{ detail?: string, ok: boolean }> => {
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timeout after 1000ms')),
            1000,
          )
          timer.unref?.()
        }),
      ])
      return { ok: true }
    } catch {
      return { ok: false, detail: 'dependency unavailable' }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  const readiness = async (): Promise<ReadinessReport> => {
    if (!accepting()) return { ready: false, checks: { runtime: { ok: false, detail: 'runtime not accepting requests' } } }
    const checks: ReadinessReport['checks'] = {}
    const probes: Array<Promise<void>> = []
    probes.push(probeOne(() => assertRuntimeAuthority(sql, replicaId)).then((r) => {
      checks.state = r
    }))
    if (redisBackend !== undefined) {
      probes.push(
        probeOne(async () => await redisBackend.ping()).then((r) => {
          checks.redis = r
        }),
      )
    }
    probes.push(
      probeOne(async () => {
        const backend = await storage.defaultBackend()
        await backend.objects.head('__tool_bridge_internal__/health')
      }).then((result) => {
        checks.objects = result
      }),
    )
    await Promise.all(probes)
    if (draining) checks.draining = { ok: false, detail: 'shutting down' }
    return {
      checks,
      ready: !draining && Object.values(checks).every(c => c.ok),
    }
  }

  let deps: TbAppDeps = {
    state,
    secrets,
    providerOAuthFetch,
    ...(config.pluginRunnerSocket ? { preparePluginImage: pluginRunnerClient(config.pluginRunnerSocket) } : {}),
    version: pkg.version,
    remote: config.remote,
    search,
    allowInsecureHttp: config.allowInsecureHttp,
    objects: async () => (await storage.defaultBackend()).objects,
    defaultObjectBackend: () => storage.defaultBackend(),
    objectStoreForBackend: id => storage.resolveBackend(id),
    storeBackends: storage,
    storeRepository,
    mailboxRepository,
    eventRepository,
    eventStreamShutdown: eventStreamShutdown.signal,
    // In-process MCP calls can also enter the inner HTBP app.
    ensureReady: async () => ownershipLost.signal.throwIfAborted(),
    storageManagement: storage,
    deploymentManagement: deployment,
    ...(config.adminAudit ? { adminAudit: config.adminAudit } : {}),
    ...(config.maintenanceManagement
      ? { maintenanceManagement: config.maintenanceManagement }
      : {}),
    ...(config.keyManagement ? { keyManagement: config.keyManagement } : {}),
    s3Objects: connection =>
      createS3ObjectStore(connection, {
        ...(config.internalS3Origin
          ? { internalOrigin: config.internalS3Origin }
          : {}),
      }),
    device: hub,
    readiness,
  }
  if (config.encryptionKey !== undefined)
    deps.encryptionKey = config.oauthKey ?? config.encryptionKey
  if (config.encryptionKeyring)
    deps.encryptionKeyring = config.encryptionKeyring
  if (config.storeTokenKeyring)
    deps.storeTokenKeyring = config.storeTokenKeyring
  if (config.pluginBindings !== undefined)
    deps.pluginBindings = config.pluginBindings
  if (config.pluginCatalog !== undefined)
    deps.pluginCatalog = config.pluginCatalog
  // 规范 origin(与 Workers app.ts 对等):给出即钉死 OAuth redirect_uri。
  if (config.canonicalOrigin !== undefined)
    deps.canonicalOrigin = config.canonicalOrigin
  const assets = resolveUiAssets(config.uiDir)
  if (assets !== undefined) deps.assets = assets
  if (config.toolCacheTtlSec !== undefined)
    deps.toolCacheTtlSec = config.toolCacheTtlSec
  if (config.refThresholdBytes !== undefined)
    deps.refThresholdBytes = config.refThresholdBytes
  if (config.refTtlSec !== undefined) deps.refTtlSec = config.refTtlSec
  if (config.uploadGrantTtlSec !== undefined) {
    deps.uploadGrantTtlSec = config.uploadGrantTtlSec
  }
  if (config.storeTokenSecret !== undefined)
    deps.storeTokenSecret = config.storeTokenSecret
  if (config.storeMaxObjectBytes !== undefined) {
    deps.storeMaxObjectBytes = config.storeMaxObjectBytes
  }
  if (config.storeRelayMaxBytes !== undefined) {
    deps.storeRelayMaxBytes = config.storeRelayMaxBytes
  }
  if (config.storeUploadTtlSec !== undefined)
    deps.storeUploadTtlSec = config.storeUploadTtlSec
  if (config.storeShareTtlSec !== undefined)
    deps.storeShareTtlSec = config.storeShareTtlSec
  if (config.storeReadTtlSec !== undefined)
    deps.storeReadTtlSec = config.storeReadTtlSec
  if (config.storeCallMaxBytes !== undefined)
    deps.storeCallMaxBytes = config.storeCallMaxBytes
  if (config.storeCallMaxObjectBytes !== undefined) {
    deps.storeCallMaxObjectBytes = config.storeCallMaxObjectBytes
  }
  if (config.storeCallMaxObjects !== undefined) {
    deps.storeCallMaxObjects = config.storeCallMaxObjects
  }
  if (config.storeCallAllowedContentTypes !== undefined) {
    deps.storeCallAllowedContentTypes = config.storeCallAllowedContentTypes
  }

  let server: http.Server | undefined
  let listening: Promise<{ port: number }> | undefined
  let maintenanceTimer: NodeJS.Timeout | undefined
  let maintenancePromise: Promise<void> | undefined
  let replicaTimer: NodeJS.Timeout | undefined
  let heartbeatInFlight: Promise<void> | undefined
  let applied: RuntimeConfig | undefined
  const runMaintenance = async (): Promise<void> => {
    if (closing) return
    if (maintenancePromise) return maintenancePromise
    const snapshot = deps
    maintenancePromise = (async () => {
      await sql`DELETE FROM tb_kv WHERE key >= 'mcp-inbound:' AND key < 'mcp-inbound;'
        AND value->>'expiresAt' <= ${new Date().toISOString()}`
      if (ownershipLost.signal.aborted) return
      await eventRepository.cleanup()
      if (ownershipLost.signal.aborted) return
      await cleanupDefaultStore(snapshot)
      if (!ownershipLost.signal.aborted && snapshot.encryptionKey !== undefined)
        await cleanupDeviceMailbox(snapshot)
    })().finally(() => {
      maintenancePromise = undefined
    })
    return maintenancePromise
  }
  const reportStoreCleanupFailure = (): void => {
    // 固定事件名，不把可能含 driver key 的底层错误写进日志。
    console.warn(JSON.stringify({ event: 'tool_bridge_store_cleanup_failed' }))
  }
  function scheduleStoreCleanup(): void {
    // 首次 cleanup 在端口就绪后异步执行；历史对象多时不得阻塞 readiness。
    if (closing) return
    void runMaintenance().catch(reportStoreCleanupFailure)
    maintenanceTimer = setInterval(
      () => {
        void runMaintenance().catch(reportStoreCleanupFailure)
      },
      (applied?.storeCleanupIntervalSec ?? config.storeCleanupIntervalSec)
      * 1000,
    )
    maintenanceTimer.unref?.()
  }
  const buildApp = () => createTbApp({
    ...deps,
    mcpOAuth: createMcpOAuth(state, deps.canonicalOrigin, chatGptMetadataFetch),
  })
  let currentApp = buildApp()
  const settings = new ConfigManager(sql, async (next) => {
    deps = {
      ...deps,
      ...runtimeAppSettings(next, config.instanceId),
      configManagement: settings,
    }
    currentApp = buildApp()
  }, async (next) => {
    ownershipLost.signal.throwIfAborted()
    await hub.setReclaimSec(next.deviceReclaimSec)
    const reschedule
      = applied?.storeCleanupIntervalSec !== next.storeCleanupIntervalSec
    applied = next
    if (maintenanceTimer && reschedule) {
      clearInterval(maintenanceTimer)
      maintenanceTimer = undefined
      scheduleStoreCleanup()
    }
  })
  deps.configManagement = settings
  currentApp = buildApp()
  let activeRequests = 0
  const drainWaiters: Array<() => void> = []
  const requestContext = new AsyncLocalStorage<{ release(): void }>()
  const app = new Hono()
  app.mount('/', async (raw, env, executionCtx) => {
    const path = new URL(raw.url).pathname
    const read = raw.method === 'GET' || raw.method === 'HEAD'
    const probe = read && ['/healthz', '/livez', '/readyz'].includes(path)
    const unavailable = (message: string) => Response.json({ code: 'unavailable', message }, { status: 503 })
    if (!accepting()) {
      if (probe) return currentApp.fetch(raw, env, executionCtx)
      return unavailable('runtime not accepting requests')
    }
    const transport = AbortSignal.any([raw.signal, ownershipLost.signal])
    const signal = AbortSignal.any([transport, shutdown.signal])
    activeRequests++
    let released = false
    const request = {
      release: () => {
        if (released) return
        released = true
        if (--activeRequests === 0)
          for (const done of drainWaiters.splice(0)) done()
      },
    }
    return requestContext.run(request, async () => {
      try {
        if (!probe && !(read && (path === '/ui' || path.startsWith('/ui/')))) {
          try {
            await assertRuntimeAuthority(sql, replicaId)
            transport.throwIfAborted()
            await settings.sync()
          } catch {
            request.release()
            return unavailable('configuration authority unavailable')
          }
        }
        if (transport.aborted) {
          request.release()
          return unavailable('request interrupted before dispatch')
        }
        // A Request's signal alone does not interrupt json()/text() on a pending upload.
        // Keep graceful drain for admitted bodies, and fail partial reads on disconnect/loss.
        // Fetch forbids streaming input for keepalive and no-cors requests.
        const body = !raw.keepalive && raw.mode !== 'no-cors'
          ? raw.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), { signal: transport })
          : undefined
        try {
          const init = { signal, ...(body && { body, duplex: 'half' }) }
          const forwarded = new Request(raw, init)
          // The Node adapter represents TRACE with a GET-backed Request.
          if (forwarded.method !== raw.method) Object.defineProperty(forwarded, 'method', { value: raw.method })
          const response = await currentApp.fetch(forwarded, env, executionCtx)
          const sse = response.headers.get('content-type')?.split(';')[0] === 'text/event-stream'
          return trackResponseBody(response, request.release, sse ? AbortSignal.any([transport, eventStreamShutdown.signal]) : transport)
        } finally {
          // A rejected upload may never be consumed by the handler.
          if (body && !body.locked) void body.cancel().catch(() => {})
        }
      } catch (error) {
        request.release()
        throw error
      }
    })
  }, { replaceRequest: false })

  let prepared: Promise<void> | undefined
  let runtimeLease: RuntimeLease | undefined
  let closePromise: Promise<void> | undefined
  let listenerClosed: Promise<void> | undefined
  const stopListening = async (listener: http.Server) => {
    // listen(hostname) can still be resolving the address when ownership is lost.
    if (!listener.listening) await listening?.catch(() => {})
    if (!listener.listening) return
    await new Promise<void>((resolve, reject) => {
      listener.close(err => err ? reject(err) : resolve())
      listener.closeIdleConnections()
    })
  }
  const close: TbServer['close'] = async (options) => {
    // The caller is identified by its actual async request, after dispatch/auth,
    // not by an encoded URL prefix or a particular management entry point.
    const caller = options?.excludeCurrentRequest ? requestContext.getStore() : undefined
    caller?.release()
    if (!closePromise) {
      closing = true
      draining = true
      if (server) listenerClosed = stopListening(server)
      closePromise = Promise.resolve().then(async () => {
        eventStreamShutdown.abort()
        // Maintenance drains admitted calls, including the command that initiated it.
        if (!caller) shutdown.abort(new TBError('unavailable', 'runtime is shutting down'))
        if (maintenanceTimer !== undefined) {
          clearInterval(maintenanceTimer)
          maintenanceTimer = undefined
        }
        // Finish any pending orphan sweep before removing the hub's timers.
        if (!preparedForTraffic) await prepared?.catch(() => {})
        await hub.close()
        if (activeRequests > 0)
          await new Promise<void>(resolve => drainWaiters.push(resolve))
        await maintenancePromise?.catch(() => {})
        if (replicaTimer) clearInterval(replicaTimer)
        await heartbeatInFlight
        try {
          await runtimeLease?.release()
        } finally {
          storage.close()
          await eventRepository.close().finally(() => sql.end({ timeout: 5 }))
        }
      })
    }
    // A maintenance handler can own a socket on this listener. Let it send its
    // final response after runtime drain; external closers still wait for the socket.
    await Promise.all([closePromise, caller ? undefined : listenerClosed])
  }
  const prepare = async (): Promise<void> => {
    assertOpen()
    prepared ??= (async () => {
      const lease = await acquireRuntimeLease(sql, {
        instanceId: config.instanceId ?? 'embedded',
        replicaId,
        redisUrl: config.redisUrl,
        onLost: () => {
          if (ownershipLost.signal.aborted) return
          ownershipLost.abort(new TBError('unavailable', 'runtime ownership lost'))
          if (replicaTimer) clearInterval(replicaTimer)
          console.error(JSON.stringify({ event: 'tool_bridge_runtime_ownership_lost' }))
          // The callback can run inside heartbeat. Never wait for close from there.
          void close().catch(() => {
            console.error(JSON.stringify({ event: 'tool_bridge_runtime_close_failed' }))
          })
          server?.closeAllConnections()
          onOwnershipLost?.()
        },
      })
      runtimeLease = lease
      assertOpen()
      replicaTimer = setInterval(() => {
        if (heartbeatInFlight) return
        heartbeatInFlight = lease.heartbeat().catch(() => {}).finally(() => {
          heartbeatInFlight = undefined
        })
      }, 15000)
      replicaTimer.unref()

      await state.ensureSchema()
      await storeRepository.ensureSchema()
      await state.ensureContextReferencesSchema()
      await eventRepository.ensureSchema()
      await mailboxRepository.ensureSchema()
      await deployment.ensureSchema()
      await sql`CREATE TABLE IF NOT EXISTS tb_admin_audit (
        id text PRIMARY KEY, actor text NOT NULL, action text NOT NULL, outcome text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      )`
      await search.enableCanonicalAudit()
      await settings.ensureSchema(
        config.managedSettings
        ?? runtimeConfigSchema.parse(
          Object.fromEntries(
            Object.keys(runtimeConfigSchema.shape)
              .filter(key => key in config)
              .map(key => [key, config[key as keyof ServerConfig]]),
          ),
        ),
      )
      assertOpen()
      await runBootstrap(state, {
        management: true,
        additionalModules: [
          ...(config.maintenanceManagement ? ['maintenance'] : []),
          ...(config.keyManagement ? ['keys'] : []),
        ],
        ...(config.adminSk ? { adminSk: config.adminSk } : {}),
      })
      assertOpen()
      const backends = (await storage.list()).items
      let active = backends.find(backend => backend.active)
      if (!active && config.objectStore) {
        const connection = {
          ...config.objectStore,
          region: config.objectStore.region ?? 'us-east-1',
        }
        const existing = backends.find(
          backend =>
            backend.endpoint === new URL(connection.endpoint).origin
            && backend.bucket === connection.bucket
            && backend.region === connection.region,
        )
        const tested = existing
          ? await storage.update({
              id: existing.id,
              expectedRevision: existing.revision,
              accessKeyId: connection.accessKeyId,
              secretAccessKey: connection.secretAccessKey,
            })
          : await (async () => {
              const created = await storage.write({
                name: 'Default S3',
                connection,
              })
              return storage.test({
                id: created.id,
                expectedRevision: created.revision,
              })
            })()
        active = await storage.activate({
          id: tested.id,
          expectedRevision: tested.revision,
          expectedActiveRevision: 0,
        })
      }
      if (!active)
        throw new TBError('unavailable', 'no active storage backend')
      // A failed later capability probe blocks new uploads, but management remains reachable.
      await storage.resolveBackend(active.id)
      assertOpen()
      await hub.startRouter()
      await settings.sync()
      assertOpen()
      await hub.sweepOrphans()
      assertOpen()
      scheduleStoreCleanup()
      preparedForTraffic = true
    })()
    await prepared
    assertOpen()
  }
  return {
    app,
    settings,
    storage,
    prepare,
    search,
    state,
    deviceHub: hub,
    async start(): Promise<{ port: number }> {
      await prepare()
      assertOpen()
      listening ??= new Promise((resolve, reject) => {
        server = serve(
          { fetch: app.fetch, port: config.port, hostname: config.host },
          (info) => {
            if (!closing) hub.attach(server!)
            resolve({ port: info.port })
          },
        ) as http.Server
        server.once('error', reject)
      })
      const address = await listening
      assertOpen()
      return address
    },
    startDraining(): void {
      draining = true
    },
    get shutdownDrainSec(): number {
      return applied?.shutdownDrainSec ?? config.shutdownDrainSec ?? 0
    },
    close,
  }
}
