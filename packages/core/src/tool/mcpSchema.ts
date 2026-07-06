/**
 * 上游工具集 → HelpModel(Proto §4.1 → §1.3,`~help` 从上游派生的核心映射)。
 *
 * 每个(虚拟化后的)工具 → 一条 CmdSpec:name=虚拟名、method POST、path=`/<nodePath>`、
 * inputSchema 透传、h=description、scope 恒 'call'、effect/confirm 透传。纯逻辑;产出的
 * HelpModel 经 renderHelpDsl/renderHelpJson 渲染(DSL↔JSON 语义等价)。
 */

import { cmdPath } from '../builtin/util'
import type { CmdSpec, HelpModel } from '../htbp/model'
import type { NodeKind, TreePath } from '../types'
import type { ToolSpec } from './types'

/**
 * 派生 mcp/http 节点的 `~help` 模型。`tools` 应为**虚拟化后**的 ToolSpec(名字已是虚拟名)。
 * `effect==='destructive'` 且工具未显式给 `confirm` 时,派生 `confirm:true`(危险操作二次确认)。
 */
export function toolsToHelpModel(
  nodePath: TreePath,
  node: { kind: NodeKind; description: string },
  tools: ToolSpec[],
): HelpModel {
  const path = cmdPath(nodePath)
  const cmds: CmdSpec[] = tools.map((tool) => {
    const cmd: CmdSpec = {
      name: tool.name,
      method: 'POST',
      path,
      scope: 'call',
    }
    if (tool.description !== undefined) cmd.h = tool.description
    if (tool.inputSchema !== undefined) cmd.inputSchema = tool.inputSchema
    if (tool.effect !== undefined) cmd.effect = tool.effect
    const confirm = tool.confirm ?? (tool.effect === 'destructive' ? true : undefined)
    if (confirm) cmd.confirm = confirm
    return cmd
  })

  return {
    node: { path: nodePath, kind: node.kind, description: node.description },
    cmds,
  }
}
