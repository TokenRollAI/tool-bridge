/**
 * builtin 装配:把基础模块与宿主可选模块组装为 `module → BuiltinModule` 映射。
 *
 * 存储实例(SKRegistryStore / SecretStoreImpl / NodeRegistryStore)由网关注入并复用;
 * status 的 nodeCount 经单趟全树扫描统计 registry 全量节点(当前树规模小,可接受)。
 */

import type { RemoteAllowlistStore } from '../tool/allowlist'
import type { SecretStoreImpl } from '../secret/secretStore'
import type { AnnotationStore } from '../annotation/store'
import type { NodeRegistryStore } from '../tree/registry'
import type { ScopeChecker } from '../tree/visibility'
import type { SKRegistryStore } from '../auth/sk'
import type { BuiltinModule } from './types'
import { type CatalogModuleDeps, createCatalogModule } from './catalog'
import { createPluginModule, type PluginModuleDeps } from './plugin'
import { createStoreModule, type StoreModuleDeps } from './store'
import { createAnnotationModule } from './annotation'
import { createFederationModule } from './federation'
import { createRegistryModule } from './registry'
import { createSecretModule } from './secret'
import { createStatusModule } from './status'
import { createSkModule } from './sk'

export interface BuiltinDeps {
  /** annotation 模块装配(Path 补充说明;registry 复用上方注入)。缺省不装配。 */
  annotation?: { store: AnnotationStore }
  /**
   * catalog 模块装配:内置插件目录的只读浏览面(read scope)。
   * 缺省不装配 system/catalog —— 没装内置插件的宿主不该多一个恒空的节点。
   */
  catalog?: CatalogModuleDeps
  /**
   * federation 模块装配:remote host 白名单的运行时存储 + env 基线。
   * 缺省不装配 system/federation(纯逻辑单测无需)。
   */
  federation?: { base: string[], store: RemoteAllowlistStore }
  /** 时间源;缺省 `new Date().toISOString()`(测试可注入固定时钟)。 */
  now?: () => string
  /**
   * plugin 模块装配:store + 探活/契约抓取回调(I/O 在宿主)。
   * 缺省不装配 system/plugin(sk/secrets/now 复用上方注入)。
   */
  plugin?: Omit<PluginModuleDeps, 'sk' | 'secrets' | 'now'>
  registry: NodeRegistryStore
  secret: SecretStoreImpl
  sk: SKRegistryStore
  /** 部署级 default Store；正式宿主应注入，纯 core 旧单测可缺省。 */
  store?: StoreModuleDeps
  /** 网关 version(单一真源:package.json),status.get 回显。 */
  version: () => string
  /**
   * 可见性判定(= auth/scope 的 checkScopes),注入给 registry 模块做可见性裁剪
   * (list 裁剪 / get→not_found)。网关装配一律传入;缺省则 registry 不裁剪(纯逻辑单测)。
   */
  visibility?: ScopeChecker
}

/**
 * 全树节点数(status.nodeCount)。`subtree('')` 一趟扫描即全量;此前按 `list` 翻页
 * 统计,而 `list` 每页都内部全扫再切片,整体 O(N²/页)。不用 `rootSnapshot`:它按
 * 派生索引预算(500)截断,计数会失真。
 */
async function countNodes(registry: NodeRegistryStore): Promise<number> {
  return (await registry.subtree('')).length
}

/** 构造 module 名 → BuiltinModule 映射；可选模块只在宿主提供依赖时装配。 */
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
  if (deps.plugin !== undefined) {
    modules.set(
      'plugin',
      createPluginModule({ ...deps.plugin, sk: deps.sk, secrets: deps.secret, now }),
    )
  }
  if (deps.catalog !== undefined) {
    modules.set('catalog', createCatalogModule(deps.catalog))
  }
  if (deps.federation !== undefined) {
    modules.set(
      'federation',
      createFederationModule({ store: deps.federation.store, base: deps.federation.base, now }),
    )
  }
  if (deps.annotation !== undefined) {
    modules.set(
      'annotation',
      createAnnotationModule({ store: deps.annotation.store, registry: deps.registry, now }),
    )
  }
  if (deps.store !== undefined) {
    modules.set('store', createStoreModule(deps.store))
  }
  return modules
}

export { type AnnotationModuleDeps } from './annotation'
export {
  type CatalogExportAuth,
  type CatalogExportDetails,
  type CatalogListItem,
  type CatalogModuleDeps,
} from './catalog'
export { type FederationHost, type FederationModuleDeps } from './federation'
export {
  type PluginHealthRecord,
  type PluginModuleDeps,
  type PluginProbeResult,
  type PluginRegistration,
  pluginTokenSecretName,
  type PluginView,
} from './plugin'
export { parseNodeInput } from './registry'
export { type StatusDeps, type StatusSummary } from './status'
export {
  createStoreModule,
  type StoreModuleCallbacks,
  type StoreModuleDeps,
  storeScopeForCmd,
} from './store'
export type { BuiltinDispatchRuntime, BuiltinModule } from './types'
