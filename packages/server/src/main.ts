/**
 * bin 入口:env 配置 → 引导 → 监听 → SIGINT/SIGTERM 优雅关闭。
 * 首次引导的 Admin SK 明文由 runBootstrap console.log 一次(docker logs 可见,
 * 与 CF 宿主行为一致);TB_BOOTSTRAP_ADMIN_SK 提供时不打印明文。
 */

import { configFromEnv } from './config'
import { createTbServer } from './server'

const config = configFromEnv(process.env)
const server = createTbServer(config)
const { port } = await server.start()
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
