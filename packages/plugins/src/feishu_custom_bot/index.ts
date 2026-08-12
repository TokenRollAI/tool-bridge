/**
 * 飞书自定义机器人 —— 从 open-connector 迁移的 provider(群 webhook 发消息)。
 *
 * 这个 provider 走**手写豁免**路径:`send_post_message` 的 inputSchema 带 Zod 无法反推的
 * 组合约束(中英文语言块二选一),schema 由人写在 `schema.handwritten.ts`。
 *
 * 没有 credentialProbe:五个 action 全是发消息(effect: write),挂载时探一次会真往群里
 * 发一条 —— 探针必须零副作用,这里选不出合适的。
 */

import {
  sendImageMessage,
  sendInteractiveMessage,
  sendPostMessage,
  sendShareChatMessage,
  sendTextMessage,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { feishuCustomBotActions } from './schema'

export type { ProviderEnv as Env }

export function createFeishuCustomBotPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Feishu Custom Bot',
    actions: feishuCustomBotActions,
    handlers: {
      send_text_message: sendTextMessage,
      send_post_message: sendPostMessage,
      send_image_message: sendImageMessage,
      send_share_chat_message: sendShareChatMessage,
      send_interactive_message: sendInteractiveMessage,
    },
  })
}

export default createFeishuCustomBotPlugin()
