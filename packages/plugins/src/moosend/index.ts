/**
 * Moosend —— 从 open-connector 迁移的 provider(api_key,4 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { addSubscriber, getSubscriberByEmail, listMailingLists, listSubscribers } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { moosendActions } from './schema'

export type { ProviderEnv as Env }

export function createMoosendPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Moosend',
    actions: moosendActions,
    // 上游 credentialValidators 打的就是 /lists.json;它是唯一只读且无必填入参的 action。
    credentialProbe: 'list_mailing_lists',
    handlers: {
      list_mailing_lists: listMailingLists,
      list_subscribers: listSubscribers,
      get_subscriber_by_email: getSubscriberByEmail,
      add_subscriber: addSubscriber,
    },
  })
}

export default createMoosendPlugin()
