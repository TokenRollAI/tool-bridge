import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'node:path'
import pkg from './package.json' with { type: 'json' }

// base=/ui/:构建产物由 Node 服务挂在 /ui 前缀下。
// dev 模式经 proxy 把 HTBP API(除 /ui 与 vite 内部路径外)
// 转发到本地自托管服务，保持与生产一致的同源行为。
export default defineConfig({
  base: '/ui/',
  plugins: [react(), tailwindcss(), { name: 'artifact-version', transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'tool-bridge-version', content: pkg.version }, injectTo: 'head' }] }],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@tool-bridge/sdk/client': path.resolve(import.meta.dirname, '../sdk/src/client/index.ts'),
      '@tool-bridge/sdk/store': path.resolve(import.meta.dirname, '../sdk/src/store/index.ts'),
    },
  },
  server: {
    proxy: {
      '^/(?!ui($|/)|@).*': {
        target: process.env.TB_DEV_GATEWAY ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
