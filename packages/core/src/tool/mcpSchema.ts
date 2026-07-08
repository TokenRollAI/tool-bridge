/**
 * 上游工具集 → HelpModel(`~help` 从上游派生的核心映射)。
 *
 * 两级渐进披露:节点级 `~help` 出**索引形态**(每工具一行 name+h+scope,
 * 不含 inputSchema/returns——大工具集不再一次性塞满 agent 上下文);单工具全量 spec 经
 * `GET /<node>/<tool>/~help`(toolHelpModel)按需获取。纯逻辑;产出的 HelpModel 经
 * renderHelpDsl/renderHelpJson 渲染(DSL↔JSON 语义等价)。
 */

import { cmdPath } from '../builtin/util'
import type { CmdSpec, HelpModel } from '../htbp/model'
import { summarizeOneLine } from '../htbp/summary'
import type { NodeKind, TreePath } from '../types'
import type { ToolSpec } from './types'

/**
 * 单个(虚拟化后)ToolSpec → CmdSpec;index=true 时略去 inputSchema/returns(索引形态),
 * 且 `h` 压缩为一句话摘要(上游 description 常是整篇多行 markdown,索引里只留概述句;
 * 全文保留在单工具全量 `~help`)。
 * cmd 宣告**直连工具路径** `POST /<node>/<tool>`(body 即 arguments 本体,flatBody);
 * 兼容入口 `POST /<node>` + `{tool,arguments}` 信封仍受理但不再宣告。
 */
function toolToCmd(nodePath: TreePath, tool: ToolSpec, index: boolean): CmdSpec {
  const cmd: CmdSpec = {
    name: tool.name,
    method: 'POST',
    path: `${cmdPath(nodePath)}/${tool.name}`,
    scope: 'call',
    flatBody: true,
  }
  if (tool.description !== undefined) {
    cmd.h = index ? summarizeOneLine(tool.description) : tool.description
  }
  if (!index && tool.inputSchema !== undefined) cmd.inputSchema = tool.inputSchema
  if (tool.effect !== undefined) cmd.effect = tool.effect
  const confirm = tool.confirm ?? (tool.effect === 'destructive' ? true : undefined)
  if (confirm) cmd.confirm = confirm
  return cmd
}

/**
 * 派生 mcp/http 节点的 `~help` 模型。`tools` 应为**虚拟化后**的 ToolSpec(名字已是虚拟名)。
 * `effect==='destructive'` 且工具未显式给 `confirm` 时,派生 `confirm:true`(危险操作二次确认)。
 * `opts.index` → 索引形态:cmd 不含 inputSchema/returns、h 一句话化,
 * 工具级 `~help` 的下钻指引经 `hint` 字段下发(不再污染节点 description)。
 */
export function toolsToHelpModel(
  nodePath: TreePath,
  node: { kind: NodeKind; description: string },
  tools: ToolSpec[],
  opts: { index?: boolean } = {},
): HelpModel {
  const index = opts.index === true
  const model: HelpModel = {
    node: { path: nodePath, kind: node.kind, description: node.description },
    cmds: tools.map((tool) => toolToCmd(nodePath, tool, index)),
  }
  if (index) {
    model.index = true
    model.hint = `this is an index (descriptions summarized, input schemas omitted); GET /${nodePath}/<tool>/~help returns one tool's full spec`
  }
  return model
}

/**
 * 单工具的 `~help` 模型(`GET /<node>/<tool>/~help`,两级披露的细节级)。
 * node 行呈现工具伪节点路径 `<nodePath>/<tool>`;cmd 的调用 path 同为直连路径
 * `POST /<nodePath>/<tool>`(body 即 arguments 本体)。
 * node 行 description 取一句话摘要(全文在 cmd 的 `h` 里,避免整篇重复两遍)。
 */
export function toolHelpModel(
  nodePath: TreePath,
  node: { kind: NodeKind; description: string },
  tool: ToolSpec,
): HelpModel {
  return {
    node: {
      path: `${nodePath}/${tool.name}`,
      kind: node.kind,
      description: summarizeOneLine(tool.description ?? node.description),
    },
    cmds: [toolToCmd(nodePath, tool, false)],
  }
}
