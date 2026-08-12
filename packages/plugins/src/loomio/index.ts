/**
 * Loomio —— 从 open-connector 迁移的 provider(api_key,2 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不设 credentialProbe:上游的 credentialValidators 打的是 `/groups`,而这个 provider
 * 根本没有对应的 action;两个 action 又都要必填业务 id,挑不出"空转"调用。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { getPoll, listPolls } from './api'
import { loomioActions } from './schema'

export type { ProviderEnv as Env }

export function createLoomioPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Loomio',
    actions: loomioActions,
    handlers: {
      list_polls: listPolls,
      get_poll: getPoll,
    },
  })
}

export default createLoomioPlugin()
