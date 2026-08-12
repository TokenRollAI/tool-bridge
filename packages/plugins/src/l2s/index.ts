/**
 * L2S —— 从 open-connector 迁移的 provider(api_key,3 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不设 credentialProbe:上游 credentialValidators 打的 `GET /user/setting` 没有对应 action,
 * 而唯一只读的 get_url_details 要必填 id,拿不到"空转"调用。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { getUrlDetails, shortenUrl, updateUrlDetails } from './api'
import { l2sActions } from './schema'

export type { ProviderEnv as Env }

export function createL2sPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'L2S',
    actions: l2sActions,
    handlers: {
      shorten_url: shortenUrl,
      get_url_details: getUrlDetails,
      update_url_details: updateUrlDetails,
    },
  })
}

export default createL2sPlugin()
