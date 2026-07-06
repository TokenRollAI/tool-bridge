/**
 * http 工具的请求拼装(Proto §3.2 HttpToolDef + Phase 2 定型)。
 *
 * 全部为 **core 纯逻辑**:只计算 `{url, method, body, headers}`,不发 fetch(gateway 拿去发)。
 */

import { TBError } from '../errors'
import type { HttpToolDef } from '../types'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'
export type HttpEffect = 'readonly' | 'mutating' | 'destructive'

/** buildHttpRequest 的产物:gateway 据此发 fetch。 */
export interface BuiltHttpRequest {
  url: string
  method: string
  /** GET/DELETE 无 body;POST/PUT 为剩余 args 的 JSON。 */
  body?: string
  headers: Record<string, string>
}

/** pathTemplate 的 `{param}` 占位(不含嵌套花括号)。 */
const PARAM_RE = /\{([^{}]+)\}/g

/** 剩余 args → query string(标量 String() 编码;undefined 跳过)。 */
function buildQuery(params: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.join('&')
}

/**
 * 按 HttpToolDef 拼请求(Phase 2 定型):
 * - `pathTemplate` 的 `{param}` 逐个从 `args` 取值(URL 编码后替换,取用即从剩余集移除);
 *   缺参 → invalid_argument。
 * - 剩余 args(未被占位消费的):GET/DELETE → query;POST/PUT → JSON body。
 * - 最终 url = `endpoint`(去尾斜杠)+ 替换后的相对 path。认证头不在此注入(见 authHeaderFor)。
 */
export function buildHttpRequest(
  def: HttpToolDef,
  endpoint: string,
  args: Record<string, unknown>,
): BuiltHttpRequest {
  const consumed = new Set<string>()
  const path = def.pathTemplate.replace(PARAM_RE, (_match, name: string) => {
    const value = args[name]
    if (value === undefined) {
      throw new TBError(
        'invalid_argument',
        `缺少路径参数 '${name}'(pathTemplate '${def.pathTemplate}')`,
      )
    }
    consumed.add(name)
    return encodeURIComponent(String(value))
  })

  const remaining: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (!consumed.has(k)) remaining[k] = v
  }

  const base = endpoint.replace(/\/+$/, '')
  const rel = path.startsWith('/') ? path : `/${path}`
  let url = `${base}${rel}`
  const headers: Record<string, string> = {}
  let body: string | undefined

  if (def.method === 'GET' || def.method === 'DELETE') {
    const qs = buildQuery(remaining)
    if (qs) url += `?${qs}`
  } else {
    body = JSON.stringify(remaining)
    headers['content-type'] = 'application/json'
  }

  return { url, method: def.method, body, headers }
}

/**
 * 工具的 effect(Phase 2 定型):显式 `effect` 优先;缺省派生——GET→readonly,其余→mutating。
 */
export function effectFor(def: { method: HttpMethod; effect?: HttpEffect }): HttpEffect {
  if (def.effect !== undefined) return def.effect
  return def.method === 'GET' ? 'readonly' : 'mutating'
}

/**
 * 认证头拼装(Proto §3.2 定型):默认头名 `Authorization`、scheme 前缀 `Bearer`。
 * `authScheme` 为空串 → 原样注入 secret 值(无 scheme 前缀)。返回 `[headerName, headerValue]`。
 */
export function authHeaderFor(
  config: { authHeader?: string; authScheme?: string },
  secret: string,
): [string, string] {
  const name = config.authHeader ?? 'Authorization'
  const scheme = config.authScheme
  const value =
    scheme === undefined ? `Bearer ${secret}` : scheme === '' ? secret : `${scheme} ${secret}`
  return [name, value]
}
