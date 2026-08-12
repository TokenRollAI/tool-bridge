/**
 * Geokeo —— 从 open-connector 迁移的 provider(api_key 走 query,2 个 geocoding action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不设 credentialProbe:两个 action 的 effect 都是 write,且都有必填业务入参,
 * 没有可"空转"的只读调用。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { geocodeForward, geocodeReverse } from './api'
import { geokeoActions } from './schema'

export type { ProviderEnv as Env }

export function createGeokeoPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Geokeo',
    actions: geokeoActions,
    handlers: {
      geocode_forward: geocodeForward,
      geocode_reverse: geocodeReverse,
    },
  })
}

export default createGeokeoPlugin()
