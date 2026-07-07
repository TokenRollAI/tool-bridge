import {
  type BuiltinModule,
  buildTree,
  type CallContext,
  type CmdSpec,
  CONTEXT_CAPABILITIES,
  type ContextEntryInput,
  type ContextPatch,
  type ContextProvider,
  check,
  checkRegisterPath,
  checkScopes,
  clampDepth,
  contentTypeFor,
  contextHelpModel,
  contextScopeForCmd,
  createBuiltins,
  createObjectContextProvider,
  type DeviceCallResult,
  deviceDirectoryHelpModel,
  deviceFsHelpModel,
  deviceShellHelpModel,
  type HelpModel,
  identify,
  isContextExpired,
  isTBError,
  KEY_PLUGIN,
  KEY_PLUGIN_META,
  type ListOptions,
  type NodeConfig,
  NodeRegistryStore,
  negotiate,
  type ObjectStore,
  optionalMethodsForCapabilities,
  type PluginDescribe,
  type PluginKind,
  type PluginManifest,
  PRESIGN_TTL_SEC_DEFAULT,
  parseNodeInput,
  type Representation,
  renderHelpDsl,
  renderHelpJson,
  resolveUpstreamTool,
  type SearchOptions,
  type SecretStoreImpl,
  type StateStore,
  TBError,
  type TBErrorBody,
  type ToolSpec,
  type TreeEntry,
  type TreeJson,
  type TreeNode,
  type TreePath,
  toolHelpModel,
  toolsToHelpModel,
  virtualizeTools,
} from '@tool-bridge/core'
import { type Context, Hono } from 'hono'
import { buildDeps } from './bootstrap'
import { createHttpProvider, type HttpConfig } from './providers/http'
import { createMcpProvider, invalidateMcpSession, type McpConfig } from './providers/mcp'
import { createPluginContextProvider } from './providers/pluginContext'
import { createPluginToolProvider } from './providers/pluginTool'
import { assertRemoteAllowed, passthroughRemote, type RemoteSettings } from './providers/remote'
import { createS3ObjectStore, type S3StoreConfig } from './providers/s3Object'
import { getTools, invalidateToolCache } from './providers/toolCache'
import type { UpstreamProvider } from './providers/types'
import { signRefToken, verifyRefToken } from './refToken'

/** 帧协议 call 转发的入参(id 由调用点生成,幂等键)。 */
export interface DeviceInvokeRequest {
  id: string
  path: string
  tool: string
  arguments: Record<string, unknown>
}

/** 设备通道宿主(CF = DeviceSession DO / Docker = ws;Proto §7 deviceTransport 的消费面)。 */
export interface DeviceChannel {
  /** HTTP→WS 调用转发:结果为 DeviceCallResult 形状(设备侧 result 帧)。 */
  invoke(deviceId: string, req: DeviceInvokeRequest): Promise<unknown>
  /** WS 升级请求转交(/system/device/ws)。 */
  ws(deviceId: string, request: Request): Promise<Response>
}

/** 进程内本地 Provider 钩子(SDK registerTool/registerContext 的装配面,Proto §7)。 */
export interface LocalProviderHooks {
  /** kind:'tool' 节点按路径取进程内工具源;undefined → 走 plugin 解析。 */
  tool?(nodePath: TreePath): UpstreamProvider | undefined
  /** kind:'context' 节点按路径取进程内 ContextProvider;undefined → 走 plugin 解析。 */
  context?(nodePath: TreePath): ContextProvider | undefined
}

/**
 * tb app 的宿主注入面(Proto §7 四注入点 + 解析后的部署配置)。
 * 核心业务逻辑零分叉:Workers 适配层(app.ts)与 SDK(packages/sdk)都注入此形状。
 */
export interface TbAppDeps {
  state: StateStore
  secrets: SecretStoreImpl
  /** healthz 与 system/status 回显的版本号(单一真源:宿主 package.json)。 */
  version: string
  /** 认证前的实例就绪钩子(引导/延迟注册 flush);每请求调用,幂等由宿主保证。 */
  ensureReady?: () => Promise<void>
  /** remote 联邦透传配置(Proto §3.4/§7)。 */
  remote: RemoteSettings
  /** 放行 http:// 上游(仅本地开发,Proto §4.2)。 */
  allowInsecureHttp: boolean
  /** §2.4 b 的追加保留根路径(Proto §7)。 */
  reservedRoots?: string[]
  /** context 平台对象存储('r2' provider 的落点,Proto §7 objects);缺省 → 该 provider unavailable。 */
  objects?: () => Promise<ObjectStore> | ObjectStore
  /** $ref 中转 token 签名密钥(TB_SECRET_ENCRYPTION_KEY);缺省 → /~ref 404、大对象走 presign 或 unavailable。 */
  encryptionKey?: string
  /** 设备通道;缺省 → device 能力禁用(Proto §7)。 */
  device?: DeviceChannel
  /** Dashboard 静态资源(Workers Static Assets);缺省 → /ui 404。 */
  assets?: (request: Request) => Promise<Response>
  /** SDK 进程内 Provider 表(缺省无)。 */
  locals?: LocalProviderHooks
  /** mcp/tool 工具缓存 TTL 秒(缺省 300)。 */
  toolCacheTtlSec?: number
  /** context Get 的 $ref 内联阈值(字节,缺省 1 MiB)。 */
  refThresholdBytes?: number
  /** $ref URL(presign 与 /~ref 中转)有效期秒(缺省 900)。 */
  refTtlSec?: number
}

