/**
 * ngrok —— 从 open-connector 迁移的 provider(api_key,6 个 action,全部只读)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getEndpoint,
  getReservedDomain,
  listEndpoints,
  listReservedDomains,
  listTunnels,
  listTunnelSessions,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { ngrokActions } from './schema'

export type { ProviderEnv as Env }

export function createNgrokPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'ngrok',
    actions: ngrokActions,
    // 上游的 credentialValidators 打的就是 /endpoints?limit=1,对应 list_endpoints。
    credentialProbe: 'list_endpoints',
    handlers: {
      list_endpoints: listEndpoints,
      get_endpoint: getEndpoint,
      list_tunnels: listTunnels,
      list_tunnel_sessions: listTunnelSessions,
      list_reserved_domains: listReservedDomains,
      get_reserved_domain: getReservedDomain,
    },
  })
}

export default createNgrokPlugin()
