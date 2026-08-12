/**
 * Zipcodebase —— 从 open-connector 迁移的 provider(api_key,7 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  calculateDistance,
  getStatus,
  listPostalCodesByCity,
  listPostalCodesByState,
  listPostalCodesWithinRadius,
  matchPostalCodesByDistance,
  searchPostalCodes,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { zipcodebaseActions } from './schema'

export type { ProviderEnv as Env }

export function createZipcodebasePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Zipcodebase',
    actions: zipcodebaseActions,
    // 上游的 credentialValidators 就打 /status;get_status 是它的同一个调用,且不消耗查询额度。
    credentialProbe: 'get_status',
    handlers: {
      get_status: getStatus,
      search_postal_codes: searchPostalCodes,
      calculate_distance: calculateDistance,
      list_postal_codes_within_radius: listPostalCodesWithinRadius,
      match_postal_codes_by_distance: matchPostalCodesByDistance,
      list_postal_codes_by_city: listPostalCodesByCity,
      list_postal_codes_by_state: listPostalCodesByState,
    },
  })
}

export default createZipcodebasePlugin()
