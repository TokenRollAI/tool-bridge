/**
 * IP2Proxy —— 从 open-connector 迁移的 provider(1 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 没有 credentialProbe:唯一的 action 需要一个业务 ip,且 effect 播种成 write,
 * 拿不到"空转"的只读调用。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { ip2proxyActions } from './schema'
import { lookupIp } from './api'

export type { ProviderEnv as Env }

export function createIp2proxyPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'IP2Proxy',
    actions: ip2proxyActions,
    handlers: {
      lookup_ip: lookupIp,
    },
  })
}

export default createIp2proxyPlugin()
