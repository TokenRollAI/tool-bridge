import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// 集成测试跑在真实 workerd(与 gateway 同基建);飞书换发接口与 MCP 上游全部 fetch mock,
// 默认离线确定性。测试凭证经 miniflare.bindings 注入。
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          FEISHU_ALLOWED_TOOLS: 'create-doc,fetch-doc',
          PLUGIN_TOKEN: 'tbp_test_token',
          FEISHU_MCP_URL: 'https://feishu-mcp.mock/mcp',
          FEISHU_AUTH_URL: 'https://feishu-auth.mock/tat',
        },
      },
    }),
  ],
})
