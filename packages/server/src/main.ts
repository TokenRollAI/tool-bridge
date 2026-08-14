#!/usr/bin/env node
/**
 * bin 入口:env 配置 → 引导 → 监听 → SIGINT/SIGTERM 优雅关闭。
 * 首次引导默认要求预置 TB_BOOTSTRAP_ADMIN_SK;缺失时在监听前 fail closed。
 * 仅显式 TB_ALLOW_INSECURE_BOOTSTRAP=true 的本地开发模式会随机生成并打印一次。
 */

import {
  BUILTIN_CATALOG,
  builtinPluginBindings,
  type BuiltinPluginEnv,
} from '@tool-bridge/plugins'
import { createTbServer } from './server'
import { configFromEnv } from './config'

/**
 * **内置插件目录全量装配**(与 Workers 的 `deployEntry.ts` 对等)。
 *
 * 此前只有 gateway 的部署入口装配它,`packages/server` 连 `@tool-bridge/plugins` 依赖都没有
 * —— 于是同一份代码在 Workers 上有 99 个可用 provider,在官方 Node/Docker 镜像上是 0 个。
 * **部署形态改变了产品能力**,而这不是任何人的设计意图。
 *
 * Node 侧没有 Worker 那样的 bundle 体积上限,故不必裁剪;loader 仍是懒加载(装配只建
 * Map 与闭包,不 import 插件模块),启动不付全量代价。
 */
const config = configFromEnv(process.env)
const server = createTbServer({
  ...config,
  pluginBindings:
    config.pluginBindings ?? builtinPluginBindings(process.env as BuiltinPluginEnv),
  pluginCatalog: config.pluginCatalog ?? BUILTIN_CATALOG,
})
let port: number
try {
  ;({ port } = await server.start())
} catch (err) {
  // fail closed:首次引导缺 TB_BOOTSTRAP_ADMIN_SK(且未开 insecure bootstrap)→ 拒绝启动,
  // 退出非 0,不随机生成并打印最高权限凭证。给出可操作的修复指引(不含任何明文)。
  const detail = err instanceof Error ? err.message : String(err)
  console.error(`[tool-bridge] refusing to start: ${detail}`)
  console.error(
    '[tool-bridge] set TB_BOOTSTRAP_ADMIN_SK to a secret Admin SK before first boot, '
    + 'or set TB_ALLOW_INSECURE_BOOTSTRAP=true for local/dev (generates a random Admin SK and prints it once).',
  )
  await server.close().catch(() => {})
  process.exit(1)
}
console.log(`[tool-bridge] listening on http://${config.host}:${port} (data: ${config.dataDir})`)

let shuttingDown = false
const shutdown = (signal: string): void => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[tool-bridge] ${signal} received, shutting down`)
  server
    .close()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[tool-bridge] shutdown error', err)
      process.exit(1)
    })
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
