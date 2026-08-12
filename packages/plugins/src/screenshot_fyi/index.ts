/**
 * screenshot.fyi —— 从 open-connector 迁移的 provider。
 *
 * 三个文件的分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的
 * 业务逻辑,本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { screenshotFyiActions } from './schema'
import { takeScreenshot } from './api'

export type { ProviderEnv as Env }

export function createScreenshotFyiPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'screenshot.fyi',
    actions: screenshotFyiActions,
    handlers: { take_screenshot: takeScreenshot },
  })
}

export default createScreenshotFyiPlugin()