const TOOL_CACHE_TTL_DEFAULT = 300

type Vars = { ctx: CallContext; store: StateStore }

type AppContext = Context<{ Variables: Vars }>

/** 把 TBError 渲染为线上响应(Proto §0.2)。 */
function tbErrorResponse(err: TBError): Response {
  return new Response(JSON.stringify(err.toJSON()), {
    status: err.httpStatus,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
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
  return mod.help(nodePath).cmds.find((c) => c.name === cmd)
}

/** 渲染 HelpModel:按协商表现输出 DSL(text/plain)或 JSON。 */
function renderHelp(model: HelpModel, rep: Representation): Response {
  if (rep === 'json') {
    return new Response(JSON.stringify(renderHelpJson(model)), {
      headers: { 'content-type': contentTypeFor('json') },
    })
  }
  // ~help 只有 DSL(text/plain)与 JSON 两种;markdown 一并按 DSL 处理(Proto §1.2)。
  return new Response(renderHelpDsl(model), {
    headers: { 'content-type': contentTypeFor('dsl') },
  })
}

/** 渲染数据面调用返回值:json → 原始 JSON;默认 → markdown(```json 包裹,Phase 后续美化)。 */
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
 * 逐段 decodeURIComponent 树路径(Proto:注册的树路径可含空格等,URL 里被百分号编码)。
 * 逐段解码(而非整段)以免把编码的 '/'(%2F)误解为路径分隔。decode 失败 → 400 invalid_argument。
 */
function decodePath(path: TreePath): TreePath {
  if (path === '') return ''
  try {
    return path
      .split('/')
      .map((seg) => decodeURIComponent(seg))
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
 * 构造 tool-bridge 的 Hono app(宿主中立;Workers 适配见 app.ts,SDK 装配见 packages/sdk)。
 */
export function createTbApp(deps: TbAppDeps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>()
  const builtinsOf = (store: StateStore): Map<string, BuiltinModule> =>
    createBuiltins(
      buildDeps({
        store,
        secrets: deps.secrets,
        version: deps.version,
        allowInsecureHttp: deps.allowInsecureHttp,
      }),
    )

  // GET /healthz → 200 JSON,树外免认证(Proto §1.1)。version 单一真源:宿主 package.json。
  app.get('/healthz', (c) => c.json({ healthy: true, version: deps.version }))

  // GET /~ref/<token> → 大对象中转下载,树外免认证(Proto §5.2 中转下载路由)。
  // 注册在认证中间件之前:token 本身即凭证(HMAC 限时签名);验签失败/过期一律 404 不泄露。
  app.get('/~ref/:token', (c) =>
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
      // 签发后节点可能被卸载/换 kind/ttl 到期——须仍是存活的 context 节点。
      if (node.kind !== 'context' || node.config?.kind !== 'context') {
        throw TBError.notFound('not found')
      }
      await assertContextAlive(node, node.config, registry)
      const objects = await contextObjectStoreFor(node.config, deps)
      const got = await objects.get(payload.k)
      if (got === null) throw TBError.notFound('not found')
      return new Response(got.body as unknown as BodyInit, {
        headers: { 'content-type': got.meta.contentType ?? 'application/octet-stream' },
      })
    }),
  )

  // --- /ui Dashboard 静态资源(Workers Static Assets,Architecture M9)---
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
  app.get('/ui', (c) => c.redirect('/ui/', 302))
  app.get('/ui/*', serveUi)

  // 浏览器直开根路径 → Dashboard(Architecture M9:GET / 且 Accept 带 text/html 时 302);
  // 非 HTML 客户端(Agent/CLI)落回后续路由,行为与此前一致(401/404)。
  app.get('/', async (c, next) => {
    if (c.req.header('accept')?.includes('text/html')) return c.redirect('/ui/', 302)
    await next()
  })

  // 认证中间件(/healthz、/~ref、/ui 静态资源之外全路由):Bearer → identify → 401 或注入 ctx(Proto §0.2)。
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

  // WS /system/device/ws?deviceId=<id> → 设备通道宿主(CF:每 deviceId 一个 DeviceSession DO)。
  // deviceId 同时在 hello 帧中出现;通道侧会校验二者一致,以满足 Proto §6.1 的帧契约。
  app.get('/system/device/ws', (c) =>
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

    // 子树根必须真实存在(§否则 ~tree 可伪造任意根)。非根 path 不存在 → 404;
    // 存在则以真实节点元数据作 rootEntry(kind/description/online),不再伪造为 directory。
    let rootEntry: TreeEntry | undefined
    if (path !== '') {
      let rootNode: TreeNode
      try {
        rootNode = await registry.get(path)
      } catch {
        throw TBError.notFound('not found')
      }
      // 子树根本身是 ttl 到期的 context 节点 → 懒回收 + 404(Proto §5.3)。
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
      return [...localKids.map((n) => toEntry(n)), ...remoteKids]
    }

    const depth = clampDepth(Number(c.req.query('depth')))
    const tree = await buildTree({
      root: path,
      depth,
      getChildren,
      ...(rootEntry !== undefined ? { rootEntry } : {}),
    })
    const rep = negotiate(c.req.header('accept'))
    if (rep === 'json') {
      return new Response(JSON.stringify(tree), {
        headers: { 'content-type': contentTypeFor('json') },
      })
    }
    return new Response(renderTreeDsl(tree), {
      headers: { 'content-type': contentTypeFor('dsl') },
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
        children: children.map((n) => ({ path: n.path, kind: n.kind, description: n.description })),
      }
      return renderHelp(model, rep)
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
      // 非注册路径:尝试工具级 ~help(Proto §4.2 两级披露)——最长前缀命中 mcp/http 节点
      // 且剩余恰一段(工具虚拟名)→ 单工具全量 spec(命中同一 toolcache,不额外打上游)。
      const toolModel = await toolHelpModelFor(c, ctx, registry, path, deps)
      if (toolModel !== null) return renderHelp(toolModel, rep)
      throw TBError.notFound('not found')
    }
    const builtins = builtinsOf(store)
    const refresh = c.req.query('refresh') === '1'
    const model = await helpModelFor(node, registry, ctx, builtins, deps, {
      refresh,
      now: new Date().toISOString(),
    })
    return renderHelp(model, rep)
  }

  // --- POST /<path> 数据面调用 ---
  const handleInvoke = async (c: AppContext): Promise<Response> => {
    const rawEncoded = new URL(c.req.url).pathname.replace(/^\/+|\/+$/g, '')
    if (rawEncoded === '' || rawEncoded.split('/').some((s) => s.startsWith('~'))) {
      throw TBError.notFound('no such path')
    }
    const raw = decodePath(rawEncoded)
    const ctx = c.get('ctx')
    const store = c.get('store')
    const registry = new NodeRegistryStore(store)

    // 节点不可见 → 404(隐藏存在性)。
    if (!check(ctx, raw, 'read').allow) throw TBError.notFound('not found')

    // remote 透传:命中 remote 节点(或其后代)→ 改写 POST 打到 baseUrl(scope 恒 'call')。
    const remote = await remotePassthroughIfMatch(c, ctx, registry, raw, null, deps)
    if (remote) return remote

    let node: TreeNode
    try {
      node = await registry.get(raw)
    } catch {
      throw TBError.notFound('not found')
    }

    // --- device 自定义 tool 节点(Proto §6.3 Phase 5):providerConfig 标记 → 帧协议 call 转发。 ---
    // 须先于 mcp/http/tool 通用分支:provider 是设备本地保留 id(如 '@local'),不是 plugin。
    const toolMarker = deviceToolMarker(node)
    if (toolMarker !== null) {
      if (!check(ctx, node.path, 'call').allow) {
        throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
      }
      const body = (await c.req.json().catch(() => null)) as {
        tool?: unknown
        arguments?: unknown
      } | null
      if (!body || typeof body.tool !== 'string') {
        throw new TBError('invalid_argument', 'body must be {tool, arguments}')
      }
      const result = await invokeDevice(deps, toolMarker.deviceId, {
        path: relativeDevicePath(node.path, toolMarker.mountPath),
        tool: body.tool,
        arguments: (body.arguments ?? {}) as Record<string, unknown>,
      })
      return renderResult(result, negotiate(c.req.header('accept')))
    }

    // --- mcp/http/tool 上游工具调用(Proto §4.2/§8.1):scope 恒 'call';虚拟名反查上游真名再调 Provider。 ---
    if (
      (node.kind === 'mcp' || node.kind === 'http' || node.kind === 'tool') &&
      node.config !== undefined
    ) {
      if (!check(ctx, node.path, 'call').allow) {
        throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
      }
      const body = (await c.req.json().catch(() => null)) as {
        tool?: unknown
        arguments?: unknown
      } | null
      if (!body || typeof body.tool !== 'string') {
        throw new TBError('invalid_argument', 'body must be {tool, arguments}')
      }
      const args = (body.arguments ?? {}) as Record<string, unknown>
      const provider = await providerFor(node, ctx, deps)
      const tools = await upstreamTools(node, provider, deps, false, new Date().toISOString())
      const upstreamName = resolveUpstreamTool(node.virtualize, tools, body.tool)
      const result = await provider.call(upstreamName, args)
      // MCP RPC 业务错误(result.isError)是正常返回值(HTTP 200),按 §1.2 协商渲染其 content。
      return renderResult(result.content, negotiate(c.req.header('accept')))
    }

    // --- device shell 调用(Proto §6.3):节点级 read/call 后转发到设备通道。 ---
    if (node.kind === 'device' && node.config?.kind === 'device') {
      if (!check(ctx, node.path, 'call').allow) {
        throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
      }
      const body = (await c.req.json().catch(() => null)) as {
        tool?: unknown
        arguments?: unknown
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

    // --- context namespace 数据面(Proto §5):四动词 + Search/Delete,cmd→scope 静态表判定。 ---
    if (node.kind === 'context' && node.config?.kind === 'context') {
      const cfg = node.config
      // ttl 懒回收(Proto §5.3):POST 命中即判,过期删节点并 404。
      await assertContextAlive(node, cfg, registry)
      const body = (await c.req.json().catch(() => null)) as {
        tool?: unknown
        arguments?: unknown
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
      // readOnly 挂载对写动词直接拒(provider 内亦拒,双保险;Proto §5.3)。
      if (cfg.readOnly === true && scope === 'write') {
        throw new TBError('permission_denied', `readOnly 挂载拒绝 '${body.tool}'(Proto §5.3)`)
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
      // device 自定义 context 节点(Proto §6.3 Phase 5):标记命中 → 相对路径转发到设备。
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
        // SDK 进程内 context Provider(Proto §7 registerContext):按节点路径查本实例表。
        const local = localContext(deps, node)
        if (local !== null) {
          const result = await dispatchContextCmd(local, body.tool, args)
          return renderResult(result, negotiate(c.req.header('accept')))
        }
        // plugin-backed context(Proto §8.1):provider 非 r2/s3 视为 plugin id,
        // 经 §8.3 envelope 转发;plugin 不存在/禁用/kind 不符 → invalid_argument。
        const manifest = await requirePlugin(store, cfg.provider, 'context-provider', 'context')
        const provider = createPluginContextProvider({
          manifest,
          secrets: deps.secrets,
          ctx,
          capabilities: await pluginCapabilities(store, cfg.provider),
        })
        const result = await dispatchContextCmd(provider, body.tool, args)
        return renderResult(result, negotiate(c.req.header('accept')))
      }
      const provider = await contextProviderFor(node, cfg, deps, c.req.url)
      const result = await dispatchContextCmd(provider, body.tool, args)
      return renderResult(result, negotiate(c.req.header('accept')))
    }

    if (node.kind !== 'builtin' || node.config?.kind !== 'builtin') {
      throw TBError.unimplemented(`kind '${node.kind}' not callable`)
    }

    const builtins = builtinsOf(store)
    const mod = builtins.get(node.config.module)
    if (!mod) throw TBError.unimplemented(`builtin module '${node.config.module}' not available`)

    const body = (await c.req.json().catch(() => null)) as {
      tool?: unknown
      arguments?: unknown
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

    // registry 模块的 write/update/delete 额外过 §2.4(资源 = arguments.path)。
    let registryTarget: string | undefined
    if (node.config.module === 'registry' && ['write', 'update', 'delete'].includes(cmd)) {
      const targetPath = typeof args.path === 'string' ? args.path : undefined
      if (targetPath === undefined) {
        throw new TBError('invalid_argument', "field 'path' must be a string")
      }
      // 挂载/更新 remote 节点时校验 baseUrl 白名单(Proto §3.4,注册时即拒)。
      const cfgPatch =
        cmd === 'write'
          ? args.config
          : cmd === 'update'
            ? (args.patch as { config?: unknown } | undefined)?.config
            : undefined
      assertRemoteConfigAllowed(cfgPatch, deps.remote)
      await assertRegisterPath(
        registry,
        ctx,
        targetPath,
        cmd === 'delete' ? 'delete' : 'write',
        deps,
      )
      // context 配置校验 + s3 连通探测(Proto §5.3):探测出站网络,须在权限判定之后。
      await assertContextConfig(cfgPatch, deps)
      // kind:'tool' 挂载校验(Proto §8.1):provider 必须是已注册且启用的 tool-provider plugin。
      await assertToolConfig(cfgPatch, store)
      registryTarget = targetPath
    }

    const result = await mod.dispatch(cmd, args, ctx)
    // 注册变更 → 失效该节点工具缓存 + mcp 会话缓存(Proto §4.2:Write/Update/Delete 触发失效)。
    if (registryTarget !== undefined) {
      await invalidateToolCache(store, registryTarget)
      await invalidateMcpSession(store, registryTarget)
    }
    return renderResult(result, negotiate(c.req.header('accept')))
  }

  // --- ~skill:remote 透传;本地 Phase 1 占位 501 ---
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

  // --- ~describe(Proto §1.1):有可选能力的节点返回 { kind, capabilities };其余 404 ---
  const handleDescribe = async (c: AppContext): Promise<Response> => {
    const path = splitReserved(new URL(c.req.url).pathname, '~describe')
    if (path === null || path === '') throw TBError.notFound('no such path')
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
      // device 自定义 context 节点(带转发标记,Proto §6.3)回固定表;
      // SDK 进程内 Provider 按可选方法实现存在性推导。
      const cfg = node.config
      const local = cfg.provider !== 'r2' && cfg.provider !== 's3' ? localContext(deps, node) : null
      const capabilities =
        cfg.provider === 'r2' ||
        cfg.provider === 's3' ||
        cfg.provider === 'device-fs' ||
        deviceMarkerOf(cfg.providerConfig) !== null
          ? CONTEXT_CAPABILITIES
          : local !== null
            ? localCapabilities(local)
            : await pluginCapabilities(store, cfg.provider)
      return new Response(JSON.stringify({ kind: 'context', capabilities }), {
        headers: { 'content-type': contentTypeFor('json') },
      })
    }
    // 无可选能力的节点(其他 kind)→ 404(Proto §1.1)。
    throw TBError.notFound(`no capabilities for kind '${node.kind}'`)
  }

  // GET 通配分派:按 pathname 末段路由到 ~help / ~tree / ~skill;其余 GET 无对应端点 → 404。
  // (不用 `/:path{.*}/~help` 具名后缀路由——Hono 该形式对 3+ 段路径不匹配。)
  // handleX(c) 必须 `await`(而非裸 `return handleX(c)`):裸返回 async promise 时其 reject
  // 会在链接那一 tick 被 workerd 误报为 unhandled,即便 runHandler 最终 catch。
  app.get('/*', (c) =>
    runHandler(async () => {
      const last = new URL(c.req.url).pathname.replace(/\/+$/, '').split('/').pop() ?? ''
      if (last === '~help') return await handleHelp(c)
      if (last === '~tree') return await handleTree(c)
      if (last === '~skill') return await handleSkill(c)
      if (last === '~describe') return await handleDescribe(c)
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
    // body.path 必须等于 URL path(Proto §3.3);先于 NodeInput 结构校验(路径一致是通道契约)。
    if (raw.path !== path) {
      throw new TBError(
        'invalid_argument',
        `body.path '${String(raw.path)}' must equal URL path '${path}'`,
      )
    }
    // 复用与 system/registry write 相同的 NodeInput 校验(kind/description 必填、kind 枚举合法)。
    const body = parseNodeInput(raw)
    // 挂载 remote 节点时校验 baseUrl 白名单(Proto §3.4,注册时即拒)。
    assertRemoteConfigAllowed(body.config, deps.remote)
    // register 判定 + §2.4 路径规则(含 existing 查询)。
    if (!check(ctx, path, 'register').allow) {
      throw new TBError('permission_denied', `no scope grants 'register' on '${path}'`)
    }
    await assertRegisterPath(registry, ctx, body.path, 'write', deps)
    // context 配置校验 + s3 连通探测(Proto §5.3):探测出站网络,须在权限判定之后。
    await assertContextConfig(body.config, deps)
    // kind:'tool' 挂载校验(Proto §8.1):provider 必须是已注册且启用的 tool-provider plugin。
    await assertToolConfig(body.config, store)
    const now = new Date().toISOString()
    const node = await registry.write(body, ctx.keyId, now)
    // 注册变更 → 失效该节点工具缓存 + mcp 会话缓存(Proto §4.2)。
    await invalidateToolCache(store, body.path)
    await invalidateMcpSession(store, body.path)
    return new Response(JSON.stringify(node), {
      headers: { 'content-type': contentTypeFor('json') },
    })
  }

  // POST 通配分派:末段为 ~register → 反向注册;否则数据面调用。
  app.post('/*', (c) =>
    runHandler(async () => {
      const last = new URL(c.req.url).pathname.replace(/\/+$/, '').split('/').pop() ?? ''
      if (last === '~register') return await handleRegister(c)
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

/** §2.4 反向注册路径判定(查 existing 占用者;deps.reservedRoots 追加保留根)。allow=false 则抛其 error。 */
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
 * 目录/~tree 展示裁剪。Phase 2 DOD 要求无 call 权限的 SK 对同一调用节点
 * `tb call` 为 403,且 `tb ls` 不可见;因此 mcp/http/remote 节点在列表面同时要求 read+call。
 * 直接访问节点本身仍由 handler 保持 Proto §1.4 的 read→404 / call→403 次序。
 */
function filterListVisible(nodes: TreeNode[], scopes: CallContext['scopes']): TreeNode[] {
  return nodes.filter((node) => {
    if (!checkScopes(scopes, node.path, 'read')) return false
    if (
      (node.kind === 'mcp' ||
        node.kind === 'http' ||
        node.kind === 'remote' ||
        node.kind === 'device' ||
        node.kind === 'tool') &&
      !checkScopes(scopes, node.path, 'call')
    ) {
      return false
    }
    return true
  })
}

function localizeRemoteEntry(mountPath: TreePath, entry: TreeJson): TreeEntry {
  const rel = entry.path.replace(/^\/+|\/+$/g, '')
  const out: TreeEntry = {
    path: rel === '' ? mountPath : `${mountPath}/${rel}`,
    kind: entry.kind,
    description: entry.description,
  }
  if (entry.online !== undefined) out.online = entry.online
  return out
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
  let resolved: { node: TreeNode; rest: string }
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
  return (remoteTree.children ?? []).map((child) => localizeRemoteEntry(resolved.node.path, child))
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
  opts: { refresh: boolean; now: string },
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
        children.map((n) => ({ path: n.path, kind: n.kind, description: n.description })),
      )
    }
    return {
      node: { path: node.path, kind: node.kind, description: node.description },
      cmds: [],
      children: children.map((n) => ({ path: n.path, kind: n.kind, description: n.description })),
    }
  }
  // device 自定义 tool 节点(Proto §6.3 Phase 5):~help 来自注册时上送的工具表(cmds),
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
    // 索引形态(Proto §4.2 两级披露):不含 inputSchema;全量 spec 走工具级 ~help。
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
  // context:cmd 表静态声明(readOnly 隐藏写动词);~help 命中即做 ttl 懒回收(Proto §5.3)。
  if (node.kind === 'context' && node.config?.kind === 'context') {
    await assertContextAlive(node, node.config, registry)
    if (node.config.provider === 'device-fs') {
      return deviceFsHelpModel(
        { path: node.path, description: node.description },
        { readOnly: node.config.readOnly ?? false },
      )
    }
    // device 自定义 context 节点(Proto §6.3 Phase 5):静态动词表(readOnly 隐藏写动词)。
    if (deviceMarkerOf(node.config.providerConfig) !== null) {
      return contextHelpModel(node, { readOnly: node.config.readOnly ?? false })
    }
    if (node.config.provider !== 'r2' && node.config.provider !== 's3') {
      const model = contextHelpModel(node, { readOnly: node.config.readOnly ?? false })
      const core = new Set(['List', 'Get', 'Write', 'Update'])
      // SDK 进程内 Provider:可选方法按实现存在性裁剪(与 ~describe 推导一致);
      // plugin-backed 节点:只列四动词 + 注册时声明的可选方法(Proto §8.2 注记,Q12)。
      const local = localContext(deps, node)
      const declared =
        local !== null
          ? optionalMethodsForCapabilities(localCapabilities(local))
          : optionalMethodsForCapabilities(
              await pluginCapabilities(deps.state, node.config.provider),
            )
      return { ...model, cmds: model.cmds.filter((c) => core.has(c.name) || declared.has(c.name)) }
    }
    return contextHelpModel(node, { readOnly: node.config.readOnly ?? false })
  }
  throw TBError.unimplemented(`~help for kind '${node.kind}' not implemented yet`)
}

/**
 * 工具级 `~help`(Proto §4.2 两级披露的细节级):path 非注册节点时,最长前缀 resolve 命中
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
  let resolved: { node: TreeNode; rest: string }
  try {
    resolved = await registry.resolve(path)
  } catch {
    return null
  }
  const { node, rest } = resolved
  if (
    (node.kind !== 'mcp' && node.kind !== 'http' && node.kind !== 'tool') ||
    node.config === undefined
  ) {
    return null
  }
  if (rest === '' || rest.includes('/')) return null
  if (!check(ctx, node.path, 'read').allow || !check(ctx, node.path, 'call').allow) return null
  // device 自定义 tool 节点(Proto §6.3):工具表来自注册时缓存的 providerConfig.cmds,不打设备。
  const marker = deviceToolMarker(node)
  if (marker !== null) {
    const cached = (marker.cmds ?? []).find((t) => t.name === rest)
    if (cached === undefined) return null
    return toolHelpModel(node.path, { kind: node.kind, description: node.description }, cached)
  }
  const provider = await providerFor(node, ctx, deps)
  const refresh = c.req.query('refresh') === '1'
  const raw = await upstreamTools(node, provider, deps, refresh, new Date().toISOString())
  const { exposed } = virtualizeTools(node.virtualize, raw)
  const tool = exposed.find((t) => t.name === rest)
  if (tool === undefined) return null
  return toolHelpModel(node.path, { kind: node.kind, description: node.description }, tool)
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
    })
  }
  if (node.kind === 'http' && node.config?.kind === 'http') {
    return createHttpProvider(node.config as HttpConfig, deps.secrets, { allowInsecure: insecure })
  }
  if (node.kind === 'tool' && node.config?.kind === 'tool') {
    // SDK 进程内工具源(Proto §7 registerTool):按节点路径查本实例表,先于 plugin 解析。
    const local = deps.locals?.tool?.(node.path)
    if (local !== undefined) return local
    // plugin 工具源(Proto §8.1):provider = 已注册 tool-provider plugin 的 id。
    const manifest = await requirePlugin(deps.state, node.config.provider, 'tool-provider', 'tool')
    return createPluginToolProvider({ manifest, secrets: deps.secrets, ctx })
  }
  throw TBError.unimplemented(`kind '${node.kind}' has no tool provider`)
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
    return getTools(deps.state, node.path, () => provider.list(), {
      refresh,
      ttl: deps.toolCacheTtlSec ?? TOOL_CACHE_TTL_DEFAULT,
      now,
    })
  }
  return provider.list()
}

/**
 * remote 透传(Proto §3.4):最长前缀 resolve 命中 remote 节点则改写请求打到 baseUrl。
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
  let resolved: { node: TreeNode; rest: string }
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
    config: node.config,
    nodePath: node.path,
    requestPath,
    method,
    ...(body !== undefined ? { body } : {}),
    headers,
    secrets: deps.secrets,
    settings: deps.remote,
    requestUrl: c.req.url,
  })
}

/** 注册 remote 节点时的白名单校验:config.kind==='remote' → baseUrl 必须在 §7 白名单内。 */
function assertRemoteConfigAllowed(config: unknown, settings: RemoteSettings): void {
  if (config === null || typeof config !== 'object') return
  if ((config as { kind?: unknown }).kind !== 'remote') return
  const baseUrl = (config as { baseUrl?: unknown }).baseUrl
  if (typeof baseUrl !== 'string') {
    throw new TBError('invalid_argument', 'remote config 缺少 baseUrl')
  }
  assertRemoteAllowed(baseUrl, settings)
}

// ---------- device 节点(Proto §6,Phase 4) ----------

function tbErrorFromBody(body: TBErrorBody): TBError {
  return new TBError(body.code, body.message, { retryable: body.retryable })
}

/** 设备通道缺省(Proto §7:deviceTransport 未注入)→ device 能力禁用。 */
function requireDevice(deps: TbAppDeps): DeviceChannel {
  if (deps.device === undefined) {
    throw TBError.unimplemented('device capability disabled: no device transport (Proto §7)')
  }
  return deps.device
}

async function invokeDevice(
  deps: TbAppDeps,
  deviceId: string,
  req: { path: string; tool: string; arguments: Record<string, unknown> },
): Promise<unknown> {
  const id = crypto.randomUUID()
  const body = (await requireDevice(deps).invoke(deviceId, { id, ...req })) as DeviceCallResult
  if (!body || !('ok' in body)) {
    throw new TBError('unavailable', 'device session returned invalid result')
  }
  if (body.ok) return body.value
  throw tbErrorFromBody(body.error)
}

function deviceIdForDeviceFs(cfg: ContextConfig): string {
  const pc = cfg.providerConfig
  if (pc && typeof pc === 'object' && typeof pc.deviceId === 'string') return pc.deviceId
  throw new TBError('invalid_argument', 'device-fs context 缺少 providerConfig.deviceId')
}

/** device 自定义节点转发标记(Proto §6.3 Phase 5):hello 代注册时网关写入 providerConfig。 */
interface DeviceNodeMarker {
  deviceId: string
  mountPath: string
  /** 注册时随 NodeInput 上送的工具表(~help 数据源);老客户端不带。 */
  cmds?: ToolSpec[]
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

/** 帧协议 call 的 path = 节点路径相对设备 mountPath(Proto §6.2,如 'tools/echo')。 */
function relativeDevicePath(nodePath: TreePath, mountPath: string): string {
  if (nodePath.startsWith(`${mountPath}/`)) return nodePath.slice(mountPath.length + 1)
  throw new TBError('invalid_argument', `device 节点 '${nodePath}' 不在挂载 '${mountPath}' 下`)
}

// ---------- SDK 进程内 Provider(Proto §7,Phase 5) ----------

/** 按节点路径查 SDK 进程内 ContextProvider(未注入/未命中 → null)。 */
function localContext(deps: TbAppDeps, node: TreeNode): ContextProvider | null {
  return deps.locals?.context?.(node.path) ?? null
}

/** 进程内 Provider 的 capabilities:按可选方法实现存在性推导(~describe/~help 共用)。 */
function localCapabilities(provider: ContextProvider): string[] {
  return [
    ...(provider.Search !== undefined ? ['search'] : []),
    ...(provider.Delete !== undefined ? ['delete'] : []),
  ]
}

// ---------- plugin 挂载消费(Proto §8,Phase 5) ----------

/**
 * 取已注册且启用的 plugin manifest(挂载校验与调用点共用)。
 * 不存在/kind 不符 → invalid_argument(与既有「未知 provider」口径一致,不泄露更多);
 * 禁用 → invalid_argument。落盘记录含平台内部 tokenSkId,网关内部使用无须投影。
 */
async function requirePlugin(
  store: StateStore,
  id: string,
  kind: PluginKind,
  what: 'context' | 'tool',
): Promise<PluginManifest> {
  const manifest = (await store.get(KEY_PLUGIN + id)) as PluginManifest | null
  if (manifest === null || manifest.kind !== kind) {
    throw new TBError('invalid_argument', `未知 ${what} provider:'${id}'`)
  }
  if (manifest.enabled !== true) {
    throw new TBError('invalid_argument', `plugin '${id}' 已禁用`)
  }
  return manifest
}

/** 注册时抓取缓存的 `~describe.capabilities`(pluginmeta:<id>;缺失回空表)。 */
async function pluginCapabilities(store: StateStore, id: string): Promise<readonly string[]> {
  const meta = (await store.get(KEY_PLUGIN_META + id)) as PluginDescribe | null
  return meta?.capabilities ?? []
}

/**
 * 注册/更新 kind:'tool' 节点时的配置校验(Proto §8.1,注册时即拒):
 * provider 必须是已注册且启用的 tool-provider plugin(SDK 保留 id '@local' 由
 * SDK 内部注册通道落库,不经注册面)。
 */
async function assertToolConfig(config: unknown, store: StateStore): Promise<void> {
  if (config === null || typeof config !== 'object') return
  if ((config as { kind?: unknown }).kind !== 'tool') return
  assertNoDeviceMarker(config)
  const provider = (config as { provider?: unknown }).provider
  if (typeof provider !== 'string' || provider === '') {
    throw new TBError(
      'invalid_argument',
      "kind:'tool' 节点需要 config.provider(plugin id,Proto §3.2)",
    )
  }
  await requirePlugin(store, provider, 'tool-provider', 'tool')
}

/**
 * device 转发标记(Proto §6.3)只能由 hello 代注册写入:注册面手工携带 providerConfig
 * 的 deviceId+mountPath → 拒,防止把任意节点调用劫持转发到他人设备(与 device-fs 口径一致)。
 */
function assertNoDeviceMarker(config: unknown): void {
  const pc = (config as { providerConfig?: unknown }).providerConfig
  if (
    pc !== null &&
    typeof pc === 'object' &&
    deviceMarkerOf(pc as Record<string, unknown>) !== null
  ) {
    throw new TBError(
      'invalid_argument',
      'providerConfig 的 device 转发标记由网关代写,不得经注册面携带(Proto §6.3)',
    )
  }
}

// ---------- context 节点(Proto §5,Phase 3) ----------

type ContextConfig = Extract<NodeConfig, { kind: 'context' }>

/** S3 类凭证值形状(Proto §5.2):JSON {"accessKeyId","secretAccessKey"};解析失败不回显值。 */
export function parseS3Credentials(
  raw: string,
  refName: string,
): { accessKeyId: string; secretAccessKey: string } {
  try {
    const v = JSON.parse(raw) as { accessKeyId?: unknown; secretAccessKey?: unknown }
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

/** s3 provider 的 store 构造参数:providerConfig.endpoint/bucket + authRef 解析(均必填)。 */
async function s3StoreConfig(cfg: ContextConfig, secrets: SecretStoreImpl): Promise<S3StoreConfig> {
  const pc = (cfg.providerConfig ?? {}) as {
    endpoint?: unknown
    bucket?: unknown
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

/** 按 config.provider 构造底层 ObjectStore('r2' = 宿主注入的平台对象存储,Proto §7 objects)。 */
async function contextObjectStoreFor(cfg: ContextConfig, deps: TbAppDeps): Promise<ObjectStore> {
  if (cfg.provider === 'r2') {
    if (deps.objects === undefined) {
      throw new TBError('unavailable', 'object store not configured(Proto §7 objects 未注入)', {
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

/**
 * 数据面 {tool} → ContextProvider 方法派发;入参精细校验由 provider 承担。
 * 可选方法(Search/Delete)未实现(plugin 未在 capabilities 声明)→ 按 unknown cmd 拒
 * (未声明的可选方法平台永不调用,Proto §8.2)。
 */
async function dispatchContextCmd(
  provider: ContextProvider,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (tool) {
    case 'List':
      return await provider.List((args.path as string) ?? '', args.opts as ListOptions | undefined)
    case 'Get':
      return await provider.Get(args.path as string)
    case 'Write':
      if (typeof args.entry !== 'object' || args.entry === null) {
        throw new TBError('invalid_argument', "Write 需要对象 'entry'")
      }
      return await provider.Write(args.path as string, args.entry as ContextEntryInput)
    case 'Update':
      if (typeof args.patch !== 'object' || args.patch === null) {
        throw new TBError('invalid_argument', "Update 需要对象 'patch'")
      }
      return await provider.Update(args.path as string, args.patch as ContextPatch)
    case 'Delete':
      if (provider.Delete === undefined) {
        throw new TBError('invalid_argument', `unknown cmd '${tool}'(capability 未声明)`)
      }
      return await provider.Delete(args.path as string)
    case 'Search':
      if (provider.Search === undefined) {
        throw new TBError('invalid_argument', `unknown cmd '${tool}'(capability 未声明)`)
      }
      return await provider.Search(args.query as string, args.opts as SearchOptions | undefined)
    default:
      // contextScopeForCmd 已挡未知 cmd;此处为类型完备性兜底。
      throw new TBError('invalid_argument', `unknown cmd '${tool}'`)
  }
}

/** ttl 懒回收(Proto §5.3)单点判定:过期 → 删节点 + not_found;未过期 → 通过。 */
async function assertContextAlive(
  node: TreeNode,
  cfg: ContextConfig,
  registry: NodeRegistryStore,
): Promise<void> {
  if (!isContextExpired(node.createdAt, cfg.ttl, Date.now())) return
  await registry.delete(node.path)
  throw TBError.notFound('not found')
}

/** 列表面(~tree/目录 ~help)的 ttl 懒回收:过期 context 节点剔除并删除(量少,逐个 await)。 */
async function pruneExpiredContext(
  nodes: TreeNode[],
  registry: NodeRegistryStore,
): Promise<TreeNode[]> {
  const now = Date.now()
  const alive: TreeNode[] = []
  for (const n of nodes) {
    if (
      n.kind === 'context' &&
      n.config?.kind === 'context' &&
      isContextExpired(n.createdAt, n.config.ttl, now)
    ) {
      await registry.delete(n.path)
      continue
    }
    alive.push(n)
  }
  return alive
}

/**
 * 注册/更新 context 节点时的配置校验(Proto §3.2/§5.3/§8.1,注册时即拒):
 * provider = r2|s3 或已注册且启用的 context-provider plugin id(Phase 5);
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
    await requirePlugin(deps.state, cfg.provider, 'context-provider', 'context')
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

/** ~tree 的 DSL 文本渲染:每行缩进树(简单实现;JSON 是规范形状,Proto §1.3)。 */
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
