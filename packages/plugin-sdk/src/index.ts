/**
 * `@tool-bridge/plugin-sdk` —— 写 tool-bridge plugin 的作者面。
 *
 * 作者只声明**操作**(名字 + Zod schema + 语义 + handler);协议那一整套由 SDK 接管:
 * 健康检查、`/~describe`(v2 exports)、`/~help`、envelope 编解码、Bearer 鉴权、
 * 按 `X-TB-Request-Id` 去重、上游凭证解包、Zod 校验与 JSON Schema 派生、错误归一。
 *
 * 此前每个 plugin 都要手写这些(见 plugin-feishu 的历史实现),协议细节因此泄漏进业务代码,
 * 且每个 plugin 都可能写出细微不同的行为。现在它们只有一份实现。
 *
 * **Web 标准 only**:产物不含 Node 内建,可直接跑在 Cloudflare Worker / Deno / Bun。
 * 入口就是一个 `fetch(request, env)`,`export default plugin` 即可部署。
 *
 * ```ts
 * import { createPlugin } from '@tool-bridge/plugin-sdk'
 * import { z } from 'zod/v4'
 *
 * const plugin = createPlugin<Env>({ token: env => env.PLUGIN_TOKEN })
 *
 * plugin.tools('actions', { description: 'Feishu actions' })
 *   .register('create_document', {
 *     description: 'Create a document',
 *     inputSchema: z.object({ title: z.string(), content: z.string() }),
 *     effect: 'write',
 *   }, async ({ title, content }, ctx) => createDoc(ctx.upstreamAuth, title, content))
 *
 * plugin.context('documents', {
 *   description: 'Feishu documents',
 *   get: async ({ path }, ctx) => loadDoc(path),
 *   list: async ({ path, opts }, ctx) => listDocs(path, opts),
 * })
 *
 * export default plugin
 * ```
 */

import {
  type CallContext,
  decodeCallContext,
  decodePluginCall,
  HEADER_TB_CONTEXT,
  HEADER_TB_REQUEST_ID,
  HEADER_TB_UPSTREAM_AUTH,
  type InferInput,
  type InputSchemaLike,
  isTBError,
  OperationRegistry,
  type OperationSpec,
  RequestDedupe,
  TBError,
  type ToolSpec,
} from '@tool-bridge/core'

/** 平台传给 handler 的调用上下文。 */
export interface PluginCallContext<Env = unknown> {
  /** 平台透传的完整 CallContext(keyId/owner/scopes/traceId/mountPath/mountConfig/exportId)。 */
  readonly caller: CallContext
  readonly env: Env
  /** 命中的 export id(多 export 时用得上)。 */
  readonly exportId: string
  /** 挂载节点的 providerConfig(每挂载非敏感配置)。 */
  readonly mountConfig: Record<string, unknown> | undefined
  readonly mountPath: string | undefined
  /**
   * 平台代解析的上游凭证明文(挂载配置了 authRef 时才有)。
   * plugin 自身不持有凭证:轮换只需在平台 `tb secret set`,无须重新部署。
   */
  readonly upstreamAuth: string | undefined
}

export type ToolHandler<S extends InputSchemaLike | undefined, Env>
  = (input: InferInput<S>, ctx: PluginCallContext<Env>) => unknown | Promise<unknown>

/** context 动词的入参形状(SDK 统一维护,作者不必重复声明 schema)。 */
export interface ContextListInput { opts?: Record<string, unknown>, path: string }
export interface ContextGetInput { path: string }
export interface ContextWriteInput { entry: Record<string, unknown>, path: string }
export interface ContextUpdateInput { patch: Record<string, unknown>, path: string }
export interface ContextDeleteInput { path: string }
export interface ContextSearchInput { opts?: Record<string, unknown>, query: string }

/**
 * context export 的 handler 集合。**全部可选** —— 写了哪个就有哪个能力,
 * `/~describe` 的 methods 与 capabilities 由存在性推导(与平台侧 Round 7 的语义一致)。
 */
export interface ContextHandlers<Env = unknown> {
  delete?: (input: ContextDeleteInput, ctx: PluginCallContext<Env>) => unknown | Promise<unknown>
  description?: string
  get?: (input: ContextGetInput, ctx: PluginCallContext<Env>) => unknown | Promise<unknown>
  list?: (input: ContextListInput, ctx: PluginCallContext<Env>) => unknown | Promise<unknown>
  search?: (input: ContextSearchInput, ctx: PluginCallContext<Env>) => unknown | Promise<unknown>
  update?: (input: ContextUpdateInput, ctx: PluginCallContext<Env>) => unknown | Promise<unknown>
  write?: (input: ContextWriteInput, ctx: PluginCallContext<Env>) => unknown | Promise<unknown>
}

/** context handler 名 → 协议动词名。 */
const CONTEXT_VERB_BY_HANDLER = {
  list: 'List',
  get: 'Get',
  write: 'Write',
  update: 'Update',
  delete: 'Delete',
  search: 'Search',
} as const

