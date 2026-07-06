import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// 集成测试跑在真实 workerd 里(DOD.md:26/27)。vitest-pool-workers 0.18(vitest 4)已改为
// Vite 插件形态:cloudflareTest(...) 取代旧的 test.poolOptions.workers。
// 从 wrangler.jsonc 读取 main 与 KV/R2 绑定,由 miniflare 起本地实例,SELF.fetch 打进 Worker。
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
})
