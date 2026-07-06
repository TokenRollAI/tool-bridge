import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base=/ui/:构建产物由 tb-gateway 以 Workers Static Assets 挂在 /ui 前缀下
// (Architecture M9)。dev 模式经 proxy 把 HTBP API(除 /ui 与 vite 内部路径外)
// 转发到本地 wrangler dev,保证与生产同源行为一致。
export default defineConfig({
  base: '/ui/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
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
