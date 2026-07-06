import {
  type BuiltinModule,
  buildTree,
  type CallContext,
  type CmdSpec,
  CONTEXT_CAPABILITIES,
  type ContextEntryInput,
  type ContextPatch,
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
  type ListOptions,
  type NodeConfig,
  NodeRegistryStore,
  negotiate,
  type ObjectContextProvider,
  type ObjectStore,
  PRESIGN_TTL_SEC_DEFAULT,
  parseNodeInput,
  type Representation,
  renderHelpDsl,
  renderHelpJson,
  resolveUpstreamTool,
  type SearchOptions,
  SecretStoreImpl,
  type StateStore,
  TBError,
  type TBErrorBody,
  type ToolSpec,
  type TreeEntry,
  type TreeJson,
  type TreeNode,
  type TreePath,
  toolsToHelpModel,
  virtualizeTools,
} from '@tool-bridge/core'
import { type Context, Hono } from 'hono'
import pkg from '../package.json' with { type: 'json' }
import { buildDeps, ensureBootstrapped } from './bootstrap'
import type { DeviceSession } from './deviceSession'
import { KvStateStore } from './kvStateStore'
import { createHttpProvider, type HttpConfig } from './providers/http'
import { createMcpProvider, type McpConfig } from './providers/mcp'
import { createR2ObjectStore, type R2PresignCredentials } from './providers/r2Object'
import { assertRemoteAllowed, passthroughRemote } from './providers/remote'
import { createS3ObjectStore, type S3StoreConfig } from './providers/s3Object'
import { getTools, invalidateToolCache, toolCacheTtl } from './providers/toolCache'
import type { UpstreamProvider } from './providers/types'
import { signRefToken, verifyRefToken } from './refToken'

/**
 * Workers 运行时绑定。KV/R2 名称从 TB_NAME_PREFIX 派生(wrangler.jsonc)。
 * TB_SECRET_ENCRYPTION_KEY / TB_BOOTSTRAP_ADMIN_SK 经 wrangler secret 或 .dev.vars 注入。
 */
export interface Env {
  TB_KV: KVNamespace
  TB_R2: R2Bucket
  TB_SECRET_ENCRYPTION_KEY?: string
  TB_BOOTSTRAP_ADMIN_SK?: string
  /** 放行 http:// 上游(仅本地开发,Proto §4.2)。 */
  TB_ALLOW_INSECURE_HTTP?: string
  /** remote baseUrl 的 host 后缀白名单(逗号分隔;空 = 拒一切 remote,Proto §3.4)。 */
  TB_REMOTE_ALLOWLIST?: string
  /** X-TB-Via 跳数上限(默认 4)。 */
  TB_MAX_HOPS?: string
  /** 本实例 X-TB-Via 标识(缺省用入站 host 派生)。 */
  TB_INSTANCE_ID?: string
  /** mcp 工具缓存 TTL 秒(默认 300)。 */
  TB_TOOL_CACHE_TTL?: string
  /** r2 presign 的 S3 兼容端点(https://<account>.r2.cloudflarestorage.com)与 bucket。 */
  TB_R2_S3_ENDPOINT?: string
  TB_R2_BUCKET?: string
  /** r2 presign 凭证链的 env 段(SecretStore 'r2-presign' 优先,Proto §5.2)。 */
  TB_R2_ACCESS_KEY_ID?: string
  TB_R2_SECRET_ACCESS_KEY?: string
  /** context Get 的 $ref 内联阈值(字节,缺省 1 MiB)。 */
  TB_REF_THRESHOLD_BYTES?: string
  /** $ref URL(presign 与 /~ref 中转)有效期秒(缺省 900)。 */
  TB_REF_TTL_SEC?: string
  /** DeviceSession Durable Object(Phase 4 设备 WS hibernation)。 */
  TB_DEVICE: DurableObjectNamespace<DeviceSession>
  /** Dashboard 静态资源(Workers Static Assets,M9;本地测试/未部署 UI 时可缺省)。 */
  ASSETS?: Fetcher
  /** 设备断线后未重连的回收秒数(缺省 24h)。 */
  TB_DEVICE_RECLAIM_SEC?: string
  /** opt-in 集成测试:真实 MCP echo server 的 URL(仅测试注入)。 */
  TB_TEST_MCP_URL?: string
  /** opt-in 集成测试:S3 兼容端点与凭证(仅测试注入)。 */
  TB_TEST_S3_ENDPOINT?: string
  TB_TEST_S3_ACCESS_KEY_ID?: string
  TB_TEST_S3_SECRET_ACCESS_KEY?: string
  TB_TEST_S3_BUCKET?: string
}

