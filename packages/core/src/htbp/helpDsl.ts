/**
 * Help DSL / Help JSON 的渲染与最小解析。
 *
 * 两个渲染器都只吃同一个 HelpModel(model.ts),这是 DSL↔JSON 语义等价的保证。
 * parseHelpDsl 是消费侧的最小 parser:只回收断言所需字段
 * (htbp 版本、cmd 的 name/method/path/scope、node 三元组),未知行一律忽略
 * (消费方对未知行必须忽略 = 向前兼容)。
 */

import { HTBP_HELP_HEADER, HTBP_VERSION } from '../version'
import type { HelpJson, HelpModel } from './model'
import { collapseToOneLine } from './summary'

/** node 行的路径显示:根路径(空串或 '/')渲染为 '/'。 */
function displayPath(path: string): string {
  return path === '' || path === '/' ? '/' : path
}

/**
 * 一行 `node <path> <kind> "<description>"`(description 假定不含双引号,当前不转义)。
 * description 折叠为单行:node 行是行式 DSL 的结构锚点,多行值会破坏消费侧解析。
 */
function nodeLine(path: string, kind: string, description: string): string {
  return `node ${displayPath(path)} ${kind} "${collapseToOneLine(description)}"`
}

/**
 * 属性行渲染:首行 `  <key> <首行值>`;多行值的续行统一 4 空格缩进
 * (比属性缩进更深,最小 parser 按未知行忽略——全文得以保留且不破坏行结构)。
 */
function attrLines(key: string, value: string): string[] {
  const [first = '', ...rest] = value.split('\n')
  return [`  ${key} ${first.trimEnd()}`, ...rest.map((line) => `    ${line.trimEnd()}`)]
}

/**
 * 渲染 Help DSL:
 *   首行 `htbp 0.1`;`node` 行;可选 `hint` 行(下一步指引,单行);可选 `note` 行
 *   (管理员补充说明,单行);每 cmd 一行
 *   `cmd <name> POST <path>` + 缩进的 `h`/`body`/`returns`/`scope`/`effect`/`confirm`
 *   (此顺序);directory 的 children 续为 `node` 行;末尾可选 `feedback` 块
 *   (`feedback <count> POST /system/feedback` 头行 + 缩进的 `<id> <score> "<title>"` 条目行
 *   + 缩进的 `use` 指引行)。
 * `scope` 恒有;`h`/`inputSchema`/`returns`/`effect` 有值才渲染;`confirm` 仅在为真时渲染(其缺席即默认 false)。
 * 多行 `h` 经 attrLines 以续行(4 空格缩进)保留全文;消费方按未知行忽略即可。
 *
 * `note`/`feedback` 走"未知行忽略"扩展通道(同 `hint` 先例):最小 parser 不识别它们,
 * 老消费者零破坏;条目行以 `fb_` id 开头、指引行以 `use` 开头,不会撞上 `scope` 归属正则。
 * `feedback` 块的端点与 `use` 指引由 node.path 派生(类比 `body` 行由 inputSchema 派生,
 * 属表现不属语义);JSON 侧的语义等价字段是 `note` 与 `feedback[]`。
 *
 * `body` 行是**请求体示意**:缺省由 cmd 的 `inputSchema`(arguments 的 JSON Schema)
 * 包成 `{ "tool": <name>, "arguments": <inputSchema> }` 单行紧凑 JSON;`flatBody` 的 cmd
 * (直连工具路径 `POST /<node>/<tool>`)body 即裸 `inputSchema`——两种都与 JSON 表现的
 * 裸 `inputSchema` 语义等价、结构表现不同。
 */
export function renderHelpDsl(model: HelpModel): string {
  const lines: string[] = [HTBP_HELP_HEADER]
  lines.push(nodeLine(model.node.path, model.node.kind, model.node.description))
  if (model.hint !== undefined) lines.push(`hint ${collapseToOneLine(model.hint)}`)
  if (model.note !== undefined) lines.push(`note "${collapseToOneLine(model.note)}"`)
  for (const cmd of model.cmds) {
    lines.push(`cmd ${cmd.name} ${cmd.method} ${cmd.path}`)
    if (cmd.h !== undefined) lines.push(...attrLines('h', cmd.h))
    if (cmd.inputSchema !== undefined) {
      const body = cmd.flatBody ? cmd.inputSchema : { tool: cmd.name, arguments: cmd.inputSchema }
      lines.push(`  body ${JSON.stringify(body)}`)
    }
    if (cmd.returns !== undefined) lines.push(...attrLines('returns', cmd.returns))
    lines.push(`  scope ${cmd.scope}`)
    if (cmd.effect !== undefined) lines.push(`  effect ${cmd.effect}`)
    if (cmd.confirm) lines.push('  confirm')
  }
  if (model.children) {
    for (const child of model.children) {
      lines.push(nodeLine(child.path, child.kind, child.description))
    }
  }
  if (model.feedback !== undefined && model.feedback.length > 0) {
    lines.push(`feedback ${model.feedback.length} POST /system/feedback`)
    for (const f of model.feedback) {
      lines.push(`  ${f.id} ${f.score} "${collapseToOneLine(f.title)}"`)
    }
    lines.push(
      `  use {"tool":"get","arguments":{"path":"${model.node.path}","id":"<id>"}} for detail; submit/vote/list: GET /system/feedback/~help`,
    )
  }
  return lines.join('\n')
}

