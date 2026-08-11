/**
 * 测试用 MCP 客户端。**两个 era 各留一个**:
 * - `connectTestMcpClient` — **v1 SDK**,走 `initialize` 握手,验证 server 面对 2025 系老
 *   客户端的兼容腿。故意用 v1 而非「v2 的 legacy 模式」:价值就在于它是另一代实现,
 *   v2 自己的 legacy 臂证明不了「真老客户端还能连」。v1 SDK 是 devDependency,不进生产构建。
 * - `connectModernMcpClient` — v2 SDK,走 2026-07-28 无握手路径,验证 modern 腿。
 *
 * 两者不可合并:合并任何一个都会让对应 era 失去覆盖。
 */

import {
  Client as ModernClient,
  StreamableHTTPClientTransport as ModernTransport,
} from '@modelcontextprotocol/client'
import { CfWorkerJsonSchemaValidator as ModernValidator } from '@modelcontextprotocol/client/validators/cf-worker'
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

/**
 * 2026-07-28(modern)客户端:无握手,协议版本与能力走 `_meta` 信封 + 路由头。
 *
 * `versionNegotiation` 必须显式给——SDK 默认是 `'legacy'`,不设则 v2 客户端连 v2 服务端
 * 也会走 2025 握手。这里 `pin` 而非 `auto`:验收要的是「拿不到 modern 就响亮失败」,
 * auto 的静默回落会把 server 面的 modern 腿坏掉伪装成通过。
 */
export async function connectModernMcpClient(
  endpoint: string,
  sk: string,
  fetchFn: typeof fetch,
): Promise<ModernClient> {
  const client = new ModernClient(
    { name: 'tool-bridge-test-modern', version: '0.0.0' },
    {
      jsonSchemaValidator: new ModernValidator(),
      versionNegotiation: { mode: { pin: '2026-07-28' } },
    },
  )
  const transport = new ModernTransport(new URL(endpoint), {
    fetch: (input, init) =>
      init?.method === 'GET'
        ? Promise.resolve(new Response(null, { status: 405 }))
        : fetchFn(input, init),
    requestInit: { headers: { authorization: `Bearer ${sk}` } },
  })
  await client.connect(transport)
  return client
}
