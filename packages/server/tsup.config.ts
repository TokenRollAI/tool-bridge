import { defineConfig } from 'tsup'

// Node-only resources remain external; private workspace packages are bundled.
export default defineConfig({
  entry: { index: 'src/index.ts', main: 'src/main.ts', admin: 'src/admin.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  tsconfig: 'tsconfig.build.json',
  dts: {
    entry: { index: 'src/index.ts' },
    // app/core 的公开类型包含 Zod 推导；一起内联，避免 packed declarations
    // 指向未声明的传递依赖。
    resolve: ['@tool-bridge/core', '@tool-bridge/app', 'zod'],
  },
  clean: true,
  minify: false,
  noExternal: ['@tool-bridge/core', '@tool-bridge/app', '@tool-bridge/plugins'],
  external: [
    'ws',
    'hono',
    '@hono/node-server',
    '@tool-bridge/dashboard',
  ],
})
