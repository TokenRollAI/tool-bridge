/**
 * createTbServer:Node 宿主装配(对位 gateway/src/app.ts 的 depsFromEnv)。
 *
 * SQLite StateStore + fs ObjectStore + @hono/node-server;引导在 start() 时
 * 直调宿主中立 runBootstrap(Node 有真实启动点,不需要 Workers 的 per-request once,
 * 故不注入 deps.ensureReady)。设备通道(DeviceHub)与 /ui 静态托管由后续
 * 装配点注入(deps.device / deps.assets)。
 */

import type * as http from 'node:http'
import { createTbApp, type TbAppDeps } from '@tool-bridge/gateway/tbApp'
import { runBootstrap } from '@tool-bridge/gateway/bootstrap'
import { serve, type ServerType } from '@hono/node-server'
import { SecretStoreImpl } from '@tool-bridge/core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerConfig } from './config'
import pkg from '../package.json' with { type: 'json' }
import { SqliteStateStore } from './sqliteStateStore'
import { createDataObjectStore } from './objects'
import { resolveUiAssets } from './assets'
import { DeviceHub } from './deviceHub'

export interface TbServer {
  app: ReturnType<typeof createTbApp>
  close(): Promise<void>
  deviceHub: DeviceHub
  /** 引导(幂等)+ 孤儿设备回收排程 + 监听;返回实际端口(config.port=0 时由系统分配)。 */
  start(): Promise<{ port: number }>
  state: SqliteStateStore
}

export function createTbServer(config: ServerConfig): TbServer {
  mkdirSync(config.dataDir, { recursive: true })
  const state = new SqliteStateStore(join(config.dataDir, 'state.sqlite3'))
  const secrets = new SecretStoreImpl(state, config.encryptionKey)
  const objects = createDataObjectStore(config.dataDir)
  const hub = new DeviceHub({ store: state, reclaimSec: config.deviceReclaimSec })

  const deps: TbAppDeps = {
    state,
    secrets,
    version: pkg.version,
    remote: config.remote,
    allowInsecureHttp: config.allowInsecureHttp,
    objects: () => objects,
    device: hub,
  }
  if (config.encryptionKey !== undefined) deps.encryptionKey = config.encryptionKey
  const assets = resolveUiAssets(config.uiDir)
  if (assets !== undefined) deps.assets = assets
  if (config.toolCacheTtlSec !== undefined) deps.toolCacheTtlSec = config.toolCacheTtlSec
  if (config.refThresholdBytes !== undefined) deps.refThresholdBytes = config.refThresholdBytes
  if (config.refTtlSec !== undefined) deps.refTtlSec = config.refTtlSec

  const app = createTbApp(deps)

  let server: ServerType | undefined
  return {
    app,
    state,
    deviceHub: hub,
    async start(): Promise<{ port: number }> {
      await runBootstrap(state, config.adminSk !== undefined ? { adminSk: config.adminSk } : {})
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
      state.close()
    },
  }
}
