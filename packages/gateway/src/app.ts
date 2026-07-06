import { HTBP_HELP_HEADER, isTBError, TBError } from '@tool-bridge/core'
import { Hono } from 'hono'
import pkg from '../package.json' with { type: 'json' }

/**
 * Workers 运行时绑定(Phase 0 占位:定义但未使用)。
 * KV/R2 名称从 TB_NAME_PREFIX 派生,见 wrangler.jsonc。
 */
export interface Env {
  TB_KV: KVNamespace
  TB_R2: R2Bucket
}

/** 把 TBError 渲染为线上响应:HTTP 状态取 httpStatus,body 为规范 TBError 形状(Proto §0.2)。 */
function tbErrorResponse(err: TBError): Response {
  return new Response(JSON.stringify(err.toJSON()), {
    status: err.httpStatus,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** 尚未落地的控制面保留段,Phase 0 统一返回 501(Proto §0.2 未实现占位)。 */
const UNIMPLEMENTED_RESERVED = ['/~tree', '/~skill', '/~register', '/~describe'] as const

/**
 * 构造 tool-bridge 网关的 Hono app。
 *
 * Workers 与 Node 宿主共用同一工厂(Proto §7:ToolBridge.fetch 挂到任意宿主)。
 * Phase 0 只实现:/healthz、根 /~help 占位、保留段 501、兜底 404 + TBError↔HTTP 映射。
 */
export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  // GET /healthz → 200 JSON。version 取自 gateway package.json,单一真源避免漂移(DOD.md:40)。
  app.get('/healthz', (c) => c.json({ healthy: true, version: pkg.version }))

  // GET /~help(根)→ 200 text/plain,首行 htbp 0.1;空树占位:无 node/cmd 行(Proto §1.1-1.3)。
  // 完整 ~help 生成在 Phase 1;此处只满足"根 ~help 占位"契约(DOD.md:35)。
  app.get(
    '/~help',
    () =>
      new Response(`${HTBP_HELP_HEADER}\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
  )

  // 其他保留段 → 501。GET 全部;~register 另接受 POST(HTTP 反向注册入口,Phase 1+)。
  for (const path of UNIMPLEMENTED_RESERVED) {
    app.get(path, () => tbErrorResponse(TBError.unimplemented(`${path} not implemented yet`)))
  }
  app.post('/~register', () =>
    tbErrorResponse(TBError.unimplemented('~register not implemented yet')),
  )

  // 兜底:未匹配任何路由 → 404 裸 TBError(Proto §0.2)。
  app.notFound((c) => {
    const { pathname } = new URL(c.req.url)
    return tbErrorResponse(TBError.notFound(`no such path: ${pathname}`))
  })

  // 未捕获异常:已知 TBError 按其 httpStatus 映射;其余归 internal 500(不泄漏内部细节)。
  app.onError((err) => {
    if (isTBError(err)) return tbErrorResponse(err)
    return tbErrorResponse(new TBError('internal', 'internal error'))
  })

  return app
}
