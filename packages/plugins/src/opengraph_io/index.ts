/**
 * OpenGraph.io —— 从 open-connector 迁移的 provider(api_key,4 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不设 credentialProbe:上游 credentialValidators 拿 `https://example.com` 当靶子打 Site 端点,
 * 而四个 action 都要必填目标 URL、都消耗配额,拿不到一个"空转"的只读调用。
 */

import { captureScreenshot, extractSite, scrapeSite, scrapeUrl } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { opengraphIoActions } from './schema'

export type { ProviderEnv as Env }

export function createOpengraphIoPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'OpenGraph.io',
    actions: opengraphIoActions,
    handlers: {
      extract_site: extractSite,
      scrape_site: scrapeSite,
      scrape_url: scrapeUrl,
      capture_screenshot: captureScreenshot,
    },
  })
}

export default createOpengraphIoPlugin()
