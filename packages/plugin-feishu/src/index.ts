/**
 * 飞书官方远程 MCP 的 tool-provider plugin(CF Worker,自部署后注册进 tool-bridge)。
 *
 * 解决的问题:飞书 TAT 凭证约 2h 过期,直接以 kind:mcp 挂载须人工 `tb secret set` 续期;
 * 本 plugin 按需换发并缓存 TAT(tat.ts),上游 401 时强制重换发重试一次——对平台侧
 * 呈现为永不过期的工具源。
 *
 * **凭证边界**:app_id/app_secret 不由 plugin 自持——凭证存平台 SecretStore(挂载
 * config.authRef),每次调用由平台 resolve 后经 `X-TB-Upstream-Auth`(base64url JSON
 * `{"app_id":"...","app_secret":"..."}`)传入。plugin 无凭证即不可用:公网可达的
 * endpoint 即使 PLUGIN_TOKEN 泄漏,也拿不到任何飞书凭证;同一部署可服务多个不同
 * 凭证的挂载(TAT 缓存按 app_id 键控)。
 *
 * 契约面(tool-provider/v1,与 gateway pluginClient/契约校验对齐):
 *   GET  /healthz     → { healthy: true }
 *   GET  /~describe   → { kind, interfaceVersion }
 *   GET  /~help       → Help DSL / HelpJson(Accept 协商)
 *   POST /            → envelope {"tool":"List|Get|Call","arguments":{...}}
 * envelope 鉴权:`Authorization: Bearer <PLUGIN_TOKEN>`(注册后由平台签发,配进
 * Worker secret);X-TB-Request-Id 幂等去重(isolate 内存,重放返回首次结果)。
 *
 * env(wrangler secret / vars):
 *   PLUGIN_TOKEN                      — 平台 pluginToken(secret;注册前可暂缺,届时仅要求非空)
 *   FEISHU_ALLOWED_TOOLS              — 工具白名单(vars,逗号分隔;飞书无此头恒回空列表)
 *   FEISHU_MCP_URL / FEISHU_AUTH_URL  — 端点 override(vars,可缺省)
 */

import {
  base64urlDecode,
  decodePluginCall,
  HEADER_TB_UPSTREAM_AUTH,
  type HelpModel,
  isTBError,
  negotiate,
  RequestDedupe,
  renderHelpDsl,
  renderHelpJson,
  TBError,
} from '@tool-bridge/core'
import {
  callTool,
  DEFAULT_MCP_URL,
  type FeishuMcpConfig,
  type FeishuTool,
  isUnauthorized,
  listTools,
} from './feishuMcp'
import { tenantAccessToken } from './tat'

export interface Env {
  FEISHU_ALLOWED_TOOLS: string
  PLUGIN_TOKEN?: string
  FEISHU_MCP_URL?: string
  FEISHU_AUTH_URL?: string
}

/** X-TB-Upstream-Auth 解码后的飞书凭证形状。 */
interface FeishuCredential {
  app_id: string
  app_secret: string
}

/**
 * 从 X-TB-Upstream-Auth 取飞书凭证(base64url JSON {app_id,app_secret})。
 * 缺失 → unavailable(挂载少配了 authRef,是配置错误不是调用方参数错);坏形状 → invalid_argument。
 */
function upstreamCredential(req: Request): FeishuCredential {
  const header = req.headers.get(HEADER_TB_UPSTREAM_AUTH)
  if (header === null || header === '') {
    throw new TBError(
      'unavailable',
      `缺 ${HEADER_TB_UPSTREAM_AUTH}:挂载节点须配置 authRef(飞书凭证 JSON {"app_id","app_secret"} 存平台凭证保管)`,
      { retryable: false },
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64urlDecode(header)))
  } catch {
    throw new TBError('invalid_argument', `${HEADER_TB_UPSTREAM_AUTH} 非法(须 base64url JSON)`)
  }
  const cred = parsed as Partial<FeishuCredential>
  if (typeof cred.app_id !== 'string' || cred.app_id === '') {
    throw new TBError('invalid_argument', `${HEADER_TB_UPSTREAM_AUTH} 缺 app_id`)
  }
  if (typeof cred.app_secret !== 'string' || cred.app_secret === '') {
    throw new TBError('invalid_argument', `${HEADER_TB_UPSTREAM_AUTH} 缺 app_secret`)
  }
  return { app_id: cred.app_id, app_secret: cred.app_secret }
}

const KIND = 'tool-provider'
const INTERFACE_VERSION = 'tool-provider/v1'

const dedupe = new RequestDedupe()

// ---------- ToolSpec 转换(annotations → effect,与 gateway providers/mcp.ts 同规则) ----------

interface ToolSpec {
  name: string
  description?: string
  inputSchema?: unknown
  effect?: string
}

function toSpec(t: FeishuTool): ToolSpec {
  const spec: ToolSpec = { name: t.name }
  if (t.description !== undefined) spec.description = t.description
  if (t.inputSchema !== undefined) spec.inputSchema = t.inputSchema
  if (t.annotations?.readOnlyHint === true) spec.effect = 'read'
  else if (t.annotations?.destructiveHint === true) spec.effect = 'destructive'
  return spec
}

