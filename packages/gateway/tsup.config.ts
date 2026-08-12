import { defineConfig } from 'tsup'

// 打包为单文件 ESM 库(Workers 目标):core 与宿主中立层 `@tool-bridge/app` 经
// devDependencies bundle 进产物,并把类型内联进 dist/index.d.ts(与 sdk/server 同一
// 发布模式)。**app 必须 noExternal**:core 是 private 包不随发布走,每个发布产物各自
// bundle 一份;若把 app 留 external,运行时会同时加载两份 core 副本,`err instanceof
// TBError` 跨副本恒为 false,错误被静默降级成 internal。
// cloudflare:workers 是 workerd 运行时内置模块,只能 external,由消费方 wrangler 解析。
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'es2022',
  platform: 'neutral',
  tsconfig: 'tsconfig.build.json',
  dts: { resolve: ['@tool-bridge/core', '@tool-bridge/app'] },
  clean: true,
  minify: false,
  noExternal: ['@tool-bridge/core', '@tool-bridge/app'],
  external: ['cloudflare:workers'],
})
