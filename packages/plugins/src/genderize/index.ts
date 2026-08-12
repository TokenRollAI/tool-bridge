/**
 * Genderize —— 从 open-connector 迁移的 provider(api_key,2 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { predictGender, predictGenderBatch } from './api'
import { genderizeActions } from './schema'

export type { ProviderEnv as Env }

export function createGenderizePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Genderize',
    actions: genderizeActions,
    // 不设 credentialProbe:两个 action 都必须给名字(没有"空转"调用),且都按次计费,
    // 挂载时白跑一次没有零成本的选项。
    handlers: {
      predict_gender: predictGender,
      predict_gender_batch: predictGenderBatch,
    },
  })
}

export default createGenderizePlugin()