/** 可选能力(进 `/~describe` 的 capabilities)。 */
const CAPABILITY_BY_VERB: Record<string, string> = { Search: 'search', Delete: 'delete' }

export interface CreatePluginOptions<Env = unknown> {
  /** 健康检查路径(须以 '/' 开头);缺省 '/healthz'。 */
  healthPath?: string
  /**
   * 平台调用本 plugin 时应携带的 Bearer token。返回 undefined 表示**未配置**:
   * 此时只要求 Authorization 非空(便于本地开发),生产务必配置。
   */
  token?: (env: Env) => string | undefined
}

interface ToolsExportState<Env> {
  description: string | undefined
  id: string
  kind: 'tools'
  registry: OperationRegistry<PluginCallContext<Env>>
}

interface ContextExportState<Env> {
  description: string | undefined
  handlers: ContextHandlers<Env>
  id: string
  kind: 'context'
}

type ExportState<Env> = ContextExportState<Env> | ToolsExportState<Env>

/** tools export 的注册面(链式)。 */
export interface ToolsExport<Env> {
  register: <S extends InputSchemaLike | undefined = undefined>(
    name: string,
    spec: OperationSpec<S>,
    handler: ToolHandler<S, Env>,
  ) => ToolsExport<Env>
}

export interface Plugin<Env = unknown> {
  /** 声明一个 context export(handler 全可选)。 */
  context: (id: string, handlers: ContextHandlers<Env>) => Plugin<Env>
  /** Worker/Deno/Bun 入口。 */
  fetch: (request: Request, env: Env) => Promise<Response>
  /** 声明一个 tools export。 */
  tools: (id: string, meta?: { description?: string }) => ToolsExport<Env>
}

const PROTOCOL_VERSION = 'plugin/v2'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function errorResponse(err: unknown): Response {
  if (isTBError(err)) return json(err.toJSON(), err.httpStatus)
  return json(new TBError('internal', 'internal plugin error').toJSON(), 500)
}

/** context handler 存在性 → 协议动词集合。 */
function contextVerbs<Env>(handlers: ContextHandlers<Env>): string[] {
  const verbs: string[] = []
  for (const [key, verb] of Object.entries(CONTEXT_VERB_BY_HANDLER)) {
    if (typeof handlers[key as keyof ContextHandlers<Env>] === 'function') verbs.push(verb)
  }
  return verbs
}

