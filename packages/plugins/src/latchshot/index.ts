/**
 * Latchshot —— 从 open-connector 迁移的 provider(api_key,2 个 action:页面渲染 + 配额)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 注意 `capture_page` 目前会直接回 501:它的产物要写进平台没有的 transit 文件存储,
 * 理由见 `api.ts` 里那个 handler 的说明。宁可宣告后显式拒绝,也不摘掉这个 action ——
 * 摘了会让规格表与上游快照对不上,闸门当场炸,而且调用方看不出它为什么消失了。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { capturePage, getUsage } from './api'
import { latchshotActions } from './schema'

export type { ProviderEnv as Env }

export function createLatchshotPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Latchshot',
    actions: latchshotActions,
    // 上游 credentialValidator 也是打 /v1/usage 试凭证:只读、无入参、不消耗渲染配额。
    credentialProbe: 'get_usage',
    handlers: {
      capture_page: capturePage,
      get_usage: getUsage,
    },
  })
}

export default createLatchshotPlugin()
