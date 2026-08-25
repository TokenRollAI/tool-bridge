import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsup'

const sdkDeviceSource = fileURLToPath(new URL('../sdk/src/device/index.ts', import.meta.url))
const sdkClientSource = fileURLToPath(new URL('../sdk/src/client/index.ts', import.meta.url))
const sdkStoreSource = fileURLToPath(new URL('../sdk/src/store/index.ts', import.meta.url))

// 打包为单文件 ESM bin(node22 目标);banner 注入 shebang 使 dist/index.js 可直接执行。
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node22',
  clean: true,
  minify: false,
  noExternal: [
    '@tool-bridge/core',
    '@tool-bridge/sdk',
    '@tool-bridge/sdk/client',
    '@tool-bridge/sdk/device',
    '@tool-bridge/sdk/store',
  ],
  // CLI 是单文件产物。workspace 内直接从 SDK 源入口打包，避免把 SDK
  // 已内联的 core/zod 产物再嵌一遍；源码仍只能通过同一公开子入口导入。
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      '@tool-bridge/sdk/client': sdkClientSource,
      '@tool-bridge/sdk/device': sdkDeviceSource,
      '@tool-bridge/sdk/store': sdkStoreSource,
    }
  },
  banner: { js: '#!/usr/bin/env node' },
})
