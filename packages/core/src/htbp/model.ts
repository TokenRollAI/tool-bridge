/**
 * HelpModel:`~help` 的内部规范模型(Proto §1.3)。
 *
 * 「单一 Model 渲染两种表现」是 DSL/JSON 语义等价的唯一保证(DOD.md:53):
 * `renderHelpDsl` 与 `renderHelpJson`(helpDsl.ts)都只从同一个 HelpModel 出发,
 * 不各自持有数据,故两种表现不可能字段漂移。
 */

import type { Action, NodeKind, TreePath } from '../types'

/** directory 节点在上级 `~help` 中列出的子节点引用(Proto §1.1:相对路径 + 一句话描述)。 */
export interface ChildRef {
  path: TreePath
  kind: NodeKind
  description: string
}

/**
 * 单条命令声明(Proto §1.3)。`path` 是数据面调用的 HTTP 路径(如 "/docs/context7",
 * 带前导 '/'),DSL 的 `cmd` 行与 JSON 的 `cmds[].path` 都原样承载它。
 * `scope` 必填(§1.3:每个 cmd 必须声明 scope);`body`/`returns`/`effect`/`confirm` 可选。
 */
export interface CmdSpec {
  name: string
  method: 'POST'
  path: string
  /** JSON Schema(有 inputSchema 时);DSL 渲染为单行 JSON 的 `body` 行。 */
  body?: unknown
  returns?: string
  scope: Action
  /** 副作用描述(HTBP 属性表可选)。 */
  effect?: string
  /** 危险操作需二次确认(HTBP 属性表可选)。 */
  confirm?: boolean
}

/** `~help` 的内部模型:一个节点 + 其 cmd 集合 + (directory)子节点引用。 */
export interface HelpModel {
  node: { path: TreePath; kind: NodeKind; description: string }
  cmds: CmdSpec[]
  /** directory 节点携带:上级/自身 `~help` 列出的子节点。 */
  children?: ChildRef[]
}

/**
 * `Accept: application/json` 时 `~help` 的响应形状(Proto §1.3,规范性)。
 * 字段与 DSL 一一对应,不多不少——JSON 是 DSL 的机器可读形态。
 */
export interface HelpJson {
  /** 协议版本,对应 DSL 首行 `htbp <ver>`。 */
  htbp: string
  node: { path: TreePath; kind: NodeKind; description: string }
  cmds: Array<{
    name: string
    method: 'POST'
    path: string
    body?: unknown
    returns?: string
    scope: Action
    effect?: string
    confirm?: boolean
  }>
  /** directory 节点携带。 */
  children?: Array<{ path: TreePath; kind: NodeKind; description: string }>
}
