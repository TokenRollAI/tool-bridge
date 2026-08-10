import { defineConfig } from 'tsup'

// Web 标准目标(es2022,非 node):plugin 通常部署为 Cloudflare Worker / Deno / Bun,
// 产物不得含 Node 内建。core 是 private 包,经 noExternal bundle 进产物,dts 用
// tsconfig.build.json 的 paths 内联 —— 否则发布包的类型入口悬空(同 @tool-bridge/sdk)。
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
})
