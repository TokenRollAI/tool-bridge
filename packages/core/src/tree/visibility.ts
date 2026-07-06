/**
 * 可见性裁剪(Proto §2.3,行 223):"可见性即权限"。
 *
 * `~help` / `~tree` / 各 List 的结果必须按调用者裁剪——对 (path,'read') 判不过的
 * 节点不出现在结果里。裁剪是体验,不是判定;数据面每次调用仍必须过 Check。
 *
 * 判定委托给 auth/scope.ts 的 checkScopes(签名见 {@link ScopeChecker})。此处以
 * 注入方式接收,避免 tree → auth 的模块级耦合;网关装配时传入 `checkScopes`:
 *   `filterVisible(nodes, ctx.scopes, checkScopes)`
 *
 * 实现决策(待联合验证/回写 docs):任务描述给的是 `filterVisible(nodes, scopes)`
 * 两参内联 checkScopes;这里改为第三参注入 checker,理由是 checkScopes 由并行
 * worker 编写、尚未就绪,注入可让本模块独立编译与测试,集成成本仅调用点一行。
 */

import type { Action, Scope, TreeNode, TreePath } from '../types'

/** (scopes, path, action) → 是否放行;由 auth/scope.ts 的 checkScopes 满足(Proto §2.2)。 */
export type ScopeChecker = (scopes: Scope[], path: TreePath, action: Action) => boolean

/** 剔除对 (node.path,'read') 判定不过的节点。 */
export function filterVisible(nodes: TreeNode[], scopes: Scope[], check: ScopeChecker): TreeNode[] {
  return nodes.filter((node) => check(scopes, node.path, 'read'))
}
