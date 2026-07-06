/**
 * builtin 装配:把四个 system/* 模块组装为 `module → BuiltinModule` 映射。
 *
 * 存储实例(SKRegistryStore / SecretStoreImpl / NodeRegistryStore)由网关注入并复用;
 * status 的 nodeCount 经翻页统计 registry 全量节点(Phase 1 树规模小,可接受)。
 */

import type { SKRegistryStore } from '../auth/sk'
import type { SecretStoreImpl } from '../secret/secretStore'
import type { NodeRegistryStore } from '../tree/registry'
import type { ScopeChecker } from '../tree/visibility'
import { LIST_LIMIT_MAX } from '../types'
import { createRegistryModule } from './registry'
import { createSecretModule } from './secret'
import { createSkModule } from './sk'
import { createStatusModule } from './status'
import type { BuiltinModule } from './types'

export interface BuiltinDeps {
  sk: SKRegistryStore
  secret: SecretStoreImpl
  registry: NodeRegistryStore
  /** 网关 version(单一真源:package.json),status.get 回显。 */
  version: () => string
  /** 时间源;缺省 `new Date().toISOString()`(测试可注入固定时钟)。 */
  now?: () => string
  /**
   * 可见性判定(= auth/scope 的 checkScopes),注入给 registry 模块做 §2.3 裁剪
   * (list 裁剪 / get→not_found)。网关装配一律传入;缺省则 registry 不裁剪(纯逻辑单测)。
   */
  visibility?: ScopeChecker
}

/** 翻页统计 registry 全量节点数(status.nodeCount)。 */
async function countNodes(registry: NodeRegistryStore): Promise<number> {
  let count = 0
  let cursor: string | undefined
  do {
    const page: { items: unknown[]; cursor?: string } = await registry.list(undefined, {
      limit: LIST_LIMIT_MAX,
      ...(cursor !== undefined ? { cursor } : {}),
    })
    count += page.items.length
    cursor = page.cursor
  } while (cursor)
  return count
}

/** 构造 module 名 → BuiltinModule 映射(sk / secret / registry / status)。 */
export function createBuiltins(deps: BuiltinDeps): Map<string, BuiltinModule> {
  const now = deps.now ?? (() => new Date().toISOString())
  const modules = new Map<string, BuiltinModule>()
  modules.set('sk', createSkModule(deps.sk, now))
  modules.set('secret', createSecretModule(deps.secret, now))
  modules.set('registry', createRegistryModule(deps.registry, now, deps.visibility))
  modules.set(
    'status',
    createStatusModule({ version: deps.version, nodeCount: () => countNodes(deps.registry) }),
  )
  return modules
}

export { createRegistryModule, parseNodeInput } from './registry'
export { createSecretModule } from './secret'
export { createSkModule } from './sk'
export { createStatusModule, type StatusDeps, type StatusSummary } from './status'
export type { BuiltinModule } from './types'
