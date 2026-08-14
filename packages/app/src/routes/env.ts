/**
 * 路由共享装配面:一次构造、全路由复用的请求外状态。
 *
 * createTbApp 装配时构造一次,handler 只读:builtin 模块表按 store 现造(每请求 store
 * 相同,但 builtin 需要 store 句柄),搜索派生同步器与全局 search 能力表随注入点存在性决定。
 */
import { type BuiltinModule, createBuiltins, type StateStore } from '@tool-bridge/core'
import type { TbAppDeps } from '../deps'
import { isMutableSearchIndex, SearchSynchronizer } from '../search/synchronizer'
import { buildDeps } from '../bootstrap'

/** 路由 handler 的公共装配面(handler 签名统一为 `(c, env)`)。 */
export interface RouteEnv {
  /** builtin 模块表(system/* 管理面);按请求期 store 现造。 */
  builtinsOf: (store: StateStore) => Map<string, BuiltinModule>
  deps: TbAppDeps
  /** 全局工具搜索能力表;未注入索引或未声明 search → 空数组(端点不存在)。 */
  globalSearchCapabilities: () => Array<'search' | 'search:semantic'>
  /** 派生搜索状态同步器;索引不可写(或未注入)→ undefined,全部同步点变成 no-op。 */
  searchSync: SearchSynchronizer | undefined
}

export function createRouteEnv(deps: TbAppDeps): RouteEnv {
  const searchSync = isMutableSearchIndex(deps.search)
    ? new SearchSynchronizer(deps.state, deps.search)
    : undefined
  const builtinsOf = (store: StateStore): Map<string, BuiltinModule> =>
    createBuiltins(
      buildDeps({
        store,
        secrets: deps.secrets,
        version: deps.version,
        allowInsecureHttp: deps.allowInsecureHttp,
        remoteAllowlistBase: deps.remote.allowlist,
        ...(deps.pluginBindings !== undefined ? { pluginBindings: deps.pluginBindings } : {}),
        ...(deps.pluginCatalog !== undefined ? { pluginCatalog: deps.pluginCatalog } : {}),
      }),
    )
  const globalSearchCapabilities = (): Array<'search' | 'search:semantic'> => {
    const declared = new Set(deps.search?.capabilities ?? [])
    if (!declared.has('search')) return []
    return [
      'search',
      ...(declared.has('search:semantic') ? ['search:semantic' as const] : []),
    ]
  }
  return { builtinsOf, deps, globalSearchCapabilities, searchSync }
}
