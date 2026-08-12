/**
 * Upstash Redis —— 从 open-connector 迁移的 provider(7 个字符串键命令)。
 *
 * 凭证是**两个字段**:restUrl(数据库的 REST 端点,非敏感)与 restToken(Bearer 令牌)。
 * 对应上游 `definition.ts` 的 `custom_credential`,字段名与那里逐字一致 —— 名字对不上
 * 就取不到值,而 `requireCredential` 会把它报成 internal(provider 自身的 bug)。
 *
 * 没有 credentialProbe:七个 action 的 effect 都被播种成 write,探针必须是 read。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { deleteKey, exists, expire, get, scan, set, ttl } from './api'
import { upstashRedisActions } from './schema'

export type { ProviderEnv as Env }

export function createUpstashRedisPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Upstash Redis',
    credentialFields: [
      {
        key: 'restUrl',
        label: 'REST URL',
        required: true,
        secret: false,
        description: 'Upstash 控制台里那个数据库的 HTTPS REST 地址(https://<db>.upstash.io);只接受官方 upstash.io 端点',
      },
      {
        key: 'restToken',
        label: 'REST Token',
        required: true,
        secret: true,
        description: '以 Bearer 发送的 Upstash REST 令牌。只读令牌能跑 get/exists/ttl,但 scan 与所有写操作要标准令牌',
      },
    ],
    actions: upstashRedisActions,
    handlers: {
      get,
      set,
      delete: deleteKey,
      exists,
      expire,
      ttl,
      scan,
    },
  })
}

export default createUpstashRedisPlugin()
