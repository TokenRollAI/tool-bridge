import {
  type BuiltinModule,
  buildTree,
  type CallContext,
  type CmdSpec,
  check,
  checkRegisterPath,
  checkScopes,
  clampDepth,
  contentTypeFor,
  createBuiltins,
  filterVisible,
  type HelpModel,
  identify,
  isTBError,
  type NodeInput,
  NodeRegistryStore,
  negotiate,
  type Representation,
  renderHelpDsl,
  renderHelpJson,
  type StateStore,
  TBError,
  type TreeEntry,
  type TreeJson,
  type TreeNode,
  type TreePath,
} from '@tool-bridge/core'
import { type Context, Hono } from 'hono'
import pkg from '../package.json' with { type: 'json' }
import { buildDeps, ensureBootstrapped } from './bootstrap'
import { KvStateStore } from './kvStateStore'

/**
 * Workers 运行时绑定。KV/R2 名称从 TB_NAME_PREFIX 派生(wrangler.jsonc)。
 * TB_SECRET_ENCRYPTION_KEY / TB_BOOTSTRAP_ADMIN_SK 经 wrangler secret 或 .dev.vars 注入。
 */
export interface Env {
  TB_KV: KVNamespace
  TB_R2: R2Bucket
  TB_SECRET_ENCRYPTION_KEY?: string
  TB_BOOTSTRAP_ADMIN_SK?: string
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

/** 根路径与保留段:从 URL pathname 提取树路径与保留段(如 "docs/x/~help" → { path:"docs/x", seg:"~help" })。 */
function splitReserved(pathname: string, seg: string): TreePath | null {
  const p = pathname.replace(/^\/+|\/+$/g, '')
  if (p === seg) return '' // 根级 /~help、/~tree
  if (p.endsWith(`/${seg}`)) return p.slice(0, -(seg.length + 1))
  return null
}

/**
 * 构造 tool-bridge 网关的 Hono app(Phase 1:认证 + HTBP 核心树 + builtin 装配)。
 */
export function createApp(): Hono<{ Bindings: Env; Variables: Vars }> {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>()

  // GET /healthz → 200 JSON,树外免认证(Proto §1.1)。version 单一真源:package.json。
  app.get('/healthz', (c) => c.json({ healthy: true, version: pkg.version }))

  // 认证中间件(除 /healthz 外全路由):Bearer → identify → 401 或注入 ctx(Proto §0.2)。
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

  // --- ~tree(根级与子树)---
  const handleTree = async (c: AppContext): Promise<Response> => {
    const path = splitReserved(new URL(c.req.url).pathname, '~tree')
    if (path === null) throw TBError.notFound('no such path')
    const ctx = c.get('ctx')
    const store = c.get('store')
    // 根路径('')免 read 判定(整棵树入口);非根节点需 (path,'read')。
    if (path !== '' && !check(ctx, path, 'read').allow) throw TBError.notFound('not found')
    const registry = new NodeRegistryStore(store)
    const depth = clampDepth(Number(c.req.query('depth')))
    const getChildren = async (p: TreePath): Promise<TreeEntry[]> => {
      const kids = filterVisible(await registry.children(p), ctx.scopes, checkScopes)
      return kids.map((n) => toEntry(n))
    }
    const tree = await buildTree({ root: path, depth, getChildren })
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
      const children = filterVisible(await registry.children(''), ctx.scopes, checkScopes)
      const model: HelpModel = {
        node: { path: '', kind: 'directory', description: 'tool-bridge root' },
        cmds: [],
        children: children.map((n) => ({ path: n.path, kind: n.kind, description: n.description })),
      }
      return renderHelp(model, rep)
    }

    // 不可见(read 判不过)→ 404 不泄露存在性(v1 教训:deny==not_found)。
    if (!check(ctx, path, 'read').allow) throw TBError.notFound('not found')
    let node: TreeNode
    try {
      node = await registry.get(path)
    } catch {
      throw TBError.notFound('not found')
    }
    const builtins = createBuiltins(buildDeps(store, c.env, pkg.version))
    const model = await helpModelFor(node, registry, ctx, builtins)
    return renderHelp(model, rep)
  }

