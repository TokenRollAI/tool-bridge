/**
 * Zhihu —— 从 open-connector 迁移的 provider(api_key,4 个 action:三种检索 + 智答对话)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 没有 `credentialProbe`:上游拿 `hot_list?Limit=1` 试凭证,但生成的规格表把四个 action
 * 的 effect 全播成了 write(名字都不带读前缀),而探针要求 effect 为 read。修 effect 属于
 * 改 schema.ts,不在本次迁移范围内。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { globalSearch, hotList, zhida, zhihuSearch } from './api'
import { zhihuActions } from './schema'

export type { ProviderEnv as Env }

export function createZhihuPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Zhihu',
    actions: zhihuActions,
    handlers: {
      zhihu_search: zhihuSearch,
      global_search: globalSearch,
      hot_list: hotList,
      zhida,
    },
  })
}

export default createZhihuPlugin()
