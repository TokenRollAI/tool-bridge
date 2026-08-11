import {
  type Action,
  AnnotationStore,
  assertSecretRefUse,
  buildTree,
  type BuiltinModule,
  type CallContext,
  check,
  checkRegisterPath,
  checkScopes,
  clampDepth,
  type CmdSpec,
  contentTypeFor,
  CONTEXT_CAPABILITIES,
  contextCapabilitiesOf,
  type ContextEntryInput,
  contextHelpModel,
  contextMethodsOf,
  type ContextPatch,
  type ContextProvider,
  contextScopeForCmd,
  createBuiltins,
  createObjectContextProvider,
  createSkillhubProvider,
  DEFAULT_MAX_NODES,
  type DeviceCallResult,
  deviceDirectoryHelpModel,
  deviceFsHelpModel,
  deviceShellHelpModel,
  FEEDBACK_HIDE_SCORE,
  FeedbackStore,
  type HelpJson,
  type HelpModel,
  identify,
  isContextExpired,
  isReadOnlyProvider,
  isTBError,
  KEY_PLUGIN,
  KEY_PLUGIN_META,
  type ListOptions,
  MAX_TREE_DEPTH,
  negotiate,
  type NodeConfig,
  NodeRegistryStore,
  normalizeToolSearchLimit,
  type ObjectStore,
  optionalMethodsForCapabilities,
  parseNodeInput,
  type PluginDescribe,
  type PluginExport,
  type PluginManifest,
  PRESIGN_TTL_SEC_DEFAULT,
  RemoteAllowlistStore,
  renderHelpDsl,
  renderHelpJson,
  renderHelpMarkdown,
  type Representation,
  resolvePluginExport,
  resolveUpstreamTool,
  type SearchIndex,
  type SearchOptions,
  type SecretStoreImpl,
  SKILLHUB_CAPABILITIES,
  skillhubHelpModel,
  type SkillhubProvider,
  skillhubScopeForCmd,
  type SkillPublishFile,
  type StateStore,
  TBError,
  type TBErrorBody,
  TOOL_SEARCH_BATCH_LIMIT,
  TOOL_SEARCH_PAGE_BYTES,
  TOOL_SEARCH_WORK_LIMIT,
  toolHelpModel,
  type ToolResult,
  type ToolSearchCandidate,
  type ToolSpec,
  toolsToHelpModel,
  type TreeEntry,
  type TreeJson,
  type TreeNode,
  type TreePath,
  validatePath,
  virtualizeTools,
} from '@tool-bridge/core'
import { type Context, Hono } from 'hono'
import type { PluginBindings } from './providers/pluginClient'
import type { UpstreamProvider } from './providers/types'
import {
  finishMcpAuthorization,
  invalidateMcpOAuth,
  OAUTH_CALLBACK_PATH,
  openOAuthState,
  renderOAuthCallbackHtml,
  startMcpAuthorization,
} from './oauth'
import {
  canonicalSearchTools,
  isMutableSearchIndex,
  type SearchDirtyMarker,
  SearchSynchronizer,
} from './search/synchronizer'
import {
  handleMcpRequest,
  type McpBridgeTool,
  type McpToolBridge,
  mcpToolIdentity,
} from './mcpServer'
import { assertRemoteAllowed, passthroughRemote, type RemoteSettings } from './providers/remote'
import { createMcpProvider, invalidateMcpEra, type McpConfig } from './providers/mcp'
import { createS3ObjectStore, type S3StoreConfig } from './providers/s3Object'
import { createPluginContextProvider } from './providers/pluginContext'
import { createHttpProvider, type HttpConfig } from './providers/http'
import { getTools, invalidateToolCache } from './providers/toolCache'
import { createPluginToolProvider } from './providers/pluginTool'
import { signRefToken, verifyRefToken } from './refToken'
import { buildDeps } from './bootstrap'

export type { RemoteSettings } from './providers/remote'
export type { UpstreamProvider } from './providers/types'

/** 帧协议 call 转发的入参(id 由调用点生成,幂等键)。 */
export interface DeviceInvokeRequest {
  arguments: Record<string, unknown>
  id: string
  path: string
  tool: string
}

/** 设备通道宿主(CF = DeviceSession DO / Docker = ws;deviceTransport 的消费面)。 */
export interface DeviceChannel {
  /** HTTP→WS 调用转发:结果为 DeviceCallResult 形状(设备侧 result 帧)。 */
  invoke(deviceId: string, req: DeviceInvokeRequest): Promise<unknown>
  /** WS 升级请求转交(/system/device/ws)。 */
  ws(deviceId: string, request: Request): Promise<Response>
}

/** 进程内本地 Provider 钩子(SDK registerTool/registerContext 的装配面)。 */
export interface LocalProviderHooks {
  /** kind:'context' 节点按路径取进程内 ContextProvider;undefined → 走 plugin 解析。 */
  context?(nodePath: TreePath): ContextProvider | undefined
  /** kind:'tool' 节点按路径取进程内工具源;undefined → 走 plugin 解析。 */
  tool?(nodePath: TreePath): UpstreamProvider | undefined
}

/**
 * tb app 的宿主注入面(五注入点 + 解析后的部署配置)。
 * 核心业务逻辑零分叉:Workers 适配层(app.ts)与 SDK(packages/sdk)都注入此形状。
 */
export interface TbAppDeps {
  /** 放行 http:// 上游(仅本地开发)。 */
  allowInsecureHttp: boolean
  /** Dashboard 静态资源(Workers Static Assets);缺省 → /ui 404。 */
  assets?: (request: Request) => Promise<Response>
  /**
   * 规范网关 origin(如 `https://tool-bridge.example.com`)。配置后,OAuth 的
   * redirect_uri 钉在此规范值上,而非每请求动态取 origin——防止实例经多域名
   * (自定义域 + *.workers.dev 等)访问时,授权 code 在不同域名间被互换。
   * 缺省 → 回退到请求期 origin(单域名部署行为不变)。
   */
  canonicalOrigin?: string
  /** 设备通道;缺省 → device 能力禁用。 */
  device?: DeviceChannel
  /** $ref 中转 token 签名密钥(TB_SECRET_ENCRYPTION_KEY);缺省 → /~ref 404、大对象走 presign 或 unavailable。 */
  encryptionKey?: string
  /** 认证前的实例就绪钩子(引导/延迟注册 flush);每请求调用,幂等由宿主保证。 */
  ensureReady?: () => Promise<void>
  /** SDK 进程内 Provider 表(缺省无)。 */
  locals?: LocalProviderHooks
  /** context 平台对象存储('r2' provider 的落点);缺省 → 该 provider unavailable。 */
  objects?: () => Promise<ObjectStore> | ObjectStore
  /**
   * 进程内插件装配表(binding 名 → fetch handler)。manifest.endpoint 为
   * `binding:<name>` 的插件经此直调,零网络跳;未装配的 binding 注册/调用报 unavailable。
   */
  pluginBindings?: PluginBindings
  /** context Get 的 $ref 内联阈值(字节,缺省 1 MiB)。 */
  refThresholdBytes?: number
  /** $ref URL(presign 与 /~ref 中转)有效期秒(缺省 900)。 */
  refTtlSec?: number
  /** remote 联邦透传配置。 */
  remote: RemoteSettings
  /** 追加保留根路径(在内置保留根之外额外声明)。 */
  reservedRoots?: string[]
  /** 全局工具搜索索引；缺省或未声明 search capability 时 /~search 不存在。 */
  search?: SearchIndex
  secrets: SecretStoreImpl
  state: StateStore
  /** mcp/tool 工具缓存 TTL 秒(缺省 300)。 */
  toolCacheTtlSec?: number
  /** healthz 与 system/status 回显的版本号(单一真源:宿主 package.json)。 */
  version: string
}

const TOOL_CACHE_TTL_DEFAULT = 300
const MCP_REMOTE_MAX_REQUESTS = 32

/** `~tree` 深度边界上免 fetch 探测、直接标 truncated 的 kind:remote 联邦(子树在远端,探测需远端往返)。 */
const REMOTE_OPAQUE_KINDS = new Set(['remote'])

type Vars = { ctx: CallContext, store: StateStore }

type AppContext = Context<{ Variables: Vars }>

