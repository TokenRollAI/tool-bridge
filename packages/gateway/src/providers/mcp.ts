/**
 * mcp 内置 Provider:经官方 MCP SDK 的 Streamable HTTP client 连接 `config.url`。
 *
 * - `List` ← `tools/list`,`Call` ← `tools/call`;上游 `tools[].inputSchema` 已是 JSON Schema,
 *   直接进 `ToolSpec.inputSchema`;annotations 派生 effect(readOnlyHint→read、
 *   destructiveHint→destructive;无提示则不标注,避免过度声明)。
 * - **会话复用**:上游签发 `Mcp-Session-Id` 时存 StateStore
 *   `mcpsession:<nodePath>`(连同协商的 protocolVersion),后续请求带 sessionId 重建
 *   transport——SDK 对已有 sessionId 跳过 initialize,单次调用只剩一趟上游往返。
 *   会话失效(上游 400/404)→ 清缓存、完整握手重试一次并回填新会话。
 *   缓存的只有会话凭证与 tools/list(toolCache);**调用结果永不缓存**。
 * - **空列表防御**:不合规上游(实测 MetaMCP)对过期会话不按 spec 回 404,而是当作
 *   空会话正常返回 200 + 空 tools——网关侧毫无失效信号。故 `list` 在"复用缓存会话且
 *   拿到空列表"时视为可疑:清会话、**强制完整重握手**再取一次,仍空才相信(只重试
 *   一次,真空列表上游至多多付一趟握手)。重试不得回读会话缓存:KV 边缘读缓存
 *   (≥60s)会把刚删的旧会话又还回来,重试再次复用死会话,防御被击穿
 *   (2026-07-08 生产复发取证)。
 * - `authRef` 经 SecretStore.resolve 注入 `requestInit.headers` 的静态 `Authorization: Bearer`。
 * - **单一 choke point**(`guard`):一切传输/协议错误经 `normalizeUpstreamError` 归一为 TBError;
 *   MCP RPC 业务错误(`result.isError`)不是错误——落 `ToolResult.isError`,正常返回。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker'
import {
  assertSecureUrl,
  isTBError,
  normalizeUpstreamError,
  type SecretStoreImpl,
  type StateStore,
  type ToolResult,
  type ToolSpec,
  type TreePath,
} from '@tool-bridge/core'
import type { UpstreamProvider } from './types'

/** mcp 节点 config。 */
export interface McpConfig {
  url: string
  authRef?: string
}

