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
  type ContextEntryInput,
  type ContextPatch,
  decodeCallContext,
  decodePluginCall,
  HEADER_TB_CONTEXT,
  HEADER_TB_REQUEST_ID,
  HEADER_TB_UPSTREAM_AUTH,
  type InferInput,
  type InputSchemaLike,
  isTBError,
  type ListOptions,
  OperationRegistry,
  type OperationSpec,
  parseCredentialValues,
  type PluginCredentialField,
  type PluginCredentialValues,
  RequestDedupe,
  type SearchOptions,
  TBError,
  type ToolSpec,
  toToolResult,
} from '@tool-bridge/core'

/**
 * 作者面必需的错误原语:handler 里 `throw TBError.notFound(...)` 即得到平台归一后的
 * 404/`not_found`。不导出它,作者就只能抛裸 Error(一律归为 internal 500),
 * 语义会在传输层丢失 —— 这是写样例 plugin 时暴露出来的缺口。
 */
export { TBError }
export type { ToolResult, ToolSpec } from '@tool-bridge/core'

/** 平台传给 handler 的调用上下文。 */
export interface PluginCallContext<Env = unknown> {
  /** 平台透传的完整 CallContext(keyId/owner/scopes/traceId/mountPath/mountConfig/exportId)。 */
  readonly caller: CallContext
  /**
   * 多字段凭证的字段表(仅在本 export 声明了 `credentials([...])` 时有值)。
   * 平台注入的凭证已按声明解析并校验过必填项,handler 直接取用即可。
   */
  readonly credentials: PluginCredentialValues | undefined
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

/**
 * **代理型** tools export 的 handler:工具表来自上游、只有拿到调用凭证才能枚举
 * (典型是转发到另一个 MCP/HTTP 服务),因此声明期列不出来,只能给 `list`/`call` 两个函数。
 *
 * 静态注册(`plugin.tools().register()`)仍是首选 —— 它能派生 JSON Schema、校验入参。
 * 代理型放弃这些是因为**上游才是 schema 的真源**,由 plugin 复述一遍只会漂移。
 */
export interface ProxyToolsHandlers<Env = unknown> {
  call: (
    input: { args: Record<string, unknown>, name: string },
    ctx: PluginCallContext<Env>,
  ) => unknown | Promise<unknown>
  /**
   * 需要**多字段凭证**时声明字段(缺省单值)。与静态 tools 的 `.credentials([...])` 同义 ——
   * 两种 export 对外都是 `tools/v1`,凭证形态不该因"工具表是声明期写死还是运行时枚举"而异。
   */
  credentialFields?: PluginCredentialField[]
  description?: string
  list: (ctx: PluginCallContext<Env>) => Promise<ToolSpec[]> | ToolSpec[]
}

/**
 * context 动词的入参形状(SDK 统一维护,作者不必重复声明 schema)。
 * entry/patch/opts 直接复用平台的 Context 类型 —— 作者拿到的就是定形对象
 * (`entry.metadata?.title`),不必在每个 handler 里把 `Record<string, unknown>` 断言回去。
 */
export interface ContextListInput { opts?: ListOptions, path: string }
export interface ContextGetInput { path: string }
export interface ContextWriteInput { entry: ContextEntryInput, path: string }
export interface ContextUpdateInput { patch: ContextPatch, path: string }
export interface ContextDeleteInput { path: string }
export interface ContextSearchInput { opts?: SearchOptions, query: string }

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
  credentialFields: PluginCredentialField[] | undefined
  credentialProbe: string | undefined
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

interface ProxyToolsExportState<Env> {
  credentialFields: PluginCredentialField[] | undefined
  description: string | undefined
  handlers: ProxyToolsHandlers<Env>
  id: string
  kind: 'proxyTools'
}

type ExportState<Env>
  = | ContextExportState<Env>
    | ProxyToolsExportState<Env>
    | ToolsExportState<Env>

/** tools export 的注册面(链式)。 */
export interface ToolsExport<Env> {
  /**
   * 声明本 export 需要**多字段凭证**(默认单值:一个 API key)。
   *
   * 平台据此:把 secret 当 JSON 对象存、挂载时校验必填字段齐全、管理面提示该填哪些字段。
   * 传输契约不变(仍是 `X-TB-Upstream-Auth` 那个字符串,内容变成 JSON),
   * handler 里用 `ctx.credentials` 取字段表。
   */
  credentials: (fields: PluginCredentialField[]) => ToolsExport<Env>
  /**
   * 指定**凭证探针**:一个只读、零副作用、无必填入参的工具名。
   *
   * 平台的凭证是 `tb secret set` 存进 SecretStore、挂载只写 `authRef`,插件要到第一次
   * 业务调用才拿得到它 —— 配错的 key 不会在存入或挂载时报错,而是等某个 agent 真去调用
   * 时才 401。声明探针后,挂载时平台会用注入的凭证真实调一次它,当场判定凭证是否可用。
   *
   * 名字必须是已注册的工具(在 `~describe` 里报出去之前就校验,免得平台挂载时才发现)。
   */
  probeCredentialWith: (name: string) => ToolsExport<Env>
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
  /** 声明一个**代理型** tools export(工具表来自上游,运行时枚举)。 */
  proxyTools: (id: string, handlers: ProxyToolsHandlers<Env>) => Plugin<Env>
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

/**
 * `~help` 的 cmd 表。代理型 export 返回空表并标 `dynamic` —— 枚举工具需要调用凭证,
 * 而 `~help` 是不鉴权的生命周期端点;宁可如实说"要经 List 才知道",不编一份可能过时的表。
 */
function helpCmds<Env>(state: ExportState<Env>): Array<{ name: string }> {
  if (state.kind === 'tools') return state.registry.list()
  if (state.kind === 'proxyTools') return []
  return contextVerbs(state.handlers).map(name => ({ name }))
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
        // 代理型与静态 tools 对外**同一形状**:export 是什么由 profile 说了算,
        // 至于工具表是声明期写死还是运行时枚举,是 plugin 的内部实现,平台不必知道。
        if (state.kind === 'tools' || state.kind === 'proxyTools') {
          return {
            id: state.id,
            profile: 'tools/v1',
            ...(state.description !== undefined ? { description: state.description } : {}),
            ...(state.kind === 'tools' && state.credentialProbe !== undefined
              ? { credentialProbe: state.credentialProbe }
              : {}),
            ...(state.credentialFields !== undefined
              ? { credentialFields: state.credentialFields }
              : {}),
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
        ...(state.kind === 'proxyTools' ? { dynamic: true } : {}),
        cmds: helpCmds(state),
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
    try {
      const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0))
      return new TextDecoder().decode(bytes)
    } catch {
      // 坏头是**调用方**送来的坏输入,不是 plugin 内部故障 —— 归 invalid_argument(400),
      // 否则 atob 抛裸 Error 会被归一成 internal 500,把配置错误说成服务故障。
      throw new TBError('invalid_argument', `${HEADER_TB_UPSTREAM_AUTH} is not valid base64url`)
    }
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

  async function dispatchProxyTools(
    state: ProxyToolsExportState<Env>,
    method: string,
    args: Record<string, unknown>,
    ctx: PluginCallContext<Env>,
  ): Promise<unknown> {
    if (method === 'List') return await state.handlers.list(ctx)
    if (method === 'Call') {
      const name = args.name
      if (typeof name !== 'string' || name === '') {
        throw new TBError('invalid_argument', 'Call requires a non-empty string \'name\'')
      }
      const callArgs
        = typeof args.args === 'object' && args.args !== null
          ? (args.args as Record<string, unknown>)
          : {}
      // 上游返回值形状不由我们决定:裸值包成 ToolResult,已是结果形状则透传(与静态路径同规则)。
      return toToolResult(await state.handlers.call({ name, args: callArgs }, ctx))
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
          { path: String(args.path ?? ''), ...(args.opts !== undefined ? { opts: args.opts as ListOptions } : {}) },
          ctx,
        )
      case 'Get':
        if (handlers.get === undefined) break
        return await handlers.get({ path: String(args.path ?? '') }, ctx)
      case 'Write':
        if (handlers.write === undefined) break
        return await handlers.write(
          { path: String(args.path ?? ''), entry: (args.entry ?? {}) as ContextEntryInput },
          ctx,
        )
      case 'Update':
        if (handlers.update === undefined) break
        return await handlers.update(
          { path: String(args.path ?? ''), patch: (args.patch ?? {}) as ContextPatch },
          ctx,
        )
      case 'Delete':
        if (handlers.delete === undefined) break
        return await handlers.delete({ path: String(args.path ?? '') }, ctx)
      case 'Search':
        if (handlers.search === undefined) break
        return await handlers.search(
          { query: String(args.query ?? ''), ...(args.opts !== undefined ? { opts: args.opts as SearchOptions } : {}) },
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

    const upstreamAuth = decodeUpstreamAuth(request)
    // 声明了多字段凭证就在这里解析一次:每个 handler 各自 JSON.parse 一遍是重复劳动,
    // 且各写各的校验会让"缺字段"的报错措辞不一致。解析失败 → invalid_argument(配置错)。
    const credentialFields = state.kind === 'context' ? undefined : state.credentialFields
    const ctx: PluginCallContext<Env> = {
      env,
      caller,
      exportId,
      mountPath: caller.mountPath,
      mountConfig: caller.mountConfig,
      upstreamAuth,
      credentials: credentialFields !== undefined && upstreamAuth !== undefined
        ? parseCredentialValues(upstreamAuth, credentialFields)
        : undefined,
    }

    const requestId = request.headers.get(HEADER_TB_REQUEST_ID)
    const run = async (): Promise<unknown> => {
      if (state.kind === 'tools') return await dispatchTools(state, call.tool, call.arguments, ctx)
      if (state.kind === 'proxyTools') {
        return await dispatchProxyTools(state, call.tool, call.arguments, ctx)
      }
      return await dispatchContext(state, call.tool, call.arguments, ctx)
    }

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
        credentialProbe: undefined,
        credentialFields: undefined,
        registry: new OperationRegistry<PluginCallContext<Env>>(),
      }
      exports.set(id, state)
      const surface: ToolsExport<Env> = {
        register(name, spec, handler) {
          state.registry.register(name, spec, handler)
          return surface
        },
        credentials(fields) {
          if (fields.length === 0) {
            throw new TBError('invalid_argument', 'credentials() 至少要声明一个字段')
          }
          state.credentialFields = fields
          return surface
        },
        probeCredentialWith(name) {
          // 立刻校验而不是等 ~describe:声明一个不存在的探针,平台挂载时会拿它去 Call
          // 然后收到 invalid_argument —— 那个错误看起来像"凭证有问题",实际是拼错了工具名。
          if (!state.registry.list().some(tool => tool.name === name)) {
            throw new TBError(
              'invalid_argument',
              `credentialProbe '${name}' 不是 export '${id}' 已注册的工具`,
            )
          }
          state.credentialProbe = name
          return surface
        },
      }
      return surface
    },

    proxyTools(id, handlers) {
      assertFreshId(id)
      exports.set(id, {
        kind: 'proxyTools',
        id,
        description: handlers.description,
        credentialFields: handlers.credentialFields,
        handlers,
      })
      return plugin
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
