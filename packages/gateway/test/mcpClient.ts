import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'

export async function connectTestMcpClient(
  endpoint: string,
  sk: string,
  fetchFn: typeof fetch,
): Promise<Client> {
  const client = new Client(
    { name: 'tool-bridge-test', version: '0.0.0' },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  )
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: fetchFn,
    requestInit: { headers: { authorization: `Bearer ${sk}` } },
  })
  await client.connect(transport)
  return client
}