/** MCP SDK 返回的单个工具形状(仅取我们用到的字段)。 */
interface McpTool {
  name: string
  description?: string
  inputSchema?: unknown
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

/** annotations → effect 词汇;无明确提示则返回 undefined(不臆测 write)。 */
function effectFromAnnotations(a: McpTool['annotations']): string | undefined {
  if (!a) return undefined
  if (a.readOnlyHint === true) return 'read'
  if (a.destructiveHint === true) return 'destructive'
  return undefined
}

function toSpec(t: McpTool): ToolSpec {
  const spec: ToolSpec = { name: t.name }
  if (t.description !== undefined) spec.description = t.description
  if (t.inputSchema !== undefined) spec.inputSchema = t.inputSchema
  const effect = effectFromAnnotations(t.annotations)
  if (effect !== undefined) spec.effect = effect
  return spec
}

/** callTool 结果 → ToolResult:全 text 片段拼接;含非 text 片段则结构化原样返回。 */
function toToolResult(res: { content?: unknown; isError?: boolean }): ToolResult {
  const parts = Array.isArray(res.content)
    ? (res.content as Array<{ type: string; text?: string }>)
    : []
  const allText = parts.length > 0 && parts.every((p) => p.type === 'text')
  const content: unknown = allText ? parts.map((p) => p.text ?? '').join('') : res.content
  const out: ToolResult = { content }
  if (res.isError === true) out.isError = true
  return out
}

/**
 * 我们只使用 Streamable HTTP 的 request/response 能力(listTools/callTool),不消费服务端主动
 * 消息流。MCP SDK 在 initialize 后会自动尝试 GET 打开可选 standalone SSE;这里对 GET 直接
 * 返回 405(协议允许:服务器不提供 SSE),避免关闭会话时中止一条无用网络连接。
 */
const noStandaloneSseFetch: typeof fetch = (input, init) => {
  const method =
    init?.method ??
    (input instanceof Request
      ? input.method
      : typeof input === 'object' && 'method' in input
        ? input.method
        : 'GET')
  if (String(method).toUpperCase() === 'GET') {
    return Promise.resolve(new Response(null, { status: 405, statusText: 'Method Not Allowed' }))
  }
  return fetch(input, init)
}

/**
 * 会话复用的存取(key `mcpsession:<nodePath>`)。缓存的是上游会话凭证,不是任何调用结果;
 * 不设 TTL——有效性由上游裁决(400/404 即失效,届时清缓存重握手)。
 */
export interface McpSessionStore {
  store: StateStore
  nodePath: TreePath
}

interface CachedSession {
  sessionId: string
  protocolVersion?: string
  updatedAt: string
}

const SESSION_KEY_PREFIX = 'mcpsession:'

function sessionKey(nodePath: TreePath): string {
  return `${SESSION_KEY_PREFIX}${nodePath}`
}

function isCachedSession(v: unknown): v is CachedSession {
  return typeof v === 'object' && v !== null && typeof (v as CachedSession).sessionId === 'string'
}

async function loadSession(s: McpSessionStore | undefined): Promise<CachedSession | null> {
  if (s === undefined) return null
  const raw = await s.store.get(sessionKey(s.nodePath))
  return isCachedSession(raw) ? raw : null
}

async function saveSession(
  s: McpSessionStore | undefined,
  transport: StreamableHTTPClientTransport,
): Promise<void> {
  if (s === undefined || transport.sessionId === undefined) return
  const record: CachedSession = {
    sessionId: transport.sessionId,
    ...(transport.protocolVersion !== undefined
      ? { protocolVersion: transport.protocolVersion }
      : {}),
    updatedAt: new Date().toISOString(),
  }
  await s.store.put(sessionKey(s.nodePath), record)
}

async function clearSession(s: McpSessionStore | undefined): Promise<void> {
  if (s === undefined) return
  await s.store.delete(sessionKey(s.nodePath))
}

/** 删除某节点的会话缓存(注册面 Write/Update/Delete 时调用:URL/authRef 变更后旧凭证作废)。 */
export async function invalidateMcpSession(store: StateStore, nodePath: string): Promise<void> {
  await store.delete(`${SESSION_KEY_PREFIX}${nodePath}`)
}

/** 上游宣告会话失效的状态码(spec 规定 404;部分实现回 400)。 */
function isSessionInvalid(err: unknown): boolean {
  return err instanceof StreamableHTTPError && (err.code === 404 || err.code === 400)
}

/** `withSession` 的返回:结果值 + 本次是否复用了缓存会话(未经历完整 initialize)。 */
interface SessionOutcome<T> {
  value: T
  viaCachedSession: boolean
}

/**
 * 会话内执行 `fn`:有缓存会话则带 sessionId 重建 transport(SDK 跳过 initialize,单趟往返);
 * 无缓存/会话失效则完整握手并回填缓存。**不再主动 terminateSession**——会话跨请求存续,
 * 由上游按空闲策略回收;失效信号(400/404)驱动重握手。
 * `forceFresh` 跳过缓存会话直接完整握手——供空列表防御的重试使用(不得回读 KV,
 * 边缘读缓存会把刚删的旧会话还回来)。
 */
async function withSession<T>(
  url: string,
  bearer: string | undefined,
  session: McpSessionStore | undefined,
  fn: (client: Client) => Promise<T>,
  forceFresh = false,
): Promise<SessionOutcome<T>> {
  const makeTransport = (sessionId: string | undefined): StreamableHTTPClientTransport =>
    new StreamableHTTPClientTransport(new URL(url), {
      fetch: noStandaloneSseFetch,
      ...(bearer !== undefined
        ? { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } }
        : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
    })

  // SDK 默认的 Ajv 校验器经 new Function 编译 schema,workerd 禁 eval——上游工具一旦声明
  // outputSchema,tools/list 阶段就会抛 "Code generation from strings disallowed"。
  // 换 SDK 自带的 @cfworker/json-schema 解释执行实现。
  const makeClient = (): Client =>
    new Client(
      { name: 'tool-bridge', version: '0.0.0' },
      { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
    )

  const runFresh = async (): Promise<SessionOutcome<T>> => {
    const transport = makeTransport(undefined)
    const client = makeClient()
    await client.connect(transport) // initialize 握手;成功后 transport 持有新 sessionId(如有)
    await saveSession(session, transport)
    return { value: await fn(client), viaCachedSession: false }
  }

  const cached = forceFresh ? null : await loadSession(session)
  if (cached !== null) {
    const transport = makeTransport(cached.sessionId)
    const client = makeClient()
    await client.connect(transport) // sessionId 已设 → SDK 跳过 initialize
    if (cached.protocolVersion !== undefined) {
      transport.setProtocolVersion(cached.protocolVersion)
    }
    try {
      return { value: await fn(client), viaCachedSession: true }
    } catch (err) {
      if (!isSessionInvalid(err)) throw err
      await clearSession(session)
      // 落回完整握手重试一次
    }
  }
  return await runFresh()
}

/** 单一 choke point:把传输/协议错误归一为 TBError(已是 TBError 的原样抛出)。 */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isTBError(err)) throw err
    if (err instanceof StreamableHTTPError && err.code !== undefined) {
      throw normalizeUpstreamError({ kind: 'http', status: err.code, message: err.message })
    }
    throw normalizeUpstreamError({
      kind: 'network',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * 构造 mcp Provider。`allowInsecure`(env `TB_ALLOW_INSECURE_HTTP=true`)放行 http:// 上游。
 * 构造即做 https 强制:非法 url → 抛 invalid_argument(在 guard 之外,快速失败)。
 */
export function createMcpProvider(
  config: McpConfig,
  secrets: SecretStoreImpl,
  opts: { allowInsecure: boolean; session?: McpSessionStore },
): UpstreamProvider {
  const secErr = assertSecureUrl(config.url, opts.allowInsecure)
  if (secErr) throw secErr

  const bearer = (): Promise<string | undefined> =>
    config.authRef !== undefined ? secrets.resolve(config.authRef) : Promise.resolve(undefined)

  return {
    list: () =>
      guard(async () => {
        const b = await bearer()
        const listOnce = (forceFresh = false): Promise<SessionOutcome<{ tools: McpTool[] }>> =>
          withSession(config.url, b, opts.session, (c) => c.listTools(), forceFresh) as Promise<
            SessionOutcome<{ tools: McpTool[] }>
          >
        let res = await listOnce()
        // 空列表防御(见文件头):复用缓存会话拿到空列表 → 清会话、强制完整重握手再取
        // 一次。重试必须 forceFresh:清会话后回读 KV 会命中边缘读缓存拿回旧会话,
        // 重试再次复用死会话,防御被击穿。
        if (res.viaCachedSession && res.value.tools.length === 0) {
          await clearSession(opts.session)
          res = await listOnce(true)
        }
        return res.value.tools.map(toSpec)
      }),
    call: (name, args) =>
      guard(async () => {
        const b = await bearer()
        const { value } = await withSession(config.url, b, opts.session, (c) =>
          c.callTool({ name, arguments: args }),
        )
        return toToolResult(value as { content?: unknown; isError?: boolean })
      }),
  }
}
