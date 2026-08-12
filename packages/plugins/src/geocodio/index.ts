/**
 * Geocodio —— 从 open-connector 迁移的 provider(api_key,4 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不设 credentialProbe:四个 action 的 effect 都被播种成 write(探针必须是 read),
 * 且每个都要必填查询内容,挑不出"空转"调用。
 */

import {
  batchReverseGeocode,
  geocodeBatch,
  singleGeocode,
  singleReverseGeocode,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { geocodioActions } from './schema'

export type { ProviderEnv as Env }

export function createGeocodioPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Geocodio',
    actions: geocodioActions,
    handlers: {
      single_geocode: singleGeocode,
      geocode_batch: geocodeBatch,
      single_reverse_geocode: singleReverseGeocode,
      batch_reverse_geocode: batchReverseGeocode,
    },
  })
}

export default createGeocodioPlugin()
