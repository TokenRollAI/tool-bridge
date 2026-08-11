import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import assert from 'node:assert/strict'

/**
 * MCP 生产出口验收:官方 SDK initialize 后完成 tools/list + tools/call,再以窄 SK
 * 重连并验证工具集收窄、旧的 admin-only 工具名不可调用。
 *
 * 用法:
 * `TB_BASE_URL=https://... TB_SK=tbk_... TB_MCP_NARROW_SK=tbk_... pnpm verify:mcp`
 *
 * 默认调用只读的 system/registry:list。可用 TB_MCP_PATH、TB_MCP_COMMAND 与
 * TB_MCP_ARGS(JSON object)选择另一项无副作用工具。窄 SK 默认须允许
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

async function connect(endpoint: URL, sk: string): Promise<Client> {
  const client = new Client({ name: 'tool-bridge-production-smoke', version: '0.1.0' })
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { authorization: `Bearer ${sk}` } },
  })
  await client.connect(transport)
  return client
}

function toolMeta(tool: { _meta?: Record<string, unknown> }, key: string): unknown {
  return tool._meta?.[key]
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
  let adminNames = new Set<string>()
  try {
    const listed = await adminClient.listTools()
    assert.ok(listed.tools.length > 0, 'admin tools/list must return at least one tool')
    adminNames = new Set(listed.tools.map(tool => tool.name))
    const selected = listed.tools.find(tool =>
      toolMeta(tool, 'io.tool-bridge/path') === callPath
      && toolMeta(tool, 'io.tool-bridge/command') === callCommand,
    )
    assert.ok(selected, `tools/list did not expose ${callPath}:${callCommand}`)

    const called = await adminClient.callTool({ name: selected.name, arguments: callArguments })
    assert.notEqual(called.isError, true, `${callPath}:${callCommand} returned isError=true`)
    assert.ok(
      Array.isArray(called.content) && called.content.length > 0,
      `${callPath}:${callCommand} returned empty content`,
    )
    console.log(
      `ok  admin initialize → tools/list (${listed.tools.length}) → tools/call ${callPath}:${callCommand}`,
    )
  } finally {
    await adminClient.close()
  }

  const narrowClient = await connect(endpoint, narrowSk)
  try {
    const listed = await narrowClient.listTools()
    const narrowNames = new Set(listed.tools.map(tool => tool.name))
    assert.ok(narrowNames.size > 0, 'narrow tools/list must expose at least one allowed tool')
    assert.ok(
      narrowNames.size < adminNames.size,
      `narrow tools/list must shrink: admin=${adminNames.size}, narrow=${narrowNames.size}`,
    )
    for (const name of narrowNames) {
      assert.ok(adminNames.has(name), `narrow tools/list exposed non-admin tool '${name}'`)
    }
    const narrowSelected = listed.tools.find(tool =>
      toolMeta(tool, 'io.tool-bridge/path') === narrowCallPath
      && toolMeta(tool, 'io.tool-bridge/command') === narrowCallCommand,
    )
    assert.ok(
      narrowSelected,
      `narrow tools/list did not expose ${narrowCallPath}:${narrowCallCommand}`,
    )
    const narrowCalled = await narrowClient.callTool({
      name: narrowSelected.name,
      arguments: narrowCallArguments,
    })
    assert.notEqual(
      narrowCalled.isError,
      true,
      `${narrowCallPath}:${narrowCallCommand} returned isError=true`,
    )
    assert.ok(
      Array.isArray(narrowCalled.content) && narrowCalled.content.length > 0,
      `${narrowCallPath}:${narrowCallCommand} returned empty content`,
    )
    const adminOnlyCallCandidate = [...adminNames].find(name => !narrowNames.has(name)) ?? ''
    assert.notEqual(adminOnlyCallCandidate, '', 'expected at least one admin-only tool')
    await assert.rejects(
      narrowClient.callTool({ name: adminOnlyCallCandidate, arguments: {} }),
      /tool not found/i,
    )
    console.log(
      `ok  narrow reconnect → tools/list shrank ${adminNames.size} → ${narrowNames.size}`
      + ` → tools/call ${narrowCallPath}:${narrowCallCommand}; stale call rejected`,
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
