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
import { type MutableSearchIndex, SecretStoreImpl, type StateStore } from '@tool-bridge/core'
import { createTbApp, runBootstrap, type TbAppDeps } from '@tool-bridge/app'
import { serve, type ServerType } from '@hono/node-server'
import postgres, { type Sql } from 'postgres'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerConfig } from './config'
import pkg from '../package.json' with { type: 'json' }
import { SqliteSearchIndex } from './sqliteSearchIndex'
import { SqliteStateStore } from './sqliteStateStore'
import { createDataObjectStore } from './objects'
import { PgSearchIndex } from './pgSearchIndex'
import { PgStateStore } from './pgStateStore'
import { resolveUiAssets } from './assets'
import { DeviceHub } from './deviceHub'

export interface TbServer {
  app: ReturnType<typeof createTbApp>
  close(): Promise<void>
  deviceHub: DeviceHub
  search: MutableSearchIndex
  /** 引导(幂等)+ 孤儿设备回收排程 + 监听;返回实际端口(config.port=0 时由系统分配)。 */
  start(): Promise<{ port: number }>
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
  const objects = createDataObjectStore(config.dataDir)
  const hub = new DeviceHub({
    store: state,
    search,
    reclaimSec: config.deviceReclaimSec,
  })

  const deps: TbAppDeps = {
    state,
    secrets,
    version: pkg.version,
    remote: config.remote,
    search,
    allowInsecureHttp: config.allowInsecureHttp,
    objects: () => objects,
    device: hub,
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

  const app = createTbApp(deps)

  let server: ServerType | undefined
  return {
    app,
    search,
    state,
    deviceHub: hub,
    async start(): Promise<{ port: number }> {
      // 两个后端各自就绪(PG 建表 / SQLite no-op);state 必须早于 runBootstrap 的读写。
      await backends.state.ensureReady()
      await backends.search.ensureReady()
      // fail closed:缺 TB_BOOTSTRAP_ADMIN_SK 时默认拒绝启动(不随机生成 Admin SK 写 stdout);
      // 仅 TB_ALLOW_INSECURE_BOOTSTRAP=true 的本地/一次性开发保留旧的随机生成+打印一次路径。
      await runBootstrap(state, {
        ...(config.adminSk !== undefined ? { adminSk: config.adminSk } : {}),
        requireAdminSk: !config.allowInsecureBootstrap,
      })
      await hub.sweepOrphans()
      return await new Promise((resolve) => {
        server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
          resolve({ port: info.port })
        })
        hub.attach(server as http.Server)
      })
    },
    async close(): Promise<void> {
      await hub.close()
      if (server !== undefined) {
        await new Promise<void>((resolve, reject) => {
          server?.close(err => (err ? reject(err) : resolve()))
        })
        server = undefined
      }
      // search 先关(可能依赖 state 侧的连接池),再关 state。
      await backends.search.close()
      await backends.state.close()
    },
  }
}
