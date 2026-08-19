import { defineConfig } from 'tsup'

// @tool-bridge/sdk/device 必须是独立 neutral 产物：不能沿根入口触达 app、ws 或 node:*。
// core/zod 内联，避免发布声明或运行时依赖指向 private workspace 包。
export default defineConfig({
  entry: { device: 'src/device/index.ts' },
  format: ['esm'],
  platform: 'neutral',
  target: 'es2020',
  tsconfig: 'tsconfig.device.json',
  dts: { resolve: ['@tool-bridge/core/device'] },
  clean: false,
  minify: false,
  noExternal: ['@tool-bridge/core/device', 'zod'],
})
