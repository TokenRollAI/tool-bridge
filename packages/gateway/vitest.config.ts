import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'
import { TEST_ADMIN_SK, TEST_ENCRYPTION_KEY } from './test/fixtures'

// 集成测试跑在真实 workerd 里(DOD.md:26/27)。vitest-pool-workers 0.18(vitest 4)已改为
// Vite 插件形态:cloudflareTest(...) 取代旧的 test.poolOptions.workers。
// 从 wrangler.jsonc 读取 main 与 KV/R2 绑定,由 miniflare 起本地实例,SELF.fetch 打进 Worker。
//
// 测试用 vars 经 miniflare.bindings 注入(不依赖 .dev.vars,保证测试确定性):
// - TB_SECRET_ENCRYPTION_KEY:32 字节 base64url,secret 能力可用;
// - TB_BOOTSTRAP_ADMIN_SK:固定 Admin SK 明文,测试用它认证并签发受限 SK(E2E-1 本地版)。

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TB_SECRET_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
          TB_BOOTSTRAP_ADMIN_SK: TEST_ADMIN_SK,
        },
      },
    }),
  ],
})
