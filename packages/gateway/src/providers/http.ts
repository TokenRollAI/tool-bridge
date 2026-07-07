/**
 * http 内置 Provider:按 `HttpToolDef` 拼请求,`authRef` 解析后注入认证头。
 *
 * - `List` 直接从 `config.tools`(HttpToolDef[])生成 ToolSpec(effect 经 `effectFor` 派生);
 *   无需网络。
 * - `Call`:`buildHttpRequest`(core 纯逻辑,{param} 占位 + 剩余 args 按 method 入 query/body)
 *   + `authHeaderFor`(config.authHeader/authScheme)注入凭证 → fetch。
 * - 响应:2xx → ToolResult(json 或 text);非 2xx / 网络失败 → `normalizeUpstreamError` 归一。
 */

import {
  assertSecureUrl,
  authHeaderFor,
  buildHttpRequest,
  effectFor,
  type HttpToolDef,
  normalizeUpstreamError,
  type SecretStoreImpl,
  TBError,
  type ToolResult,
  type ToolSpec,
} from '@tool-bridge/core'
import type { UpstreamProvider } from './types'

/** http 节点 config(authHeader/authScheme 为可选认证头形态)。 */
export interface HttpConfig {
  endpoint: string
  tools: HttpToolDef[]
  authRef?: string
  authHeader?: string
  authScheme?: string
}

function toSpec(t: HttpToolDef): ToolSpec {
  const spec: ToolSpec = { name: t.name, description: t.description, effect: effectFor(t) }
  if (t.inputSchema !== undefined) spec.inputSchema = t.inputSchema
  return spec
}

/**
 * 构造 http Provider。构造即对 `endpoint` 做 https 强制。
 * `allowInsecure`(env `TB_ALLOW_INSECURE_HTTP=true`)放行 http:// endpoint。
 */
export function createHttpProvider(
  config: HttpConfig,
  secrets: SecretStoreImpl,
  opts: { allowInsecure: boolean },
): UpstreamProvider {
  const secErr = assertSecureUrl(config.endpoint, opts.allowInsecure)
  if (secErr) throw secErr

  return {
    list: () => Promise.resolve(config.tools.map(toSpec)),
    call: async (name, args) => {
      const def = config.tools.find((t) => t.name === name)
      if (!def) throw TBError.notFound(`未知工具:'${name}'`)

      const req = buildHttpRequest(def, config.endpoint, args)
      const headers: Record<string, string> = { ...req.headers }
      if (config.authRef !== undefined) {
        const cred = await secrets.resolve(config.authRef)
        if (cred !== undefined) {
          const [hn, hv] = authHeaderFor(config, cred)
          headers[hn] = hv
        }
      }

      let resp: Response
      try {
        resp = await fetch(req.url, {
          method: req.method,
          headers,
          ...(req.body !== undefined ? { body: req.body } : {}),
        })
      } catch (err) {
        throw normalizeUpstreamError({
          kind: 'network',
          message: err instanceof Error ? err.message : String(err),
        })
      }

      if (resp.status < 200 || resp.status >= 300) {
        throw normalizeUpstreamError({ kind: 'http', status: resp.status })
      }

      const ct = resp.headers.get('content-type') ?? ''
      const content: unknown = ct.includes('application/json')
        ? await resp.json()
        : await resp.text()
      return { content } satisfies ToolResult
    },
  }
}
