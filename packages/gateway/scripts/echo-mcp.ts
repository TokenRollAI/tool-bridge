/**
 * 最小 echo MCP server(官方 SDK v2,Streamable HTTP + JSON 响应模式)。
 *
 * 供真实 E2E 用:`pnpm echo-mcp` 起在 127.0.0.1:39001/mcp,暴露两个工具:
 * - `echo`:回显入参 text;
 * - `whoami`:回显本次连接的协议 era(`modern` / `legacy`)。
 *
 * **双 era**:`createMcpHandler` 同时服务 2026-07-28(modern)与 2025 系(legacy),
 * 由客户端协商决定。`ECHO_MCP_ERA` 可收窄以便定向验证:
 * - 不设 / `both`(默认):两个 era 都服务;
 * - `modern`:legacy 请求一律拒(`legacy:'reject'`),用于验证网关的 modern 客户端路径;
 * - `legacy`:只服务 2025 系,用于验证网关对老上游的保守回落。
 *
 * 会话:v2 起协议已无会话概念,网关也不再复用上游会话(见 providers/mcp.ts 文件头),
 * 故这里不再区分有状态/无状态——一律无状态,每请求独立处理。
 *
 * `ECHO_MCP_REQUIRE_FEISHU_AUTH=1` 额外开启 Compose 开发栈用的 `/auth` TAT 换发与
 * Feishu MCP 头校验;默认关闭,不改变既有 opt-in MCP E2E。
 *
 * 用法:`pnpm echo-mcp`(devDependency,不进生产构建);配合
 * `TB_TEST_MCP_URL=http://127.0.0.1:39001/mcp TB_ALLOW_INSECURE_HTTP=true` 跑 opt-in 集成用例。
 */

import { createMcpHandler, isLegacyRequest, McpServer } from '@modelcontextprotocol/server'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { z } from 'zod'

const PORT = Number(process.env.ECHO_MCP_PORT ?? 39001)
const HOST = process.env.ECHO_MCP_HOST ?? '127.0.0.1'
const ERA = process.env.ECHO_MCP_ERA ?? 'both'
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

function buildServer(era: 'legacy' | 'modern', allowed?: Set<string>): McpServer {
  const server = new McpServer({ name: 'echo', version: '0.0.0' })
  if (allowed === undefined || allowed.has('echo')) {
    server.registerTool(
      'echo',
      { description: 'echo back the given text', inputSchema: { text: z.string() } },
      async ({ text }) => ({ content: [{ type: 'text', text }] }),
    )
  }
  if (allowed === undefined || allowed.has('whoami')) {
    server.registerTool('whoami', { description: 'return this connection protocol era' }, async () => ({
      content: [{ type: 'text', text: era }],
    }))
  }
  return server
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

/** 当前请求的 allowed-tools(Feishu 形态);createMcpHandler 的工厂经此闭包读取。 */
let currentAllowed: Set<string> | undefined

const handler = createMcpHandler(ctx => buildServer(ctx.era, currentAllowed), {
  responseMode: 'json',
  keepAliveMs: 0,
  legacy: ERA === 'modern' ? 'reject' : 'stateless',
})

async function toWebRequest(req: IncomingMessage, body: Buffer): Promise<Request> {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(', '))
  }
  return new Request(`http://${HOST}:${PORT}${req.url ?? '/'}`, {
    method: req.method ?? 'GET',
    headers,
    ...(body.length > 0 ? { body } : {}),
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
  if (req.method !== 'POST') {
    writeJson(res, 405, { error: 'method not allowed' })
    return
  }
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => {
    void (async () => {
      const raw = Buffer.concat(chunks)
      if (path === '/auth') {
        let body: unknown
        try {
          const text = raw.toString('utf8')
          body = text.length > 0 ? JSON.parse(text) : undefined
        } catch {
          body = undefined
        }
        handleAuth(res, body)
        return
      }
      const allowed = allowedTools(req)
      if (REQUIRE_FEISHU_AUTH && (allowed === undefined || allowed.size === 0)) {
        writeJson(res, 401, { error: 'bad TAT or empty allowed-tools' })
        return
      }
      const request = await toWebRequest(req, raw)
      // ECHO_MCP_ERA=legacy:只服务 2025 系,modern 请求直接拒,便于验证网关的保守回落。
      if (ERA === 'legacy' && !(await isLegacyRequest(request.clone()))) {
        writeJson(res, 400, { error: 'this echo-mcp serves the 2025 era only' })
        return
      }
      currentAllowed = allowed
      const response = await handler.fetch(request)
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
      res.end(response.body === null ? undefined : Buffer.from(await response.arrayBuffer()))
    })().catch((err: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    })
  })
})

httpServer.listen(PORT, HOST, () => {
  console.log(
    `[echo-mcp] listening on http://${HOST}:${PORT}/mcp (era=${ERA}${REQUIRE_FEISHU_AUTH ? ', compose auth' : ''})`,
  )
})
