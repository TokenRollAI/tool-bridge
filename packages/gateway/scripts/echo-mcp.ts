/**
 * 最小 echo MCP server(官方 SDK,Streamable HTTP + JSON 响应模式)。
 *
 * 供真实 E2E 用:`pnpm echo-mcp` 起在 127.0.0.1:39001/mcp,暴露两个工具:
 * - `echo`:回显入参 text;
 * - `whoami`:回显当前会话 id(无会话时 'stateless')——opt-in 用例据此断言网关跨请求
 *   复用会话(两次调用同一 sessionId ⇔ 第二次跳过了 initialize 握手)。
 *
 * 默认**有状态**(签发 `Mcp-Session-Id`,transport 按会话缓存),贴近真实上游、覆盖网关的
 * 会话复用路径;`ECHO_MCP_STATELESS=1` 回落无状态(每 POST 独立处理)。JSON 响应模式下
 * 无 SSE reader,避免测试进程被关闭 AbortError 影响。
 * `ECHO_MCP_REQUIRE_FEISHU_AUTH=1` 额外开启 Compose 开发栈用的 `/auth` TAT 换发与
 * Feishu MCP 头校验;默认关闭,不改变既有 opt-in MCP E2E。
 *
 * 用法:`pnpm echo-mcp`(devDependency,不进生产构建);配合
 * `TB_TEST_MCP_URL=http://127.0.0.1:39001/mcp TB_ALLOW_INSECURE_HTTP=true` 跑 opt-in 集成用例。
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const PORT = Number(process.env.ECHO_MCP_PORT ?? 39001)
const HOST = process.env.ECHO_MCP_HOST ?? '127.0.0.1'
const STATELESS = process.env.ECHO_MCP_STATELESS === '1'
const REQUIRE_FEISHU_AUTH = process.env.ECHO_MCP_REQUIRE_FEISHU_AUTH === '1'
const EXPECTED_APP_ID = process.env.ECHO_MCP_APP_ID ?? 'compose-app'
const EXPECTED_APP_SECRET = process.env.ECHO_MCP_APP_SECRET ?? 'compose-secret'
const EXPECTED_TAT = process.env.ECHO_MCP_TAT ?? 'compose-tat'

function allowedTools(req: IncomingMessage): Set<string> | undefined {
  if (!REQUIRE_FEISHU_AUTH) return undefined
  const tat = req.headers['x-lark-mcp-tat']
  if (tat !== EXPECTED_TAT) return new Set()
  const raw = req.headers['x-lark-mcp-allowed-tools']
  return new Set(
    (typeof raw === 'string' ? raw : '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  )
}

function buildServer(allowed?: Set<string>): McpServer {
  const server = new McpServer({ name: 'echo', version: '0.0.0' })
  if (allowed === undefined || allowed.has('echo')) {
    server.registerTool(
      'echo',
      { description: 'echo back the given text', inputSchema: { text: z.string() } },
      async ({ text }) => ({ content: [{ type: 'text', text }] }),
    )
  }
  if (allowed === undefined || allowed.has('whoami')) {
    server.registerTool('whoami', { description: 'return current session id' }, async extra => ({
      content: [{ type: 'text', text: extra.sessionId ?? 'stateless' }],
    }))
  }
  return server
}

/** 有状态:transport 按会话 id 缓存,后续请求经 Mcp-Session-Id 路由到既有会话。 */
const sessions = new Map<string, StreamableHTTPServerTransport>()

async function handleStateful(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  allowed: Set<string> | undefined,
): Promise<void> {
  const sessionId = req.headers['mcp-session-id']
  if (typeof sessionId === 'string') {
    const existing = sessions.get(sessionId)
    if (existing === undefined) {
      // 会话失效:spec 规定 404,客户端应重新 initialize。
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'session not found' }))
      return
    }
    await existing.handleRequest(req, res, body)
    return
  }
  if (!isInitializeRequest(body)) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'missing Mcp-Session-Id (send initialize first)' }))
    return
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: id => sessions.set(id, transport),
  })
  transport.onclose = () => {
    if (transport.sessionId !== undefined) sessions.delete(transport.sessionId)
  }
  await buildServer(allowed).connect(transport)
  await transport.handleRequest(req, res, body)
}

/** 无状态:每请求新建 server + transport,响应关闭时清理。 */
async function handleStateless(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  allowed: Set<string> | undefined,
): Promise<void> {
  const server = buildServer(allowed)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

function handleAuth(res: ServerResponse, body: unknown): void {
  if (!REQUIRE_FEISHU_AUTH) {
    writeJson(res, 404, { error: 'not found' })
    return
  }
  const credential = body as { app_id?: unknown, app_secret?: unknown } | null
  if (
    credential === null
    || credential?.app_id !== EXPECTED_APP_ID
    || credential.app_secret !== EXPECTED_APP_SECRET
  ) {
    writeJson(res, 401, { code: 10_003, msg: 'bad compose app credential' })
    return
  }
  writeJson(res, 200, {
    code: 0,
    msg: 'ok',
    tenant_access_token: EXPECTED_TAT,
    expire: 7200,
  })
}

const httpServer = createServer((req, res) => {
  const path = (req.url ?? '/').replace(/\?.*$/, '')
  if (req.method === 'GET' && path === '/healthz') {
    writeJson(res, 200, { healthy: true })
    return
  }
  if (path !== '/mcp' && path !== '/auth') {
    writeJson(res, 404, { error: 'only /healthz, /auth and /mcp are supported' })
    return
  }
  // 有状态模式下 DELETE(terminateSession)也交给 transport;其余非 POST 拒绝。
  if (req.method !== 'POST' && (path === '/auth' || STATELESS || req.method !== 'DELETE')) {
    writeJson(res, 405, { error: 'method not allowed' })
    return
  }
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => {
    let body: unknown
    try {
      const text = Buffer.concat(chunks).toString('utf8')
      body = text.length > 0 ? JSON.parse(text) : undefined
    } catch {
      body = undefined
    }
    if (path === '/auth') {
      handleAuth(res, body)
      return
    }
    const allowed = allowedTools(req)
    if (REQUIRE_FEISHU_AUTH && (allowed === undefined || allowed.size === 0)) {
      writeJson(res, 401, { error: 'bad TAT or empty allowed-tools' })
      return
    }
    const handle = STATELESS ? handleStateless : handleStateful
    handle(req, res, body, allowed).catch((err: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    })
  })
})

httpServer.listen(PORT, HOST, () => {
  console.log(
    `[echo-mcp] listening on http://${HOST}:${PORT}/mcp (${STATELESS ? 'stateless' : 'stateful'}${REQUIRE_FEISHU_AUTH ? ', compose auth' : ''})`,
  )
})
