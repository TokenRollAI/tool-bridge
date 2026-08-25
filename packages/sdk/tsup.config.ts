import { defineConfig } from 'tsup'

// 打包为单文件 ESM 库(node22 目标):core 与宿主中立层 `@tool-bridge/app` 经
// devDependencies bundle 进产物,并把类型内联进 dist/index.d.ts(private 的 core
// 不随发布走,不内联则发布包的类型入口悬空)。**app 必须 noExternal**:每个发布产物
// 各自 bundle 一份 core,若 app 留 external 则运行时两份 core 副本并存,
// `err instanceof TBError` 跨副本恒为 false。运行时依赖只留 partysocket/ws。
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node22',
  tsconfig: 'tsconfig.build.json',
  dts: {
    resolve: ['@tool-bridge/core', '@tool-bridge/core/device', '@tool-bridge/app', 'zod'],
  },
  clean: true,
  minify: false,
  noExternal: [
    '@tool-bridge/core',
    '@tool-bridge/core/device',
    '@tool-bridge/app',
    /^zod(?:\/.*)?$/,
  ],
})
