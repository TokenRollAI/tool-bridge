import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// 仅收敛本包 test/ 下的单测;命令级测试用注入 fetch mock,不起真实网关。
export default defineConfig({
  resolve: {
    alias: {
      '@tool-bridge/sdk/client': fileURLToPath(new URL('../sdk/src/client/index.ts', import.meta.url)),
      '@tool-bridge/sdk/device': fileURLToPath(new URL('../sdk/src/device/index.ts', import.meta.url)),
      '@tool-bridge/sdk/store': fileURLToPath(new URL('../sdk/src/store/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
})
