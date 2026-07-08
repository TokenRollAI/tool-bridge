/**
 * HelpModel:`~help` 的内部规范模型。
 *
 * 「单一 Model 渲染两种表现」是 DSL/JSON 语义等价的唯一保证:
 * `renderHelpDsl` 与 `renderHelpJson`(helpDsl.ts)都只从同一个 HelpModel 出发,
 * 不各自持有数据,故两种表现不可能字段漂移。
 */

import type { Action, NodeKind, TreePath } from '../types'

/** directory 节点在上级 `~help` 中列出的子节点引用(相对路径 + 一句话描述)。 */
export interface ChildRef {
  path: TreePath
  kind: NodeKind
  description: string
}

/**
 * 单条命令声明。`path` 是数据面调用的 HTTP 路径(如 "/docs/context7",
 * 带前导 '/'),DSL 的 `cmd` 行与 JSON 的 `cmds[].path` 都原样承载它。
 * `scope` 必填(每个 cmd 必须声明 scope);`inputSchema`/`returns`/`effect`/`confirm` 可选。
 *
 * `inputSchema` 是该 cmd `arguments` 的 JSON Schema(不含 {tool,arguments} 信封)——
 * JSON 表现直接输出它;DSL 的 `body` 行则由它生成请求信封示意(`renderHelpDsl` 负责),
 * 二者语义等价、结构表现不同。
 */
export interface CmdSpec {
  name: string
  method: 'POST'
  path: string
  /** 工具级一句话描述(`h` 行,定型;mcp/http 工具的上游 description 落此)。 */
  h?: string
  /** 该 cmd `arguments` 的 JSON Schema(不含 {tool,arguments} 信封)。 */
  inputSchema?: unknown
  returns?: string
  scope: Action
  /** 副作用描述(HTBP 属性表可选)。 */
  effect?: string
  /** 危险操作需二次确认(HTBP 属性表可选)。 */
  confirm?: boolean
  /**
   * body 即 arguments 本体(直连工具路径,无 {tool,arguments} 信封)。
   * 仅影响 DSL `body` 行渲染;JSON 表现恒为裸 inputSchema,body 形状由 path 判别
   * (path 含工具段 ⇒ 扁平)。
   */
  flatBody?: boolean
}

/** `~help` 的内部模型:一个节点 + 其 cmd 集合 + (directory)子节点引用。 */
export interface HelpModel {
  node: { path: TreePath; kind: NodeKind; description: string }
  cmds: CmdSpec[]
  /** directory 节点携带:上级/自身 `~help` 列出的子节点。 */
  children?: ChildRef[]
  /**
   * 面向消费者的下一步指引(如"入参 schema 经 GET <path>/<tool>/~help 获取")。
   * DSL 渲染为 `hint` 行(消费方按未知行忽略,向前兼容);JSON/Markdown 渲染为同名字段/引言。
   */
  hint?: string
  /**
   * 索引形态标记(两级披露的节点级 `~help`:cmd 不含 inputSchema/returns)。
   * 仅供渲染器措辞用(Markdown 区分"schema 未展示"与"无参数"),不进任何表现。
   */
  index?: boolean
}

/**
 * `Accept: application/json` 时 `~help` 的响应形状(规范性)。
 * 字段与 DSL 一一对应,不多不少——JSON 是 DSL 的机器可读形态。
 */
export interface HelpJson {
  /** 协议版本,对应 DSL 首行 `htbp <ver>`。 */
  htbp: string
  node: { path: TreePath; kind: NodeKind; description: string }
  /** 下一步指引,对应 DSL 的 `hint` 行(有值才出现)。 */
  hint?: string
  cmds: Array<{
    name: string
    method: 'POST'
    path: string
    /** 工具级一句话描述(`h`,定型)。 */
    h?: string
    /** arguments 的 JSON Schema(不含 {tool,arguments} 信封)。 */
    inputSchema?: unknown
    returns?: string
    scope: Action
    effect?: string
    confirm?: boolean
  }>
  /** directory 节点携带。 */
  children?: Array<{ path: TreePath; kind: NodeKind; description: string }>
}
