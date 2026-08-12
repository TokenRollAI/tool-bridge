/**
 * GraphHopper —— 从 open-connector 迁移的 provider(api_key,5 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { calculateRoute, computeIsochrone, computeMatrix, geocode, listProfiles } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { graphhopperActions } from './schema'

export type { ProviderEnv as Env }

export function createGraphhopperPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'GraphHopper',
    actions: graphhopperActions,
    // 上游 credentialValidators 打的就是 /profiles;它是唯一只读、无必填入参且不消耗路径配额的调用。
    credentialProbe: 'list_profiles',
    handlers: {
      calculate_route: calculateRoute,
      geocode,
      compute_matrix: computeMatrix,
      compute_isochrone: computeIsochrone,
      list_profiles: listProfiles,
    },
  })
}

export default createGraphhopperPlugin()
