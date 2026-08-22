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

import type { CmdSpec, HelpModel } from './model'
import { collapseToOneLine } from './summary'
import { HTBP_VERSION } from '../version'

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
  // 唯一调用形态:直连 `POST <path>`(path 含命令/工具叶子段),body 即 arguments 本体。
  lines.push(`- Invoke: \`POST ${cmd.path}\` with body \`{...arguments}\``)
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
      'Request body (JSON Schema):',
      '',
      '```json',
      JSON.stringify(cmd.inputSchema, null, 2),
      '```',
    )
  } else if (index) {
    // cmd.path 已是完整命令路径,直接加 /~help 取该命令全量 spec。
    lines.push(`- Arguments: schema not shown in this index — \`GET ${cmd.path}/~help\``)
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
  if (model.note !== undefined && model.note.trim() !== '') {
    out.push('## Notes')
    out.push('')
    out.push(model.note.trim(), '')
  }

  if (model.cmds.length > 0) {
    out.push('## How to call')
    out.push('')
    // 唯一调用形态:每个命令是节点下的虚拟叶子,有自己的直连 URL,body 即 arguments 本体。
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

  if (model.feedback !== undefined && model.feedback.length > 0) {
    const fbPath = `/${model.node.path}/~feedback`
    out.push('## Agent feedback')
    out.push('')
    out.push('Pitfalls shared by other agents on this path (sorted by votes, top entries only):')
    out.push('')
    out.push('| id | score | title |')
    out.push('|---|---|---|')
    for (const f of model.feedback) {
      out.push(`| \`${f.id}\` | ${f.score} | ${tableCell(f.title)} |`)
    }
    out.push('')
    out.push(`Full detail of one entry: \`GET ${fbPath}/<id>\`.`)
    out.push(
      `Hit a pitfall yourself? \`POST ${fbPath}\` with body \`{"title": "...", "detail": "..."}\` (keep both short).`,
    )
    out.push(
      `Found an entry (un)helpful? \`POST ${fbPath}/<id>\` with body \`{"vote": "up"|"down"|"clear"}\`.`,
    )
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
