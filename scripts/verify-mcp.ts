import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import assert from 'node:assert/strict'

/**
 * MCP 生产出口验收:官方 SDK initialize 后完成 tools/list + tools/call,再以窄 SK
 * 重连并验证固定入口一致、help/search 隐藏越权目标、已知 admin 路径不可调用。
 *
 * 用法:
 * `TB_BASE_URL=https://... TB_SK=tbk_... TB_MCP_NARROW_SK=tbk_... pnpm verify:mcp`
 *
 * era:客户端用 `versionNegotiation: { mode: 'auto' }` 走真实协商(SDK 默认是 `'legacy'`,
 * 不显式开启就永远只验 2025 系),并打印生产实际服务的 era。`TB_MCP_ERA=modern` 可改为
 * 钉住 2026-07-28——拿不到就响亮失败,用于确认新协议确实已上线。
 *
 * 默认调用只读的 system/registry:list。可用 TB_MCP_PATH、TB_MCP_COMMAND 与
 * TB_MCP_ARGS(JSON object)选择另一项无副作用工具；该目标必须对窄 SK 不可见。
 * 实际调用路径只取实时 help 的 cmds[].path，不从 PATH/COMMAND 重建。
 * 窄 SK 默认须允许
 * system/status:get,也可用 TB_MCP_NARROW_PATH / _COMMAND / _ARGS 改写。
 * 本脚本不创建或修改生产资源。
 */

function requireValue(value: string | undefined, message: string): string {
  if (value === undefined || value.trim() === '') throw new Error(message)
  return value
}

function parseArguments(raw: string, variable = 'TB_MCP_ARGS'): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${variable} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

const PIN_MODERN = process.env.TB_MCP_ERA === 'modern'

async function connect(endpoint: URL, sk: string): Promise<Client> {
  const client = new Client(
    { name: 'tool-bridge-production-smoke', version: '0.1.0' },
    {
      versionNegotiation: {
        mode: PIN_MODERN ? { pin: '2026-07-28' } : 'auto',
      },
    },
  )
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { authorization: `Bearer ${sk}` } },
  })
  await client.connect(transport)
  return client
}

const ENTRY_POINTS = ['tb_call', 'tb_device_operations', 'tb_help', 'tb_list_nodes', 'tb_search'].sort()

type McpResult = Awaited<ReturnType<Client['callTool']>>

