/**
 * Twilio —— 从 open-connector 迁移的 provider(5 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 凭证是**两个字段**:accountSid(账户标识,进 API 路径)与 authToken(进 HTTP Basic 的
 * 密码位)。字段名与上游 `definition.ts` 里 `custom_credential` 那份 auth 的 `fields`
 * 逐字一致 —— 名字对不上就取不到值,而 `requireCredential` 会把它报成 internal
 * (provider 自身的 bug)。
 *
 * credentialProbe 选 `get_account`:effect 为 read、入参是空对象,且打的正是上游
 * `credentialValidators` 用的那个端点(`/Accounts/{sid}.json`)—— 它同时验到
 * authToken 有效与 accountSid 指得对。
 */

import { getAccount, getMessage, listMessages, listUsageRecords, sendMessage } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { twilioActions } from './schema'

export type { ProviderEnv as Env }

export function createTwilioPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Twilio',
    credentialFields: [
      {
        key: 'accountSid',
        label: 'Account SID',
        required: true,
        secret: false,
        description: 'Twilio Account SID(AC 开头),作为账户标识拼进 API 路径;见 https://www.twilio.com/console 的 Account Info',
      },
      {
        key: 'authToken',
        label: 'Auth Token',
        required: true,
        secret: true,
        description: 'Twilio Auth Token,与 accountSid 一起以 HTTP Basic 发送(不是 Bearer);可在 https://www.twilio.com/console 查看或轮换',
      },
    ],
    credentialProbe: 'get_account',
    actions: twilioActions,
    handlers: {
      get_account: getAccount,
      list_usage_records: listUsageRecords,
      list_messages: listMessages,
      get_message: getMessage,
      send_message: sendMessage,
    },
  })
}

export default createTwilioPlugin()
