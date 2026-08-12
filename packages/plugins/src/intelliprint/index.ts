/**
 * Intelliprint —— 从 open-connector 迁移的 provider(api_key,8 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getBackground,
  getMailingList,
  getMailingListRecipient,
  getPrint,
  listBackgrounds,
  listMailingListRecipients,
  listMailingLists,
  listPrints,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { intelliprintActions } from './schema'

export type { ProviderEnv as Env }

export function createIntelliprintPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Intelliprint',
    actions: intelliprintActions,
    // 上游的 credentialValidators 打的就是 /prints?limit=1;list_prints 只读、无必填入参,原样当探针。
    credentialProbe: 'list_prints',
    handlers: {
      list_prints: listPrints,
      get_print: getPrint,
      list_backgrounds: listBackgrounds,
      get_background: getBackground,
      list_mailing_lists: listMailingLists,
      get_mailing_list: getMailingList,
      list_mailing_list_recipients: listMailingListRecipients,
      get_mailing_list_recipient: getMailingListRecipient,
    },
  })
}

export default createIntelliprintPlugin()
