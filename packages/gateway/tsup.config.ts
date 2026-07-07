import { defineConfig } from 'tsup'

// 打包为单文件 ESM 库(Workers 目标):core 经 devDependencies bundle 进产物
// (与 sdk/cli 同一发布模式);hono/MCP SDK 等真正的外部包留在 dependencies。
// dts 用 tsconfig.build.json 的 paths 把 core 类型内联进 dist/index.d.ts:
// core 是 private 包不随发布走,不内联则发布包的类型入口悬空。
// cloudflare:workers 是 workerd 运行时内置模块,只能 external,由消费方 wrangler 解析。
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'es2022',
  platform: 'neutral',
  tsconfig: 'tsconfig.build.json',
  dts: { resolve: true },
  clean: true,
  minify: false,
  noExternal: ['@tool-bridge/core'],
  external: ['cloudflare:workers'],
})
