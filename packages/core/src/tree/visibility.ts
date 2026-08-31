/**
 * 可见性判定的注入契约:"可见性即权限"。
 *
 * `~help` / `~tree` / 各 List 的结果必须按调用者裁剪——对 (path,'read') 判不过的
 * 节点不出现在结果里。裁剪是体验,不是判定;数据面每次调用仍必须过 Check。
 *
 * 判定委托给 auth/scope.ts 的 checkScopes(签名见 {@link ScopeChecker})。以注入
 * 方式接收,避免 tree → auth 的模块级耦合;网关装配时把 `checkScopes` 传给消费方
 * (如 builtin/registry 的可见性裁剪)。
 */

import type { Action, Scope, TreePath } from '../types'

/** (scopes, path, action) → 是否放行;由 auth/scope.ts 的 checkScopes 满足。 */
export type ScopeChecker = (scopes: Scope[], path: TreePath, action: Action) => boolean
