import { createProcessSessionManager, type ProcessSessionBinding, processSessionCommands, type ProcessSessionManager } from '@tool-bridge/core/node'
import { type HelpJson, isTBError, type Scope, TBError } from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { helpJsonSchema } from '@tool-bridge/core/protocol'
import { execPath } from 'node:process'
import { z } from 'zod/v4'
import type { DeviceInvokeRequest } from '../../src/deps'
import { ToolJsonSchemaValidator } from '../../src/jsonSchemaValidator'
import { bearer, createTestApp, type TestApp } from '../harness'
import { processDeviceHello } from '../../src/deviceHello'
import { connectTestMcpClient } from '../mcpClient'
import { TEST_ADMIN_SK } from '../fixtures'

const NODE_PATH = 'device/contract-host/sessions/command'
const BINDING_PATH = 'sessions/command'
const binding: ProcessSessionBinding = {
  path: BINDING_PATH,
  description: 'Controlled contract-test process',
  effect: 'read',
  inputSchema: z.strictObject({}),
  maxRuntimeMs: 10_000,
  prepare: () => ({
    executable: execPath,
    argv: ['-e', 'process.stdout.write("contract-ready\\n"); setInterval(() => {}, 1000)'],
  }),
}
const managers = new Set<ProcessSessionManager>()
afterEach(async () => {
  await Promise.all([...managers].map(manager => manager.close()))
  managers.clear()
})

async function post(tb: TestApp, path: string, body: unknown, secret = TEST_ADMIN_SK): Promise<Response> {
  return await tb.request(`https://tb.test/${path}`, bearer(secret, {
    method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(body),
  }))
}
async function issue(tb: TestApp, owner: string, scopes: Scope[]): Promise<string> {
  const response = await post(tb, 'system/sk/write', { owner, scopes })
  expect(response.status).toBe(200)
  return (await response.json() as { secret: string }).secret
}
async function setup() {
  const manager = createProcessSessionManager({ platform: 'linux', terminationGraceMs: 25 })
  managers.add(manager)
  manager.register(binding)
  const invoke = vi.fn(async (_deviceId: string, request: DeviceInvokeRequest) => {
    const parts = request.path.split('/')
    const action = parts.pop()!
    try {
      const value = await manager.invoke(parts.join('/'), action, request.arguments,
        request.context === undefined ? {} : { caller: request.context.caller })
      return { disposition: 'completed' as const, result: { ok: true as const, value } }
    } catch (error) {
      const failure = isTBError(error) ? error : new TBError('internal', 'test device failed')
      return { disposition: 'completed' as const, result: { ok: false as const, error: failure.toJSON() } }
    }
  })
  const tb = await createTestApp({ objects: null, device: { ws: async () => new Response(null, { status: 501 }), invoke } })
  await processDeviceHello({
    store: tb.state, authorization: `Bearer ${TEST_ADMIN_SK}`, deviceIdHint: 'contract-host',
    hello: { deviceId: 'contract-host', expose: { nodes: [{
      path: BINDING_PATH, kind: 'tool', description: binding.description!, cmds: processSessionCommands(binding),
    }] } },
  })
  const scopes: Scope[] = [{ pattern: 'device/contract-host/**', actions: ['read', 'call'] }]
  const alice = await issue(tb, 'agent:alice', scopes)
  const bob = await issue(tb, 'agent:bob', scopes)
  const reader = await issue(tb, 'agent:reader', [{ pattern: 'device/contract-host/**', actions: ['read'] }])
  const response = await tb.request(`https://tb.test/${NODE_PATH}/~help?schemas=1`, bearer(alice, { headers: { accept: 'application/json' } }))
  expect(response.status).toBe(200)
  const help = helpJsonSchema.parse(await response.json())
  return { tb, manager, invoke, help, alice, bob, reader }
}
type Harness = Awaited<ReturnType<typeof setup>>
function startArgs(manager: ProcessSessionManager, requestId: string) {
  return { input: {}, expectedRuntimeId: manager.runtimeId, requestId, startBefore: new Date(Date.now() + 60_000).toISOString() }
}
async function call(h: Harness, name: string, args: Record<string, unknown>, secret = h.alice): Promise<Record<string, unknown>> {
  const response = await post(h.tb, `${NODE_PATH}/${name}`, args, secret)
  expect(response.status).toBe(200)
  return await response.json() as Record<string, unknown>
}
function validateOutput(help: HelpJson, name: string, output: unknown): void {
  const command = help.cmds.find(candidate => candidate.name === name)
  expect(command, `missing advertised command ${name}`).toBeDefined()
  expect(command!.outputSchema, `${name} needs a public output schema`).toBeDefined()
  const validate = new ToolJsonSchemaValidator().getValidator(command!.outputSchema as Record<string, unknown>)
  expect(validate(output)).toMatchObject({ valid: true })
}

