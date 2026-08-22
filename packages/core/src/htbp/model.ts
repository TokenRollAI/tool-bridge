/**
 * HelpModel:`~help` 的内部规范模型。
 *
 * 「单一 Model 渲染两种表现」是 DSL/JSON 语义等价的唯一保证:
 * `renderHelpDsl` 与 `renderHelpJson`(helpDsl.ts)都只从同一个 HelpModel 出发,
 * 不各自持有数据,故两种表现不可能字段漂移。
 */

import type { Action, NodeKind, TreePath } from '../types'

/** ~help 默认 feedback 区块的单条形态(只露 id+title+score,详情经 system/feedback get 下钻)。 */
export interface HelpFeedbackItem {
  id: string
  /** 净分(赞-踩)。 */
  score: number
  title: string
}

/** directory 节点在上级 `~help` 中列出的子节点引用(相对路径 + 一句话描述)。 */
export interface ChildRef {
  description: string
  kind: NodeKind
  path: TreePath
}

/**
 * 单条命令声明。`path` 是该命令的**完整直连调用路径**(如 "/docs/context7/resolve_library_id",
 * 带前导 '/',含命令/工具叶子段),DSL 的 `cmd` 行与 JSON 的 `cmds[].path` 都原样承载它。
 * 调用形态唯一:`POST <path>`,body 即 arguments 本体,无 `{tool,arguments}` 信封。
 * `scope` 必填(每个 cmd 必须声明 scope);`inputSchema`/`returns`/`effect`/`confirm` 可选。
 *
 * `inputSchema` 是该 cmd `arguments`(= 请求体)的 JSON Schema;DSL/JSON/Markdown 都直接
 * 把它作为请求体示意,不再包信封。
 */
export interface CmdSpec {
  /** 危险操作需二次确认(HTBP 属性表可选)。 */
  confirm?: boolean
  /** 副作用描述(HTBP 属性表可选)。 */
  effect?: string
  /** 工具级一句话描述(`h` 行,定型;mcp/http 工具的上游 description 落此)。 */
  h?: string
  /** 该 cmd `arguments` 的 JSON Schema;body 即此 schema 本体(直连,无信封)。 */
  inputSchema?: unknown
  method: 'POST'
  name: string
  /**
   * 该 cmd 返回值的 JSON Schema(可选,裸 JSON Schema)。
   * JSON 表现直接输出它;DSL 渲染为 `result` 行(与 `body` 行对称:一个是请求体示意,
   * 一个是响应示意)。`returns` 是人读的一句话类型描述,两者并存不互斥。
   */
  outputSchema?: unknown
  path: string
  returns?: string
  scope: Action
}

/** `~help` 的内部模型:一个节点 + 其 cmd 集合 + (directory)子节点引用。 */
export interface HelpModel {
  /** directory 节点携带:上级/自身 `~help` 列出的子节点。 */
  children?: ChildRef[]
  cmds: CmdSpec[]
  /**
   * Agent feedback 默认区块(该 path 头部可见条目,网关 ~help 注入;空数组不注入)。
   * DSL 渲染为 `feedback` 头行 + 缩进条目行(未知行忽略通道);JSON 同名字段;Markdown Feedback 节。
   */
  feedback?: HelpFeedbackItem[]
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
  node: { description: string, kind: NodeKind, path: TreePath }
  /**
   * 管理员对该 path 的补充说明(annotation:<path>,网关 ~help 注入)。
   * DSL 渲染为 `note` 行(消费方按未知行忽略,向前兼容);JSON 同名字段;Markdown Notes 节。
   */
  note?: string
}

/**
 * `Accept: application/json` 时 `~help` 的响应形状(规范性)。
 * 字段与 DSL 一一对应,不多不少——JSON 是 DSL 的机器可读形态。
 */
export interface HelpJson {
  /** directory 节点携带。 */
  children?: Array<{ description: string, kind: NodeKind, path: TreePath }>
  cmds: Array<{
    confirm?: boolean
    effect?: string
    /** 工具级一句话描述(`h`,定型)。 */
    h?: string
    /** arguments 的 JSON Schema(不含 {tool,arguments} 信封)。 */
    inputSchema?: unknown
    method: 'POST'
    name: string
    /** 返回值的 JSON Schema,对应 DSL 的 `result` 行(有值才出现)。 */
    outputSchema?: unknown
    path: string
    returns?: string
    scope: Action
  }>
  /** Agent feedback 默认区块,对应 DSL 的 `feedback` 块(有条目才出现)。 */
  feedback?: HelpFeedbackItem[]
  /** 下一步指引,对应 DSL 的 `hint` 行(有值才出现)。 */
  hint?: string
  /** 协议版本,对应 DSL 首行 `htbp <ver>`。 */
  htbp: string
  node: { description: string, kind: NodeKind, path: TreePath }
  /** 管理员补充说明,对应 DSL 的 `note` 行(有值才出现)。 */
  note?: string
}
