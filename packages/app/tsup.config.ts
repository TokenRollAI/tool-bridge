import { defineConfig } from 'tsup'

// 打包为单文件 ESM 库(platform: neutral —— 这一层不得依赖任何宿主内建)。
// core 是 private 包不随发布走,故经 devDependencies bundle 进产物,并用
// tsconfig.build.json 的 paths 把其类型内联进 dist/index.d.ts(否则类型入口悬空)。
// hono / MCP SDK / aws4fetch 是真正的外部运行时依赖,留在 dependencies。
// dts.resolve 必须是数组而非 true:true 会连 zod 一起内联,而 dts rollup 读
// `zod/v4/index.d.cts` 时无法解析其指向 `index.cjs` 的 default 导出,直接 build error
// (gateway/sdk/server 三个宿主包同此写法)。
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'es2022',
  platform: 'neutral',
  tsconfig: 'tsconfig.build.json',
  dts: { resolve: ['@tool-bridge/core', '@tool-bridge/core/protocol'] },
  clean: true,
  minify: false,
  noExternal: ['@tool-bridge/core', '@tool-bridge/core/protocol'],
})
