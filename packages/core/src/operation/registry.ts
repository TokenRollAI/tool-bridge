/**
 * OperationRegistry:Zod 驱动的操作注册表(tools 与 context 的共同底座)。
 *
 * 动机(2026-08-10 Plugin SDK 设计评审):此前 Provider 作者必须手写 `List/Get/Call`
 * 三个协议适配方法,还要手写 JSON Schema —— 协议细节泄漏到了开发者接口上,且 `Get`
 * 纯属样板(网关只消费 List/Call)。本表把"一个操作"收敛为它真正的四件事:
 * **名字、Zod schema、语义标注、handler**;协议形态(ToolSpec 派生、入参校验、
 * 错误归一、结果包装)一律由本表代劳。
 *
 * 与 MCP SDK 的 `registerTool` 保持形似,便于迁移;`inputSchema` 既收完整 Zod schema,
 * 也收 MCP 风格的 raw shape(`{ text: z.string() }`),另留 `rawInputSchema` 作为直接
 * 给 JSON Schema 的低层逃生阀。
 *
 * **Zod v4**:用 zod 3.25 内置的 `zod/v4` 子路径,其 `toJSONSchema` 是官方实现 ——
 * 不引新依赖、不手写转换器(工程纪律:成熟框架优先)。作者侧应 `import { z } from 'zod/v4'`。
 *
 * 纯逻辑,无 I/O、无宿主依赖:SDK 与 plugin-sdk 都装配它。
 */

import { z } from 'zod/v4'
import type { ToolResult, ToolSpec } from '../tool/types'
import { TBError } from '../errors'
import { omit } from '../omit'

/** 值或其 Promise(handler 可同步可异步)。 */
export type Awaitable<T> = T | Promise<T>

/** 入参 schema:完整 Zod schema,或 MCP 风格的 raw shape。 */
export type InputSchemaLike = z.ZodType | Record<string, z.ZodType>

/** 由 schema 形态推导 handler 的入参类型(未声明 schema → 原始 args)。 */
export type InferInput<S>
  = S extends z.ZodType
    ? z.infer<S>
    : S extends Record<string, z.ZodType>
      ? z.infer<z.ZodObject<S>>
      : Record<string, unknown>

/** 操作的语义标注(与 ToolSpec 对齐;协议形态由本表派生)。 */
export interface OperationSpec<S extends InputSchemaLike | undefined = undefined> {
  /** 危险操作二次确认。 */
  confirm?: boolean
  /** 一句话描述(进 `~help` 的 h 行)。 */
  description?: string
  /** 副作用标记:read / write / destructive。 */
  effect?: string
  /** Zod schema 或 raw shape;省略 → 不校验,handler 收到原始 args。 */
  inputSchema?: S
  /**
   * 低层逃生阀:直接给 JSON Schema(与 inputSchema 互斥)。
   * 给出时本表不做入参校验 —— 作者自负其责。文档默认路径仍是 Zod。
   */
  rawInputSchema?: unknown
}

export type OperationHandler<S extends InputSchemaLike | undefined, TCtx>
  = (input: InferInput<S>, ctx: TCtx) => Awaitable<unknown>

interface RegisteredOp<TCtx> {
  handler: (input: unknown, ctx: TCtx) => Awaitable<unknown>
  /** 规范化后的校验器;undefined = 不校验。 */
  schema: z.ZodType | undefined
  spec: ToolSpec
}

/** raw shape → ZodObject;已是 schema 则原样。 */
function normalizeSchema(input: InputSchemaLike): z.ZodType {
  return input instanceof z.ZodType ? input : z.object(input)
}

/**
 * Zod → JSON Schema(官方 toJSONSchema)。剥掉 `$schema` 顶层键:既有 ToolSpec
 * (mcp/http 来源)都是裸 JSON Schema,保持一致以免 `~help` 与表单渲染出现两种形状。
 */
function toJsonSchema(schema: z.ZodType): unknown {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  return omit(json, '$schema')
}

