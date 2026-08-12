/**
 * Kernel —— 从 open-connector 迁移的 provider(api_key,5 个 action,围绕托管浏览器会话)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createBrowserSession,
  deleteBrowserSession,
  getBrowserSession,
  listBrowserSessions,
  updateBrowserSession,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { kernelActions } from './schema'

export type { ProviderEnv as Env }

export function createKernelPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Kernel',
    actions: kernelActions,
    // 上游 credentialValidators 打的就是 /browsers —— 只读、无必填入参。
    credentialProbe: 'list_browser_sessions',
    handlers: {
      list_browser_sessions: listBrowserSessions,
      create_browser_session: createBrowserSession,
      get_browser_session: getBrowserSession,
      update_browser_session: updateBrowserSession,
      delete_browser_session: deleteBrowserSession,
    },
  })
}

export default createKernelPlugin()
