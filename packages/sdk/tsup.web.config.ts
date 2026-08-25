import { defineConfig } from 'tsup'

/**
 * 三个 Web-standard 子入口共用一次构建，让 core/Zod 落到共享 chunk。
 * 每个入口仍只引用自己的业务闭包；不会因共享 runtime 把 client/store/device 互相拉入。
 */
export default defineConfig({
  entry: {
    client: 'src/client/index.ts',
    device: 'src/device/index.ts',
    store: 'src/store/index.ts',
  },
  format: ['esm'],
  platform: 'neutral',
  target: 'es2020',
  tsconfig: 'tsconfig.web.json',
  dts: {
    resolve: ['@tool-bridge/core/device', '@tool-bridge/core/protocol', 'zod'],
  },
  clean: false,
  minify: false,
  splitting: true,
  noExternal: [
    '@tool-bridge/core/device',
    '@tool-bridge/core/protocol',
    /^zod(?:\/.*)?$/,
  ],
})