// ---------- 方法实现(401 → 强制重换发 TAT 重试一次) ----------

async function mcpConfig(
  env: Env,
  cred: FeishuCredential,
  forceTat = false,
): Promise<FeishuMcpConfig> {
  const tat = await tenantAccessToken(
    {
      appId: cred.app_id,
      appSecret: cred.app_secret,
      ...(env.FEISHU_AUTH_URL !== undefined ? { authUrl: env.FEISHU_AUTH_URL } : {}),
    },
    forceTat,
  )
  return {
    url: env.FEISHU_MCP_URL ?? DEFAULT_MCP_URL,
    appId: cred.app_id,
    tat,
    allowedTools: env.FEISHU_ALLOWED_TOOLS ?? '',
  }
}

/**
 * 执行 `fn`,上游 401 时强制重换发 TAT 后重试一次。缓存的 TAT 在余量内也可能已被
 * 飞书吊销(如重置 app_secret),401 是唯一失效信号;重试必须绕过缓存(force)。
 */
async function withTatRetry<T>(
  env: Env,
  cred: FeishuCredential,
  fn: (cfg: FeishuMcpConfig) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await mcpConfig(env, cred))
  } catch (err) {
    if (!isUnauthorized(err)) throw err
    return await fn(await mcpConfig(env, cred, true))
  }
}

async function invoke(
  env: Env,
  cred: FeishuCredential,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (tool) {
    case 'List':
      return (await withTatRetry(env, cred, listTools)).map(toSpec)
    case 'Get': {
      const name = args.name
      if (typeof name !== 'string' || name === '') {
        throw new TBError('invalid_argument', "field 'name' must be a non-empty string")
      }
      const found = (await withTatRetry(env, cred, listTools)).find((t) => t.name === name)
      if (found === undefined) throw TBError.notFound(`未知工具:'${name}'`)
      return toSpec(found)
    }
    case 'Call': {
      const name = args.name
      if (typeof name !== 'string' || name === '') {
        throw new TBError('invalid_argument', "field 'name' must be a non-empty string")
      }
      const callArgs =
        typeof args.args === 'object' && args.args !== null
          ? (args.args as Record<string, unknown>)
          : {}
      // MCP RPC 业务错误(isError)是正常返回值,原样进 ToolResult。
      return await withTatRetry(env, cred, (cfg) => callTool(cfg, name, callArgs))
    }
    default:
      throw new TBError('invalid_argument', `unknown method '${tool}'(见 ~help)`)
  }
}

// ---------- 元端点 ----------

const HELP: HelpModel = {
  node: {
    path: 'plugin-feishu',
    kind: 'tool',
    description: 'Feishu official remote MCP (auto-refreshed tenant_access_token)',
  },
  cmds: [
    {
      name: 'List',
      method: 'POST',
      path: '/',
      h: 'List Feishu MCP tools (filtered by FEISHU_ALLOWED_TOOLS)',
      returns: 'ToolSpec[]',
      scope: 'read',
    },
    {
      name: 'Get',
      method: 'POST',
      path: '/',
      h: 'Get one tool spec by name',
      returns: 'ToolSpec',
      scope: 'read',
    },
    {
      name: 'Call',
      method: 'POST',
      path: '/',
      h: 'Call a Feishu MCP tool',
      returns: 'ToolResult',
      scope: 'call',
    },
  ],
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(err: unknown): Response {
  const tb = isTBError(err)
    ? err
    : new TBError('internal', err instanceof Error ? err.message : String(err))
  return json(tb.toJSON(), tb.httpStatus)
}

async function handleEnvelope(req: Request, env: Env): Promise<Response> {
  // 鉴权:Bearer 非空;配置了 PLUGIN_TOKEN 时还须逐字相等(platform-token 语义)。
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (token === '') throw TBError.unauthenticated('missing Bearer token')
  if (env.PLUGIN_TOKEN !== undefined && env.PLUGIN_TOKEN !== '' && token !== env.PLUGIN_TOKEN) {
    throw TBError.unauthenticated('bad plugin token')
  }

  const call = decodePluginCall(await req.text())
  const cred = upstreamCredential(req)
  const requestId = req.headers.get('x-tb-request-id')
  const exec = (): Promise<unknown> => invoke(env, cred, call.tool, call.arguments)
  const result =
    requestId !== null && requestId !== '' ? await dedupe.run(requestId, exec) : await exec()
  return json(result ?? null)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    try {
      if (req.method === 'GET') {
        if (url.pathname === '/healthz') return json({ healthy: true })
        if (url.pathname === '/~describe') {
          return json({ kind: KIND, interfaceVersion: INTERFACE_VERSION })
        }
        if (url.pathname === '/~help') {
          if (negotiate(req.headers.get('accept') ?? undefined) === 'json') {
            return json(renderHelpJson(HELP))
          }
          return new Response(renderHelpDsl(HELP), {
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          })
        }
        throw TBError.notFound(`no such path '${url.pathname}'`)
      }
      if (req.method === 'POST' && url.pathname === '/') return await handleEnvelope(req, env)
      throw TBError.notFound(`no such route ${req.method} '${url.pathname}'`)
    } catch (err) {
      return errorResponse(err)
    }
  },
}