  // --- POST /<path> 数据面调用 ---
  const handleInvoke = async (c: AppContext): Promise<Response> => {
    const raw = new URL(c.req.url).pathname.replace(/^\/+|\/+$/g, '')
    if (raw === '' || raw.split('/').some((s) => s.startsWith('~'))) {
      throw TBError.notFound('no such path')
    }
    const ctx = c.get('ctx')
    const store = c.get('store')
    const registry = new NodeRegistryStore(store)

    // 节点不可见 → 404(隐藏存在性)。
    if (!check(ctx, raw, 'read').allow) throw TBError.notFound('not found')
    let node: TreeNode
    try {
      node = await registry.get(raw)
    } catch {
      throw TBError.notFound('not found')
    }
    if (node.kind !== 'builtin' || node.config?.kind !== 'builtin') {
      throw TBError.unimplemented(`kind '${node.kind}' not callable in Phase 1`)
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
    if (node.config.module === 'registry' && ['write', 'update', 'delete'].includes(cmd)) {
      const targetPath = typeof args.path === 'string' ? args.path : undefined
      if (targetPath === undefined) {
        throw new TBError('invalid_argument', "field 'path' must be a string")
      }
      await assertRegisterPath(registry, ctx, targetPath, cmd === 'delete' ? 'delete' : 'write')
    }

    const result = await mod.dispatch(cmd, args, ctx)
    return renderResult(result, negotiate(c.req.header('accept')))
  }

  // --- ~skill:Phase 1 占位 501 ---
  const handleSkill = (_c: AppContext): Response =>
    tbErrorResponse(TBError.unimplemented('~skill not implemented yet'))

  // GET 通配分派:按 pathname 末段路由到 ~help / ~tree / ~skill;其余 GET 无对应端点 → 404。
  // (不用 `/:path{.*}/~help` 具名后缀路由——Hono 该形式对 3+ 段路径不匹配。)
  // handleX(c) 必须 `await`(而非裸 `return handleX(c)`):裸返回 async promise 时其 reject
  // 会在链接那一 tick 被 workerd 误报为 unhandled,即便 runHandler 最终 catch。
  app.get('/*', (c) =>
    runHandler(async () => {
      const last = new URL(c.req.url).pathname.replace(/\/+$/, '').split('/').pop() ?? ''
      if (last === '~help') return await handleHelp(c)
      if (last === '~tree') return await handleTree(c)
      if (last === '~skill') return handleSkill(c)
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
    const body = (await c.req.json().catch(() => null)) as NodeInput | null
    if (!body || typeof body.path !== 'string') {
      throw new TBError('invalid_argument', 'body must be a NodeInput with a path')
    }
    // register 判定 + §2.4 路径规则(含 existing 查询)。
    if (!check(ctx, path, 'register').allow) {
      throw new TBError('permission_denied', `no scope grants 'register' on '${path}'`)
    }
    await assertRegisterPath(registry, ctx, body.path, 'write')
    const now = new Date().toISOString()
    const node = await registry.write(body, ctx.keyId, now)
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
    sk: { scopes: ctx.scopes, id: ctx.keyId },
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

/** 节点的 HelpModel:directory 列可见子节点;builtin 取模块 help()。 */
async function helpModelFor(
  node: TreeNode,
  registry: NodeRegistryStore,
  ctx: CallContext,
  builtins: Map<string, BuiltinModule>,
): Promise<HelpModel> {
  if (node.kind === 'builtin' && node.config?.kind === 'builtin') {
    const mod = builtins.get(node.config.module)
    if (mod) return mod.help(node.path)
  }
  const children = filterVisible(await registry.children(node.path), ctx.scopes, checkScopes)
  return {
    node: { path: node.path, kind: node.kind, description: node.description },
    cmds: [],
    children: children.map((n) => ({ path: n.path, kind: n.kind, description: n.description })),
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