/** http:// 上游是否放行(env `TB_ALLOW_INSECURE_HTTP=true`,仅本地开发)。 */
function allowInsecure(env: Env): boolean {
  return env.TB_ALLOW_INSECURE_HTTP === 'true'
}

/** 构造网关内部 SecretStore(解析 authRef/skRef;不暴露为节点 cmd)。 */
function secretStore(store: StateStore, env: Env): SecretStoreImpl {
  return new SecretStoreImpl(store, env.TB_SECRET_ENCRYPTION_KEY)
}

type Vars = { ctx: CallContext; store: StateStore }

type AppContext = Context<{ Bindings: Env; Variables: Vars }>

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
 * 构造 tool-bridge 网关的 Hono app(Phase 1:认证 + HTBP 核心树 + builtin 装配)。
 */
export function createApp(): Hono<{ Bindings: Env; Variables: Vars }> {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>()

  // GET /healthz → 200 JSON,树外免认证(Proto §1.1)。version 单一真源:package.json。
  app.get('/healthz', (c) => c.json({ healthy: true, version: pkg.version }))

  // GET /~ref/<token> → 大对象中转下载,树外免认证(Proto §5.2 中转下载路由)。
  // 注册在认证中间件之前:token 本身即凭证(HMAC 限时签名);验签失败/过期一律 404 不泄露。
  app.get('/~ref/:token', (c) =>
    runHandler(async () => {
      const encKey = c.env.TB_SECRET_ENCRYPTION_KEY
      if (encKey === undefined) throw TBError.notFound('not found')
      const payload = await verifyRefToken(c.req.param('token'), encKey)
      if (payload === null || payload.exp * 1000 <= Date.now()) throw TBError.notFound('not found')
      const store = new KvStateStore(c.env.TB_KV)
      const registry = new NodeRegistryStore(store)
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
      const objects = await contextObjectStoreFor(node.config, c.env, secretStore(store, c.env))
      const got = await objects.get(payload.k)
      if (got === null) throw TBError.notFound('not found')
      return new Response(got.body as unknown as BodyInit, {
        headers: { 'content-type': got.meta.contentType ?? 'application/octet-stream' },
      })
    }),
  )

  // --- /ui Dashboard 静态资源(Workers Static Assets,Architecture M9)---
  // wrangler.jsonc assets.run_worker_first=true:一切请求先进 Worker,静态资源仅由
  // 此处显式转发,SPA 回退只在 /ui 内生效——不可能吞根 ~help、POST 数据面与 system/*。
  // /ui 免认证:登录页本身须在无 SK 时可加载(SK 只存浏览器,静态资源不含机密)。
  const serveUi = async (c: AppContext): Promise<Response> => {
    const assets = c.env.ASSETS
    if (assets === undefined) {
      return tbErrorResponse(TBError.notFound('dashboard assets not deployed'))
    }
    const url = new URL(c.req.url)
    // 构建产物是站点根布局(index.html + assets/*),/ui 挂载前缀在此剥离。
    const sub = url.pathname.slice('/ui'.length) || '/'
    const res = await assets.fetch(new URL(sub, url.origin))
    if (res.status !== 404) return res
    // SPA 回退(仅 /ui 内):深链交给前端路由,由 '/' 取回 index.html。
    return await assets.fetch(new URL('/', url.origin))
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
    const store = new KvStateStore(c.env.TB_KV)
    try {
      await ensureBootstrapped(store, c.env)
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

  // WS /system/device/ws?deviceId=<id> → 每 deviceId 一个 DeviceSession DO。
  // deviceId 同时在 hello 帧中出现;DO 会校验二者一致,以满足 Proto §6.1 的帧契约。
  app.get('/system/device/ws', (c) =>
    runHandler(async () => {
      if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
        throw new TBError('invalid_argument', 'device ws requires WebSocket upgrade')
      }
      const deviceId = c.req.query('deviceId')
      if (!deviceId) throw new TBError('invalid_argument', 'deviceId query is required')
      return await c.env.TB_DEVICE.getByName(deviceId).fetch(c.req.raw)
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
      const remote = await remotePassthroughIfMatch(c, ctx, registry, path, '~tree')
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
      const remoteKids = await remoteTreeChildren(c, ctx, registry, p)
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
    const remote = await remotePassthroughIfMatch(c, ctx, registry, path, '~help')
    if (remote) return remote

    let node: TreeNode
    try {
      node = await registry.get(path)
    } catch {
      throw TBError.notFound('not found')
    }
    const builtins = createBuiltins(buildDeps(store, c.env, pkg.version))
    const refresh = c.req.query('refresh') === '1'
    const model = await helpModelFor(node, registry, ctx, builtins, {
      store,
      secrets: secretStore(store, c.env),
      env: c.env,
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
    const remote = await remotePassthroughIfMatch(c, ctx, registry, raw, null)
    if (remote) return remote

    let node: TreeNode
    try {
      node = await registry.get(raw)
    } catch {
      throw TBError.notFound('not found')
    }

    // --- mcp/http 上游工具调用(Proto §4.2):scope 恒 'call';虚拟名反查上游真名再调 Provider。 ---
    if ((node.kind === 'mcp' || node.kind === 'http') && node.config !== undefined) {
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
      const provider = providerFor(node, secretStore(store, c.env), c.env)
      const tools = await upstreamTools(
        node,
        provider,
        store,
        c.env,
        false,
        new Date().toISOString(),
      )
      const upstreamName = resolveUpstreamTool(node.virtualize, tools, body.tool)
      const result = await provider.call(upstreamName, args)
      // MCP RPC 业务错误(result.isError)是正常返回值(HTTP 200),按 §1.2 协商渲染其 content。
      return renderResult(result.content, negotiate(c.req.header('accept')))
    }

    // --- device shell 调用(Proto §6.3):节点级 read/call 后转发到 DeviceSession DO。 ---
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
      const result = await invokeDevice(c.env, node.config.deviceId, {
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
      if (cfg.provider === 'device-fs') {
        const result = await invokeDevice(c.env, deviceIdForDeviceFs(cfg), {
          path: 'fs',
          tool: body.tool,
          arguments: (body.arguments ?? {}) as Record<string, unknown>,
        })
        return renderResult(result, negotiate(c.req.header('accept')))
      }
      const provider = await contextProviderFor(node, cfg, {
        store,
        env: c.env,
        requestUrl: c.req.url,
      })
      const args = (body.arguments ?? {}) as Record<string, unknown>
      const result = await dispatchContextCmd(provider, body.tool, args)
      return renderResult(result, negotiate(c.req.header('accept')))
    }

    if (node.kind !== 'builtin' || node.config?.kind !== 'builtin') {
      throw TBError.unimplemented(`kind '${node.kind}' not callable`)
    }

    const builtins = createBuiltins(buildDeps(store, c.env, pkg.version))
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
      assertRemoteConfigAllowed(cfgPatch, c.env)
      await assertRegisterPath(registry, ctx, targetPath, cmd === 'delete' ? 'delete' : 'write')
      // context 配置校验 + s3 连通探测(Proto §5.3):探测出站网络,须在权限判定之后。
      await assertContextConfig(cfgPatch, c.env, secretStore(store, c.env))
      registryTarget = targetPath
    }

    const result = await mod.dispatch(cmd, args, ctx)
    // 注册变更 → 失效该节点工具缓存(Proto §4.2:Write/Update/Delete 触发失效)。
    if (registryTarget !== undefined) await invalidateToolCache(store, registryTarget)
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
      const remote = await remotePassthroughIfMatch(c, ctx, registry, path, '~skill')
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
      return new Response(JSON.stringify({ kind: 'context', capabilities: CONTEXT_CAPABILITIES }), {
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
    assertRemoteConfigAllowed(body.config, c.env)
    // register 判定 + §2.4 路径规则(含 existing 查询)。
    if (!check(ctx, path, 'register').allow) {
      throw new TBError('permission_denied', `no scope grants 'register' on '${path}'`)
    }
    await assertRegisterPath(registry, ctx, body.path, 'write')
    // context 配置校验 + s3 连通探测(Proto §5.3):探测出站网络,须在权限判定之后。
    await assertContextConfig(body.config, c.env, secretStore(store, c.env))
    const now = new Date().toISOString()
    const node = await registry.write(body, ctx.keyId, now)
    // 注册变更 → 失效该节点工具缓存(Proto §4.2)。
    await invalidateToolCache(store, body.path)
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

/** §2.4 反向注册路径判定(查 existing 占用者)。allow=false 则抛其 error。 */
async function assertRegisterPath(
  registry: NodeRegistryStore,
  ctx: CallContext,
  targetPath: TreePath,
  action: 'write' | 'delete',
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
        node.kind === 'device') &&
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
  const resp = await remotePassthroughIfMatch(c, ctx, registry, treePath, '~tree', headers)
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
  deps: { store: StateStore; secrets: SecretStoreImpl; env: Env; refresh: boolean; now: string },
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
  if (node.kind === 'mcp' || node.kind === 'http') {
    const provider = providerFor(node, deps.secrets, deps.env)
    const raw = await upstreamTools(node, provider, deps.store, deps.env, deps.refresh, deps.now)
    const { exposed } = virtualizeTools(node.virtualize, raw)
    return toolsToHelpModel(node.path, { kind: node.kind, description: node.description }, exposed)
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
    return contextHelpModel(node, { readOnly: node.config.readOnly ?? false })
  }
  throw TBError.unimplemented(`~help for kind '${node.kind}' not implemented yet`)
}

/** 为 mcp/http 节点构造对应 Provider(其余 kind 无 Provider → unimplemented)。 */
function providerFor(node: TreeNode, secrets: SecretStoreImpl, env: Env): UpstreamProvider {
  const insecure = allowInsecure(env)
  if (node.kind === 'mcp' && node.config?.kind === 'mcp') {
    return createMcpProvider(node.config as McpConfig, secrets, { allowInsecure: insecure })
  }
  if (node.kind === 'http' && node.config?.kind === 'http') {
    return createHttpProvider(node.config as HttpConfig, secrets, { allowInsecure: insecure })
  }
  throw TBError.unimplemented(`kind '${node.kind}' has no tool provider`)
}

/** 取上游工具集:mcp 走 `toolcache:<path>` 缓存(TTL + refresh);http 从 config 直接生成。 */
function upstreamTools(
  node: TreeNode,
  provider: UpstreamProvider,
  store: StateStore,
  env: Env,
  refresh: boolean,
  now: string,
): Promise<ToolSpec[]> {
  if (node.kind === 'mcp') {
    return getTools(store, node.path, () => provider.list(), {
      refresh,
      ttl: toolCacheTtl(env),
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
  const store = c.get('store')
  // 必须 await(而非裸 return async promise):裸返回时其 reject 会在链接那一 tick 被
  // workerd/miniflare 误报为 unhandled rejection,即便 runHandler 最终 catch(同 GET 通配注释)。
  return await passthroughRemote({
    config: node.config,
    nodePath: node.path,
    requestPath,
    method,
    ...(body !== undefined ? { body } : {}),
    headers,
    secrets: secretStore(store, c.env),
    env: c.env,
    requestUrl: c.req.url,
  })
}

/** 注册 remote 节点时的白名单校验:config.kind==='remote' → baseUrl 必须在 §7 白名单内。 */
function assertRemoteConfigAllowed(config: unknown, env: Env): void {
  if (config === null || typeof config !== 'object') return
  if ((config as { kind?: unknown }).kind !== 'remote') return
  const baseUrl = (config as { baseUrl?: unknown }).baseUrl
  if (typeof baseUrl !== 'string') {
    throw new TBError('invalid_argument', 'remote config 缺少 baseUrl')
  }
  assertRemoteAllowed(baseUrl, env)
}

// ---------- device 节点(Proto §6,Phase 4) ----------

function tbErrorFromBody(body: TBErrorBody): TBError {
  return new TBError(body.code, body.message, { retryable: body.retryable })
}

async function invokeDevice(
  env: Env,
  deviceId: string,
  req: { path: string; tool: string; arguments: Record<string, unknown> },
): Promise<unknown> {
  const id = crypto.randomUUID()
  const body = (await env.TB_DEVICE.getByName(deviceId).invoke({ id, ...req })) as DeviceCallResult
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

// ---------- context 节点(Proto §5,Phase 3) ----------

type ContextConfig = Extract<NodeConfig, { kind: 'context' }>

/** 正整数 env 解析(TB_REF_THRESHOLD_BYTES / TB_REF_TTL_SEC);非法/缺省 → undefined。 */
function positiveIntEnv(value: string | undefined): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

/** S3 类凭证值形状(Proto §5.2):JSON {"accessKeyId","secretAccessKey"};解析失败不回显值。 */
function parseS3Credentials(
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

/**
 * r2 presign 凭证链(Proto §5.2,按序):SecretStore 保留名 'r2-presign' →
 * env TB_R2_ACCESS_KEY_ID/TB_R2_SECRET_ACCESS_KEY → 均缺则 undefined($ref 走 /~ref 中转)。
 * endpoint/bucket 亦缺则无从 presign。
 */
async function r2PresignCredentials(
  env: Env,
  secrets: SecretStoreImpl,
): Promise<R2PresignCredentials | undefined> {
  const endpoint = env.TB_R2_S3_ENDPOINT
  const bucket = env.TB_R2_BUCKET
  if (endpoint === undefined || bucket === undefined) return undefined
  const stored = await secrets.resolve('r2-presign')
  if (stored !== undefined) {
    return { endpoint, bucket, ...parseS3Credentials(stored, 'r2-presign') }
  }
  if (env.TB_R2_ACCESS_KEY_ID !== undefined && env.TB_R2_SECRET_ACCESS_KEY !== undefined) {
    return {
      endpoint,
      bucket,
      accessKeyId: env.TB_R2_ACCESS_KEY_ID,
      secretAccessKey: env.TB_R2_SECRET_ACCESS_KEY,
    }
  }
  return undefined
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

/** 按 config.provider 构造底层 ObjectStore(plugin provider 归 Phase 5)。 */
async function contextObjectStoreFor(
  cfg: ContextConfig,
  env: Env,
  secrets: SecretStoreImpl,
): Promise<ObjectStore> {
  if (cfg.provider === 'r2') {
    return createR2ObjectStore(env.TB_R2, await r2PresignCredentials(env, secrets))
  }
  if (cfg.provider === 's3') {
    return createS3ObjectStore(await s3StoreConfig(cfg, secrets), {
      allowInsecure: allowInsecure(env),
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
  deps: { store: StateStore; env: Env; requestUrl: string },
): Promise<ObjectContextProvider> {
  const secrets = secretStore(deps.store, deps.env)
  const objects = await contextObjectStoreFor(cfg, deps.env, secrets)
  const opts: Parameters<typeof createObjectContextProvider>[1] = {
    nsPath: node.path,
    keyPrefix: contextKeyPrefix(cfg, node.path),
    readOnly: cfg.readOnly ?? false,
  }
  const threshold = positiveIntEnv(deps.env.TB_REF_THRESHOLD_BYTES)
  if (threshold !== undefined) opts.refThresholdBytes = threshold
  const ttlSec = positiveIntEnv(deps.env.TB_REF_TTL_SEC)
  if (ttlSec !== undefined) opts.presignTtlSec = ttlSec
  // /~ref 中转 URL 工厂:token 密钥派生自 TB_SECRET_ENCRYPTION_KEY;密钥缺省则不提供
  // (presign 也缺时 core 对大对象 Get 报 unavailable)。
  const encKey = deps.env.TB_SECRET_ENCRYPTION_KEY
  if (encKey !== undefined) {
    const origin = new URL(deps.requestUrl).origin
    const relayTtlSec = ttlSec ?? PRESIGN_TTL_SEC_DEFAULT
    opts.relayRefUrl = async (key) => {
      const exp = Math.floor(Date.now() / 1000) + relayTtlSec
      return `${origin}/~ref/${await signRefToken({ p: node.path, k: key, exp }, encKey)}`
    }
  }
  return createObjectContextProvider(objects, opts)
}

/** 数据面 {tool} → ContextProvider 方法派发;入参精细校验由 provider 承担。 */
async function dispatchContextCmd(
  provider: ObjectContextProvider,
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
      return await provider.Delete(args.path as string)
    case 'Search':
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
 * 注册/更新 context 节点时的配置校验(Proto §3.2/§5.3,注册时即拒):
 * provider 词表 r2|s3(plugin id 归 Phase 5);s3 必填 endpoint/bucket/authRef,
 * 且做一次浅 list 连通探测(D8)——失败 → unavailable(retryable);r2 不探测。
 */
async function assertContextConfig(
  config: unknown,
  env: Env,
  secrets: SecretStoreImpl,
): Promise<void> {
  if (config === null || typeof config !== 'object') return
  if ((config as { kind?: unknown }).kind !== 'context') return
  const cfg = config as ContextConfig
  if (cfg.provider !== 'r2' && cfg.provider !== 's3') {
    throw new TBError('invalid_argument', `未知 context provider:'${String(cfg.provider)}'`)
  }
  if (cfg.provider === 's3') {
    // 结构/凭证/https 校验失败 → invalid_argument(store 构造抛出)。
    const store = createS3ObjectStore(await s3StoreConfig(cfg, secrets), {
      allowInsecure: allowInsecure(env),
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
