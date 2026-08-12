/**
 * CommPeak —— 从 open-connector 迁移的 provider(api_key,8 个 action,围绕 TextPeak)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getStream,
  getStreamToken,
  listDomains,
  listIncomingMessages,
  listMessages,
  listSenders,
  listStreams,
  sendSms,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { commpeakActions } from './schema'

export type { ProviderEnv as Env }

export function createCommpeakPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'CommPeak',
    actions: commpeakActions,
    // 上游 credentialValidators 打的就是 /streams?itemsPerPage=1;list_streams 只读且无必填入参。
    credentialProbe: 'list_streams',
    handlers: {
      list_streams: listStreams,
      get_stream: getStream,
      get_stream_token: getStreamToken,
      list_senders: listSenders,
      list_domains: listDomains,
      list_messages: listMessages,
      list_incoming_messages: listIncomingMessages,
      send_sms: sendSms,
    },
  })
}

export default createCommpeakPlugin()
