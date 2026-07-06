/**
 * builtin 模块契约(Proto §3.2 kind='builtin'、§4.2 builtin ~help 由模块静态声明)。
 *
 * 每个 system/* 节点(sk / secret / registry / status)背后是一个 BuiltinModule:
 * - `help(nodePath)` 产出该节点的 {@link HelpModel}(cmd 集合 + scope),供 ~help 渲染
 *   与网关取 cmd→scope 做判定;
 * - `dispatch(cmd, args, ctx)` 执行数据面调用(POST /<nodePath> body {tool,arguments})。
 *
 * 纯逻辑:存储经注入的 Store(SKRegistryStore / SecretStoreImpl / NodeRegistryStore)。
 * §2.2/§2.4 的权限判定不在此——由网关调用点统一做(见 gateway/app.ts)。
 */

import type { HelpModel } from '../htbp/model'
import type { CallContext, TreePath } from '../types'

export interface BuiltinModule {
  /** 模块名,对应 NodeConfig{kind:'builtin', module}(Proto §3.2)。 */
  module: string
  /** 一句话描述;上级 ~help 列子节点与本节点 node 行展示。 */
  description: string
  /** 该节点的 ~help 模型(cmd 集合含 scope)。nodePath 为节点挂载路径,如 "system/sk"。 */
  help(nodePath: TreePath): HelpModel
  /** 数据面调度:未知 cmd → invalid_argument(Proto §0.2)。 */
  dispatch(cmd: string, args: Record<string, unknown>, ctx: CallContext): Promise<unknown>
}
