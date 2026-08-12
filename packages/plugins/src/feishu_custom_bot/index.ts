/**
 * 飞书自定义机器人 —— 从 open-connector 迁移的 provider(群 webhook 发消息)。
 *
 * 这个 provider 走**手写豁免**路径:`send_post_message` 的 inputSchema 带 Zod 无法反推的
 * 组合约束(中英文语言块二选一),schema 由人写在 `schema.handwritten.ts`。
 *
 * 没有 credentialProbe:五个 action 全是发消息(effect: write),挂载时探一次会真往群里
 * 发一条 —— 探针必须零副作用,这里选不出合适的。
 *
 * 凭证是**两个字段**:webhook(地址或 token)与可选的 signingSecret(加签密钥)。后者曾走
 * `providerConfig`,但那会明文进节点记录、被任何有 read 的 SK 读走;现在两个都在 secret 里。
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
    credentialFields: [
      {
        key: 'webhook',
        label: 'Webhook',
        required: true,
        secret: true,
        description: '群机器人的 webhook 地址(https://open.feishu.cn/open-apis/bot/v2/hook/<token>)或其 token',
      },
      {
        key: 'signingSecret',
        label: 'Signing Secret',
        required: false,
        secret: true,
        description: '群机器人开启「签名校验」时的密钥;未开启则留空',
      },
    ],
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
