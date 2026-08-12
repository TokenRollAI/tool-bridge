/**
 * Mistral AI —— 从 open-connector 迁移的 provider(54 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来。
 *
 * handler 表这里**不逐条手写**:54 个 action 共用同一段规格表驱动的代码,`api.ts` 的
 * `mistralAiHandlers` 就是从那张规格表生成的。键集合的正确性仍有保障 ——
 * `createProviderPlugin` 会拿它与 `mistralAiActions` 对一次,多一个少一个都在装配期炸。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { mistralAiActions } from './schema'
import { mistralAiHandlers } from './api'

export type { ProviderEnv as Env }

export function createMistralAiPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Mistral AI',
    actions: mistralAiActions,
    // 上游的 credentialValidator 打的就是 /v1/models,只读、无必填入参、不消耗 token 额度。
    credentialProbe: 'list_models',
    handlers: mistralAiHandlers,
  })
}

export default createMistralAiPlugin()
