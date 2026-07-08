/**
 * 飞书官方远程 MCP(https://mcp.feishu.cn/mcp)的 Streamable HTTP client 封装。
 *
 * - 认证:每趟请求带 `X-Lark-MCP-TAT: <token>`(原样,无 scheme 前缀)+
 *   `X-Lark-MCP-Allowed-Tools: <逗号分隔白名单>`(缺失时上游 tools/list 恒回空列表)。
 * - 会话:上游签发的 Mcp-Session-Id 缓存在 isolate 内存;失效信号(400/404)→ 清缓存
 *   完整重握手一次。凭证过期(401)由调用方(index.ts)强制重换发 TAT 后重试。
 * - workerd 禁 eval,JSON Schema 校验用 SDK 自带的 @cfworker/json-schema 解释执行实现
 *   (同 gateway providers/mcp.ts 的坑)。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker'
import { isTBError, normalizeUpstreamError, TBError } from '@tool-bridge/core'

export const DEFAULT_MCP_URL = 'https://mcp.feishu.cn/mcp'

/** 上游工具形状(仅取转发所需字段;与 gateway providers/mcp.ts 同构)。 */
export interface FeishuTool {
  name: string
  description?: string
  inputSchema?: unknown
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

export interface FeishuToolResult {
  content?: unknown
  isError?: boolean
}

interface CachedSession {
  sessionId: string
  protocolVersion?: string
}

/** MCP 会话按 app_id 键控(同一部署可服务多凭证挂载,会话不得串号)。 */
const sessions = new Map<string, CachedSession>()

/** 测试用:清空进程内 MCP 会话缓存。 */
export function clearSessionCache(): void {
  sessions.clear()
}

export interface FeishuMcpConfig {
  url: string
  /** TAT 所属应用,作会话缓存键。 */
  appId: string
  tat: string
  allowedTools: string
}

/** SDK 在 initialize 后自动 GET 打开可选 standalone SSE;这里不消费,直接 405。 */
const noStandaloneSseFetch: typeof fetch = (input, init) => {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
  if (String(method).toUpperCase() === 'GET') {
    return Promise.resolve(new Response(null, { status: 405, statusText: 'Method Not Allowed' }))
  }
  return fetch(input, init)
}

function isSessionInvalid(err: unknown): boolean {
  return err instanceof StreamableHTTPError && (err.code === 404 || err.code === 400)
}

/** 上游 401:TAT 过期/无效,调用方应强制重换发后重试。 */
export function isUnauthorized(err: unknown): boolean {
  return err instanceof StreamableHTTPError && err.code === 401
}

async function withSession<T>(
  cfg: FeishuMcpConfig,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const makeTransport = (sessionId: string | undefined): StreamableHTTPClientTransport =>
    new StreamableHTTPClientTransport(new URL(cfg.url), {
      fetch: noStandaloneSseFetch,
      requestInit: {
        headers: {
          'X-Lark-MCP-TAT': cfg.tat,
          'X-Lark-MCP-Allowed-Tools': cfg.allowedTools,
        },
      },
      ...(sessionId !== undefined ? { sessionId } : {}),
    })
  const makeClient = (): Client =>
    new Client(
      { name: 'tb-plugin-feishu', version: '0.1.0' },
      { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
    )

  const runFresh = async (): Promise<T> => {
    const transport = makeTransport(undefined)
    const client = makeClient()
    await client.connect(transport)
    if (transport.sessionId !== undefined) {
      sessions.set(cfg.appId, {
        sessionId: transport.sessionId,
        ...(transport.protocolVersion !== undefined
          ? { protocolVersion: transport.protocolVersion }
          : {}),
      })
    } else {
      sessions.delete(cfg.appId)
    }
    return await fn(client)
  }

  const session = sessions.get(cfg.appId)
  if (session !== undefined) {
    const transport = makeTransport(session.sessionId)
    const client = makeClient()
    await client.connect(transport) // sessionId 已设 → SDK 跳过 initialize
    if (session.protocolVersion !== undefined) {
      transport.setProtocolVersion(session.protocolVersion)
    }
    try {
      return await fn(client)
    } catch (err) {
      if (!isSessionInvalid(err)) throw err
      sessions.delete(cfg.appId)
      // 落回完整握手重试一次
    }
  }
  return await runFresh()
}

/** 传输/协议错误归一 TBError;401 原样抛给调用方做 TAT 重换发。 */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isTBError(err) || isUnauthorized(err)) throw err
    if (err instanceof StreamableHTTPError && err.code !== undefined) {
      throw normalizeUpstreamError({ kind: 'http', status: err.code, message: err.message })
    }
    throw normalizeUpstreamError({
      kind: 'network',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function listTools(cfg: FeishuMcpConfig): Promise<FeishuTool[]> {
  return guard(async () => {
    const res = (await withSession(cfg, (c) => c.listTools())) as { tools: FeishuTool[] }
    // 空列表几乎必是 Allowed-Tools 头缺失/写错(飞书对无白名单请求回空而非报错)。
    if (res.tools.length === 0 && cfg.allowedTools.trim() === '') {
      throw new TBError('unavailable', 'FEISHU_ALLOWED_TOOLS 为空:飞书 MCP 不宣告任何工具', {
        retryable: false,
      })
    }
    return res.tools
  })
}

export async function callTool(
  cfg: FeishuMcpConfig,
  name: string,
  args: Record<string, unknown>,
): Promise<FeishuToolResult> {
  return guard(async () => {
    const res = await withSession(cfg, (c) => c.callTool({ name, arguments: args }))
    return res as FeishuToolResult
  })
}
