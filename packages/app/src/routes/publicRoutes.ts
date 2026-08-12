/**
 * 树外免认证路由:healthz、`/~ref/<token>` 大对象中转、`/ui` Dashboard 静态资源、
 * 根路径浏览器跳转与 mcp 托管 OAuth 回调。
 *
 * 这些路由必须注册在认证中间件之前:它们各自持有自己的凭证形式(限时签名 token /
 * 加密 state)或本就无凭证(静态资源、健康检查)。
 */
import { isTBError, NodeRegistryStore, TBError, type TreeNode } from '@tool-bridge/core'
import type { AppContext, TbHono } from '../deps'
import type { RouteEnv } from './env'
import {
  finishMcpAuthorization,
  OAUTH_CALLBACK_PATH,
  openOAuthState,
  renderOAuthCallbackHtml,
} from '../oauth'
import { assertContextAlive, contextObjectStoreFor } from '../contextNodes'
import { finishProviderAuthorization } from '../providerOAuth'
import { runHandler, tbErrorResponse } from '../responses'
import { requirePluginExport } from '../toolNodes'
import { verifyRefToken } from '../refToken'

/**
 * provider 型 OAuth 的回调段(kind:'tool')。失败一律渲染失败页而非抛错:这是浏览器
 * 直达的端点,用户该看到一句人话,而不是 JSON 错误体。
 */
async function finishToolAuthorization(opts: {
  code: string
  deps: RouteEnv['deps']
  encryptionKey: string
  node: TreeNode
  origin: string
  verifier: string
}): Promise<Response> {
  const config = opts.node.config as { authRef?: string, export?: string, provider: string }
  try {
    const { export: exported } = await requirePluginExport(
      opts.deps.state,
      config.provider,
      'tool',
      'tool',
      config.export,
    )
    if (exported.oauth === undefined || config.authRef === undefined) {
      return renderOAuthCallbackHtml(false, 'target node is not an OAuth-backed tool mount')
    }
    await finishProviderAuthorization({
      authRef: config.authRef,
      code: opts.code,
      codeVerifier: opts.verifier,
      config: exported.oauth,
      encryptionKey: opts.encryptionKey,
      fetcher: fetch,
      nodePath: opts.node.path,
      now: new Date(),
      origin: opts.origin,
      secrets: opts.deps.secrets,
      store: opts.deps.state,
    })
  } catch (err) {
    return renderOAuthCallbackHtml(false, isTBError(err) ? err.message : 'token exchange failed')
  }
  return renderOAuthCallbackHtml(true, `挂载 '${opts.node.path}' 已完成授权`)
}

export function registerPublicRoutes(app: TbHono, env: RouteEnv): void {
  const { deps } = env

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
      // 两套 OAuth 流程共用这一个回调端点,按目标节点的 kind 分派:state 里的 `p` 已经是
      // 节点路径,不需要在 state 里再塞一个流程标记(那会多一处可被篡改的输入)。
      if (node.kind === 'tool' && node.config?.kind === 'tool') {
        return await finishToolAuthorization({
          code,
          deps,
          encryptionKey: encKey,
          node,
          origin: deps.canonicalOrigin ?? new URL(c.req.url).origin,
          verifier: payload.v,
        })
      }
      if (node.kind !== 'mcp' || node.config?.kind !== 'mcp' || node.config.auth !== 'oauth') {
        return renderOAuthCallbackHtml(false, 'target node is not an OAuth-backed mount')
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
}
