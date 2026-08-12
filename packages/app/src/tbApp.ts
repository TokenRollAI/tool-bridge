/**
 * 宿主中立 app 的装配面:只做"路由挂在哪、顺序如何",不含任何 handler 实现。
 *
 * 顺序即安全语义,改动前先读懂三段:
 * 1. 安全头中间件必须最先(覆盖 API、Dashboard 与错误响应);
 * 2. 树外免认证路由(healthz / ~ref / /ui / OAuth 回调)必须在认证中间件之前——
 *    它们各自持有自己的凭证形式(限时签名 token、加密 state)或本就无凭证;
 * 3. 其余一切在认证中间件之后,GET/DELETE/POST 三个通配分派按末段保留字路由。
 *
 * handler 实现见 routes/*,跨路由的纯函数见 paths/federation/deviceNodes/toolNodes/
 * contextNodes/helpModel/responses,宿主注入面形状见 deps.ts。
 */
import { identify, isTBError, TBError } from '@tool-bridge/core'
import { Hono } from 'hono'
import {
  handleFeedbackDelete,
  handleFeedbackGet,
  handleFeedbackPost,
} from './routes/feedback'
import { runHandler, tbErrorResponse, withSecurityHeaders } from './responses'
import { handleAuthorize, handleRegister } from './routes/register'
import { handleDescribe, handleSkill } from './routes/describe'
import { registerPublicRoutes } from './routes/publicRoutes'
import { registerSearchRoute } from './routes/search'
import { type TbAppDeps, type Vars } from './deps'
import { registerMcpRoute } from './routes/mcp'
import { handleInvoke } from './routes/invoke'
import { requireDevice } from './deviceNodes'
import { createRouteEnv } from './routes/env'
import { handleHelp } from './routes/help'
import { handleTree } from './routes/tree'

export type { PluginBindings } from './providers/pluginClient'
export type { RemoteSettings } from './providers/remote'
export type { UpstreamProvider } from './providers/types'

/**
 * 构造 tool-bridge 的 Hono app(宿主中立;Workers 适配见 app.ts,SDK 装配见 packages/sdk)。
 */
export function createTbApp(deps: TbAppDeps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>()
  const env = createRouteEnv(deps)

  // 放在全部路由之前,确保宿主中立 app 的 API、Dashboard、错误响应都覆盖安全头。
  app.use('*', async (c, next) => {
    await next()
    const response = c.res
    const secured = withSecurityHeaders(response)
    if (secured !== response) c.res = secured
  })

  // 树外免认证路由(healthz / ~ref 中转 / /ui 静态资源 / OAuth 回调),须在认证中间件之前。
  registerPublicRoutes(app, env)

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

  registerMcpRoute(app, env)
  registerSearchRoute(app, env)

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

  // GET 通配分派:按 pathname 末段路由到 ~help / ~tree / ~skill;其余 GET 无对应端点 → 404。
  // (不用 `/:path{.*}/~help` 具名后缀路由——Hono 该形式对 3+ 段路径不匹配。)
  // handleX(c) 必须 `await`(而非裸 `return handleX(c)`):裸返回 async promise 时其 reject
  // 会在链接那一 tick 被 workerd 误报为 unhandled,即便 runHandler 最终 catch。
  app.get('/*', c =>
    runHandler(async () => {
      const segs = new URL(c.req.url).pathname.replace(/\/+$/, '').split('/')
      const last = segs.pop() ?? ''
      if (last === '~help') return await handleHelp(c, env)
      if (last === '~tree') return await handleTree(c, env)
      if (last === '~skill') return await handleSkill(c, env)
      if (last === '~describe') return await handleDescribe(c, env)
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
      if (segs[segs.length - 2] === '~feedback') return await handleFeedbackDelete(c, env)
      throw TBError.notFound('no such path')
    }),
  )

  // POST 通配分派:末段为 ~register → 反向注册;~authorize → OAuth 发起;~feedback(末段或
  // 倒数第二段)→ 反馈提交/投票;否则数据面调用。
  app.post('/*', async c =>
    await runHandler(async () => {
      const segs = new URL(c.req.url).pathname.replace(/\/+$/, '').split('/')
      const last = segs.pop() ?? ''
      if (last === '~register') return await handleRegister(c, env)
      if (last === '~authorize') return await handleAuthorize(c, env)
      if (last === '~feedback' || segs[segs.length - 1] === '~feedback') {
        return await handleFeedbackPost(c, env)
      }
      return await handleInvoke(c, env)
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
