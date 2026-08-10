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
    // initialized 后 SDK 会探测可选长驻 SSE GET；workerd 测试 harness 不允许悬挂
    // 子请求。initialize/list/call 的 POST 仍全部真实穿透 gateway。
    fetch: (input, init) =>
      init?.method === 'GET'
        ? Promise.resolve(new Response(null, { status: 405 }))
        : fetchFn(input, init),
    requestInit: { headers: { authorization: `Bearer ${sk}` } },
  })
  await client.connect(transport)
  return client
}