/** ZodError → invalid_argument(把 issue 路径与原因压成一行可读消息)。 */
function invalidArgument(name: string, error: z.ZodError): TBError {
  const detail = error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
  return new TBError('invalid_argument', `invalid arguments for '${name}': ${detail}`)
}

/**
 * handler 裸返回值 → ToolResult(已是 ToolResult 形状则原样)。
 * 导出供代理型工具源复用(如 plugin-sdk 的 proxyTools:上游返回值形状不由我们决定,
 * 但"裸值要包、已是结果就透传"这条规则必须只有一份)。
 */
export function toToolResult(value: unknown): ToolResult {
  if (typeof value === 'object' && value !== null && 'content' in value) {
    return value as ToolResult
  }
  return { content: value }
}

/**
 * 操作注册表。`TCtx` 是 handler 的第二参(调用上下文形态由装配方决定)。
 *
 * 注册后自动获得 `list/get/call`:平台需要的 `list`/`call` 由此而来(`get` 是作者侧
 * 查询便利,平台不发 Get)。作者不再实现协议适配器。
 */
export class OperationRegistry<TCtx = unknown> {
  private readonly ops = new Map<string, RegisteredOp<TCtx>>()

  /** 注册一个操作。同名重复注册 → invalid_argument(配置错误,快速失败)。 */
  register<S extends InputSchemaLike | undefined = undefined>(
    name: string,
    spec: OperationSpec<S>,
    handler: OperationHandler<S, TCtx>,
  ): this {
    if (name.length === 0) {
      throw new TBError('invalid_argument', 'operation name must be non-empty')
    }
    if (this.ops.has(name)) {
      throw new TBError('invalid_argument', `operation '${name}' is already registered`)
    }
    if (spec.inputSchema !== undefined && spec.rawInputSchema !== undefined) {
      throw new TBError(
        'invalid_argument',
        `operation '${name}': inputSchema and rawInputSchema are mutually exclusive`,
      )
    }
    const schema = spec.inputSchema !== undefined ? normalizeSchema(spec.inputSchema) : undefined
    const toolSpec: ToolSpec = { name }
    if (spec.description !== undefined) toolSpec.description = spec.description
    if (spec.effect !== undefined) toolSpec.effect = spec.effect
    if (spec.confirm !== undefined) toolSpec.confirm = spec.confirm
    if (schema !== undefined) toolSpec.inputSchema = toJsonSchema(schema)
    else if (spec.rawInputSchema !== undefined) toolSpec.inputSchema = spec.rawInputSchema

    this.ops.set(name, {
      schema,
      spec: toolSpec,
      handler: handler as (input: unknown, ctx: TCtx) => Awaitable<unknown>,
    })
    return this
  }

  /** 已注册的操作名(注册顺序)。 */
  names(): string[] {
    return [...this.ops.keys()]
  }

  has(name: string): boolean {
    return this.ops.has(name)
  }

  /** 全部 ToolSpec(工具源天然小,豁免分页)。 */
  list(): ToolSpec[] {
    return [...this.ops.values()].map(op => op.spec)
  }

  /** 单个 ToolSpec;不存在 → not_found。 */
  get(name: string): ToolSpec {
    const op = this.ops.get(name)
    if (op === undefined) throw TBError.notFound(`unknown operation: '${name}'`)
    return op.spec
  }

  /**
   * 调用:safeParse 入参(失败 → invalid_argument)、执行 handler、把裸返回值包成 ToolResult。
   * 未声明 schema 的操作原样透传 args。
   */
  async call(name: string, args: Record<string, unknown>, ctx: TCtx): Promise<ToolResult> {
    const op = this.ops.get(name)
    if (op === undefined) throw TBError.notFound(`unknown operation: '${name}'`)
    let input: unknown = args
    if (op.schema !== undefined) {
      const parsed = op.schema.safeParse(args)
      if (!parsed.success) throw invalidArgument(name, parsed.error)
      input = parsed.data
    }
    return toToolResult(await op.handler(input, ctx))
  }
}
