/**
 * IPGeolocation.io —— 从 open-connector 迁移的 provider(3 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import {
  getAstronomy,
  getTimezone,
  lookupIp,
} from './api'
import { ipgeolocationIoActions } from './schema'

export type { ProviderEnv as Env }

export function createIpgeolocationIoPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'IPGeolocation.io',
    actions: ipgeolocationIoActions,
    // 上游的 credentialValidator 打的是 /v3/ipgeo,但 lookup_ip 的 effect 被播种成 write,
    // 不能当探针。get_timezone 同样只读、无必填入参、同一把 key,等效且合规。
    credentialProbe: 'get_timezone',
    handlers: {
      lookup_ip: lookupIp,
      get_timezone: getTimezone,
      get_astronomy: getAstronomy,
    },
  })
}

export default createIpgeolocationIoPlugin()
