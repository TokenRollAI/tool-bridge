import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'
import { TEST_ADMIN_SK, TEST_ENCRYPTION_KEY } from './test/fixtures'

// wrangler.jsonc 的 assets.directory 指向 dashboard 构建产物;目录缺失时 miniflare
// 无法起 assets worker——冷启动(fresh clone / dist 被清)时就地构建一次。
if (!existsSync('../dashboard/dist/index.html')) {
  execSync('pnpm --filter @tool-bridge/dashboard build', { stdio: 'inherit' })
}

// 集成测试跑在真实 workerd 里(DOD.md:26/27)。vitest-pool-workers 0.18(vitest 4)已改为
// Vite 插件形态:cloudflareTest(...) 取代旧的 test.poolOptions.workers。
// 从 wrangler.jsonc 读取 main 与 KV/R2 绑定,由 miniflare 起本地实例,SELF.fetch 打进 Worker。
//
// 测试用 vars 经 miniflare.bindings 注入(不依赖 .dev.vars,保证测试确定性):
// - TB_SECRET_ENCRYPTION_KEY:32 字节 base64url,secret 能力可用;
// - TB_BOOTSTRAP_ADMIN_SK:固定 Admin SK 明文,测试用它认证并签发受限 SK(E2E-1 本地版)。
// - TB_INSTANCE_ID / TB_REMOTE_ALLOWLIST:Phase 2 remote 透传的固定实例标识与白名单(确定性)。
// - TB_TEST_MCP_URL / TB_ALLOW_INSECURE_HTTP:仅当 process.env 提供时注入(opt-in 真实 echo E2E)。

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TB_SECRET_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
          TB_BOOTSTRAP_ADMIN_SK: TEST_ADMIN_SK,
          TB_INSTANCE_ID: 'tb-test-instance',
          TB_REMOTE_ALLOWLIST: 'example.com',
          ...(process.env.TB_TEST_MCP_URL !== undefined
            ? { TB_TEST_MCP_URL: process.env.TB_TEST_MCP_URL }
            : {}),
          ...(process.env.TB_TEST_LIVE_HTTP !== undefined
            ? { TB_TEST_LIVE_HTTP: process.env.TB_TEST_LIVE_HTTP }
            : {}),
          ...(process.env.TB_ALLOW_INSECURE_HTTP !== undefined
            ? { TB_ALLOW_INSECURE_HTTP: process.env.TB_ALLOW_INSECURE_HTTP }
            : {}),
          // opt-in 真实 S3 兼容端点 E2E(四个环境变量齐才跑,context.integration.test.ts)。
          ...(process.env.TB_TEST_S3_ENDPOINT !== undefined
            ? { TB_TEST_S3_ENDPOINT: process.env.TB_TEST_S3_ENDPOINT }
            : {}),
          ...(process.env.TB_TEST_S3_ACCESS_KEY_ID !== undefined
            ? { TB_TEST_S3_ACCESS_KEY_ID: process.env.TB_TEST_S3_ACCESS_KEY_ID }
            : {}),
          ...(process.env.TB_TEST_S3_SECRET_ACCESS_KEY !== undefined
            ? { TB_TEST_S3_SECRET_ACCESS_KEY: process.env.TB_TEST_S3_SECRET_ACCESS_KEY }
            : {}),
          ...(process.env.TB_TEST_S3_BUCKET !== undefined
            ? { TB_TEST_S3_BUCKET: process.env.TB_TEST_S3_BUCKET }
            : {}),
        },
      },
    }),
  ],
})
