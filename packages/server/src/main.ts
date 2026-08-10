#!/usr/bin/env node
/**
 * bin 入口:env 配置 → 引导 → 监听 → SIGINT/SIGTERM 优雅关闭。
 * 首次引导的 Admin SK 明文由 runBootstrap console.log 一次(docker logs 可见,
 * 与 CF 宿主行为一致);TB_BOOTSTRAP_ADMIN_SK 提供时不打印明文。
 */

import { createTbServer } from './server'
import { configFromEnv } from './config'

const config = configFromEnv(process.env)
const server = createTbServer(config)
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
