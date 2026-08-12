/**
 * Exa —— 从 open-connector 迁移的 provider(4 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * **没有 credentialProbe**:四个 action 里 effect 为 read 的只有 `get_contents` 与
 * `find_similar`,而它们各自有必填入参(`urls` / `url`)—— 平台空参调探针会被 Zod 拦成
 * invalid_argument,那个错误看起来像凭证问题、实际是探针选错了。宁可不写。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { answer, findSimilar, getContents, search } from './api'
import { exaActions } from './schema'

export type { ProviderEnv as Env }

export function createExaPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Exa',
    actions: exaActions,
    handlers: {
      search,
      get_contents: getContents,
      answer,
      find_similar: findSimilar,
    },
  })
}

export default createExaPlugin()