function resultObject(result: McpResult, label: string): Record<string, unknown> {
  const text = Array.isArray(result.content)
    ? result.content.find(block => block.type === 'text')?.text
    : undefined
  const value: unknown = result.structuredContent ?? (typeof text === 'string' ? JSON.parse(text) : undefined)
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must return a JSON object`)
  return value as Record<string, unknown>
}

function assertSucceeded(result: McpResult, label: string): void {
  assert.notEqual(result.isError, true, `${label} returned isError=true`)
  assert.ok(Array.isArray(result.content) && result.content.length > 0, `${label} returned empty content`)
}

async function commandPath(client: Client, path: string, command: string): Promise<string> {
  const result = await client.callTool({ name: 'tb_help', arguments: { path, tool: command } })
  assertSucceeded(result, `tb_help ${path}:${command}`)
  const help = resultObject(result, 'tb_help')
  assert.ok(Array.isArray(help.cmds), 'tb_help.cmds must be an array')
  const selected = help.cmds.find((item: unknown) =>
    item !== null && typeof item === 'object' && (item as { name?: unknown }).name === command,
  ) as { path?: unknown } | undefined
  assert.ok(selected, `tb_help did not describe ${path}:${command}`)
  assert.ok(typeof selected.path === 'string' && selected.path.length > 0, 'tb_help command must have a complete path')
  return selected.path
}

async function assertDenied(client: Client, name: string, args: Record<string, unknown>): Promise<void> {
  let result: McpResult
  try {
    result = await client.callTool({ name, arguments: args })
  } catch (error) {
    // SDK eras can represent a rejected invocation as an RPC error or isError content.
    assert.match(error instanceof Error ? error.message : String(error), /not[_ ]found|permission[_ ]denied|no scope/i)
    return
  }
  assert.equal(result.isError, true, `${name} must reject the narrow identity`)
  const body = resultObject(result, `${name} denial`)
  assert.ok(body.code === 'not_found' || body.code === 'permission_denied', `${name} must fail because of visibility or scope`)
}

async function main(): Promise<void> {
  const baseUrl = requireValue(
    process.argv[2] ?? process.env.TB_BASE_URL,
    'missing base URL. Set TB_BASE_URL or pass it as argv[2].',
  ).replace(/\/+$/, '')
  const adminSk = requireValue(
    process.env.TB_ADMIN_SK ?? process.env.TB_SK,
    'missing admin SK. Set TB_ADMIN_SK or TB_SK.',
  )
  const narrowSk = requireValue(
    process.env.TB_MCP_NARROW_SK,
    'missing narrow SK. Set TB_MCP_NARROW_SK.',
  )
  const callPath = process.env.TB_MCP_PATH ?? 'system/registry'
  const callCommand = process.env.TB_MCP_COMMAND ?? 'list'
  const callArguments = parseArguments(process.env.TB_MCP_ARGS ?? '{}')
  const narrowCallPath = process.env.TB_MCP_NARROW_PATH ?? 'system/status'
  const narrowCallCommand = process.env.TB_MCP_NARROW_COMMAND ?? 'get'
  const narrowCallArguments = parseArguments(
    process.env.TB_MCP_NARROW_ARGS ?? '{}',
    'TB_MCP_NARROW_ARGS',
  )
  const endpoint = new URL(`${baseUrl}/~mcp`)
  const adminClient = await connect(endpoint, adminSk)
  let adminCommandPath = ''
  try {
    const listed = await adminClient.listTools()
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), ENTRY_POINTS, 'admin must expose only the fixed MCP entry points')
    assertSucceeded(await adminClient.callTool({ name: 'tb_list_nodes', arguments: { depth: 1 } }), 'admin tb_list_nodes')
    adminCommandPath = await commandPath(adminClient, callPath, callCommand)
    const called = await adminClient.callTool({ name: 'tb_call', arguments: { path: adminCommandPath, args: callArguments } })
    assertSucceeded(called, `admin tb_call ${adminCommandPath}`)
    const searched = await adminClient.callTool({ name: 'tb_search', arguments: { query: callCommand, pathPrefix: callPath } })
    assertSucceeded(searched, 'admin tb_search')
    assert.ok(Array.isArray(resultObject(searched, 'admin tb_search').items), 'admin search must return items')
    console.log(
      `ok  admin ${adminClient.getProtocolEra() ?? 'unknown'} era`
      + ` (${adminClient.getNegotiatedProtocolVersion() ?? 'unknown'})`
      + ` → fixed tools/list (${listed.tools.length}) → help/search → tb_call ${adminCommandPath}`,
    )
  } finally {
    await adminClient.close()
  }

  const narrowClient = await connect(endpoint, narrowSk)
  try {
    const listed = await narrowClient.listTools()
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), ENTRY_POINTS, 'narrow identity keeps the same fixed MCP entry points')
    const narrowCommandPath = await commandPath(narrowClient, narrowCallPath, narrowCallCommand)
    const narrowCalled = await narrowClient.callTool({
      name: 'tb_call',
      arguments: { path: narrowCommandPath, args: narrowCallArguments },
    })
    assertSucceeded(narrowCalled, `narrow tb_call ${narrowCommandPath}`)
    await assertDenied(narrowClient, 'tb_help', { path: adminCommandPath })
    const searched = await narrowClient.callTool({ name: 'tb_search', arguments: { query: callCommand, pathPrefix: callPath } })
    assertSucceeded(searched, 'narrow tb_search')
    assert.deepEqual(resultObject(searched, 'narrow tb_search').items, [], 'search must hide the forbidden target subtree')
    await assertDenied(narrowClient, 'tb_call', { path: adminCommandPath, args: callArguments })
    console.log(
      `ok  narrow reconnect → fixed tools/list (${listed.tools.length})`
      + ` → tb_call ${narrowCommandPath}; help/search hidden and known forbidden path rejected`,
    )
  } finally {
    await narrowClient.close()
  }

  console.log(`\nMCP smoke passed against ${baseUrl}`)
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`MCP smoke FAILED: ${message}`)
  process.exitCode = 1
})
