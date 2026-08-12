/**
 * Wolfram|Alpha —— 从 open-connector 迁移的 provider(api_key,3 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { getShortAnswer, getSpokenResult, validateQuery } from './api'
import { wolframAlphaApiActions } from './schema'

export type { ProviderEnv as Env }

export function createWolframAlphaApiPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Wolfram|Alpha',
    actions: wolframAlphaApiActions,
    // 不设 credentialProbe:三个 action 都必填 `query`,平台空参调探针会被 Zod 拦成
    // invalid_argument —— 那个错误看起来像凭证问题,实际是探针选错了。上游
    // credentialValidators 打的 queryrecognizer 端点同样要带 input,没有"空转"调用。
    handlers: {
      validate_query: validateQuery,
      get_short_answer: getShortAnswer,
      get_spoken_result: getSpokenResult,
    },
  })
}

export default createWolframAlphaApiPlugin()