/**
 * 渲染 Help JSON(规范性)——与 DSL 语义等价、字段不多不少。
 * `hint`/`inputSchema`/`returns`/`effect` 仅在有值时出现;`confirm` 仅在为真时出现(与 DSL 的存在性对齐)。
 * 注:JSON 的 `cmds[].inputSchema` 是 arguments 的裸 JSON Schema(不含信封);DSL 的 `body` 行
 * 才把它包成请求信封示意。JSON 的 `node.path`/`children[].path` 承载原始 TreePath(根为空串)。
 */
export function renderHelpJson(model: HelpModel): HelpJson {
  const cmds = model.cmds.map((cmd) => {
    const out: HelpJson['cmds'][number] = {
      name: cmd.name,
      method: cmd.method,
      path: cmd.path,
      scope: cmd.scope,
    }
    if (cmd.h !== undefined) out.h = cmd.h
    if (cmd.inputSchema !== undefined) out.inputSchema = cmd.inputSchema
    if (cmd.returns !== undefined) out.returns = cmd.returns
    if (cmd.effect !== undefined) out.effect = cmd.effect
    if (cmd.confirm) out.confirm = cmd.confirm
    return out
  })
  const json: HelpJson = {
    htbp: HTBP_VERSION,
    node: { path: model.node.path, kind: model.node.kind, description: model.node.description },
    cmds,
  }
  if (model.hint !== undefined) json.hint = model.hint
  if (model.note !== undefined) json.note = model.note
  if (model.feedback !== undefined && model.feedback.length > 0) {
    json.feedback = model.feedback.map((f) => ({ id: f.id, title: f.title, score: f.score }))
  }
  if (model.children) {
    json.children = model.children.map((child) => ({
      path: child.path,
      kind: child.kind,
      description: child.description,
    }))
  }
  return json
}

/** parseHelpDsl 的产物:断言所需的最小字段集(向前兼容:未知行忽略)。 */
export interface ParsedHelp {
  htbp: string
  cmds: Array<{ name: string; method: string; path: string; scope?: string }>
  nodes: Array<{ path: string; kind: string; description: string }>
}

const HEADER_RE = /^htbp\s+(\S+)\s*$/
const NODE_RE = /^node\s+(\S+)\s+(\S+)\s+"(.*)"\s*$/
const CMD_RE = /^cmd\s+(\S+)\s+(\S+)\s+(\S+)\s*$/
const SCOPE_RE = /^\s+scope\s+(\S+)\s*$/

/**
 * 最小 DSL parser(用于断言等价性)。
 * 逐行匹配 header / node / cmd / scope;`scope` 行归属最近的 cmd;其余行(body/returns/
 * effect/confirm 及任何未知行)一律忽略。容忍 CRLF 行尾。
 */
export function parseHelpDsl(text: string): ParsedHelp {
  let htbp = ''
  const cmds: ParsedHelp['cmds'] = []
  const nodes: ParsedHelp['nodes'] = []
  let current: ParsedHelp['cmds'][number] | null = null

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')

    // 捕获组在匹配成功时必为字符串;`?? ''` 仅为满足 noUncheckedIndexedAccess。
    const header = HEADER_RE.exec(line)
    if (header) {
      htbp = header[1] ?? ''
      continue
    }
    const node = NODE_RE.exec(line)
    if (node) {
      nodes.push({ path: node[1] ?? '', kind: node[2] ?? '', description: node[3] ?? '' })
      continue
    }
    const cmd = CMD_RE.exec(line)
    if (cmd) {
      current = { name: cmd[1] ?? '', method: cmd[2] ?? '', path: cmd[3] ?? '' }
      cmds.push(current)
      continue
    }
    const scope = SCOPE_RE.exec(line)
    if (scope && current) {
      current.scope = scope[1] ?? ''
    }
    // 未知行:忽略(向前兼容)
  }

  return { htbp, cmds, nodes }
}
