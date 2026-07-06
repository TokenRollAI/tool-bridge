/**
 * 最小 echo MCP server(官方 SDK,Streamable HTTP + 无状态传输)。
 *
 * 供 Phase 2 真实 E2E 用:`pnpm echo-mcp` 起在 127.0.0.1:39001/mcp,暴露一个 `echo` 工具
 * (回显入参 text)。无状态模式(sessionIdGenerator: undefined):每个 POST 独立处理,
 * 客户端一次性会话(initialize → tools/list|tools/call → DELETE)可直接调通。
 *
 * 用法:`pnpm echo-mcp`(devDependency,不进生产构建);配合
 * `TB_TEST_MCP_URL=http://127.0.0.1:39001/mcp TB_ALLOW_INSECURE_HTTP=true` 跑 opt-in 集成用例。
 */

import { createServer } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

const PORT = Number(process.env.ECHO_MCP_PORT ?? 39001)
const HOST = process.env.ECHO_MCP_HOST ?? '127.0.0.1'

function buildServer(): McpServer {
  const server = new McpServer({ name: 'echo', version: '0.0.0' })
  server.registerTool(
    'echo',
    { description: 'echo back the given text', inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: 'text', text }] }),
  )
  return server
}

const httpServer = createServer((req, res) => {
  if (req.method !== 'POST' || req.url === undefined || !req.url.startsWith('/mcp')) {
    res.writeHead(405, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'only POST /mcp is supported' }))
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
    // 无状态:每请求新建 server + transport,响应关闭时清理。
    const server = buildServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    server
      .connect(transport)
      .then(() => transport.handleRequest(req, res, body))
      .catch((err: unknown) => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
      })
  })
})

httpServer.listen(PORT, HOST, () => {
  console.log(`[echo-mcp] listening on http://${HOST}:${PORT}/mcp`)
})
