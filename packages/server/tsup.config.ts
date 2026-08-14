import { defineConfig } from 'tsup'

// 打包为 ESM 库 + bin(node22 目标):core 与宿主中立层 `@tool-bridge/app` 经
// devDependencies bundle 进产物(与 SDK 同一发布模式);运行时依赖留 external
// (better-sqlite3 是 native 模块绝不可 bundle)。**app 必须 noExternal**:private 的
// core 由每个发布产物各自 bundle,若 app 留 external 则运行时两份 core 副本并存,
// `err instanceof TBError` 跨副本恒为 false。
// `@tool-bridge/plugins` 同理 noExternal(private 包,且 `main.ts` 装配全量内置目录 ——
// Node/Docker 宿主的 catalog 从此与 Workers 对等,不再因部署形态归零)。
// dts.resolve 必须是数组而非 true:true 会把 node 内置模块也内联,曾把
// `http.Server` 降级成 undefined(2026-07-08 反思)。
export default defineConfig({
  entry: { index: 'src/index.ts', main: 'src/main.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  tsconfig: 'tsconfig.build.json',
  dts: {
    entry: { index: 'src/index.ts' },
    resolve: ['@tool-bridge/core', '@tool-bridge/app'],
  },
  clean: true,
  minify: false,
  noExternal: ['@tool-bridge/core', '@tool-bridge/app', '@tool-bridge/plugins'],
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
