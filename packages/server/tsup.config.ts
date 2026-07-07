import { defineConfig } from 'tsup'

// 打包为 ESM 库 + bin(node22 目标):core 与 gateway 的宿主中立模块经 devDependencies
// bundle 进产物(与 SDK 同一发布模式);运行时依赖留 external(better-sqlite3 是
// native 模块绝不可 bundle)。dts 用 tsconfig.build.json 的 paths 把 workspace 包类型
// 内联进 dist/index.d.ts(core/gateway 是 dev 消费,不随发布走)。
export default defineConfig({
  entry: { index: 'src/index.ts', main: 'src/main.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  tsconfig: 'tsconfig.build.json',
  dts: { entry: { index: 'src/index.ts' }, resolve: ['@tool-bridge/core', '@tool-bridge/gateway'] },
  clean: true,
  minify: false,
  noExternal: ['@tool-bridge/core', '@tool-bridge/gateway'],
  external: [
    'better-sqlite3',
    'ws',
    'hono',
    '@hono/node-server',
    '@modelcontextprotocol/sdk',
    'aws4fetch',
    '@cfworker/json-schema',
    '@tool-bridge/dashboard',
  ],
})
