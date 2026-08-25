/**
 * 线上响应层:错误渲染、安全响应头、handler 包裹,以及 ~help / 调用返回值 / ~tree
 * 三类表现的渲染(内容协商结果由 core negotiate 给出,这里只负责落成 Response)。
 */
import {
  AnnotationStore,
  contentTypeFor,
  FeedbackStore,
  type HelpModel,
  isTBError,
  renderHelpDsl,
  renderHelpJson,
  renderHelpMarkdown,
  type Representation,
  type StateStore,
  TBError,
  type TreeJson,
  type TreePath,
} from '@tool-bridge/core'
import { helpJsonSchema, tbErrorBodySchema } from '@tool-bridge/core/protocol'

/** 把 TBError 渲染为线上响应。 */
export function tbErrorResponse(err: TBError): Response {
  return new Response(JSON.stringify(tbErrorBodySchema.parse(err.toJSON())), {
    status: err.httpStatus,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * 全宿主统一的安全响应头(Workers / Node / SDK 内嵌实例)。OAuth 回调页自带更严格
 * 的 CSP,此处只在响应未声明 CSP 时补默认策略。WebSocket 101 不重建 Response。
 */
export function withSecurityHeaders(res: Response): Response {
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
export async function runHandler(fn: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    if (isTBError(err)) return tbErrorResponse(err)
    return tbErrorResponse(new TBError('internal', 'internal error'))
  }
}
/** 渲染 HelpModel:按协商表现输出 DSL(text/plain)、JSON 或 Markdown(可读性表现)。 */
export function renderHelp(model: HelpModel, rep: Representation): Response {
  if (rep === 'json') {
    return new Response(JSON.stringify(helpJsonSchema.parse(renderHelpJson(model))), {
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
export async function enrichHelp(model: HelpModel, path: TreePath, store: StateStore): Promise<HelpModel> {
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
export function renderResult(value: unknown, rep: Representation): Response {
  const json = JSON.stringify(value ?? null)
  if (rep === 'json') {
    return new Response(json, { headers: { 'content-type': contentTypeFor('json') } })
  }
  return new Response(`\`\`\`json\n${json}\n\`\`\`\n`, {
    headers: { 'content-type': contentTypeFor('markdown') },
  })
}
/** ~tree 的 DSL 文本渲染:每行缩进树(简单实现;JSON 是规范形状)。 */
export function renderTreeDsl(tree: TreeJson): string {
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
