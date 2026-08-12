/**
 * Telnyx —— 从 open-connector 迁移的 provider(Messaging API,4 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { listMessagingProfiles, retrieveMessage, retrieveMessagingProfile, sendMessage } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { telnyxActions } from './schema'

export type { ProviderEnv as Env }

export function createTelnyxPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Telnyx',
    actions: telnyxActions,
    handlers: {
      send_message: sendMessage,
      retrieve_message: retrieveMessage,
      list_messaging_profiles: listMessagingProfiles,
      retrieve_messaging_profile: retrieveMessagingProfile,
    },
  })
}

export default createTelnyxPlugin()