interface ScenarioContext { harness: Harness, sessionId?: string }
type Scenario = (context: ScenarioContext) => Promise<unknown>
// The same executable map drives coverage comparison and actual HTTP execution.
// Adding a command requires a scenario; merely registering a name cannot satisfy the gate.
const scenarios: Record<string, Scenario> = {
  async start(context) {
    const result = await call(context.harness, 'start', startArgs(context.harness.manager, 'coverage-start'))
    expect(result.state).toBe('running')
    context.sessionId = String(result.sessionId)
    return result
  },
  async list(context) {
    const result = await call(context.harness, 'list', {})
    expect(result.items).toEqual([expect.objectContaining({ sessionId: context.sessionId })])
    return result
  },
  async observe(context) {
    const result = await call(context.harness, 'observe', { sessionId: context.sessionId, waitMs: 1000 })
    expect(result.chunks).toEqual(expect.arrayContaining([expect.objectContaining({ stream: 'stdout', text: 'contract-ready\n' })]))
    return result
  },
  async stop(context) {
    const result = await call(context.harness, 'stop', { sessionId: context.sessionId })
    expect(result.state).toBe('stopped')
    return result
  },
}
function assertCoverage(help: HelpJson, cases: Record<string, Scenario>): void {
  expect(Object.keys(cases).sort(), 'every advertised process command needs an executed output-contract scenario')
    .toEqual(help.cmds.map(command => command.name).sort())
}

describe('process session public command contract coverage', () => {
  it('executes every advertised command through HTTP and validates actual output against actual help', async () => {
    const harness = await setup()
    expect(harness.help.cmds.map(command => command.name)).toEqual(harness.manager.cmds(BINDING_PATH).map(command => command.name))
    assertCoverage(harness.help, scenarios)
    const context: ScenarioContext = { harness }
    const executed: string[] = []
    for (const [name, run] of Object.entries(scenarios)) {
      validateOutput(harness.help, name, await run(context))
      executed.push(name)
    }
    expect(executed.sort()).toEqual(harness.help.cmds.map(command => command.name).sort())
    expect(harness.invoke).toHaveBeenCalledTimes(executed.length)
    expect(() => validateOutput(harness.help, 'list', { items: 'invalid output' })).toThrow()
  })

  it('fails the gate when any public command scenario is deleted', async () => {
    const { help } = await setup()
    for (const command of help.cmds) {
      const incomplete = { ...scenarios }
      delete incomplete[command.name]
      expect(() => assertCoverage(help, incomplete), command.name).toThrow()
    }
  })

  it('enforces current gateway scopes, owner isolation, strict arguments and realtime-only delivery', async () => {
    const h = await setup()
    const start = await call(h, 'start', startArgs(h.manager, 'owner-check'))
    const sessionId = String(start.sessionId)
    expect((await call(h, 'list', {}, h.bob)).items).toEqual([])
    for (const command of ['observe', 'stop']) {
      const response = await post(h.tb, `${NODE_PATH}/${command}`, { sessionId }, h.bob)
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ code: 'not_found' })
    }
    const beforeUnauthorized = h.invoke.mock.calls.length
    const denied = await post(h.tb, `${NODE_PATH}/list`, {}, h.reader)
    expect(denied.status).toBe(403)
    expect(h.invoke.mock.calls).toHaveLength(beforeUnauthorized)
    for (const [command, args] of [
      ['start', { ...startArgs(h.manager, 'bad-input'), input: { executable: 'arbitrary' } }],
      ['list', { owner: 'agent:alice' }],
      ['observe', { sessionId, cursor: -1 }],
      ['stop', { sessionId, owner: 'agent:alice' }],
    ] as const) {
      const response = await post(h.tb, `${NODE_PATH}/${command}`, args, h.alice)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'invalid_argument' })
    }
    const beforeMailbox = h.invoke.mock.calls.length
    const mailboxArguments: Record<string, Record<string, unknown>> = {
      start: startArgs(h.manager, 'mailbox-must-not-start'), list: {}, observe: { sessionId }, stop: { sessionId },
    }
    for (const command of h.help.cmds) {
      expect(command.delivery).toBe('realtime')
      const response = await post(h.tb, `${NODE_PATH}/${command.name}`, { ...mailboxArguments[command.name], '~delivery': 'mailbox' }, h.alice)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'invalid_argument', message: 'device command does not support mailbox delivery' })
    }
    expect(h.invoke.mock.calls).toHaveLength(beforeMailbox)
    expect((await call(h, 'observe', { sessionId })).state).toBe('running')
    await expect(h.manager.invoke(BINDING_PATH, 'list', {})).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('MCP discovers the same command contract and observes the same owner session', async () => {
    const h = await setup()
    const start = await call(h, 'start', startArgs(h.manager, 'mcp-owner'))
    const client = await connectTestMcpClient('https://tb.test/~mcp', h.alice, (input, init) => h.tb.request(input, init))
    try {
      const result = await client.callTool({ name: 'tb_help', arguments: { path: NODE_PATH, format: 'json', schemas: true } })
      expect(result.isError).not.toBe(true)
      const help = helpJsonSchema.parse(result.structuredContent)
      assertCoverage(help, scenarios)
      const listed = await client.callTool({ name: 'tb_call', arguments: { path: `${NODE_PATH}/list`, args: {} } })
      expect(listed.isError).not.toBe(true)
      validateOutput(help, 'list', listed.structuredContent)
      expect(listed.structuredContent).toMatchObject({ items: [expect.objectContaining({ sessionId: start.sessionId })] })
      const observed = await client.callTool({ name: 'tb_call', arguments: { path: `${NODE_PATH}/observe`, args: { sessionId: start.sessionId, waitMs: 1000 } } })
      expect(observed.isError).not.toBe(true)
      validateOutput(help, 'observe', observed.structuredContent)
      expect(observed.structuredContent).toMatchObject({ sessionId: start.sessionId, state: 'running' })
    } finally {
      await client.close()
    }
  })
})
