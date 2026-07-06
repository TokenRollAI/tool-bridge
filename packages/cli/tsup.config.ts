import { defineConfig } from 'tsup'

// 打包为单文件 ESM bin(node22 目标);banner 注入 shebang 使 dist/index.js 可直接执行。
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node22',
  clean: true,
  minify: false,
  banner: { js: '#!/usr/bin/env node' },
})