/** 把 TBError 渲染为线上响应。 */
function tbErrorResponse(err: TBError): Response {
  return new Response(JSON.stringify(err.toJSON()), {
    status: err.httpStatus,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * 全宿主统一的安全响应头(Workers / Node / SDK 内嵌实例)。OAuth 回调页自带更严格
 * 的 CSP,此处只在响应未声明 CSP 时补默认策略。WebSocket 101 不重建 Response。
 */
function withSecurityHeaders(res: Response): Response {
  if (res.status === 101 || (res as { webSocket?: unknown }).webSocket != null) return res
  const apply = (headers: Headers): void => {
    if (!headers.has('content-security-policy')) {
      headers.set(
        'content-security-policy',
        'default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; '
        + 'img-src \'self\' data:; connect-src \'self\' https: http:; base-uri \'none\'; '
        + 'form-action \'self\'; frame-ancestors \'none\'; object-src \'none\'',
      )
    }
    headers.set('x-content-type-options', 'nosniff')
    headers.set('x-frame-options', 'DENY')
    headers.set('referrer-policy', 'no-referrer')
  }
  // 本 app 自建的 Response headers 可变,原地写可保留 Node 宿主的结构化对象流。
  // fetch/Static Assets 返回的不可变 headers 才克隆 Response(其 body 是原生流)。
  try {
    apply(res.headers)
    return res
  } catch {
    const headers = new Headers(res.headers)
    apply(headers)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }
}

/**
 * 在通配路由回调内就地捕获错误并渲染响应(不依赖 Hono onError 处理异步 reject——
 * 那会在 workerd 里留下 unhandled rejection)。已知 TBError → 其 httpStatus;其余 → 500。
 */
async function runHandler(fn: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    if (isTBError(err)) return tbErrorResponse(err)
    return tbErrorResponse(new TBError('internal', 'internal error'))
  }
}

/** cmd → scope 表(builtin help() 静态声明);未知 cmd → undefined。 */
function scopeForCmd(mod: BuiltinModule, nodePath: TreePath, cmd: string): CmdSpec | undefined {
  return mod.help(nodePath).cmds.find(c => c.name === cmd)
}

/** 渲染 HelpModel:按协商表现输出 DSL(text/plain)、JSON 或 Markdown(可读性表现)。 */
function renderHelp(model: HelpModel, rep: Representation): Response {
  if (rep === 'json') {
    return new Response(JSON.stringify(renderHelpJson(model)), {
      headers: { 'content-type': contentTypeFor('json') },
    })
  }
  if (rep === 'markdown') {
    return new Response(renderHelpMarkdown(model), {
      headers: { 'content-type': contentTypeFor('markdown') },
    })
  }
  return new Response(renderHelpDsl(model), {
    headers: { 'content-type': contentTypeFor('dsl') },
  })
}

/**
 * ~help 注入:读该 path 的管理员补充说明(annotation:<path>)与 Agent feedback 头部条目
 * (feedback:<path>,排序/阈值在 core FeedbackStore.helpItems),合并进 HelpModel 的
 * note/feedback 字段。handleHelp 三个出口(根/节点级/工具级)统一走这里,注入对
 * 注册节点与工具子路径同样生效。成本 = 并发 2 次 KV get。
 * 注入失败不打挂 ~help(增强信息,非关键路径):catch 后原样返回。
 * remote 透传路径不经此(响应来自上游,本地不解析)。
 */
async function enrichHelp(model: HelpModel, path: TreePath, store: StateStore): Promise<HelpModel> {
  try {
    const [annotation, feedback] = await Promise.all([
      new AnnotationStore(store).get(path),
      path === '' ? Promise.resolve([]) : new FeedbackStore(store).helpItems(path),
    ])
    return {
      ...model,
      ...(annotation !== null ? { note: annotation.text } : {}),
      ...(feedback.length > 0 ? { feedback } : {}),
    }
  } catch {
    return model
  }
}

/** 渲染数据面调用返回值:json → 原始 JSON;默认 → markdown(```json 包裹)。 */
function renderResult(value: unknown, rep: Representation): Response {
  const json = JSON.stringify(value ?? null)
  if (rep === 'json') {
    return new Response(json, { headers: { 'content-type': contentTypeFor('json') } })
  }
  return new Response(`\`\`\`json\n${json}\n\`\`\`\n`, {
    headers: { 'content-type': contentTypeFor('markdown') },
  })
}

/**
 * 逐段 decodeURIComponent 树路径(注册的树路径可含空格等,URL 里被百分号编码)。
 * 逐段解码(而非整段)以免把编码的 '/'(%2F)误解为路径分隔。decode 失败 → 400 invalid_argument。
 */
function decodePath(path: TreePath): TreePath {
  if (path === '') return ''
  try {
    return path
      .split('/')
      .map(seg => decodeURIComponent(seg))
      .join('/')
  } catch {
    throw new TBError('invalid_argument', `malformed percent-encoding in path '${path}'`)
  }
}

/** 根路径与保留段:从 URL pathname 提取树路径与保留段(如 "docs/x/~help" → { path:"docs/x", seg:"~help" })。 */
function splitReserved(pathname: string, seg: string): TreePath | null {
  const p = pathname.replace(/^\/+|\/+$/g, '')
  if (p === seg) return '' // 根级 /~help、/~tree
  if (p.endsWith(`/${seg}`)) return decodePath(p.slice(0, -(seg.length + 1)))
  return null
}

/**
 * 解析 ~feedback 保留段 URL(feedback 是 per-path 一级协议能力):
 * `/<path>/~feedback` → { path };`/<path>/~feedback/<id>` → { path, id };其余形状 → null。
 */
function splitFeedback(pathname: string): { id?: string, path: TreePath } | null {
  const p = pathname.replace(/^\/+|\/+$/g, '')
  const segs = p.split('/')
  const last = segs[segs.length - 1] ?? ''
  if (last === '~feedback') {
    return { path: decodePath(segs.slice(0, -1).join('/')) }
  }
  if (segs.length >= 2 && segs[segs.length - 2] === '~feedback' && !last.startsWith('~')) {
    return { path: decodePath(segs.slice(0, -2).join('/')), id: decodeURIComponent(last) }
  }
  return null
}

/**
 * 构造 tool-bridge 的 Hono app(宿主中立;Workers 适配见 app.ts,SDK 装配见 packages/sdk)。
 */
/** 反向注册路径判定(查 existing 占用者;deps.reservedRoots 追加保留根)。allow=false 则抛其 error。 */
async function assertRegisterPath(
  registry: NodeRegistryStore,
  ctx: CallContext,
  targetPath: TreePath,
  action: 'write' | 'delete',
  deps: TbAppDeps,
): Promise<void> {
  let existing: { registeredBy: string } | null = null
  try {
    existing = await registry.get(targetPath)
  } catch {
    existing = null
  }
  const res = checkRegisterPath({
    sk: {
      scopes: ctx.scopes,
      id: ctx.keyId,
      ...(ctx.registerPaths !== undefined ? { registerPaths: ctx.registerPaths } : {}),
    },
    targetPath,
    action,
    existing,
    ...(deps.reservedRoots !== undefined ? { reservedRoots: deps.reservedRoots } : {}),
  })
  if (!res.allow) throw res.error
}

/** TreeNode → TreeEntry(丢弃 config 等,仅保留 tree 视图字段)。 */
function toEntry(n: TreeNode): TreeEntry {
  const e: TreeEntry = { path: n.path, kind: n.kind, description: n.description }
  if (n.online !== undefined) e.online = n.online
  return e
}

/**
 * 目录/~tree 展示裁剪。无 call 权限的 SK 对同一调用节点 `tb call` 为 403,
 * 且 `tb ls` 不可见;因此 mcp/http/remote 节点在列表面同时要求 read+call。
 * 直接访问节点本身仍由 handler 保持 read→404 / call→403 次序。
 */
function filterListVisible(nodes: TreeNode[], scopes: CallContext['scopes']): TreeNode[] {
  return nodes.filter((node) => {
    if (!checkScopes(scopes, node.path, 'read')) return false
    if (
      (node.kind === 'mcp'
        || node.kind === 'http'
        || node.kind === 'remote'
        || node.kind === 'device'
        || node.kind === 'tool')
      && !checkScopes(scopes, node.path, 'call')
    ) {
      return false
    }
    return true
  })
}

function remoteProtocolError(message: string): TBError {
  return new TBError('unavailable', message, { retryable: false })
}

/** Remote JSON paths are untrusted protocol data; reject URL-normalizable aliases. */
function canonicalRemotePath(path: string, allowRoot: boolean): TreePath {
  if (path !== path.replace(/^\/+|\/+$/g, '')) {
    throw remoteProtocolError(`remote returned non-canonical path '${path}'`)
  }
  const invalid = validatePath(path, { allowRoot })
  if (invalid !== null) throw remoteProtocolError(`remote returned invalid path '${path}'`)
  for (const segment of path === '' ? [] : path.split('/')) {
    let decoded = segment
    for (let pass = 0; pass < 4; pass++) {
      if (
        decoded === '.'
        || decoded === '..'
        || decoded.startsWith('~')
        || decoded.includes('/')
        || decoded.includes('\\')
        || [...decoded].some((char) => {
          const code = char.charCodeAt(0)
          return code <= 31 || code === 127
        })
      ) {
        throw remoteProtocolError(`remote returned unsafe path segment '${segment}'`)
      }
      let next: string
      try {
        next = decodeURIComponent(decoded)
      } catch {
        throw remoteProtocolError(`remote returned malformed encoded path '${path}'`)
      }
      if (next === decoded) break
      if (pass === 3) {
        throw remoteProtocolError(`remote returned over-encoded path '${path}'`)
      }
      decoded = next
    }
  }
  return path
}

function remotePathWithin(nodePath: TreePath, commandPath: TreePath): boolean {
  return nodePath === ''
    || commandPath === nodePath
    || commandPath.startsWith(`${nodePath}/`)
}

function localizeRemoteEntry(
  mountPath: TreePath,
  remoteParentPath: TreePath,
  entry: TreeJson,
): TreeEntry {
  const rel = canonicalRemotePath(entry.path, false)
  const parent = rel.split('/').slice(0, -1).join('/')
  if (parent !== remoteParentPath) {
    throw remoteProtocolError(`remote ~tree child '${rel}' is not a direct descendant`)
  }
  const out: TreeEntry = {
    path: `${mountPath}/${rel}`,
    kind: entry.kind,
    description: entry.description,
  }
  if (entry.online !== undefined) out.online = entry.online
  return out
}

/**
 * 按直接父路径索引子树节点(父 = 去掉最后一段;顶层节点父为 '')。
 * `~tree` 一次读入子树后在内存建此索引,getChildren 从中取直接子,避免每层递归各扫 KV。
 */
function indexByParent(nodes: TreeNode[]): Map<TreePath, TreeNode[]> {
  const byParent = new Map<TreePath, TreeNode[]>()
  for (const n of nodes) {
    const segs = n.path.split('/')
    const parent = segs.slice(0, -1).join('/')
    const bucket = byParent.get(parent)
    if (bucket) bucket.push(n)
    else byParent.set(parent, [n])
  }
  return byParent
}

/** 取上游工具集:mcp/tool 走 `toolcache:<path>` 缓存(TTL + refresh);http 从 config 直接生成。 */
function upstreamTools(
  node: TreeNode,
  provider: UpstreamProvider,
  deps: TbAppDeps,
  refresh: boolean,
  now: string,
): Promise<ToolSpec[]> {
  if (node.kind === 'mcp' || node.kind === 'tool') {
    const sync = isMutableSearchIndex(deps.search)
      ? new SearchSynchronizer(deps.state, deps.search)
      : undefined
    let marker: SearchDirtyMarker | undefined
    return getTools(deps.state, node.path, () => provider.list(), {
      refresh,
      ttl: deps.toolCacheTtlSec ?? TOOL_CACHE_TTL_DEFAULT,
      now,
      ...(sync === undefined
        ? {}
        : {
            beforeFresh: async () => {
              marker = await sync.markNode(node.path)
            },
            onFreshError: async () => await sync.abort(marker),
            onFresh: async tools => await sync.reconcileNodeQuietly(node.path, { marker, tools }),
          }),
    })
  }
  return provider.list()
}

/**
 * 生效的 remote 白名单 = env 基线 ∪ 运行时条目(system/federation 管理)。
 * 请求期读取(app 被 WeakMap 按 env 缓存,不能在装配期定死);运行时无条目 → 原样返回基线。
 */
async function resolveRemoteSettings(
  state: StateStore,
  base: RemoteSettings,
): Promise<RemoteSettings> {
  const runtime = await new RemoteAllowlistStore(state).hosts()
  if (runtime.length === 0) return base
  return { ...base, allowlist: [...new Set([...base.allowlist, ...runtime])] }
}

/**
 * remote 透传:最长前缀 resolve 命中 remote 节点则改写请求打到 baseUrl。
 * 非 remote → 返回 null(交给普通流程)。本地两级权限:先可见(read),POST 另需 call。
 */
async function remotePassthroughIfMatch(
  c: AppContext,
  ctx: CallContext,
  registry: NodeRegistryStore,
  treePath: TreePath,
  reservedTail: '~help' | '~tree' | '~skill' | null,
  deps: TbAppDeps,
  headers: Headers = c.req.raw.headers,
): Promise<Response | null> {
  let resolved: { node: TreeNode, rest: string }
  try {
    resolved = await registry.resolve(treePath)
  } catch {
    return null
  }
  const node = resolved.node
  if (node.kind !== 'remote' || node.config?.kind !== 'remote') return null

  if (!check(ctx, treePath, 'read').allow) throw TBError.notFound('not found')
  const method = reservedTail === null ? 'POST' : 'GET'
  if (method === 'POST' && !check(ctx, treePath, 'call').allow) {
    throw new TBError('permission_denied', `no scope grants 'call' on '${treePath}'`)
  }
  const requestPath = reservedTail === null ? treePath : `${treePath}/${reservedTail}`
  const body = method === 'POST' ? await c.req.text() : undefined
  // 必须 await(而非裸 return async promise):裸返回时其 reject 会在链接那一 tick 被
  // workerd/miniflare 误报为 unhandled rejection,即便 runHandler 最终 catch(同 GET 通配注释)。
  return await passthroughRemote({
    actor: { keyId: ctx.keyId, owner: ctx.owner, traceId: ctx.traceId },
    config: node.config,
    nodePath: node.path,
    requestPath,
    method,
    ...(body !== undefined ? { body } : {}),
    headers,
    secrets: deps.secrets,
    settings: await resolveRemoteSettings(deps.state, deps.remote),
    requestUrl: c.req.url,
  })
}

/**
 * remote 联邦树聚合:本地 `~tree` 构树递归到 remote 节点或其后代时,取远端同形
 * `~tree` 的直接 children 并把路径加回本地挂载前缀,再交给 buildTree 统一计入深度/节点预算。
 */
async function remoteTreeChildren(
  c: AppContext,
  ctx: CallContext,
  registry: NodeRegistryStore,
  treePath: TreePath,
  deps: TbAppDeps,
): Promise<TreeEntry[]> {
  if (treePath === '') return []
  let resolved: { node: TreeNode, rest: string }
  try {
    resolved = await registry.resolve(treePath)
  } catch {
    return []
  }
  if (resolved.node.kind !== 'remote' || resolved.node.config?.kind !== 'remote') return []

  const headers = new Headers(c.req.raw.headers)
  headers.set('accept', 'application/json')
  const resp = await remotePassthroughIfMatch(c, ctx, registry, treePath, '~tree', deps, headers)
  if (resp === null) return []
  if (!resp.ok) {
    throw new TBError('unavailable', `remote ~tree returned HTTP ${resp.status}`, {
      retryable: resp.status >= 500,
    })
  }
  const remoteTree = (await resp.json().catch(() => null)) as TreeJson | null
  if (remoteTree === null) {
    throw new TBError('unavailable', 'remote ~tree returned invalid JSON', { retryable: false })
  }
  const remotePath = canonicalRemotePath(remoteTree.path, true)
  if (remotePath !== resolved.rest) {
    throw remoteProtocolError(`remote ~tree path '${remotePath}' does not match request`)
  }
  return (remoteTree.children ?? []).map(child =>
    localizeRemoteEntry(resolved.node.path, remotePath, child))
}

/** 注册 remote 节点时的白名单校验:config.kind==='remote' → baseUrl 必须在白名单内。 */
function assertRemoteConfigAllowed(config: unknown, settings: RemoteSettings): void {
  if (config === null || typeof config !== 'object') return
  if ((config as { kind?: unknown }).kind !== 'remote') return
  const baseUrl = (config as { baseUrl?: unknown }).baseUrl
  if (typeof baseUrl !== 'string') {
    throw new TBError('invalid_argument', 'remote config 缺少 baseUrl')
  }
  assertRemoteAllowed(baseUrl, settings)
}

// ---------- device 节点 ----------

function tbErrorFromBody(body: TBErrorBody): TBError {
  return new TBError(body.code, body.message, { retryable: body.retryable })
}

/** 设备通道缺省(deviceTransport 未注入)→ device 能力禁用。 */
function requireDevice(deps: TbAppDeps): DeviceChannel {
  if (deps.device === undefined) {
    throw TBError.unimplemented('device capability disabled: no device transport')
  }
  return deps.device
}

async function invokeDevice(
  deps: TbAppDeps,
  deviceId: string,
  req: { arguments: Record<string, unknown>, path: string, tool: string },
): Promise<unknown> {
  const id = crypto.randomUUID()
  const body = (await requireDevice(deps).invoke(deviceId, { id, ...req })) as DeviceCallResult
  if (!body || !('ok' in body)) {
    throw new TBError('unavailable', 'device session returned invalid result')
  }
  if (body.ok) return body.value
  throw tbErrorFromBody(body.error)
}

/** device 自定义节点转发标记:hello 代注册时网关写入 providerConfig。 */
interface DeviceNodeMarker {
  /** 注册时随 NodeInput 上送的工具表(~help 数据源);老客户端不带。 */
  cmds?: ToolSpec[]
  deviceId: string
  mountPath: string
}

function deviceMarkerOf(pc: Record<string, unknown> | undefined): DeviceNodeMarker | null {
  if (pc === undefined || typeof pc.deviceId !== 'string' || typeof pc.mountPath !== 'string') {
    return null
  }
  return {
    deviceId: pc.deviceId,
    mountPath: pc.mountPath,
    ...(Array.isArray(pc.cmds) ? { cmds: pc.cmds as ToolSpec[] } : {}),
  }
}

/** kind:'tool' 且带设备标记的自定义节点(SDK registerTool → connect 代注册产物)。 */
function deviceToolMarker(node: TreeNode): DeviceNodeMarker | null {
  if (node.kind !== 'tool' || node.config?.kind !== 'tool') return null
  return deviceMarkerOf(node.config.providerConfig)
}

/** 帧协议 call 的 path = 节点路径相对设备 mountPath(如 'tools/echo')。 */
function relativeDevicePath(nodePath: TreePath, mountPath: string): string {
  if (nodePath.startsWith(`${mountPath}/`)) return nodePath.slice(mountPath.length + 1)
  throw new TBError('invalid_argument', `device 节点 '${nodePath}' 不在挂载 '${mountPath}' 下`)
}

// ---------- SDK 进程内 Provider ----------

/** 按节点路径查 SDK 进程内 ContextProvider(未注入/未命中 → null)。 */
function localContext(deps: TbAppDeps, node: TreeNode): ContextProvider | null {
  return deps.locals?.context?.(node.path) ?? null
}

/**
 * 进程内 Provider 的 capabilities:按 handler 存在性推导(~describe/~help 共用)。
 * 推导真源在 core `context/capabilities.ts`,与 `~help` 的动词过滤同源,避免两处漂移。
 */
function localCapabilities(provider: ContextProvider): string[] {
  return contextCapabilitiesOf(provider)
}

// ---------- plugin 挂载消费 ----------

/**
 * 取已注册且启用的 plugin,并选出挂载目标 export(plugin/v2)。
 *
 * v1 用 manifest.kind 判「这个 plugin 是不是我要的类型」;v2 的类型属于 **export**,
 * 故改为:取 manifest(存在 + 启用)→ 取注册时缓存的 `~describe` → 按挂载配置的
 * `config.export` 与节点 kind 选出唯一 export(单 export 可省略;多 export 必须显式,
 * 见 core resolvePluginExport)。不存在/禁用 → invalid_argument(不泄露更多)。
 */
async function requirePluginExport(
  store: StateStore,
  id: string,
  nodeKind: 'tool' | 'context',
  what: 'context' | 'tool',
  exportId?: string,
): Promise<{ export: PluginExport, manifest: PluginManifest }> {
  const manifest = (await store.get(KEY_PLUGIN + id)) as PluginManifest | null
  if (manifest === null) {
    throw new TBError('invalid_argument', `未知 ${what} provider:'${id}'`)
  }
  if (manifest.enabled !== true) {
    throw new TBError('invalid_argument', `plugin '${id}' 已禁用`)
  }
  const describe = (await store.get(KEY_PLUGIN_META + id)) as PluginDescribe | null
  if (describe === null) {
    throw new TBError('invalid_argument', `plugin '${id}' 缺少 ~describe 缓存,请重新注册`)
  }
  const chosen = resolvePluginExport(describe, {
    nodeKind,
    pluginId: id,
    ...(exportId !== undefined ? { exportId } : {}),
  })
  return { manifest, export: chosen }
}

/**
 * plugin 调用的挂载上下文:同一 plugin 可多路径挂载,envelope 里带 mountPath 与
 * 挂载节点的 providerConfig(mountConfig)供 plugin 区分挂载来源;老 plugin 按
 * "未知字段忽略"原则不受影响。
 */
function mountCallContext(
  ctx: CallContext,
  mountPath: TreePath,
  providerConfig: Record<string, unknown> | undefined,
  exportId?: string,
): CallContext {
  return {
    ...ctx,
    mountPath,
    ...(providerConfig !== undefined ? { mountConfig: providerConfig } : {}),
    // v2 多 export:plugin 据此把调用路由到正确的 export。
    ...(exportId !== undefined ? { exportId } : {}),
  }
}

/** 为 mcp/http/tool 节点构造对应 Provider(其余 kind 无 Provider → unimplemented)。 */
async function providerFor(
  node: TreeNode,
  ctx: CallContext,
  deps: TbAppDeps,
): Promise<UpstreamProvider> {
  const insecure = deps.allowInsecureHttp
  if (node.kind === 'mcp' && node.config?.kind === 'mcp') {
    return createMcpProvider(node.config as McpConfig, deps.secrets, {
      allowInsecure: insecure,
      // 会话复用凭证存 StateStore(mcpsession:<path>);调用结果不缓存(providers/mcp.ts)。
      session: { store: deps.state, nodePath: node.path },
      // auth:'oauth' 节点的托管凭证存取面(mcpoauth:*);密钥缺省 → provider 内报 unavailable。
      ...(deps.encryptionKey !== undefined
        ? { oauth: { store: deps.state, encryptionKey: deps.encryptionKey } }
        : {}),
    })
  }
  if (node.kind === 'http' && node.config?.kind === 'http') {
    return createHttpProvider(node.config as HttpConfig, deps.secrets, { allowInsecure: insecure })
  }
  if (node.kind === 'tool' && node.config?.kind === 'tool') {
    // SDK 进程内工具源(registerTool):按节点路径查本实例表,先于 plugin 解析。
    const local = deps.locals?.tool?.(node.path)
    if (local !== undefined) return local
    // plugin 工具源:provider = 已注册 tool-provider plugin 的 id。
    const { manifest, export: exported } = await requirePluginExport(
      deps.state,
      node.config.provider,
      'tool',
      'tool',
      node.config.export,
    )
    return createPluginToolProvider({
      manifest,
      secrets: deps.secrets,
      ctx: mountCallContext(ctx, node.path, node.config.providerConfig, exported.id),
      // 挂载 authRef = 上游凭证引用,平台代解析经 X-TB-Upstream-Auth 注入。
      ...(node.config.authRef !== undefined ? { upstreamAuthRef: node.config.authRef } : {}),
      ...(deps.pluginBindings !== undefined ? { bindings: deps.pluginBindings } : {}),
    })
  }
  throw TBError.unimplemented(`kind '${node.kind}' has no tool provider`)
}

/** 注册变更后主动 materialize 动态工具表；失败时保留 dirty marker，由后续 fresh list 修复。 */
async function refreshDynamicSearchNode(
  node: TreeNode,
  ctx: CallContext,
  deps: TbAppDeps,
): Promise<boolean> {
  if ((node.kind !== 'mcp' && node.kind !== 'tool') || deviceToolMarker(node) !== null) return false
  try {
    const provider = await providerFor(node, ctx, deps)
    await upstreamTools(node, provider, deps, true, new Date().toISOString())
    return true
  } catch {
    // Canonical registry mutation remains successful; marker keeps derived search repairable.
    return false
  }
}

async function refreshDynamicToolCache(
  node: TreeNode,
  ctx: CallContext,
  deps: TbAppDeps,
): Promise<void> {
  if ((node.kind !== 'mcp' && node.kind !== 'tool') || deviceToolMarker(node) !== null) return
  const provider = await providerFor(node, ctx, deps)
  await getTools(deps.state, node.path, () => provider.list(), {
    refresh: true,
    ttl: deps.toolCacheTtlSec ?? TOOL_CACHE_TTL_DEFAULT,
    now: new Date().toISOString(),
  })
}

/**
 * 工具级 `~help`(两级披露的细节级):path 非注册节点时,最长前缀 resolve 命中
 * mcp/http 节点且 rest 恰为一段(工具虚拟名)→ 单工具全量 HelpModel。工具集取自与节点级
 * 相同的缓存(getTools),不额外打上游。不匹配/工具不存在 → null(调用方 404)。
 * 可见性与列表面一致(read+call;deny==not_found 不泄露存在性)。
 */
async function toolHelpModelFor(
  c: AppContext,
  ctx: CallContext,
  registry: NodeRegistryStore,
  path: TreePath,
  deps: TbAppDeps,
): Promise<HelpModel | null> {
  let resolved: { node: TreeNode, rest: string }
  try {
    resolved = await registry.resolve(path)
  } catch {
    return null
  }
  const { node, rest } = resolved
  if (
    (node.kind !== 'mcp' && node.kind !== 'http' && node.kind !== 'tool')
    || node.config === undefined
  ) {
    return null
  }
  if (rest === '' || rest.includes('/')) return null
  if (!check(ctx, node.path, 'read').allow || !check(ctx, node.path, 'call').allow) return null
  // device 自定义 tool 节点:工具表来自注册时缓存的 providerConfig.cmds,不打设备。
  const marker = deviceToolMarker(node)
  if (marker !== null) {
    const cached = (marker.cmds ?? []).find(t => t.name === rest)
    if (cached === undefined) return null
    return toolHelpModel(node.path, { kind: node.kind, description: node.description }, cached)
  }
  const provider = await providerFor(node, ctx, deps)
  const refresh = c.req.query('refresh') === '1'
  const raw = await upstreamTools(node, provider, deps, refresh, new Date().toISOString())
  const { exposed } = virtualizeTools(node.virtualize, raw)
  const tool = exposed.find(t => t.name === rest)
  if (tool === undefined) return null
  return toolHelpModel(node.path, { kind: node.kind, description: node.description }, tool)
}

/**
 * device 转发标记只能由 hello 代注册写入:注册面手工携带 providerConfig
 * 的 deviceId+mountPath → 拒,防止把任意节点调用劫持转发到他人设备(与 device-fs 口径一致)。
 */
function assertNoDeviceMarker(config: unknown): void {
  const pc = (config as { providerConfig?: unknown }).providerConfig
  if (
    pc !== null
    && typeof pc === 'object'
    && deviceMarkerOf(pc as Record<string, unknown>) !== null
  ) {
    throw new TBError(
      'invalid_argument',
      'providerConfig 的 device 转发标记由网关代写,不得经注册面携带',
    )
  }
}

/**
 * 注册/更新 kind:'tool' 节点时的配置校验(注册时即拒):
 * provider 必须是已注册且启用的 tool-provider plugin(SDK 保留 id '@local' 由
 * SDK 内部注册通道落库,不经注册面)。
 */
async function assertToolConfig(config: unknown, store: StateStore): Promise<void> {
  if (config === null || typeof config !== 'object') return
  if ((config as { kind?: unknown }).kind !== 'tool') return
  assertNoDeviceMarker(config)
  const provider = (config as { provider?: unknown }).provider
  if (typeof provider !== 'string' || provider === '') {
    throw new TBError('invalid_argument', 'kind:\'tool\' 节点需要 config.provider(plugin id)')
  }
  const exportId = (config as { export?: unknown }).export
  await requirePluginExport(
    store,
    provider,
    'tool',
    'tool',
    typeof exportId === 'string' ? exportId : undefined,
  )
}

// ---------- context 节点 ----------

type ContextConfig = Extract<NodeConfig, { kind: 'context' }>
type SkillhubConfig = Extract<NodeConfig, { kind: 'skillhub' }>
/** context 与 skillhub 共用对象存储装配(provider/providerConfig/authRef 同形)。 */
type ObjectNodeConfig = ContextConfig | SkillhubConfig

/** S3 类凭证值形状:JSON {"accessKeyId","secretAccessKey"};解析失败不回显值。 */
export function parseS3Credentials(
  raw: string,
  refName: string,
): { accessKeyId: string, secretAccessKey: string } {
  try {
    const v = JSON.parse(raw) as { accessKeyId?: unknown, secretAccessKey?: unknown }
    if (typeof v.accessKeyId === 'string' && typeof v.secretAccessKey === 'string') {
      return { accessKeyId: v.accessKeyId, secretAccessKey: v.secretAccessKey }
    }
  } catch {
    // fallthrough:统一 invalid_argument
  }
  throw new TBError(
    'invalid_argument',
    `凭证 '${refName}' 不是 {"accessKeyId","secretAccessKey"} 形状的 JSON`,
  )
}

function deviceIdForDeviceFs(cfg: ContextConfig): string {
  const pc = cfg.providerConfig
  if (pc && typeof pc === 'object' && typeof pc.deviceId === 'string') return pc.deviceId
  throw new TBError('invalid_argument', 'device-fs context 缺少 providerConfig.deviceId')
}

/** s3 provider 的 store 构造参数:providerConfig.endpoint/bucket + authRef 解析(均必填)。 */
async function s3StoreConfig(
  cfg: ObjectNodeConfig,
  secrets: SecretStoreImpl,
): Promise<S3StoreConfig> {
  const pc = (cfg.providerConfig ?? {}) as {
    bucket?: unknown
    endpoint?: unknown
    region?: unknown
  }
  if (typeof pc.endpoint !== 'string' || typeof pc.bucket !== 'string') {
    throw new TBError('invalid_argument', 's3 provider 需要 providerConfig.endpoint 与 bucket')
  }
  if (typeof cfg.authRef !== 'string') {
    throw new TBError('invalid_argument', 's3 provider 需要 authRef(SecretStore 引用名)')
  }
  const raw = await secrets.resolve(cfg.authRef)
  if (raw === undefined) {
    throw new TBError('invalid_argument', `authRef '${cfg.authRef}' 无法解析`)
  }
  return {
    endpoint: pc.endpoint,
    bucket: pc.bucket,
    ...(typeof pc.region === 'string' ? { region: pc.region } : {}),
    ...parseS3Credentials(raw, cfg.authRef),
  }
}

/** providerConfig.prefix(共桶隔离);缺省 r2 按节点路径隔离,s3 为空(整桶即 namespace)。 */
function contextKeyPrefix(cfg: ContextConfig, nodePath: TreePath): string {
  const prefix = (cfg.providerConfig as { prefix?: unknown } | undefined)?.prefix
  if (typeof prefix === 'string') return prefix
  return cfg.provider === 'r2' ? `ctx/${nodePath}` : ''
}

/** 按 config.provider 构造底层 ObjectStore('r2' = 宿主注入的平台对象存储)。 */
async function contextObjectStoreFor(cfg: ObjectNodeConfig, deps: TbAppDeps): Promise<ObjectStore> {
  if (cfg.provider === 'r2') {
    if (deps.objects === undefined) {
      throw new TBError('unavailable', 'object store not configured(objects 未注入)', {
        retryable: false,
      })
    }
    return await deps.objects()
  }
  if (cfg.provider === 's3') {
    return createS3ObjectStore(await s3StoreConfig(cfg, deps.secrets), {
      allowInsecure: deps.allowInsecureHttp,
    })
  }
  throw TBError.unimplemented(`context provider '${cfg.provider}' not implemented yet`)
}

/**
 * context 节点的 ContextProvider 装配:四动词语义在 core objectProvider,这里只注入
 * ObjectStore、keyPrefix、$ref 阈值/有效期与 /~ref 中转 URL 工厂(presign 凭证缺省时生效)。
 */
async function contextProviderFor(
  node: TreeNode,
  cfg: ContextConfig,
  deps: TbAppDeps,
  requestUrl: string,
): Promise<ContextProvider> {
  const objects = await contextObjectStoreFor(cfg, deps)
  const opts: Parameters<typeof createObjectContextProvider>[1] = {
    nsPath: node.path,
    keyPrefix: contextKeyPrefix(cfg, node.path),
    readOnly: cfg.readOnly ?? false,
  }
  if (deps.refThresholdBytes !== undefined) opts.refThresholdBytes = deps.refThresholdBytes
  if (deps.refTtlSec !== undefined) opts.presignTtlSec = deps.refTtlSec
  // /~ref 中转 URL 工厂:token 密钥派生自 TB_SECRET_ENCRYPTION_KEY;密钥缺省则不提供
  // (presign 也缺时 core 对大对象 Get 报 unavailable)。
  const encKey = deps.encryptionKey
  if (encKey !== undefined) {
    const origin = new URL(requestUrl).origin
    const relayTtlSec = deps.refTtlSec ?? PRESIGN_TTL_SEC_DEFAULT
    opts.relayRefUrl = async (key) => {
      const exp = Math.floor(Date.now() / 1000) + relayTtlSec
      return `${origin}/~ref/${await signRefToken({ p: node.path, k: key, exp }, encKey)}`
    }
  }
  return createObjectContextProvider(objects, opts)
}

/** skillhub 的 keyPrefix:共桶隔离,r2 默认 `skills/<nodePath>`,s3 默认整桶。 */
function skillhubKeyPrefix(cfg: SkillhubConfig, nodePath: TreePath): string {
  const prefix = (cfg.providerConfig as { prefix?: unknown } | undefined)?.prefix
  if (typeof prefix === 'string') return prefix
  return cfg.provider === 'r2' ? `skills/${nodePath}` : ''
}

/**
 * skillhub 节点的 SkillhubProvider 装配:底层对象存储与 $ref 中转 URL 工厂与 context 同源,
 * 只是 keyPrefix 落在 `skills/<path>` 且叠加 skill 单位语义(core skillhub/provider)。
 */
async function skillhubProviderFor(
  node: TreeNode,
  cfg: SkillhubConfig,
  deps: TbAppDeps,
  requestUrl: string,
): Promise<SkillhubProvider> {
  const objects = await contextObjectStoreFor(cfg, deps)
  const opts: Parameters<typeof createSkillhubProvider>[1] = {
    nsPath: node.path,
    keyPrefix: skillhubKeyPrefix(cfg, node.path),
    readOnly: cfg.readOnly ?? false,
  }
  if (deps.refThresholdBytes !== undefined) opts.refThresholdBytes = deps.refThresholdBytes
  if (deps.refTtlSec !== undefined) opts.presignTtlSec = deps.refTtlSec
  const encKey = deps.encryptionKey
  if (encKey !== undefined) {
    const origin = new URL(requestUrl).origin
    const relayTtlSec = deps.refTtlSec ?? PRESIGN_TTL_SEC_DEFAULT
    opts.relayRefUrl = async (key) => {
      const exp = Math.floor(Date.now() / 1000) + relayTtlSec
      return `${origin}/~ref/${await signRefToken({ p: node.path, k: key, exp }, encKey)}`
    }
  }
  return createSkillhubProvider(objects, opts)
}

/** 数据面 {tool} → SkillhubProvider 方法派发;入参精细校验由 provider 承担。 */
async function dispatchSkillhubCmd(
  provider: SkillhubProvider,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (tool) {
    case 'List':
      return await provider.List(args.opts as ListOptions | undefined)
    case 'Get':
      return typeof args.file === 'string'
        ? await provider.GetFile(args.id as string, args.file)
        : await provider.Get(args.id as string)
    case 'Search':
      return await provider.Search(args.query as string, args.opts as ListOptions | undefined)
    case 'Publish':
      if (!Array.isArray(args.files)) {
        throw new TBError('invalid_argument', 'Publish 需要数组 \'files\'')
      }
      return await provider.Publish({
        ...(typeof args.id === 'string' ? { id: args.id } : {}),
        files: args.files as SkillPublishFile[],
      })
    case 'Remove':
      return await provider.Remove(args.id as string)
    default:
      // skillhubScopeForCmd 已挡未知 cmd;此处为类型完备性兜底。
      throw new TBError('invalid_argument', `unknown cmd '${tool}'`)
  }
}

/**
 * 数据面 {tool} → ContextProvider 方法派发;入参精细校验由 provider 承担。
 * 可选方法(Search/Delete)未实现(plugin 未在 capabilities 声明)→ 按 unknown cmd 拒
 * (未声明的可选方法平台永不调用)。SDK 设备侧 handler 派发同形复用(导出)。
 */
export async function dispatchContextCmd(
  provider: ContextProvider,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  // 全动词可选:未实现的动词一律按 unknown cmd 拒绝(与"~help 只列真实存在的操作"一致,
  // 调用方看到的动词表与可调用集合始终吻合)。
  const unimplemented = (): never => {
    throw new TBError('invalid_argument', `unknown cmd '${tool}'(provider 未实现)`)
  }
  switch (tool) {
    case 'List':
      if (provider.List === undefined) return unimplemented()
      return await provider.List((args.path as string) ?? '', args.opts as ListOptions | undefined)
    case 'Get':
      if (provider.Get === undefined) return unimplemented()
      return await provider.Get(args.path as string)
    case 'Write':
      if (provider.Write === undefined) return unimplemented()
      if (typeof args.entry !== 'object' || args.entry === null) {
        throw new TBError('invalid_argument', 'Write 需要对象 \'entry\'')
      }
      return await provider.Write(args.path as string, args.entry as ContextEntryInput)
    case 'Update':
      if (provider.Update === undefined) return unimplemented()
      if (typeof args.patch !== 'object' || args.patch === null) {
        throw new TBError('invalid_argument', 'Update 需要对象 \'patch\'')
      }
      return await provider.Update(args.path as string, args.patch as ContextPatch)
    case 'Delete':
      if (provider.Delete === undefined) return unimplemented()
      return await provider.Delete(args.path as string)
    case 'Search':
      if (provider.Search === undefined) return unimplemented()
      return await provider.Search(args.query as string, args.opts as SearchOptions | undefined)
    default:
      // contextScopeForCmd 已挡未知 cmd;此处为类型完备性兜底。
      throw new TBError('invalid_argument', `unknown cmd '${tool}'`)
  }
}

/** ttl 懒回收单点判定:过期 → 删节点 + not_found;未过期 → 通过。context/skillhub 共用。 */
async function assertContextAlive(
  node: TreeNode,
  cfg: { ttl?: number },
  registry: NodeRegistryStore,
): Promise<void> {
  if (!isContextExpired(node.createdAt, cfg.ttl, Date.now())) return
  await registry.delete(node.path)
  throw TBError.notFound('not found')
}

/** 列表面(~tree/目录 ~help)的 ttl 懒回收:过期 context/skillhub 节点剔除并删除。 */
async function pruneExpiredContext(
  nodes: TreeNode[],
  registry: NodeRegistryStore,
): Promise<TreeNode[]> {
  const now = Date.now()
  const alive: TreeNode[] = []
  for (const n of nodes) {
    const cfg = n.config
    if (
      (n.kind === 'context' || n.kind === 'skillhub')
      && cfg?.kind === n.kind
      && isContextExpired(n.createdAt, (cfg as { ttl?: number }).ttl, now)
    ) {
      await registry.delete(n.path)
      continue
    }
    alive.push(n)
  }
  return alive
}

/**
 * 节点的 HelpModel:builtin 取模块 help();directory 列可见子节点;mcp/http 经 Provider 取
 * 上游工具集(mcp 走缓存,`refresh` 强制刷新)→ 虚拟化 → `toolsToHelpModel`;context 静态
 * cmd 表(ttl 懒回收先行);其余 kind(device)未落地 → 501。remote 在调用点已透传,不进此函数。
 */
async function helpModelFor(
  node: TreeNode,
  registry: NodeRegistryStore,
  ctx: CallContext,
  builtins: Map<string, BuiltinModule>,
  deps: TbAppDeps,
  opts: { now: string, refresh: boolean },
): Promise<HelpModel> {
  if (node.kind === 'builtin' && node.config?.kind === 'builtin') {
    const mod = builtins.get(node.config.module)
    if (mod) return mod.help(node.path)
    throw TBError.unimplemented(`builtin module '${node.config.module}' not available`)
  }
  if (node.kind === 'directory') {
    const children = filterListVisible(
      await pruneExpiredContext(await registry.children(node.path), registry),
      ctx.scopes,
    )
    if (node.online !== undefined) {
      return deviceDirectoryHelpModel(
        { path: node.path, description: node.description, online: node.online },
        children.map(n => ({ path: n.path, kind: n.kind, description: n.description })),
      )
    }
    return {
      node: { path: node.path, kind: node.kind, description: node.description },
      cmds: [],
      children: children.map(n => ({ path: n.path, kind: n.kind, description: n.description })),
      hint: 'GET /<child-path>/~help describes a child node',
    }
  }
  // device 自定义 tool 节点:~help 来自注册时上送的工具表(cmds),
  // 不打设备;索引形态与 mcp/http 对齐,单工具全量 spec 走工具级 ~help(toolHelpModelFor)。
  const toolMarker = deviceToolMarker(node)
  if (toolMarker !== null) {
    return toolsToHelpModel(
      node.path,
      { kind: node.kind, description: node.description },
      toolMarker.cmds ?? [],
      { index: true },
    )
  }
  if (node.kind === 'mcp' || node.kind === 'http' || node.kind === 'tool') {
    const provider = await providerFor(node, ctx, deps)
    const raw = await upstreamTools(node, provider, deps, opts.refresh, opts.now)
    const { exposed } = virtualizeTools(node.virtualize, raw)
    // 索引形态(两级披露):不含 inputSchema;全量 spec 走工具级 ~help。
    return toolsToHelpModel(
      node.path,
      { kind: node.kind, description: node.description },
      exposed,
      {
        index: true,
      },
    )
  }
  if (node.kind === 'device' && node.config?.kind === 'device') {
    return deviceShellHelpModel(node.path, node.config.expose.shell ?? {})
  }
  // context:cmd 表静态声明(readOnly 隐藏写动词);~help 命中即做 ttl 懒回收。
  if (node.kind === 'context' && node.config?.kind === 'context') {
    await assertContextAlive(node, node.config, registry)
    if (node.config.provider === 'device-fs') {
      return deviceFsHelpModel(
        { path: node.path, description: node.description },
        { readOnly: node.config.readOnly ?? false },
      )
    }
    // device 自定义 context 节点:静态动词表(readOnly 隐藏写动词)。
    if (deviceMarkerOf(node.config.providerConfig) !== null) {
      return contextHelpModel(node, { readOnly: node.config.readOnly ?? false })
    }
    if (node.config.provider !== 'r2' && node.config.provider !== 's3') {
      const local = localContext(deps, node)
      if (local !== null) {
        // SDK 进程内 Provider:动词表 = 真实实现的 handler;无任何写动词即自动只读
        // (挂载期显式 readOnly 仍可额外收紧)。~help 与可调用集合据此始终吻合。
        return contextHelpModel(node, {
          methods: contextMethodsOf(local),
          readOnly: (node.config.readOnly ?? false) || isReadOnlyProvider(local),
        })
      }
      // plugin-backed 节点:动词表 = export 自报的 methods(plugin/v2 契约);未自报则
      // 退回旧默认(四动词 + 注册时声明的可选方法,Q12)。~help 与可调用集合由此始终吻合
      // —— providers/pluginContext.ts 按同一集合挂 handler。
      const model = contextHelpModel(node, { readOnly: node.config.readOnly ?? false })
      const { export: exported } = await requirePluginExport(
        deps.state,
        node.config.provider,
        'context',
        'context',
        node.config.export,
      )
      const declared
        = exported.methods !== undefined
          ? new Set(exported.methods)
          : new Set([
              'List',
              'Get',
              'Write',
              'Update',
              ...optionalMethodsForCapabilities(exported.capabilities ?? []),
            ])
      return { ...model, cmds: model.cmds.filter(c => declared.has(c.name)) }
    }
    return contextHelpModel(node, { readOnly: node.config.readOnly ?? false })
  }
  if (node.kind === 'skillhub' && node.config?.kind === 'skillhub') {
    await assertContextAlive(node, node.config, registry)
    return skillhubHelpModel(node, { readOnly: node.config.readOnly ?? false })
  }
  throw TBError.unimplemented(`~help for kind '${node.kind}' not implemented yet`)
}

/**
 * 注册/更新 context 节点时的配置校验(注册时即拒):
 * provider = r2|s3 或已注册且启用的 context-provider plugin id;
 * s3 必填 endpoint/bucket/authRef,且做一次浅 list 连通探测(D8)——失败 →
 * unavailable(retryable);r2 与 plugin 不探测(plugin 在 PluginRegistry.Write 时已探活)。
 */
async function assertContextConfig(config: unknown, deps: TbAppDeps): Promise<void> {
  if (config === null || typeof config !== 'object') return
  if ((config as { kind?: unknown }).kind !== 'context') return
  assertNoDeviceMarker(config)
  const cfg = config as ContextConfig
  if (cfg.provider !== 'r2' && cfg.provider !== 's3') {
    // plugin 挂载:不存在/kind 不符/禁用 → invalid_argument(device-fs 由网关代写、
    // SDK '@local' 由 registerContext 内部通道落库,均不经注册面)。
    await requirePluginExport(deps.state, cfg.provider, 'context', 'context', cfg.export)
    return
  }
  if (cfg.provider === 's3') {
    // 结构/凭证/https 校验失败 → invalid_argument(store 构造抛出)。
    const store = createS3ObjectStore(await s3StoreConfig(cfg, deps.secrets), {
      allowInsecure: deps.allowInsecureHttp,
    })
    try {
      await store.list(contextKeyPrefix(cfg, ''), { limit: 1 })
    } catch (err) {
      const detail = isTBError(err) ? err.message : String(err)
      throw new TBError('unavailable', `s3 连通探测失败:${detail}`, { retryable: true })
    }
  }
}

/**
 * 注册/更新 skillhub 节点时的配置校验:provider 仅 r2|s3(本期不支持 plugin/device);
 * s3 做一次浅 list 连通探测(与 context 同则),r2 用平台桶不探测。
 */
async function assertSkillhubConfig(config: unknown, deps: TbAppDeps): Promise<void> {
  if (config === null || typeof config !== 'object') return
  if ((config as { kind?: unknown }).kind !== 'skillhub') return
  const cfg = config as SkillhubConfig
  if (cfg.provider !== 'r2' && cfg.provider !== 's3') {
    throw new TBError(
      'invalid_argument',
      `skillhub provider 仅支持 'r2' 或 's3',收到 '${cfg.provider}'`,
    )
  }
  if (cfg.provider === 's3') {
    const store = createS3ObjectStore(await s3StoreConfig(cfg, deps.secrets), {
      allowInsecure: deps.allowInsecureHttp,
    })
    try {
      await store.list(skillhubKeyPrefix(cfg, ''), { limit: 1 })
    } catch (err) {
      const detail = isTBError(err) ? err.message : String(err)
      throw new TBError('unavailable', `s3 连通探测失败:${detail}`, { retryable: true })
    }
  }
}

/** ~tree 的 DSL 文本渲染:每行缩进树(简单实现;JSON 是规范形状)。 */
function renderTreeDsl(tree: TreeJson): string {
  const lines: string[] = []
  const walk = (n: TreeJson, depth: number): void => {
    const indent = '  '.repeat(depth)
    const label = n.path === '' ? '/' : n.path
    const trunc = n.truncated ? ' …' : ''
    lines.push(`${indent}${label} [${n.kind}] ${n.description}${trunc}`)
    for (const child of n.children ?? []) walk(child, depth + 1)
  }
  walk(tree, 0)
  return `${lines.join('\n')}\n`
}
export function createTbApp(deps: TbAppDeps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>()
  const searchSync = isMutableSearchIndex(deps.search)
    ? new SearchSynchronizer(deps.state, deps.search)
    : undefined
  const builtinsOf = (store: StateStore): Map<string, BuiltinModule> =>
    createBuiltins(
      buildDeps({
        store,
        secrets: deps.secrets,
        version: deps.version,
        allowInsecureHttp: deps.allowInsecureHttp,
        remoteAllowlistBase: deps.remote.allowlist,
        ...(deps.pluginBindings !== undefined ? { pluginBindings: deps.pluginBindings } : {}),
      }),
    )
  const globalSearchCapabilities = (): Array<'search' | 'search:semantic'> => {
    const declared = new Set(deps.search?.capabilities ?? [])
    if (!declared.has('search')) return []
    return [
      'search',
      ...(declared.has('search:semantic') ? ['search:semantic' as const] : []),
    ]
  }

  // 放在全部路由之前,确保宿主中立 app 的 API、Dashboard、错误响应都覆盖安全头。
  app.use('*', async (c, next) => {
    await next()
    const response = c.res
    const secured = withSecurityHeaders(response)
    if (secured !== response) c.res = secured
  })

  // GET /healthz → 200 JSON,树外免认证。version 单一真源:宿主 package.json。
  app.get('/healthz', c => c.json({ healthy: true, version: deps.version }))

  // GET /~ref/<token> → 大对象中转下载,树外免认证(中转下载路由)。
  // 注册在认证中间件之前:token 本身即凭证(HMAC 限时签名);验签失败/过期一律 404 不泄露。
  app.get('/~ref/:token', c =>
    runHandler(async () => {
      const encKey = deps.encryptionKey
      if (encKey === undefined) throw TBError.notFound('not found')
      const payload = await verifyRefToken(c.req.param('token'), encKey)
      if (payload === null || payload.exp * 1000 <= Date.now()) throw TBError.notFound('not found')
      await deps.ensureReady?.()
      const registry = new NodeRegistryStore(deps.state)
      let node: TreeNode
      try {
        node = await registry.get(payload.p)
      } catch {
        throw TBError.notFound('not found')
      }
      // 签发后节点可能被卸载/换 kind/ttl 到期——须仍是存活的 context/skillhub 对象节点。
      const cfg = node.config
      if (
        (node.kind !== 'context' && node.kind !== 'skillhub')
        || cfg === undefined
        || cfg.kind !== node.kind
      ) {
        throw TBError.notFound('not found')
      }
      await assertContextAlive(node, cfg, registry)
      const objects = await contextObjectStoreFor(cfg, deps)
      const got = await objects.get(payload.k)
      if (got === null) throw TBError.notFound('not found')
      // core 的最小流形状与全局 ReadableStream 结构兼容(Workers/Node 皆然)。
      return new Response(got.body as unknown as ReadableStream, {
        headers: {
          'content-type': got.meta.contentType ?? 'application/octet-stream',
          'cache-control': 'private, no-store',
        },
      })
    }),
  )

  // --- /ui Dashboard 静态资源(Workers Static Assets)---
  // 一切请求先进本 app,静态资源仅由 assets 注入点显式转发,SPA 回退只在 /ui 内生效——
  // 不可能吞根 ~help、POST 数据面与 system/*。
  // /ui 免认证:登录页本身须在无 SK 时可加载(SK 只存浏览器,静态资源不含机密)。
  const serveUi = async (c: AppContext): Promise<Response> => {
    const assets = deps.assets
    if (assets === undefined) {
      return tbErrorResponse(TBError.notFound('dashboard assets not deployed'))
    }
    const url = new URL(c.req.url)
    // 构建产物是站点根布局(index.html + assets/*),/ui 挂载前缀在此剥离。
    const sub = url.pathname.slice('/ui'.length) || '/'
    const res = await assets(new Request(new URL(sub, url.origin)))
    if (res.status !== 404) return res
    // SPA 回退(仅 /ui 内):深链交给前端路由,由 '/' 取回 index.html。
    return await assets(new Request(new URL('/', url.origin)))
  }
  app.get('/ui', c => c.redirect('/ui/', 302))
  app.get('/ui/*', serveUi)

  // 浏览器直开根路径 → Dashboard(GET / 且 Accept 带 text/html 时 302);
  // 非 HTML 客户端(Agent/CLI)落回后续路由,行为与此前一致(401/404)。
  app.get('/', async (c, next) => {
    if (c.req.header('accept')?.includes('text/html')) return c.redirect('/ui/', 302)
    await next()
  })

  // GET /~oauth/callback → mcp 托管 OAuth 的授权回调,树外免认证(浏览器跳转无法带 SK)。
  // state 本身即凭证:AES-GCM 加密载荷(nodePath + code_verifier + exp),解不开/过期一律拒。
  app.get(OAUTH_CALLBACK_PATH, c =>
    runHandler(async () => {
      const encKey = deps.encryptionKey
      if (encKey === undefined) throw TBError.notFound('not found')
      const q = c.req.query()
      // AS 用户拒绝授权等错误回跳(error=access_denied 等):展示失败页,不泄露内部状态。
      if (q.error !== undefined) {
        return renderOAuthCallbackHtml(false, `authorization server returned: ${q.error}`)
      }
      const code = q.code
      const state = q.state
      if (code === undefined || state === undefined) {
        return renderOAuthCallbackHtml(false, 'missing code or state parameter')
      }
      const payload = await openOAuthState(state, encKey)
      if (payload === null || payload.exp * 1000 <= Date.now()) {
        return renderOAuthCallbackHtml(false, 'state is invalid or expired; restart authorization')
      }
      await deps.ensureReady?.()
      const registry = new NodeRegistryStore(deps.state)
      let node: TreeNode
      try {
        node = await registry.get(payload.p)
      } catch {
        return renderOAuthCallbackHtml(false, 'target node no longer exists')
      }
      if (node.kind !== 'mcp' || node.config?.kind !== 'mcp' || node.config.auth !== 'oauth') {
        return renderOAuthCallbackHtml(false, 'target node is not an OAuth-backed mcp mount')
      }
      try {
        await finishMcpAuthorization({
          store: deps.state,
          encryptionKey: encKey,
          nodePath: payload.p,
          serverUrl: node.config.url,
          origin: deps.canonicalOrigin ?? new URL(c.req.url).origin,
          code,
          codeVerifier: payload.v,
          // 本地回调通道(CLI --local):兑换必须复用授权时的 redirect_uri。
          ...(payload.r !== undefined ? { redirectUri: payload.r } : {}),
        })
      } catch (err) {
        const detail = isTBError(err) ? err.message : 'token exchange failed'
        return renderOAuthCallbackHtml(false, detail)
      }
      return renderOAuthCallbackHtml(true, `mcp mount '${payload.p}' is now authorized`)
    }),
  )

  // 认证中间件(/healthz、/~ref、/~oauth/callback、/ui 静态资源之外全路由):Bearer → identify → 401 或注入 ctx。
  app.use('*', async (c, next) => {
    const store = deps.state
    try {
      await deps.ensureReady?.()
      const now = new Date().toISOString()
      const ctx = await identify(store, c.req.header('authorization'), now)
      if (!ctx) return tbErrorResponse(TBError.unauthenticated())
      c.set('store', store)
      c.set('ctx', ctx)
    } catch (err) {
      if (isTBError(err)) return tbErrorResponse(err)
      return tbErrorResponse(new TBError('internal', 'internal error'))
    }
    await next()
  })

  const mcpCommand = (
    nodePath: TreePath,
    nodeDescription: string,
    command: {
      confirm?: boolean
      effect?: string
      h?: string
      inputSchema?: unknown
      name: string
      path: string
      scope: Action
    },
  ): McpBridgeTool => {
    const modelPath = nodePath.replace(/^\/+|\/+$/g, '')
    const commandPath = command.path.replace(/^\/+|\/+$/g, '')
    if (commandPath !== modelPath && !commandPath.startsWith(`${modelPath}/`)) {
      throw new TBError('internal', `command path '${command.path}' escapes node '${nodePath}'`)
    }
    const invokePath = `/${commandPath}`
    const invokeWithEnvelope = commandPath === modelPath
    return {
      identity: mcpToolIdentity(invokePath, command.name, invokeWithEnvelope),
      sourcePath: nodePath,
      toolName: command.name,
      invokePath,
      invokeWithEnvelope,
      description: command.h ?? nodeDescription,
      ...(command.inputSchema !== undefined ? { inputSchema: command.inputSchema } : {}),
      ...(command.effect !== undefined ? { effect: command.effect } : {}),
      ...(command.confirm === true ? { confirm: true } : {}),
    }
  }

  const toolSpecCommand = (
    node: TreeNode,
    tool: ToolSpec,
    providerBacked = false,
  ): McpBridgeTool => {
    const path = `/${node.path}`
    return {
      identity: mcpToolIdentity(path, tool.name, true),
      sourcePath: node.path,
      toolName: tool.name,
      invokePath: path,
      invokeWithEnvelope: true,
      ...(providerBacked ? { providerBacked: true } : {}),
      description: tool.description ?? node.description,
      ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
      ...(tool.effect !== undefined ? { effect: tool.effect } : {}),
      ...(tool.confirm === true ? { confirm: true } : {}),
    }
  }

  /** Rebase a remote HelpJson command path onto its local federation mount. */
  const remoteCommand = (
    localNodePath: TreePath,
    model: HelpJson,
    command: HelpJson['cmds'][number],
  ): McpBridgeTool => {
    const remoteNodePath = model.node.path.replace(/^\/+|\/+$/g, '')
    const remoteCommandPath = command.path.replace(/^\/+|\/+$/g, '')
    if (
      remoteCommandPath !== remoteNodePath
      && !remoteCommandPath.startsWith(`${remoteNodePath}/`)
    ) {
      throw new TBError('unavailable', 'remote ~help returned a command outside its node')
    }
    const suffix = remoteCommandPath.slice(remoteNodePath.length)
    const directTool = suffix.startsWith('/')
    return mcpCommand(localNodePath, model.node.description, {
      ...command,
      // Tool-layer nodes retain the envelope entrypoint. It keeps authorization on the
      // node path instead of requiring callers to hold an exact scope for the tool suffix.
      path: directTool ? `/${localNodePath}` : `/${localNodePath}${suffix}`,
    })
  }

  const mcpBridgeFor = (c: AppContext): McpToolBridge => {
    const ctx = c.get('ctx')
    const registry = new NodeRegistryStore(c.get('store'))
    let remoteRequests = 0

    const controlTools = (): McpBridgeTool[] => [
      ...(globalSearchCapabilities().includes('search')
        ? [{
            identity: JSON.stringify(['control', 'search']),
            sourcePath: '',
            toolName: 'Search',
            invokePath: '/~search',
            invokeWithEnvelope: false,
            mcpName: 'tb_search',
            operation: 'search' as const,
            description: 'Search visible tools across the Tool Bridge tree.',
            effect: 'read',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                query: { type: 'string', minLength: 1 },
                mode: { type: 'string', enum: ['keyword', 'semantic'] },
                limit: { type: 'integer', minimum: 1, maximum: 200 },
                cursor: { type: 'string', minLength: 1 },
              },
              required: ['query'],
            },
          }]
        : []),
      {
        identity: JSON.stringify(['control', 'help']),
        sourcePath: '',
        toolName: 'Help',
        invokePath: '/~help',
        invokeWithEnvelope: false,
        mcpName: 'tb_help',
        operation: 'help',
        description: 'Describe a visible Tool Bridge node or one of its tools.',
        effect: 'read',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
            tool: { type: 'string', minLength: 1, pattern: '^[^/]+$' },
            format: { type: 'string', enum: ['json', 'markdown', 'dsl'] },
          },
        },
      },
      {
        identity: JSON.stringify(['control', 'list-nodes']),
        sourcePath: '',
        toolName: 'List',
        invokePath: '/~tree',
        invokeWithEnvelope: false,
        mcpName: 'tb_list_nodes',
        operation: 'listNodes',
        description: 'List the visible Tool Bridge node tree from a path.',
        effect: 'read',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
            depth: { type: 'integer', minimum: 0, maximum: MAX_TREE_DEPTH },
          },
        },
      },
    ]

    const takeRemoteRequest = (): void => {
      remoteRequests += 1
      if (remoteRequests > MCP_REMOTE_MAX_REQUESTS) {
        throw new TBError('unavailable', 'remote MCP discovery request budget exceeded', {
          retryable: false,
        })
      }
    }

    const remoteHelp = async (path: TreePath): Promise<HelpJson> => {
      takeRemoteRequest()
      const headers = new Headers(c.req.raw.headers)
      headers.set('accept', 'application/json')
      const response = await remotePassthroughIfMatch(
        c,
        ctx,
        registry,
        path,
        '~help',
        deps,
        headers,
      )
      if (response === null || !response.ok) {
        throw new TBError('unavailable', `remote ~help failed for '${path}'`, { retryable: true })
      }
      const model = (await response.json().catch(() => null)) as HelpJson | null
      if (model === null || !Array.isArray(model.cmds) || typeof model.node?.path !== 'string') {
        throw new TBError('unavailable', `remote ~help returned invalid JSON for '${path}'`)
      }
      const owner = await registry.resolve(path).catch(() => null)
      if (owner?.node.kind !== 'remote') {
        throw remoteProtocolError(`remote ~help path '${path}' lost its mount owner`)
      }
      const modelPath = canonicalRemotePath(model.node.path, true)
      if (modelPath !== owner.rest) {
        throw remoteProtocolError(`remote ~help path '${modelPath}' does not match request`)
      }
      for (const command of model.cmds) {
        if (!command.path.startsWith('/') || command.path.startsWith('//')) {
          throw remoteProtocolError(`remote ~help returned invalid command path '${command.path}'`)
        }
        const commandPath = canonicalRemotePath(command.path.slice(1), true)
        if (!remotePathWithin(modelPath, commandPath)) {
          throw remoteProtocolError(`remote ~help command '${command.path}' escapes its node`)
        }
      }
      return model
    }

    const remotePaths = async (root: TreePath): Promise<TreePath[]> => {
      const found: TreePath[] = []
      const seen = new Set<TreePath>()
      const pending: Array<{ depth: number, path: TreePath }> = [{ depth: 0, path: root }]
      while (pending.length > 0) {
        const current = pending.shift()
        if (current === undefined || seen.has(current.path)) continue
        const { depth, path } = current
        seen.add(path)
        if (!check(ctx, path, 'read').allow || !check(ctx, path, 'call').allow) continue
        const owner = await registry.resolve(path).catch(() => null)
        if (owner?.node.path !== root || owner.node.kind !== 'remote') continue
        if (found.length >= DEFAULT_MAX_NODES) {
          throw new TBError('unavailable', 'remote MCP discovery node budget exceeded', {
            retryable: false,
          })
        }
        found.push(path)
        takeRemoteRequest()
        const children = await remoteTreeChildren(c, ctx, registry, path, deps)
        if (children.length > 0 && depth >= MAX_TREE_DEPTH) {
          throw new TBError('unavailable', 'remote MCP discovery depth exceeded', {
            retryable: false,
          })
        }
        for (const child of children) {
          if (child.path.startsWith(`${root}/`) && !seen.has(child.path)) {
            pending.push({ path: child.path, depth: depth + 1 })
          }
        }
      }
      return found
    }

    const list = async (): Promise<McpBridgeTool[]> => {
      const now = new Date().toISOString()
      const nodes = await pruneExpiredContext(await registry.subtree(''), registry)
      const result: McpBridgeTool[] = controlTools()

      for (const node of nodes) {
        if (node.kind === 'directory') continue
        if (!check(ctx, node.path, 'read').allow) continue

        if (node.kind === 'remote') {
          for (const path of await remotePaths(node.path)) {
            const model = await remoteHelp(path)
            for (const command of model.cmds) {
              if (check(ctx, path, command.scope).allow) {
                let detailed = command
                if (command.inputSchema === undefined && command.path !== `/${model.node.path}`) {
                  const remoteNodePath = model.node.path.replace(/^\/+|\/+$/g, '')
                  const remoteCommandPath = command.path.replace(/^\/+|\/+$/g, '')
                  const detailPath = `${path}${remoteCommandPath.slice(remoteNodePath.length)}`
                  const detail = await remoteHelp(detailPath)
                  detailed = detail.cmds.find(item => item.name === command.name) ?? command
                }
                result.push(remoteCommand(path, model, detailed))
              }
            }
          }
          continue
        }

        const marker = deviceToolMarker(node)
        if (marker !== null) {
          if (check(ctx, node.path, 'call').allow) {
            result.push(...(marker.cmds ?? []).map(tool => toolSpecCommand(node, tool)))
          }
          continue
        }

        if (
          (node.kind === 'mcp' || node.kind === 'http' || node.kind === 'tool')
          && node.config !== undefined
        ) {
          if (!check(ctx, node.path, 'call').allow) continue
          const provider = await providerFor(node, ctx, deps)
          const raw = await upstreamTools(node, provider, deps, false, now)
          const { exposed } = virtualizeTools(node.virtualize, raw)
          result.push(...exposed.map(tool => toolSpecCommand(node, tool, true)))
          continue
        }

        const model = await helpModelFor(node, registry, ctx, builtinsOf(c.get('store')), deps, {
          refresh: false,
          now,
        })
        for (const command of model.cmds) {
          if (check(ctx, node.path, command.scope).allow) {
            result.push(mcpCommand(node.path, node.description, command))
          }
        }
      }
      return result
    }

    return {
      list,
      call: async (tool, args) => {
        const resultFromResponse = async (response: Response): Promise<{
          content: unknown
          isError?: boolean
        }> => {
          const text = await response.text()
          let value: unknown = text
          try {
            value = JSON.parse(text) as unknown
          } catch {
            // Text help/DSL results remain MCP text content.
          }
          return { content: value, ...(response.ok ? {} : { isError: true }) }
        }
        if (tool.operation !== undefined) {
          const rawPath = args.path ?? ''
          if (typeof rawPath !== 'string') {
            throw new TBError('invalid_argument', 'path must be a string')
          }
          const path = rawPath.replace(/^\/+|\/+$/g, '')
          const pathError = validatePath(path, { allowRoot: true })
          if (pathError !== null) throw pathError
          const segments = path === '' ? [] : path.split('/')
          if (segments.some(segment => segment === '.' || segment === '..')) {
            throw new TBError('invalid_argument', 'path contains a dot segment')
          }
          const encoded = segments.map(segment => encodeURIComponent(segment))
          const headers = new Headers({
            authorization: c.req.header('authorization') ?? '',
          })

          if (tool.operation === 'search') {
            headers.set('accept', 'application/json')
            headers.set('content-type', 'application/json')
            const opts = Object.fromEntries(
              ['mode', 'limit', 'cursor']
                .filter(key => args[key] !== undefined)
                .map(key => [key, args[key]]),
            )
            const response = await app.request(new Request(new URL('/~search', c.req.url), {
              method: 'POST',
              headers,
              body: JSON.stringify({
                query: args.query,
                ...(Object.keys(opts).length === 0 ? {} : { opts }),
              }),
            }))
            return await resultFromResponse(response)
          }

          if (tool.operation === 'help') {
            const detail = args.tool
            if (detail !== undefined) {
              if (path === '' || typeof detail !== 'string' || detail.includes('/')) {
                throw new TBError('invalid_argument', 'tool detail requires a node path and one segment')
              }
              encoded.push(encodeURIComponent(detail))
            }
            const format = args.format ?? 'json'
            headers.set('accept', format === 'json'
              ? 'application/json'
              : format === 'dsl' ? 'text/plain' : 'text/markdown')
            const prefix = encoded.length === 0 ? '' : `/${encoded.join('/')}`
            return await resultFromResponse(await app.request(new Request(
              new URL(`${prefix}/~help`, c.req.url),
              { headers },
            )))
          }

          headers.set('accept', 'application/json')
          const prefix = encoded.length === 0 ? '' : `/${encoded.join('/')}`
          const url = new URL(`${prefix}/~tree`, c.req.url)
          if (args.depth !== undefined) url.searchParams.set('depth', String(args.depth))
          return await resultFromResponse(await app.request(new Request(url, { headers })))
        }
        if (tool.providerBacked === true) {
          let node: TreeNode
          try {
            node = await registry.get(tool.sourcePath)
          } catch {
            throw TBError.notFound('not found')
          }
          if (!check(ctx, node.path, 'read').allow) throw TBError.notFound('not found')
          if (!check(ctx, node.path, 'call').allow) {
            throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
          }
          if (
            (node.kind !== 'mcp' && node.kind !== 'http' && node.kind !== 'tool')
            || node.config === undefined
          ) {
            throw TBError.notFound('not found')
          }
          const provider = await providerFor(node, ctx, deps)
          const raw = await upstreamTools(node, provider, deps, false, new Date().toISOString())
          const upstreamName = resolveUpstreamTool(node.virtualize, raw, tool.toolName)
          const result: ToolResult = await provider.call(upstreamName, args)
          return {
            content: result.contentBlocks ?? result.content,
            ...(result.isError === true ? { isError: true } : {}),
            ...(result.structuredContent !== undefined
              ? { structuredContent: result.structuredContent }
              : {}),
          }
        }
        const url = new URL(tool.invokePath, c.req.url)
        const headers = new Headers({
          'accept': 'application/json',
          'authorization': c.req.header('authorization') ?? '',
          'content-type': 'application/json',
        })
        const body = tool.invokeWithEnvelope
          ? { tool: tool.toolName, arguments: args }
          : args
        const response = await app.request(
          new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }),
        )
        return await resultFromResponse(response)
      },
    }
  }

  // MCP is an HTBP reserved control segment. Stateless serving keeps every request behind
  // the gateway's current Bearer identity instead of trusting isolate-local session state.
  // tools/list advertises the same freshness window the gateway's own upstream tool cache
  // already serves from, so client-side caching adds no staleness class we don't already have.
  app.all('/~mcp', c =>
    runHandler(async () => await handleMcpRequest(
      c.req.raw,
      deps.version,
      mcpBridgeFor(c),
      (deps.toolCacheTtlSec ?? TOOL_CACHE_TTL_DEFAULT) * 1000,
    )))

  // POST /~search is a root-only, authenticated protocol endpoint. The route remains absent
  // until a host injects a real keyword index and declares the matching capability.
  app.post('/~search', c =>
    runHandler(async () => {
      const search = deps.search
      const capabilities = globalSearchCapabilities()
      if (search === undefined || !capabilities.includes('search')) {
        throw TBError.notFound('no such path')
      }

      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new TBError('invalid_argument', 'body must be a JSON object')
      }
      const bodyKeys = Object.keys(body)
      if (bodyKeys.some(key => key !== 'query' && key !== 'opts')) {
        throw new TBError('invalid_argument', 'body only accepts query and opts')
      }
      if (typeof body.query !== 'string' || body.query.trim().length === 0) {
        throw new TBError('invalid_argument', 'query must be a non-empty string')
      }

      const rawOpts = body.opts
      if (
        rawOpts !== undefined
        && (rawOpts === null || typeof rawOpts !== 'object' || Array.isArray(rawOpts))
      ) {
        throw new TBError('invalid_argument', 'opts must be a JSON object')
      }
      const opts = (rawOpts ?? {}) as Record<string, unknown>
      if (Object.keys(opts).some(key => key !== 'mode' && key !== 'limit' && key !== 'cursor')) {
        throw new TBError('invalid_argument', 'opts only accepts mode, limit and cursor')
      }
      const mode = opts.mode ?? 'keyword'
      if (mode !== 'keyword' && mode !== 'semantic') {
        throw new TBError('invalid_argument', 'opts.mode must be \'keyword\' or \'semantic\'')
      }
      if (mode === 'semantic' && !capabilities.includes('search:semantic')) {
        throw new TBError(
          'invalid_argument',
          'search mode \'semantic\' requires capability \'search:semantic\'',
        )
      }
      const limit = normalizeToolSearchLimit(opts.limit)
      if (opts.cursor !== undefined && typeof opts.cursor !== 'string') {
        throw new TBError('invalid_argument', 'opts.cursor must be a string')
      }
      const query = body.query.trim()
      await searchSync?.ensureReady()
      const ctx = c.get('ctx')
      const registry = new NodeRegistryStore(c.get('store'))
      const selected: Array<{ candidate: ToolSearchCandidate, node: TreeNode }> = []
      const workLimit = Math.min(
        TOOL_SEARCH_WORK_LIMIT,
        Math.max(TOOL_SEARCH_BATCH_LIMIT, limit * 2),
      )
      let scanCursor = opts.cursor as string | undefined
      let responseCursor: string | undefined
      let responseCandidate: ToolSearchCandidate | undefined
      let scanned = 0
      let stopped = false
      while (!stopped && selected.length < limit && scanned < workLimit) {
        const batchLimit = Math.min(TOOL_SEARCH_BATCH_LIMIT, workLimit - scanned)
        const page = await search.search(query, {
          mode,
          limit: batchLimit,
          ...(scanCursor === undefined ? {} : { cursor: scanCursor }),
        })
        if (page.items.length === 0) {
          responseCursor = page.cursor
          break
        }
        const nodes = await registry.getMany(page.items.map(candidate => candidate.path))
        for (const [index, candidate] of page.items.entries()) {
          scanned++
          if (
            !check(ctx, candidate.path, 'read').allow
            || !check(ctx, candidate.path, 'call').allow
          ) {
            continue
          }
          const node = nodes.get(candidate.path)
          if (
            node === undefined
            || (node.kind !== 'mcp' && node.kind !== 'http' && node.kind !== 'tool')
            || node.config?.kind !== node.kind
            || virtualizeTools(node.virtualize, [{ name: candidate.name }]).exposed.length === 0
          ) {
            continue
          }
          selected.push({ candidate, node })
          if (selected.length === limit) {
            const hasUnscanned = index < page.items.length - 1 || page.cursor !== undefined
            responseCandidate = hasUnscanned ? candidate : undefined
            responseCursor = undefined
            stopped = true
            break
          }
        }
        if (stopped) break
        responseCursor = page.cursor
        if (page.cursor === undefined) break
        scanCursor = page.cursor
      }

      const canonicalTools = await canonicalSearchTools(
        c.get('store'),
        selected.map(item => item.node),
      )
      const items: Array<{ path: TreePath, tool: ToolSpec }> = []
      let pageBytes = 0
      for (const [index, selectedItem] of selected.entries()) {
        const raw = canonicalTools.get(selectedItem.candidate.path)
          ?.find(tool => tool.name === selectedItem.candidate.name)
        if (raw === undefined) continue
        const tool = virtualizeTools(selectedItem.node.virtualize, [raw]).exposed[0]
        if (tool === undefined) continue
        const item = { path: selectedItem.candidate.path, tool }
        const itemBytes = new TextEncoder().encode(JSON.stringify(item)).length
        if (pageBytes + itemBytes > TOOL_SEARCH_PAGE_BYTES) {
          if (items.length === 0) {
            throw new TBError('internal', '工具搜索页面字节预算无法容纳首个结果')
          }
          responseCandidate = selected[index - 1]?.candidate
          responseCursor = undefined
          break
        }
        items.push(item)
        pageBytes += itemBytes
      }
      if (responseCandidate !== undefined) {
        responseCursor = await search.cursorFor(query, responseCandidate, mode)
      }
      // deny==not_found：空可见页不返回 continuation，避免 cursor 存在性泄露隐藏命中量。
      if (items.length === 0) responseCursor = undefined
      const result = responseCursor === undefined ? { items } : { items, cursor: responseCursor }
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': contentTypeFor('json') },
      })
    }),
  )

  // WS /system/device/ws?deviceId=<id> → 设备通道宿主(CF:每 deviceId 一个 DeviceSession DO)。
  // deviceId 同时在 hello 帧中出现;通道侧会校验二者一致,以满足设备帧契约。
  app.get('/system/device/ws', c =>
    runHandler(async () => {
      const device = requireDevice(deps)
      if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
        throw new TBError('invalid_argument', 'device ws requires WebSocket upgrade')
      }
      const deviceId = c.req.query('deviceId')
      if (!deviceId) throw new TBError('invalid_argument', 'deviceId query is required')
      return await device.ws(deviceId, c.req.raw)
    }),
  )

  // --- ~tree(根级与子树)---
  const handleTree = async (c: AppContext): Promise<Response> => {
    const path = splitReserved(new URL(c.req.url).pathname, '~tree')
    if (path === null) throw TBError.notFound('no such path')
    const ctx = c.get('ctx')
    const store = c.get('store')
    // 根路径('')免 read 判定(整棵树入口);非根节点需 (path,'read')。
    if (path !== '' && !check(ctx, path, 'read').allow) throw TBError.notFound('not found')
    const registry = new NodeRegistryStore(store)

    // remote 透传:非根路径命中 remote 节点(或其后代)→ 改写 ~tree 打到 baseUrl,
    // 远端返回的子树作为响应(query 如 ?depth 一并带过去)。
    if (path !== '') {
      const remote = await remotePassthroughIfMatch(c, ctx, registry, path, '~tree', deps)
      if (remote) return remote
    }

    // 子树根必须真实存在(否则 ~tree 可伪造任意根)。非根 path 不存在 → 404;
    // 存在则以真实节点元数据作 rootEntry(kind/description/online),不再伪造为 directory。
    let rootEntry: TreeEntry | undefined
    if (path !== '') {
      let rootNode: TreeNode
      try {
        rootNode = await registry.get(path)
      } catch {
        throw TBError.notFound('not found')
      }
      // 子树根本身是 ttl 到期的 context 节点 → 懒回收 + 404。
      if (rootNode.kind === 'context' && rootNode.config?.kind === 'context') {
        await assertContextAlive(rootNode, rootNode.config, registry)
      }
      rootEntry = toEntry(rootNode)
    }

    // 一次性读入整棵子树(而非每层递归各扫一遍),内存建 parent→直接子 索引 + 可见性裁剪。
    const nodes = await pruneExpiredContext(await registry.subtree(path), registry)
    const byParent = indexByParent(nodes)
    const getChildren = async (p: TreePath): Promise<TreeEntry[]> => {
      const localKids = filterListVisible(byParent.get(p) ?? [], ctx.scopes)
      const remoteKids = await remoteTreeChildren(c, ctx, registry, p, deps)
      return [...localKids.map(n => toEntry(n)), ...remoteKids]
    }

    const depth = clampDepth(Number(c.req.query('depth')))
    const tree = await buildTree({
      root: path,
      depth,
      getChildren,
      // remote 节点在深度边界免 fetch 探测,直接标 truncated(消除聚合树里对 remote 的边界远端往返)。
      opaqueKinds: REMOTE_OPAQUE_KINDS,
      ...(rootEntry !== undefined ? { rootEntry } : {}),
    })
    const rep = negotiate(c.req.header('accept'))
    if (rep === 'json') {
      return new Response(JSON.stringify(tree), {
        headers: { 'content-type': contentTypeFor('json') },
      })
    }
    if (rep === 'dsl') {
      return new Response(renderTreeDsl(tree), {
        headers: { 'content-type': contentTypeFor('dsl') },
      })
    }
    // markdown(默认):缩进树本身就是文本,包 code fence 防 markdown 渲染吞掉缩进。
    return new Response(`\`\`\`text\n${renderTreeDsl(tree)}\`\`\`\n`, {
      headers: { 'content-type': contentTypeFor('markdown') },
    })
  }

  // --- ~help(根级与节点)---
  const handleHelp = async (c: AppContext): Promise<Response> => {
    const path = splitReserved(new URL(c.req.url).pathname, '~help')
    if (path === null) throw TBError.notFound('no such path')
    const ctx = c.get('ctx')
    const store = c.get('store')
    const registry = new NodeRegistryStore(store)
    const rep = negotiate(c.req.header('accept'))

    if (path === '') {
      // 根:虚拟 directory,列出可见的顶层子节点。
      const children = filterListVisible(
        await pruneExpiredContext(await registry.children(''), registry),
        ctx.scopes,
      )
      const model: HelpModel = {
        node: { path: '', kind: 'directory', description: 'tool-bridge root' },
        cmds: [],
        children: children.map(n => ({ path: n.path, kind: n.kind, description: n.description })),
        hint: 'GET /<child-path>/~help describes a child node; GET /~tree?depth=N shows the subtree. Every path also serves ~feedback: GET /<path>/~feedback lists pitfalls other agents hit — check it before using a tool; POST /<path>/~feedback {"title","detail"} to share your own',
      }
      return renderHelp(await enrichHelp(model, '', store), rep)
    }

    // 不可见(read 判不过)→ 404 不泄露存在性(v1 教训:deny==not_found)。
    if (!check(ctx, path, 'read').allow) throw TBError.notFound('not found')

    // remote 透传:命中 remote 节点(或其后代)→ 改写 ~help 打到 baseUrl。
    const remote = await remotePassthroughIfMatch(c, ctx, registry, path, '~help', deps)
    if (remote) return remote

    let node: TreeNode
    try {
      node = await registry.get(path)
    } catch {
      // 非注册路径:尝试工具级 ~help(两级披露)——最长前缀命中 mcp/http 节点
      // 且剩余恰一段(工具虚拟名)→ 单工具全量 spec(命中同一 toolcache,不额外打上游)。
      const toolModel = await toolHelpModelFor(c, ctx, registry, path, deps)
      if (toolModel !== null) return renderHelp(await enrichHelp(toolModel, path, store), rep)
      throw TBError.notFound('not found')
    }
    const builtins = builtinsOf(store)
    const refresh = c.req.query('refresh') === '1'
    const model = await helpModelFor(node, registry, ctx, builtins, deps, {
      refresh,
      now: new Date().toISOString(),
    })
    return renderHelp(await enrichHelp(model, path, store), rep)
  }

  // --- POST /<path> 数据面调用 ---
  const handleInvoke = async (c: AppContext): Promise<Response> => {
    const rawEncoded = new URL(c.req.url).pathname.replace(/^\/+|\/+$/g, '')
    if (rawEncoded === '') throw TBError.notFound('no such path')
    const raw = decodePath(rawEncoded)
    if (raw.split('/').some(s => s.startsWith('~'))) throw TBError.notFound('no such path')
    const ctx = c.get('ctx')
    const store = c.get('store')
    const registry = new NodeRegistryStore(store)

    // 节点不可见 → 404(隐藏存在性)。
    if (!check(ctx, raw, 'read').allow) throw TBError.notFound('not found')

    // remote 透传:命中 remote 节点(或其后代)→ 改写 POST 打到 baseUrl(scope 恒 'call')。
    const remote = await remotePassthroughIfMatch(c, ctx, registry, raw, null, deps)
    if (remote) return remote

    let node: TreeNode
    // 直连工具路径(POST /<node>/<tool>)命中时为工具虚拟名;body 即 arguments 本体。
    let directTool: string | null = null
    try {
      node = await registry.get(raw)
    } catch {
      // 非注册路径:最长前缀命中 mcp/http/tool 节点且剩余恰一段 → 直连工具调用
      // (与工具级 ~help 同一路径面);其余 404。可见性按节点 path 复判
      // (raw 含工具段,scope 精确到节点路径时会漏判)。
      const resolved = await registry.resolve(raw).catch(() => null)
      if (
        resolved === null
        || (resolved.node.kind !== 'mcp'
          && resolved.node.kind !== 'http'
          && resolved.node.kind !== 'tool')
        || resolved.node.config === undefined
        || resolved.rest === ''
        || resolved.rest.includes('/')
      ) {
        throw TBError.notFound('not found')
      }
      if (!check(ctx, resolved.node.path, 'read').allow) throw TBError.notFound('not found')
      node = resolved.node
      directTool = resolved.rest
    }

    // 解析调用体:直连路径 body 即 arguments(可空);节点路径沿用 {tool,arguments} 信封。
    const readInvokeBody = async (): Promise<{
      args: Record<string, unknown>
      tool: string
    }> => {
      const parsed = (await c.req.json().catch(() => null)) as unknown
      if (directTool !== null) {
        if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
          throw new TBError('invalid_argument', 'body must be a JSON object (tool arguments)')
        }
        return { tool: directTool, args: (parsed ?? {}) as Record<string, unknown> }
      }
      const body = parsed as { arguments?: unknown, tool?: unknown } | null
      if (!body || typeof body.tool !== 'string') {
        throw new TBError('invalid_argument', 'body must be {tool, arguments}')
      }
      return { tool: body.tool, args: (body.arguments ?? {}) as Record<string, unknown> }
    }

    // --- device 自定义 tool 节点:providerConfig 标记 → 帧协议 call 转发。 ---
    // 须先于 mcp/http/tool 通用分支:provider 是设备本地保留 id(如 '@local'),不是 plugin。
    const toolMarker = deviceToolMarker(node)
    if (toolMarker !== null) {
      if (!check(ctx, node.path, 'call').allow) {
        throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
      }
      const { tool, args } = await readInvokeBody()
      const result = await invokeDevice(deps, toolMarker.deviceId, {
        path: relativeDevicePath(node.path, toolMarker.mountPath),
        tool,
        arguments: args,
      })
      return renderResult(result, negotiate(c.req.header('accept')))
    }

    // --- mcp/http/tool 上游工具调用:scope 恒 'call';虚拟名反查上游真名再调 Provider。 ---
    if (
      (node.kind === 'mcp' || node.kind === 'http' || node.kind === 'tool')
      && node.config !== undefined
    ) {
      if (!check(ctx, node.path, 'call').allow) {
        throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
      }
      const { tool, args } = await readInvokeBody()
      const provider = await providerFor(node, ctx, deps)
      const tools = await upstreamTools(node, provider, deps, false, new Date().toISOString())
      const upstreamName = resolveUpstreamTool(node.virtualize, tools, tool)
      const result = await provider.call(upstreamName, args)
      // MCP RPC 业务错误(result.isError)是正常返回值(HTTP 200),按协商渲染其 content。
      return renderResult(result.content, negotiate(c.req.header('accept')))
    }

    // --- device shell 调用:节点级 read/call 后转发到设备通道。 ---
    if (node.kind === 'device' && node.config?.kind === 'device') {
      if (!check(ctx, node.path, 'call').allow) {
        throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
      }
      const body = (await c.req.json().catch(() => null)) as {
        arguments?: unknown
        tool?: unknown
      } | null
      if (!body || typeof body.tool !== 'string') {
        throw new TBError('invalid_argument', 'body must be {tool, arguments}')
      }
      if (body.tool !== 'exec') {
        throw new TBError('invalid_argument', `unknown cmd '${body.tool}' on '${node.path}'`)
      }
      const result = await invokeDevice(deps, node.config.deviceId, {
        path: 'shell',
        tool: body.tool,
        arguments: (body.arguments ?? {}) as Record<string, unknown>,
      })
      return renderResult(result, negotiate(c.req.header('accept')))
    }

    // --- context namespace 数据面:四动词 + Search/Delete,cmd→scope 静态表判定。 ---
    if (node.kind === 'context' && node.config?.kind === 'context') {
      const cfg = node.config
      // ttl 懒回收:POST 命中即判,过期删节点并 404。
      await assertContextAlive(node, cfg, registry)
      const body = (await c.req.json().catch(() => null)) as {
        arguments?: unknown
        tool?: unknown
      } | null
      if (!body || typeof body.tool !== 'string') {
        throw new TBError('invalid_argument', 'body must be {tool, arguments}')
      }
      const scope = contextScopeForCmd(body.tool)
      if (scope === null) {
        throw new TBError('invalid_argument', `unknown cmd '${body.tool}' on '${node.path}'`)
      }
      // 节点可见性(read→404)已在上方统一判过;这里按 cmd 的 read/write scope 判 403。
      if (!check(ctx, node.path, scope).allow) {
        throw new TBError('permission_denied', `no scope grants '${scope}' on '${node.path}'`)
      }
      // readOnly 挂载对写动词直接拒(provider 内亦拒,双保险)。
      if (cfg.readOnly === true && scope === 'write') {
        throw new TBError('permission_denied', `readOnly 挂载拒绝 '${body.tool}'`)
      }
      const args = (body.arguments ?? {}) as Record<string, unknown>
      if (cfg.provider === 'device-fs') {
        const result = await invokeDevice(deps, deviceIdForDeviceFs(cfg), {
          path: 'fs',
          tool: body.tool,
          arguments: args,
        })
        return renderResult(result, negotiate(c.req.header('accept')))
      }
      // device 自定义 context 节点:标记命中 → 相对路径转发到设备。
      const contextMarker = deviceMarkerOf(cfg.providerConfig)
      if (cfg.provider !== 'r2' && cfg.provider !== 's3' && contextMarker !== null) {
        const result = await invokeDevice(deps, contextMarker.deviceId, {
          path: relativeDevicePath(node.path, contextMarker.mountPath),
          tool: body.tool,
          arguments: args,
        })
        return renderResult(result, negotiate(c.req.header('accept')))
      }
      if (cfg.provider !== 'r2' && cfg.provider !== 's3') {
        // SDK 进程内 context Provider(registerContext):按节点路径查本实例表。
        const local = localContext(deps, node)
        if (local !== null) {
          const result = await dispatchContextCmd(local, body.tool, args)
          return renderResult(result, negotiate(c.req.header('accept')))
        }
        // plugin-backed context:provider 非 r2/s3 视为 plugin id,
        // 经 envelope 转发;plugin 不存在/禁用/kind 不符 → invalid_argument。
        const { manifest, export: exported } = await requirePluginExport(
          store,
          cfg.provider,
          'context',
          'context',
          cfg.export,
        )
        const provider = createPluginContextProvider({
          manifest,
          secrets: deps.secrets,
          ctx: mountCallContext(ctx, node.path, cfg.providerConfig, exported.id),
          capabilities: exported.capabilities ?? [],
          ...(exported.methods !== undefined ? { methods: exported.methods } : {}),
          // 挂载 authRef = 上游凭证引用,平台代解析经 X-TB-Upstream-Auth 注入。
          ...(cfg.authRef !== undefined ? { upstreamAuthRef: cfg.authRef } : {}),
          ...(deps.pluginBindings !== undefined ? { bindings: deps.pluginBindings } : {}),
        })
        const result = await dispatchContextCmd(provider, body.tool, args)
        return renderResult(result, negotiate(c.req.header('accept')))
      }
      const provider = await contextProviderFor(node, cfg, deps, c.req.url)
      const result = await dispatchContextCmd(provider, body.tool, args)
      return renderResult(result, negotiate(c.req.header('accept')))
    }

    // --- skillhub 数据面:List/Get/Search(read)+ Publish/Remove(write)。 ---
    if (node.kind === 'skillhub' && node.config?.kind === 'skillhub') {
      const cfg = node.config
      // ttl 懒回收:POST 命中即判,过期删节点并 404。
      await assertContextAlive(node, cfg, registry)
      const body = (await c.req.json().catch(() => null)) as {
        arguments?: unknown
        tool?: unknown
      } | null
      if (!body || typeof body.tool !== 'string') {
        throw new TBError('invalid_argument', 'body must be {tool, arguments}')
      }
      const scope = skillhubScopeForCmd(body.tool)
      if (scope === null) {
        throw new TBError('invalid_argument', `unknown cmd '${body.tool}' on '${node.path}'`)
      }
      // 节点可见性(read→404)已统一判过;这里按 cmd 的 read/write scope 判 403。
      if (!check(ctx, node.path, scope).allow) {
        throw new TBError('permission_denied', `no scope grants '${scope}' on '${node.path}'`)
      }
      if (cfg.readOnly === true && scope === 'write') {
        throw new TBError('permission_denied', `readOnly 挂载拒绝 '${body.tool}'`)
      }
      const args = (body.arguments ?? {}) as Record<string, unknown>
      const provider = await skillhubProviderFor(node, cfg, deps, c.req.url)
      const result = await dispatchSkillhubCmd(provider, body.tool, args)
      return renderResult(result, negotiate(c.req.header('accept')))
    }

    if (node.kind !== 'builtin' || node.config?.kind !== 'builtin') {
      throw TBError.unimplemented(`kind '${node.kind}' not callable`)
    }

    const builtins = builtinsOf(store)
    const mod = builtins.get(node.config.module)
    if (!mod) throw TBError.unimplemented(`builtin module '${node.config.module}' not available`)

    const body = (await c.req.json().catch(() => null)) as {
      arguments?: unknown
      tool?: unknown
    } | null
    if (!body || typeof body.tool !== 'string') {
      throw new TBError('invalid_argument', 'body must be {tool, arguments}')
    }
    const cmd = body.tool
    const args = (body.arguments ?? {}) as Record<string, unknown>

    const spec = scopeForCmd(mod, node.path, cmd)
    if (!spec) throw new TBError('invalid_argument', `unknown cmd '${cmd}' on '${node.path}'`)

    // 按 cmd 声明的 scope 判定(资源 = 节点 path)。
    if (!check(ctx, node.path, spec.scope).allow) {
      throw new TBError('permission_denied', `no scope grants '${spec.scope}' on '${node.path}'`)
    }

    // registry 模块的 write/update/delete 额外过注册路径规则(资源 = arguments.path)。
    let registryTarget: string | undefined
    if (node.config.module === 'registry' && ['write', 'update', 'delete'].includes(cmd)) {
      const targetPath = typeof args.path === 'string' ? args.path : undefined
      if (targetPath === undefined) {
        throw new TBError('invalid_argument', 'field \'path\' must be a string')
      }
      // 挂载/更新 remote 节点时校验 baseUrl 白名单(注册时即拒)。
      const cfgPatch
        = cmd === 'write'
          ? args.config
          : cmd === 'update'
            ? (args.patch as { config?: unknown } | undefined)?.config
            : undefined
      // 挂载/更新 remote 节点时校验 baseUrl 白名单(注册时即拒;env 基线 ∪ 运行时条目)。
      assertRemoteConfigAllowed(cfgPatch, await resolveRemoteSettings(store, deps.remote))
      await assertRegisterPath(
        registry,
        ctx,
        targetPath,
        cmd === 'delete' ? 'delete' : 'write',
        deps,
      )
      // Secret Reference 使用授权:绑定 authRef/skRef 须持 system/secret admin(注册路径
      // 判定之后、落库之前;delete 无 config 自然放行)。confused-deputy 合入阻断项。
      assertSecretRefUse(ctx.scopes, cfgPatch)
      // context 配置校验 + s3 连通探测:探测出站网络,须在权限判定之后。
      await assertContextConfig(cfgPatch, deps)
      // skillhub 配置校验(provider r2/s3;s3 连通探测)。
      await assertSkillhubConfig(cfgPatch, deps)
      // kind:'tool' 挂载校验:provider 必须是已注册且启用的 tool-provider plugin。
      await assertToolConfig(cfgPatch, store)
      registryTarget = targetPath
    }
    if (registryTarget !== undefined && (cmd === 'write' || cmd === 'update')) {
      await searchSync?.ensureSeeded()
    }

    let pluginMounts: Array<{ marker?: SearchDirtyMarker, node: TreeNode }> = []
    if (node.config.module === 'plugin' && ['write', 'update', 'delete'].includes(cmd)) {
      const pluginId = typeof args.id === 'string' ? args.id : undefined
      if (pluginId !== undefined) {
        const mounts = (await registry.subtree('')).filter(candidate => (
          candidate.kind === 'tool'
          && candidate.config?.kind === 'tool'
          && candidate.config.provider === pluginId
        ))
        pluginMounts = await Promise.all(mounts.map(async candidate => ({
          marker: await searchSync?.markNode(candidate.path),
          node: candidate,
        })))
      }
    }

    const registryMarker = registryTarget === undefined
      ? undefined
      : await searchSync?.markNode(registryTarget)
    let result: unknown
    try {
      result = await mod.dispatch(cmd, args, ctx)
    } catch (error) {
      await searchSync?.abort(registryMarker)
      await Promise.all(pluginMounts.map(async mount => await searchSync?.abort(mount.marker)))
      if (isTBError(error)) return tbErrorResponse(error)
      return tbErrorResponse(new TBError('internal', 'internal error'))
    }
    // 注册变更 → 失效该节点工具缓存 + mcp 会话/OAuth 缓存(Write/Update/Delete 触发失效)。
    if (registryTarget !== undefined) {
      await invalidateToolCache(store, registryTarget)
      await invalidateMcpEra(store, registryTarget)
      await invalidateMcpOAuth(store, registryTarget)
      await searchSync?.reconcileNodeQuietly(registryTarget, { marker: registryMarker })
      const current = await registry.get(registryTarget).catch(() => null)
      if (current !== null && await refreshDynamicSearchNode(current, ctx, deps)) {
        await searchSync?.abort(registryMarker)
      }
    }
    const pluginEmptyPaths: TreePath[] = []
    for (const mount of pluginMounts) {
      await invalidateToolCache(store, mount.node.path)
      await invalidateMcpEra(store, mount.node.path)
      await invalidateMcpOAuth(store, mount.node.path)
      const providerId = mount.node.config?.kind === 'tool'
        ? mount.node.config.provider
        : ''
      const manifest = await store.get(KEY_PLUGIN + providerId)
      if (
        manifest !== null
        && (manifest as PluginManifest).enabled !== false
      ) {
        try {
          await refreshDynamicToolCache(mount.node, ctx, deps)
        } catch {
          // Marker remains pending; canonical plugin mutation is already durable.
        }
      } else {
        pluginEmptyPaths.push(mount.node.path)
        await searchSync?.reconcileNodeQuietly(mount.node.path, {
          marker: mount.marker,
          tools: [],
        })
      }
    }
    if (pluginMounts.length > 0) {
      await searchSync?.rebuildAll(
        pluginMounts.flatMap(mount => mount.marker === undefined ? [] : [mount.marker]),
        { authoritativeEmpty: pluginEmptyPaths },
      )
    }
    return renderResult(result, negotiate(c.req.header('accept')))
  }

  // --- ~skill:remote 透传;本地占位 501 ---
  const handleSkill = async (c: AppContext): Promise<Response> => {
    const path = splitReserved(new URL(c.req.url).pathname, '~skill')
    if (path === null) throw TBError.notFound('no such path')
    const ctx = c.get('ctx')
    const store = c.get('store')
    const registry = new NodeRegistryStore(store)
    if (path !== '') {
      const remote = await remotePassthroughIfMatch(c, ctx, registry, path, '~skill', deps)
      if (remote) return remote
    }
    return tbErrorResponse(TBError.unimplemented('~skill not implemented yet'))
  }

  // --- ~describe:有可选能力的节点返回 { kind, capabilities };其余 404 ---
  const handleDescribe = async (c: AppContext): Promise<Response> => {
    const path = splitReserved(new URL(c.req.url).pathname, '~describe')
    if (path === null) throw TBError.notFound('no such path')
    if (path === '') {
      const capabilities = globalSearchCapabilities()
      if (capabilities.length === 0) throw TBError.notFound('no such path')
      return new Response(JSON.stringify({ kind: 'directory', capabilities }), {
        headers: { 'content-type': contentTypeFor('json') },
      })
    }
    const ctx = c.get('ctx')
    const store = c.get('store')
    const registry = new NodeRegistryStore(store)
    // 不可见(read 判不过)→ 404 不泄露存在性。
    if (!check(ctx, path, 'read').allow) throw TBError.notFound('not found')
    let node: TreeNode
    try {
      node = await registry.get(path)
    } catch {
      throw TBError.notFound('not found')
    }
    if (node.kind === 'context' && node.config?.kind === 'context') {
      await assertContextAlive(node, node.config, registry)
      // plugin-backed 节点回注册时抓取缓存的 capabilities(Q12);内置 provider 与
      // device 自定义 context 节点(带转发标记)回固定表;
      // SDK 进程内 Provider 按可选方法实现存在性推导。
      const cfg = node.config
      const local = cfg.provider !== 'r2' && cfg.provider !== 's3' ? localContext(deps, node) : null
      const capabilities
        = cfg.provider === 'r2'
          || cfg.provider === 's3'
          || cfg.provider === 'device-fs'
          || deviceMarkerOf(cfg.providerConfig) !== null
          ? CONTEXT_CAPABILITIES
          : local !== null
            ? localCapabilities(local)
            : (
                await requirePluginExport(store, cfg.provider, 'context', 'context', cfg.export)
              ).export.capabilities ?? []
      return new Response(JSON.stringify({ kind: 'context', capabilities }), {
        headers: { 'content-type': contentTypeFor('json') },
      })
    }
    if (node.kind === 'skillhub' && node.config?.kind === 'skillhub') {
      await assertContextAlive(node, node.config, registry)
      return new Response(
        JSON.stringify({ kind: 'skillhub', capabilities: SKILLHUB_CAPABILITIES }),
        { headers: { 'content-type': contentTypeFor('json') } },
      )
    }
    // 无可选能力的节点(其他 kind)→ 404。
    throw TBError.notFound(`no capabilities for kind '${node.kind}'`)
  }

  // --- ~feedback(保留段:per-path Agent 反馈,一级协议能力)---
  // 权限判定落在目标 path 本身(而非集中管理节点):窄 scope SK(如仅 feishu/**)对
  // 自己够得着的路径天然可读/可反馈。read 判不过 → 404 不泄露存在性(与 ~help 同则)。
  // 排序/阈值/防刷在 core FeedbackStore;~help 默认区块经 enrichHelp 注入。

  /** 反馈条目的线上视图:投票人集合不外露,只回计数与净分。 */
  const feedbackJson = (value: unknown): Response =>
    new Response(JSON.stringify(value), { headers: { 'content-type': contentTypeFor('json') } })

  // GET /<path>/~feedback → 列表(?hidden=1 含净分 ≤ 阈值的隐藏条目);GET .../~feedback/<id> → 单条详情。
  const handleFeedbackGet = async (c: AppContext): Promise<Response> => {
    const target = splitFeedback(new URL(c.req.url).pathname)
    if (target === null || target.path === '') throw TBError.notFound('no such path')
    const ctx = c.get('ctx')
    if (!check(ctx, target.path, 'read').allow) throw TBError.notFound('not found')
    const fb = new FeedbackStore(c.get('store'))
    if (target.id !== undefined) {
      const e = await fb.get(target.path, target.id)
      return feedbackJson({
        id: e.id,
        path: target.path,
        title: e.title,
        detail: e.detail,
        by: e.by,
        at: e.at,
        up: e.up.length,
        down: e.down.length,
        score: e.up.length - e.down.length,
      })
    }
    const views = await fb.listViews(target.path)
    const items
      = c.req.query('hidden') === '1' ? views : views.filter(v => v.score > FEEDBACK_HIDE_SCORE)
    return feedbackJson({ items })
  }

  // POST /<path>/~feedback {title,detail} → 提交;POST .../~feedback/<id> {vote} → 投票(每身份一票,可改票)。
  const handleFeedbackPost = async (c: AppContext): Promise<Response> => {
    const target = splitFeedback(new URL(c.req.url).pathname)
    if (target === null || target.path === '') throw TBError.notFound('no such path')
    const ctx = c.get('ctx')
    const store = c.get('store')
    if (!check(ctx, target.path, 'read').allow) throw TBError.notFound('not found')
    if (!check(ctx, target.path, 'call').allow) {
      throw new TBError('permission_denied', `no scope grants 'call' on '${target.path}'`)
    }
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    if (body === null || typeof body !== 'object') {
      throw new TBError('invalid_argument', 'body must be a JSON object')
    }
    const marker = await searchSync?.markNode(target.path)
    try {
      const fb = new FeedbackStore(store, async (path, entries) => {
        await searchSync?.reconcileNodeQuietly(path, { feedback: entries, marker })
      })
      if (target.id !== undefined) {
        const vote = body.vote
        if (vote !== 'up' && vote !== 'down' && vote !== 'clear') {
          throw new TBError('invalid_argument', `body.vote must be 'up' | 'down' | 'clear'`)
        }
        return feedbackJson(await fb.vote(target.path, target.id, ctx.owner, vote))
      }
      if (typeof body.title !== 'string' || typeof body.detail !== 'string') {
        throw new TBError('invalid_argument', 'body must be { title: string, detail: string }')
      }
      // path 须挂在真实节点(或其工具子路径)下,防悬空路径积垃圾。
      await new NodeRegistryStore(store).resolve(target.path)
      const entry = await fb.submit(
        target.path,
        { title: body.title, detail: body.detail },
        ctx.owner,
        new Date().toISOString(),
      )
      return feedbackJson({ id: entry.id, path: target.path, title: entry.title, at: entry.at })
    } catch (error) {
      await searchSync?.abort(marker)
      throw error
    }
  }

  // DELETE /<path>/~feedback/<id> → 管理面清理(admin)。
  const handleFeedbackDelete = async (c: AppContext): Promise<Response> => {
    const target = splitFeedback(new URL(c.req.url).pathname)
    if (target === null || target.path === '' || target.id === undefined) {
      throw TBError.notFound('no such path')
    }
    const ctx = c.get('ctx')
    if (!check(ctx, target.path, 'read').allow) throw TBError.notFound('not found')
    if (!check(ctx, target.path, 'admin').allow) {
      throw new TBError('permission_denied', `no scope grants 'admin' on '${target.path}'`)
    }
    const marker = await searchSync?.markNode(target.path)
    try {
      await new FeedbackStore(c.get('store'), async (path, entries) => {
        await searchSync?.reconcileNodeQuietly(path, { feedback: entries, marker })
      }).remove(target.path, target.id)
    } catch (error) {
      await searchSync?.abort(marker)
      throw error
    }
    return feedbackJson({ ok: true })
  }

  // GET 通配分派:按 pathname 末段路由到 ~help / ~tree / ~skill;其余 GET 无对应端点 → 404。
  // (不用 `/:path{.*}/~help` 具名后缀路由——Hono 该形式对 3+ 段路径不匹配。)
  // handleX(c) 必须 `await`(而非裸 `return handleX(c)`):裸返回 async promise 时其 reject
  // 会在链接那一 tick 被 workerd 误报为 unhandled,即便 runHandler 最终 catch。
  app.get('/*', c =>
    runHandler(async () => {
      const segs = new URL(c.req.url).pathname.replace(/\/+$/, '').split('/')
      const last = segs.pop() ?? ''
      if (last === '~help') return await handleHelp(c)
      if (last === '~tree') return await handleTree(c)
      if (last === '~skill') return await handleSkill(c)
      if (last === '~describe') return await handleDescribe(c)
      // ~feedback 是末段(列表)或倒数第二段(详情);更深嵌套由 splitFeedback 判 404。
      if (last === '~feedback' || segs[segs.length - 1] === '~feedback') {
        return await handleFeedbackGet(c)
      }
      throw TBError.notFound('no such path')
    }),
  )

  // DELETE 通配分派:仅 ~feedback 详情(管理面清理);其余 DELETE 无对应端点 → 404。
  app.delete('/*', c =>
    runHandler(async () => {
      const segs = new URL(c.req.url).pathname.replace(/\/+$/, '').split('/')
      if (segs[segs.length - 2] === '~feedback') return await handleFeedbackDelete(c)
      throw TBError.notFound('no such path')
    }),
  )

  // --- POST ~register(HTTP 反向注册入口,等价 NodeRegistry.Write)---
  const handleRegister = async (c: AppContext): Promise<Response> => {
    const path = splitReserved(new URL(c.req.url).pathname, '~register')
    if (path === null || path === '') throw TBError.notFound('no such path')
    const ctx = c.get('ctx')
    const store = c.get('store')
    const registry = new NodeRegistryStore(store)
    const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') {
      throw new TBError('invalid_argument', 'body must be a NodeInput object')
    }
    // body.path 必须等于 URL path;先于 NodeInput 结构校验(路径一致是通道契约)。
    if (raw.path !== path) {
      throw new TBError(
        'invalid_argument',
        `body.path '${String(raw.path)}' must equal URL path '${path}'`,
      )
    }
    // 复用与 system/registry write 相同的 NodeInput 校验(kind/description 必填、kind 枚举合法)。
    const body = parseNodeInput(raw)
    // 挂载 remote 节点时校验 baseUrl 白名单(注册时即拒;env 基线 ∪ 运行时条目)。
    assertRemoteConfigAllowed(body.config, await resolveRemoteSettings(store, deps.remote))
    // register 判定 + 注册路径规则(含 existing 查询)。
    if (!check(ctx, path, 'register').allow) {
      throw new TBError('permission_denied', `no scope grants 'register' on '${path}'`)
    }
    await assertRegisterPath(registry, ctx, body.path, 'write', deps)
    // Secret Reference 使用授权:绑定 authRef/skRef 须持 system/secret admin(注册路径
    // 判定之后、落库之前)。受限注册者不得引用平台已有 Secret(confused-deputy 合入阻断项)。
    assertSecretRefUse(ctx.scopes, body.config)
    // context 配置校验 + s3 连通探测:探测出站网络,须在权限判定之后。
    await assertContextConfig(body.config, deps)
    // skillhub 配置校验(provider r2/s3;s3 连通探测)。
    await assertSkillhubConfig(body.config, deps)
    // kind:'tool' 挂载校验:provider 必须是已注册且启用的 tool-provider plugin。
    await assertToolConfig(body.config, store)
    await searchSync?.ensureSeeded()
    const now = new Date().toISOString()
    const marker = await searchSync?.markNode(body.path)
    let node: TreeNode
    try {
      node = await registry.write(body, ctx.keyId, now)
    } catch (error) {
      await searchSync?.abort(marker)
      throw error
    }
    // 注册变更 → 失效该节点工具缓存 + mcp 会话/OAuth 缓存。
    await invalidateToolCache(store, body.path)
    await invalidateMcpEra(store, body.path)
    await invalidateMcpOAuth(store, body.path)
    await searchSync?.reconcileNodeQuietly(body.path, { marker })
    if (await refreshDynamicSearchNode(node, ctx, deps)) await searchSync?.abort(marker)
    return new Response(JSON.stringify(node), {
      headers: { 'content-type': contentTypeFor('json') },
    })
  }

  // --- POST ~authorize(mcp 托管 OAuth 发起;需对节点有 register 权限——与挂载同权)---
  const handleAuthorize = async (c: AppContext): Promise<Response> => {
    const path = splitReserved(new URL(c.req.url).pathname, '~authorize')
    if (path === null || path === '') throw TBError.notFound('no such path')
    const ctx = c.get('ctx')
    const store = c.get('store')
    if (!check(ctx, path, 'read').allow) throw TBError.notFound('not found')
    if (!check(ctx, path, 'register').allow) {
      throw new TBError('permission_denied', `no scope grants 'register' on '${path}'`)
    }
    const encKey = deps.encryptionKey
    if (encKey === undefined) {
      throw new TBError('unavailable', 'OAuth 托管需要 TB_SECRET_ENCRYPTION_KEY', {
        retryable: false,
      })
    }
    const registry = new NodeRegistryStore(store)
    let node: TreeNode
    try {
      node = await registry.get(path)
    } catch {
      throw TBError.notFound('not found')
    }
    if (node.kind !== 'mcp' || node.config?.kind !== 'mcp' || node.config.auth !== 'oauth') {
      throw new TBError('invalid_argument', `'${path}' 不是 auth:'oauth' 的 mcp 挂载`)
    }
    // 可选 body {redirectUri}:CLI 本地回调通道(严格上游只放行 loopback 回调时)。
    const body = (await c.req.json().catch(() => null)) as { redirectUri?: unknown } | null
    const redirectUri
      = body !== null && typeof body.redirectUri === 'string' ? body.redirectUri : undefined
    const result = await startMcpAuthorization({
      store,
      encryptionKey: encKey,
      nodePath: path,
      serverUrl: node.config.url,
      origin: deps.canonicalOrigin ?? new URL(c.req.url).origin,
      ...(redirectUri !== undefined ? { redirectUri } : {}),
    })
    return new Response(JSON.stringify(result), {
      headers: { 'content-type': contentTypeFor('json') },
    })
  }

  // POST 通配分派:末段为 ~register → 反向注册;~authorize → OAuth 发起;~feedback(末段或
  // 倒数第二段)→ 反馈提交/投票;否则数据面调用。
  app.post('/*', async c =>
    await runHandler(async () => {
      const segs = new URL(c.req.url).pathname.replace(/\/+$/, '').split('/')
      const last = segs.pop() ?? ''
      if (last === '~register') return await handleRegister(c)
      if (last === '~authorize') return await handleAuthorize(c)
      if (last === '~feedback' || segs[segs.length - 1] === '~feedback') {
        return await handleFeedbackPost(c)
      }
      return await handleInvoke(c)
    }),
  )

  app.notFound((c) => {
    const { pathname } = new URL(c.req.url)
    return tbErrorResponse(TBError.notFound(`no such path: ${pathname}`))
  })

  app.onError((err) => {
    if (isTBError(err)) return tbErrorResponse(err)
    return tbErrorResponse(new TBError('internal', 'internal error'))
  })

  return app
}
