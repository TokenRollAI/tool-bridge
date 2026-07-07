import { defineConfig } from 'tsup'

// 打包为单文件 ESM 库(node22 目标):core 与 gateway 的宿主中立模块经 devDependencies
// bundle 进产物(与 CLI 同一发布模式);运行时依赖只留 hono/partysocket/ws。
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node22',
  dts: true,
  clean: true,
  minify: false,
  noExternal: ['@tool-bridge/core', '@tool-bridge/gateway'],
})
