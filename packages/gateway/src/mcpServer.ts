import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * Handle one stateless MCP Streamable HTTP request.
 *
 * A fresh server is intentional: authentication is established by the surrounding
 * gateway request, so no isolate-local session may outlive or replace that identity.
 */
export async function handleMcpRequest(request: Request, version: string): Promise<Response> {
  const server = new McpServer(
    { name: 'tool-bridge', version },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  )
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
  await server.connect(transport)
  return await transport.handleRequest(request)
}