export function createPlugin<Env = unknown>(opts: CreatePluginOptions<Env> = {}): Plugin<Env> {
  const healthPath = opts.healthPath ?? '/healthz'
  const exports = new Map<string, ExportState<Env>>()
  const dedupe = new RequestDedupe()

  const assertFreshId = (id: string): void => {
    if (id.length === 0) throw new TBError('invalid_argument', 'export id must be non-empty')
    if (exports.has(id)) {
      throw new TBError('invalid_argument', `export '${id}' is already declared`)
    }
  }

  function describe(): unknown {
    return {
      protocolVersion: PROTOCOL_VERSION,
      exports: [...exports.values()].map((state) => {
        if (state.kind === 'tools') {
          return {
            id: state.id,
            profile: 'tools/v1',
            ...(state.description !== undefined ? { description: state.description } : {}),
          }
        }
        const methods = contextVerbs(state.handlers)
        const capabilities = methods
          .map(verb => CAPABILITY_BY_VERB[verb])
          .filter((c): c is string => c !== undefined)
        return {
          id: state.id,
          profile: 'context/v1',
          ...(state.description !== undefined ? { description: state.description } : {}),
          methods,
          ...(capabilities.length > 0 ? { capabilities } : {}),
        }
      }),
    }
  }

  /** `/~help`:按 export 列出真实存在的操作(人读用;v2 契约校验不依赖它)。 */
  function help(): unknown {
    return {
      protocolVersion: PROTOCOL_VERSION,
      exports: [...exports.values()].map(state => ({
        id: state.id,
        cmds:
          state.kind === 'tools'
            ? state.registry.list()
            : contextVerbs(state.handlers).map(name => ({ name })),
      })),
    }
  }

  function assertAuthorized(request: Request, env: Env): void {
    const header = request.headers.get('authorization') ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
    const expected = opts.token?.(env)
    if (expected === undefined) {
      // 未配置期望 token(本地开发):只要求非空,避免完全裸奔。
      if (presented.length === 0) throw TBError.unauthenticated()
      return
    }
    if (presented !== expected) throw TBError.unauthenticated()
  }

  function decodeUpstreamAuth(request: Request): string | undefined {
    const raw = request.headers.get(HEADER_TB_UPSTREAM_AUTH)
    if (raw === null || raw.length === 0) return undefined
    // base64url → 明文(平台侧 base64urlEncode(TextEncoder));Web 标准解码。
    const b64 = raw.replaceAll('-', '+').replaceAll('_', '/')
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')
    const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }

  async function dispatchTools(
    state: ToolsExportState<Env>,
    method: string,
    args: Record<string, unknown>,
    ctx: PluginCallContext<Env>,
  ): Promise<unknown> {
    // 平台只发 List 与 Call —— v1 强制的 Get 是纯样板,v2 不再要求实现。
    if (method === 'List') return state.registry.list() satisfies ToolSpec[]
    if (method === 'Call') {
      const name = args.name
      if (typeof name !== 'string') {
        throw new TBError('invalid_argument', 'Call requires a string \'name\'')
      }
      const callArgs = (args.args ?? {}) as Record<string, unknown>
      return await state.registry.call(name, callArgs, ctx)
    }
    throw new TBError('invalid_argument', `unknown method '${method}' on a tools export`)
  }

  async function dispatchContext(
    state: ContextExportState<Env>,
    method: string,
    args: Record<string, unknown>,
    ctx: PluginCallContext<Env>,
  ): Promise<unknown> {
    const handlers = state.handlers
    switch (method) {
      case 'List':
        if (handlers.list === undefined) break
        return await handlers.list(
          { path: String(args.path ?? ''), ...(args.opts !== undefined ? { opts: args.opts as Record<string, unknown> } : {}) },
          ctx,
        )
      case 'Get':
        if (handlers.get === undefined) break
        return await handlers.get({ path: String(args.path ?? '') }, ctx)
      case 'Write':
        if (handlers.write === undefined) break
        return await handlers.write(
          { path: String(args.path ?? ''), entry: (args.entry ?? {}) as Record<string, unknown> },
          ctx,
        )
      case 'Update':
        if (handlers.update === undefined) break
        return await handlers.update(
          { path: String(args.path ?? ''), patch: (args.patch ?? {}) as Record<string, unknown> },
          ctx,
        )
      case 'Delete':
        if (handlers.delete === undefined) break
        return await handlers.delete({ path: String(args.path ?? '') }, ctx)
      case 'Search':
        if (handlers.search === undefined) break
        return await handlers.search(
          { query: String(args.query ?? ''), ...(args.opts !== undefined ? { opts: args.opts as Record<string, unknown> } : {}) },
          ctx,
        )
      default:
        throw new TBError('invalid_argument', `unknown method '${method}' on a context export`)
    }
    // 未实现的动词:与平台侧「~help 只列真实存在的操作」一致 —— 宣告与可调用集合始终吻合。
    throw new TBError('invalid_argument', `method '${method}' is not implemented by export '${state.id}'`)
  }

  async function handleEnvelope(request: Request, env: Env): Promise<Response> {
    assertAuthorized(request, env)

    const ctxHeader = request.headers.get(HEADER_TB_CONTEXT)
    if (ctxHeader === null) {
      throw new TBError('invalid_argument', `missing ${HEADER_TB_CONTEXT}`)
    }
    const caller = decodeCallContext(ctxHeader)
    const call = decodePluginCall(await request.text())

    const exportId = caller.exportId ?? (exports.size === 1 ? [...exports.keys()][0] : undefined)
    if (exportId === undefined) {
      throw new TBError('invalid_argument', 'call context carries no exportId and this plugin declares multiple exports')
    }
    const state = exports.get(exportId)
    if (state === undefined) throw new TBError('invalid_argument', `unknown export '${exportId}'`)

    const ctx: PluginCallContext<Env> = {
      env,
      caller,
      exportId,
      mountPath: caller.mountPath,
      mountConfig: caller.mountConfig,
      upstreamAuth: decodeUpstreamAuth(request),
    }

    const requestId = request.headers.get(HEADER_TB_REQUEST_ID)
    const run = async (): Promise<unknown> =>
      state.kind === 'tools'
        ? await dispatchTools(state, call.tool, call.arguments, ctx)
        : await dispatchContext(state, call.tool, call.arguments, ctx)

    const value = requestId === null ? await run() : await dedupe.run(requestId, run)
    return json(value ?? null)
  }

  const plugin: Plugin<Env> = {
    tools(id, meta) {
      assertFreshId(id)
      const state: ToolsExportState<Env> = {
        kind: 'tools',
        id,
        description: meta?.description,
        registry: new OperationRegistry<PluginCallContext<Env>>(),
      }
      exports.set(id, state)
      const surface: ToolsExport<Env> = {
        register(name, spec, handler) {
          state.registry.register(name, spec, handler)
          return surface
        },
      }
      return surface
    },

    context(id, handlers) {
      assertFreshId(id)
      exports.set(id, {
        kind: 'context',
        id,
        description: handlers.description,
        handlers,
      })
      return plugin
    },

    async fetch(request, env) {
      try {
        const url = new URL(request.url)
        if (request.method === 'GET') {
          if (url.pathname === healthPath) return json({ healthy: true })
          if (url.pathname === '/~describe') return json(describe())
          if (url.pathname === '/~help') return json(help())
          throw TBError.notFound('no such path')
        }
        if (request.method !== 'POST') throw TBError.notFound('no such path')
        return await handleEnvelope(request, env)
      } catch (err) {
        return errorResponse(err)
      }
    },
  }

  return plugin
}
