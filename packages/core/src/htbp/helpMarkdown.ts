/**
 * HelpModel → Markdown(`Accept: text/markdown` 的 `~help` 表现)。
 *
 * 定位:**可读性表现**——面向"把 ~help 全文塞进上下文阅读"的 Agent 与人类,
 * 用完整语句与显式路径消除 DSL 缩写(`h`/`body`/单行 schema)的语义含糊。
 * 规范等价对仍是 DSL↔JSON(机器可读);Markdown 与它们同源(同一 HelpModel),
 * 但排版自定,消费方不应对其做结构化解析。
 *
 * 三个设计目标(对应 DSL 表现的三个可读性短板):
 * 1. 语义明确:调用信封、scope/effect/confirm 全部用完整句子解释,不用单字符缩写;
 * 2. 使用路径清晰:每个下一步(调用、下钻单工具 spec、探索子节点)都给出可直接
 *    执行的 `GET`/`POST` 路径;
 * 3. 方法说明完整:cmd 的 description 全文保留,inputSchema 以缩进 JSON 呈现。
 */

import { HTBP_VERSION } from '../version'
import type { CmdSpec, HelpModel } from './model'
import { collapseToOneLine } from './summary'

/** 根路径显示为 '/'。 */
function displayPath(path: string): string {
  return path === '' || path === '/' ? '/' : `/${path}`
}

/** 表格单元格:折叠为单行并转义 `|`,空值显示 '—'。 */
function tableCell(text: string): string {
  const collapsed = collapseToOneLine(text).replace(/\|/g, '\\|')
  return collapsed === '' ? '—' : collapsed
}

/** 单条 cmd 的小节。`index` 为真时,缺 inputSchema 表示"索引未展示"而非"无参数"。 */
function cmdSection(cmd: CmdSpec, index: boolean): string[] {
  const lines: string[] = [`### \`${cmd.name}\``, '']
  if (cmd.h !== undefined && cmd.h.trim() !== '') {
    lines.push(cmd.h.trim(), '')
  }
  // flatBody(直连工具路径):body 即 arguments 本体;否则为 {tool,arguments} 信封。
  const bodyShape = cmd.flatBody
    ? '`{...arguments}`'
    : `\`{"tool": "${cmd.name}", "arguments": {...}}\``
  lines.push(`- Invoke: \`POST ${cmd.path}\` with body ${bodyShape}`)
  lines.push(`- Required scope: \`${cmd.scope}\``)
  if (cmd.effect !== undefined) {
    lines.push(
      `- Effect: \`${cmd.effect}\`${cmd.confirm ? ' — **ask the user to confirm before calling**' : ''}`,
    )
  } else if (cmd.confirm) {
    lines.push('- **Ask the user to confirm before calling** (confirm)')
  }
  if (cmd.returns !== undefined) lines.push(`- Returns: ${collapseToOneLine(cmd.returns)}`)
  if (cmd.inputSchema !== undefined) {
    lines.push(
      '',
      cmd.flatBody
        ? 'Request body (JSON Schema):'
        : 'Arguments (JSON Schema of the `arguments` field):',
      '',
      '```json',
      JSON.stringify(cmd.inputSchema, null, 2),
      '```',
    )
  } else if (index) {
    // flatBody 的 cmd.path 已含工具段,直接加 /~help;信封 cmd 补 /<name> 段。
    const specPath = cmd.flatBody ? `${cmd.path}/~help` : `${cmd.path}/${cmd.name}/~help`
    lines.push(`- Arguments: schema not shown in this index — \`GET ${specPath}\``)
  } else {
    lines.push('- Arguments: none declared')
  }
  return lines
}

/** 渲染 `~help` 的 Markdown 表现(见文件头注释)。 */
export function renderHelpMarkdown(model: HelpModel): string {
  const index = model.index === true
  const out: string[] = []
  out.push(`# ${displayPath(model.node.path)}`)
  out.push('')
  out.push(`> HTBP ${HTBP_VERSION} node · kind: \`${model.node.kind}\``)
  out.push('')
  if (model.node.description.trim() !== '') {
    out.push(model.node.description.trim(), '')
  }
  if (model.hint !== undefined) {
    out.push(`> **Next step**: ${collapseToOneLine(model.hint)}`, '')
  }

  if (model.cmds.length > 0) {
    const allFlat = model.cmds.every((c) => c.flatBody === true)
    out.push('## How to call')
    out.push('')
    if (allFlat) {
      // 直连工具路径:每个 cmd 有自己的 POST 路径,body 即 arguments 本体。
      out.push(
        'Each command has its own direct URL; the request body is the arguments object itself:',
      )
      out.push('')
      out.push('```')
      out.push(`POST ${model.cmds[0]?.path ?? displayPath(model.node.path)}`)
      out.push('Content-Type: application/json')
      out.push('')
      out.push('{...arguments}')
      out.push('```')
    } else {
      // 信封形态:所有 cmd 共享同一数据面入口;取第一条的 path 作示例。
      const invokePath = model.cmds[0]?.path ?? displayPath(model.node.path)
      out.push('Every command on this node is invoked with the same request shape:')
      out.push('')
      out.push('```')
      out.push(`POST ${invokePath}`)
      out.push('Content-Type: application/json')
      out.push('')
      out.push('{"tool": "<command name>", "arguments": {...}}')
      out.push('```')
    }
    out.push('')
    out.push('`Required scope` names the permission your Secret Key must hold for that command.')
    out.push('')
    out.push('## Commands')
    out.push('')
    for (const cmd of model.cmds) {
      out.push(...cmdSection(cmd, index), '')
    }
  }

  if (model.children !== undefined && model.children.length > 0) {
    out.push('## Child nodes')
    out.push('')
    out.push('| Path | Kind | Description |')
    out.push('|---|---|---|')
    for (const child of model.children) {
      out.push(`| \`${child.path}\` | ${child.kind} | ${tableCell(child.description)} |`)
    }
    out.push('')
    out.push('Fetch `GET /<path>/~help` to learn how to use a child node.')
    out.push('')
  }

  if (model.cmds.length === 0 && (model.children === undefined || model.children.length === 0)) {
    out.push('This node exposes no commands and no child nodes.')
    out.push('')
  }

  // 去掉结尾多余空行,保证以单个换行结束。
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return `${out.join('\n')}\n`
}
