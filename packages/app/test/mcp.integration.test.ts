import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectModernMcpClient, connectTestMcpClient } from './mcpClient'
import { createTestApp, TEST_VERSION } from './harness'
import { MemorySearchIndex } from './memorySearchIndex'
import { processDeviceHello } from '../src/index'
import { TEST_ADMIN_SK } from './fixtures'

// 文件级单实例(对齐原 SELF.fetch 语义:一个文件共享一份持久状态)。
// 注入索引:/~mcp 只在宿主提供 SearchIndex 时投影 tb_search(gateway 侧对应
// 可选的 TB_SEARCH binding)，其余固定入口不依赖动态工具目录。
const search = new MemorySearchIndex()
const tb = await createTestApp({ search })

const admin = (extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, ...(extra.headers ?? {}) },
})

let mountedPaths: string[] = []

async function postJson(path: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return tb.request(`https://tb.test/${path}`, {
    method: 'POST',
    ...init,
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

async function issueSk(input: unknown): Promise<string> {
  const response = await postJson('system/sk/write', input,
    admin(),
  )
  expect(response.status).toBe(200)
  return ((await response.json()) as { secret: string }).secret
}

async function mountHttpTools(path: string, tools: unknown[], virtualize?: Record<string, unknown>): Promise<void> {
  const response = await postJson('system/registry/write', {
    path,
    kind: 'http',
    description: `${path} tools`,
    ...(virtualize === undefined ? {} : { virtualize }),
    config: {
      kind: 'http',
      endpoint: 'https://mcp-exit-upstream.test',
      tools,
    },
  },
  admin(),
  )
  expect(response.status).toBe(200)
  mountedPaths.push(path)
}

async function mountHttp(path: string): Promise<void> {
  await mountHttpTools(path, [
    {
      name: 'greet',
      description: `greet through ${path}`,
      method: 'POST',
      pathTemplate: '/greet',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  ])
}

async function mountMcp(path: string): Promise<void> {
  const response = await postJson('system/registry/write', {
    path,
    kind: 'mcp',
    description: `${path} MCP`,
    config: { kind: 'mcp', url: 'https://round15-mcp-upstream.test/mcp' },
  },
  admin(),
  )
  expect(response.status).toBe(200)
  mountedPaths.push(path)
}

function stubSimpleMcpUpstream(tools: Array<Record<string, unknown>>): {
  toolCalls: Array<{ arguments?: unknown, name?: string }>
} {
  const toolCalls: Array<{ arguments?: unknown, name?: string }> = []
  const upstream = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      id?: number | string
      method: string
      params?: { arguments?: unknown, name?: string, protocolVersion?: string }
    }
    const rpc = (result: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
        headers: { 'content-type': 'application/json', ...headers },
      })
    if (body.method === 'initialize') {
      return rpc(
        {
          protocolVersion: body.params?.protocolVersion ?? '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'simple-upstream', version: '1.0.0' },
        },
        { 'mcp-session-id': 'simple-session' },
      )
    }
    if (body.method === 'notifications/initialized') {
      return new Response(null, { status: 202 })
    }
    if (body.method === 'tools/list') return rpc({ tools })
    if (body.method === 'tools/call') {
      toolCalls.push({ name: body.params?.name, arguments: body.params?.arguments })
      return rpc({ content: [{ type: 'text', text: 'called' }] })
    }
    return new Response('unexpected MCP upstream request', { status: 500 })
  })
  vi.stubGlobal('fetch', upstream)
  return { toolCalls }
}

async function mountContext(path: string): Promise<void> {
  const response = await postJson('system/registry/write', {
    path,
    kind: 'context',
    description: `${path} context`,
    config: { kind: 'context', provider: 'storage' },
  },
  admin(),
  )
  expect(response.status).toBe(200)
  mountedPaths.push(path)
}

async function mountRemote(path: string): Promise<void> {
  const response = await postJson('system/registry/write', {
    path,
    kind: 'remote',
    description: `${path} remote`,
    config: { kind: 'remote', baseUrl: 'https://api.example.com/htbp' },
  },
  admin(),
  )
  expect(response.status).toBe(200)
  mountedPaths.push(path)
}

afterEach(async () => {
  for (const path of mountedPaths.reverse()) {
    await postJson('system/registry/delete', { path },
      admin(),
    )
  }
  mountedPaths = []
  vi.unstubAllGlobals()
})

describe('MCP consumer endpoint', () => {
  it('rejects unauthenticated MCP requests before protocol dispatch', async () => {
    const response = await tb.request('https://tb.test/~mcp', {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'unauthenticated-test', version: '1.0.0' },
        },
      }),
    })
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      code: 'permission_denied',
      retryable: false,
    })
  })

  it('official SDK client completes initialize against the local gateway', async () => {
    const client = await connectTestMcpClient(
      'https://tb.test/~mcp',
      TEST_ADMIN_SK,
      (input, init) => tb.request(input, init),
    )

    try {
      expect(client.getServerVersion()).toEqual({ name: 'tool-bridge', version: TEST_VERSION })
      expect(client.getServerCapabilities()).toEqual({ tools: {} })
    } finally {
      await client.close()
    }
  })

  it('exposes scoped search, help and node listing as stable MCP tools', async () => {
    await mountHttpTools('mcp-controls-visible', [{
      name: 'discover_calendar',
      description: 'controlcatalogunique visible calendar discovery',
      method: 'GET',
      pathTemplate: '/calendar',
      inputSchema: { type: 'object', properties: {} },
    }, {
      name: 'update_calendar',
      description: 'controlcatalogunique visible calendar update',
      effect: 'write',
      method: 'POST',
      pathTemplate: '/calendar',
      inputSchema: { type: 'object', properties: {} },
    }])
    await mountHttpTools('mcp-controls-hidden', [{
      name: 'discover_private',
      description: 'controlcatalogunique hidden discovery',
      method: 'GET',
      pathTemplate: '/private',
    }])
    const sk = await issueSk({
      owner: 'agent:mcp-controls',
      scopes: [{ pattern: 'mcp-controls-visible', actions: ['read', 'call'] }],
    })
    const client = await connectTestMcpClient(
      'https://tb.test/~mcp',
      sk,
      (input, init) => tb.request(input, init),
    )

    try {
      const listed = await client.listTools()
      expect(listed.tools.map(tool => tool.name).sort()).toEqual([
        'tb_call', 'tb_device_operations', 'tb_help', 'tb_list_nodes', 'tb_search',
      ])
      expect(listed.tools.find(tool => tool.name === 'tb_call')?.annotations).toMatchObject({
        readOnlyHint: false, destructiveHint: true,
      })
      expect(listed.tools.find(tool => tool.name === 'tb_search')).toMatchObject({
        description: expect.stringContaining('compact by default'),
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: {
            query: { type: 'string', minLength: 1 },
            mode: { type: 'string', enum: ['keyword'] },
            detail: { type: 'string', enum: ['compact', 'full'] },
          },
          required: ['query'],
        },
      })

      const compact = await client.callTool({
        name: 'tb_search',
        arguments: { query: 'controlcatalogunique', limit: 20 },
      })
      const compactItems = (compact.structuredContent as {
        items: Array<{ path: string, tool: { name: string } }>
      }).items
      expect(compactItems).toEqual(expect.arrayContaining([expect.objectContaining({
        path: 'mcp-controls-visible',
        tool: expect.objectContaining({ name: 'discover_calendar' }),
      })]))
      expect(JSON.stringify(compact.structuredContent)).not.toContain('inputSchema')

      const searchCall = vi.spyOn(search, 'search')
      const full = await client.callTool({
        name: 'tb_search',
        arguments: {
          query: 'controlcatalogunique',
          detail: 'full',
          effects: ['read'],
          federation: 'local',
          matching: 'all',
          minCoverage: 1,
          mode: 'keyword',
          pathPrefix: 'mcp-controls-visible',
          limit: 20,
        },
      })
      expect(full).toMatchObject({
        structuredContent: {
          items: [{
            path: 'mcp-controls-visible',
            tool: {
              name: 'discover_calendar',
              inputSchema: { type: 'object', properties: {} },
            },
          }],
        },
      })
      expect(JSON.stringify(full.structuredContent)).not.toContain('update_calendar')
      expect(searchCall).toHaveBeenCalledWith(
        'controlcatalogunique',
        expect.objectContaining({
          matching: 'all',
          minCoverage: 1,
          mode: 'keyword',
          pathPrefix: 'mcp-controls-visible',
        }),
      )

      await expect(client.callTool({
        name: 'tb_help',
        arguments: { path: 'mcp-controls-visible', format: 'json' },
      })).resolves.toMatchObject({
        structuredContent: {
          node: { path: 'mcp-controls-visible', kind: 'http' },
        },
      })

      const tree = await client.callTool({
        name: 'tb_list_nodes',
        arguments: { depth: 1 },
      })
      expect(tree).toMatchObject({
        structuredContent: {
          children: [{ path: 'mcp-controls-visible' }],
        },
      })
      expect(JSON.stringify(tree)).not.toContain('mcp-controls-hidden')

      await expect(client.callTool({
        name: 'tb_help',
        arguments: { path: 'mcp-controls-hidden' },
      })).resolves.toMatchObject({ isError: true })
      searchCall.mockClear()
      await expect(client.callTool({
        name: 'tb_search',
        arguments: { query: 'controlcatalogunique', unexpected: true },
      })).rejects.toThrow(/unexpected|additional/i)
      expect(searchCall).not.toHaveBeenCalled()
    } finally {
      await client.close()
    }
  })

  it('serves the 2026-07-28 era without a handshake and caches tools/list privately', async () => {
    await mountHttp('mcp-modern/basic')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ hello: 'modern' }), {
      headers: { 'content-type': 'application/json' },
    })))
    const client = await connectModernMcpClient(
      'https://tb.test/~mcp',
      TEST_ADMIN_SK,
      (input, init) => tb.request(input, init),
    )

    try {
      const listed = await client.listTools()
      expect(listed.tools.length).toBeGreaterThan(0)
      // SEP-2549:modern 结果必带缓存字段。scope 必须是 private——工具清单按调用方
      // scope 裁剪过,public 等于允许共享中间层跨身份复用目录。
      const cacheable = listed as unknown as { cacheScope?: string, ttlMs?: number }
      expect(cacheable.cacheScope).toBe('private')
      expect(cacheable.ttlMs).toBe(300_000)
      await expect(client.callTool({
        name: 'tb_call', arguments: { path: '/mcp-modern/basic/greet', args: { name: 'modern' } },
      })).resolves.toMatchObject({ structuredContent: { hello: 'modern' } })
    } finally {
      await client.close()
    }
  })

  it('keeps cache fields off the 2025-era wire', async () => {
    await mountHttp('mcp-modern/legacy-clean')
    const client = await connectTestMcpClient(
      'https://tb.test/~mcp',
      TEST_ADMIN_SK,
      (input, init) => tb.request(input, init),
    )

    try {
      const listed = await client.listTools() as Record<string, unknown>
      expect(listed).not.toHaveProperty('ttlMs')
      expect(listed).not.toHaveProperty('cacheScope')
    } finally {
      await client.close()
    }
  })

  it('preserves delivery, TTL, idempotency and operation lifecycle through fixed tools', async () => {
    const deviceSk = await issueSk({
      owner: 'device:mcp-mailbox',
      scopes: [{ pattern: 'device/**', actions: ['read', 'call', 'register'] }],
    })
    await processDeviceHello({
      authorization: `Bearer ${deviceSk}`,
      deviceIdHint: 'mcp-mailbox',
      hello: {
        deviceId: 'mcp-mailbox',
        expose: {
          nodes: [{
            path: 'tools/mail',
            kind: 'tool',
            description: 'mail',
            cmds: [{
              name: 'send',
              delivery: 'both',
              inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
            }],
          }],
        },
      },
      store: tb.state,
    })
    const client = await connectTestMcpClient(
      'https://tb.test/~mcp',
      TEST_ADMIN_SK,
      (input, init) => tb.request(input, init),
    )
    try {
      const listed = await client.listTools()
      expect(listed.tools.map(tool => tool.name)).toContain('tb_device_operations')
      const input = {
        path: '/device/mcp-mailbox/tools/mail/send',
        args: { text: 'hello' },
        delivery: 'fallback',
        ttlSeconds: 300,
        idempotencyKey: 'mcp-send-1',
      }
      for (const invalid of [
        { path: input.path, args: { 'text': 'hello', '~delivery': 'mailbox' }, delivery: 'mailbox' },
        { path: input.path, args: { text: 'hello' }, ttlSeconds: 30 },
        { path: input.path, args: { text: 'hello' }, delivery: 'realtime', idempotencyKey: 'bad-policy' },
        { path: input.path, args: { 'text': 'hello', '~delivery': 'mailbox' }, ttlSeconds: 30 },
      ]) {
        await expect(client.callTool({ name: 'tb_call', arguments: invalid })).resolves.toMatchObject({
          isError: true, structuredContent: { code: 'invalid_argument' },
        })
      }
      await expect(client.callTool({
        name: 'tb_device_operations', arguments: { action: 'list', deviceId: 'mcp-mailbox' },
      })).resolves.toMatchObject({ structuredContent: { items: [] } })
      const result = await client.callTool({ name: 'tb_call', arguments: input })
      expect(result.structuredContent).toMatchObject({
        delivery: 'mailbox',
        operation: { state: 'queued', targetPath: 'device/mcp-mailbox/tools/mail/send' },
      })
      const operation = (result.structuredContent as {
        operation: { createdAt: string, expiresAt: string, operationId: string }
      }).operation
      expect(Date.parse(operation.expiresAt) - Date.parse(operation.createdAt)).toBe(300_000)
      await expect(client.callTool({ name: 'tb_call', arguments: input })).resolves.toMatchObject({
        structuredContent: { operation: { operationId: operation.operationId } },
      })
      await expect(client.callTool({
        name: 'tb_device_operations',
        arguments: { action: 'list', deviceId: 'mcp-mailbox', states: ['queued'], limit: 1 },
      })).resolves.toMatchObject({
        structuredContent: { items: [expect.objectContaining({ operationId: operation.operationId })] },
      })
      await expect(client.callTool({
        name: 'tb_device_operations',
        arguments: { action: 'get', deviceId: 'mcp-mailbox', operationId: operation.operationId },
      })).resolves.toMatchObject({ structuredContent: { state: 'queued' } })
      await expect(client.callTool({
        name: 'tb_device_operations',
        arguments: { action: 'cancel', deviceId: 'mcp-mailbox', operationId: operation.operationId },
      })).resolves.toMatchObject({ structuredContent: { state: 'cancelled' } })
      await expect(client.callTool({
        name: 'tb_device_operations',
        arguments: { action: 'get', deviceId: 'mcp-mailbox', operationId: operation.operationId },
      })).resolves.toMatchObject({ structuredContent: { state: 'cancelled' } })
      await expect(client.callTool({
        name: 'tb_call', arguments: { ...input, args: { text: 'changed' } },
      })).resolves.toMatchObject({ isError: true })
      await expect(client.callTool({
        name: 'tb_call', arguments: { path: input.path, args: { 'text': 'raw-control', '~delivery': 'mailbox' } },
      })).resolves.toMatchObject({
        structuredContent: { delivery: 'mailbox', operation: { state: 'queued' } },
      })
    } finally {
      await client.close()
    }
  })

  it.each(['completed', 'unknown'] as const)(
    'does not enqueue or repeat a fallback call after %s dispatch', async (disposition) => {
      const invoke = vi.fn(async () => disposition === 'completed'
        ? { disposition, result: { ok: true as const, value: { delivered: true } } }
        : {
            disposition,
            result: {
              ok: false as const,
              error: { code: 'unavailable' as const, message: 'connection lost', retryable: true },
            },
          })
      const isolated = await createTestApp({ device: {
        ws: async () => new Response(null, { status: 501 }), invoke,
      } })
      await processDeviceHello({
        authorization: `Bearer ${TEST_ADMIN_SK}`,
        deviceIdHint: 'mcp-dispatch',
        hello: { deviceId: 'mcp-dispatch', expose: { nodes: [{
          path: 'tools/mail', kind: 'tool', description: 'mail',
          cmds: [{ name: 'send', delivery: 'both', inputSchema: { type: 'object', properties: {} } }],
        }] } },
        store: isolated.state,
      })
      const client = await connectTestMcpClient('https://tb.test/~mcp', TEST_ADMIN_SK,
        (input, init) => isolated.request(input, init))
      try {
        const result = await client.callTool({
          name: 'tb_call', arguments: {
            path: '/device/mcp-dispatch/tools/mail/send', args: {}, delivery: 'fallback',
          },
        })
        expect(invoke).toHaveBeenCalledTimes(1)
        if (disposition === 'completed') {
          expect(result).toMatchObject({ structuredContent: { delivery: 'realtime', result: { delivered: true } } })
        } else {
          expect(result).toMatchObject({
            isError: true,
            structuredContent: { code: 'unavailable', retryable: false, message: expect.stringContaining('was not enqueued') },
          })
        }
        await expect(client.callTool({
          name: 'tb_device_operations', arguments: { action: 'list', deviceId: 'mcp-dispatch' },
        })).resolves.toMatchObject({ structuredContent: { items: [] } })
      } finally {
        await client.close()
      }
    },
  )

  it('calls a known realtime device path without descriptors while preserving explicit allowlists and scope', async () => {
    const invoke = vi.fn(async () => ({
      disposition: 'completed' as const, result: { ok: true as const, value: { invoked: true } },
    }))
    const isolated = await createTestApp({ device: {
      ws: async () => new Response(null, { status: 501 }), invoke,
    } })
    await processDeviceHello({
      authorization: `Bearer ${TEST_ADMIN_SK}`,
      deviceIdHint: 'mcp-dynamic',
      hello: { deviceId: 'mcp-dynamic', expose: { nodes: [
        { path: 'tools/dynamic', kind: 'tool', description: 'runtime command without metadata' },
        { path: 'tools/empty', kind: 'tool', description: 'explicit empty allowlist', cmds: [] },
        { path: 'tools/declared', kind: 'tool', description: 'explicit allowlist', cmds: [{ name: 'other' }] },
      ] } },
      store: isolated.state,
    })
    const issued = await isolated.request('https://tb.test/system/sk/write', {
      method: 'POST',
      headers: { ...admin().headers, 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({ owner: 'agent:mcp-dynamic-reader', scopes: [{ pattern: 'device/**', actions: ['read'] }] }),
    })
    expect(issued.status).toBe(200)
    const { secret } = await issued.json() as { secret: string }
    const reader = await connectTestMcpClient('https://tb.test/~mcp', secret,
      (input, init) => isolated.request(input, init))
    const caller = await connectTestMcpClient('https://tb.test/~mcp', TEST_ADMIN_SK,
      (input, init) => isolated.request(input, init))
    try {
      const path = '/device/mcp-dynamic/tools/dynamic/known'
      await expect(reader.callTool({ name: 'tb_call', arguments: { path, args: {} } })).resolves.toMatchObject({ isError: true })
      expect(invoke).not.toHaveBeenCalled()
      await expect(caller.callTool({ name: 'tb_call', arguments: { path, args: { payload: 'known' } } })).resolves.toMatchObject({
        structuredContent: { invoked: true },
      })
      expect(invoke).toHaveBeenCalledTimes(1)
      await expect(caller.callTool({
        name: 'tb_call', arguments: { path, args: {}, delivery: 'mailbox' },
      })).resolves.toMatchObject({ isError: true, structuredContent: { code: 'invalid_argument' } })
      for (const target of ['empty', 'declared']) {
        await expect(caller.callTool({
          name: 'tb_call', arguments: { path: `/device/mcp-dynamic/tools/${target}/known`, args: {} },
        })).resolves.toMatchObject({ isError: true, structuredContent: { code: 'not_found' } })
      }
      expect(invoke).toHaveBeenCalledTimes(1)
    } finally {
      await reader.close()
      await caller.close()
    }
  })

  it('discovers a selected command and enforces its schema and scope before calling', async () => {
    await mountHttp('mcp-round15/allowed')
    await mountHttp('mcp-round15/read-only')
    await mountContext('mcp-round15/context')
    const sk = await issueSk({
      owner: 'agent:mcp-round15',
      scopes: [
        { pattern: 'mcp-round15/allowed', actions: ['read', 'call'] },
        { pattern: 'mcp-round15/read-only', actions: ['read'] },
        { pattern: 'mcp-round15/context', actions: ['read'] },
      ],
    })
    const upstream = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const args = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ greeting: `hello ${String(args.name)}` }), {
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', upstream)

    const client = await connectTestMcpClient(
      'https://tb.test/~mcp',
      sk,
      (input, init) => tb.request(input, init),
    )
    try {
      const help = await client.callTool({
        name: 'tb_help', arguments: { path: '/mcp-round15/allowed', schemas: true },
      })
      const command = (help.structuredContent as {
        cmds: Array<{ inputSchema: unknown, path: string }>
      }).cmds[0]
      expect(command).toMatchObject({
        path: '/mcp-round15/allowed/greet',
        inputSchema: {
          type: 'object', properties: { name: { type: 'string' } }, required: ['name'],
        },
      })
      await expect(client.callTool({
        name: 'tb_call', arguments: { path: command?.path, args: {} },
      })).rejects.toThrow(/name|required/i)
      await expect(client.callTool({
        name: 'tb_call', arguments: { path: command?.path, args: { name: 42 } },
      })).rejects.toThrow(/name|string/i)
      await expect(client.callTool({
        name: 'tb_call', arguments: { path: '/mcp-round15/read-only/greet', args: { name: 'blocked' } },
      })).resolves.toMatchObject({ isError: true })
      await expect(client.callTool({
        name: 'tb_call', arguments: { path: '/mcp-round15/context/write', args: { path: 'x', entry: { content: 'blocked', contentType: 'text/plain' } } },
      })).resolves.toMatchObject({ isError: true })
      expect(upstream).not.toHaveBeenCalled()

      const called = await client.callTool({
        name: 'tb_call', arguments: { path: command?.path, args: { name: 'Ada' } },
      })
      expect(called).toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('hello Ada') }],
        structuredContent: { greeting: 'hello Ada' },
      })
      expect(upstream).toHaveBeenCalledTimes(1)
    } finally {
      await client.close()
    }
  })

  it('preserves Context, Skill and builtin authorization including read-only mounts', async () => {
    const skillFiles = [{ path: 'SKILL.md', content: '---\nname: mcp-skill\ndescription: Test skill.\n---\n# Skill\n' }]
    const cases = [
      { kind: 'context', write: 'write', args: { path: 'entry', entry: { content: 'stored', contentType: 'text/plain' } } },
      { kind: 'skillhub', write: 'publish', args: { id: 'mcp-skill', files: skillFiles } },
    ] as const
    for (const item of cases) {
      for (const readOnly of [false, true]) {
        const path = `mcp-access/${item.kind}${readOnly ? '-ro' : ''}`
        const mounted = await postJson('system/registry/write', {
          path, kind: item.kind, description: 'permission contract',
          config: { kind: item.kind, provider: 'storage', readOnly },
        }, admin())
        expect(mounted.status).toBe(200)
        mountedPaths.push(path)
      }
    }
    const readerSk = await issueSk({
      owner: 'agent:mcp-access-reader',
      scopes: [
        { pattern: 'mcp-access/**', actions: ['read'] },
        { pattern: 'system/annotation', actions: ['read', 'write', 'call'] },
      ],
    })
    const reader = await connectTestMcpClient('https://tb.test/~mcp', readerSk,
      (input, init) => tb.request(input, init))
    const writer = await connectTestMcpClient('https://tb.test/~mcp', TEST_ADMIN_SK,
      (input, init) => tb.request(input, init))
    try {
      for (const item of cases) {
        const path = `/mcp-access/${item.kind}`
        await expect(reader.callTool({
          name: 'tb_call', arguments: { path: `${path}/list`, args: {} },
        })).resolves.toMatchObject({ structuredContent: { items: [] } })
        await expect(reader.callTool({
          name: 'tb_call', arguments: { path: `${path}/${item.write}`, args: item.args },
        })).resolves.toMatchObject({ isError: true })
        await expect(writer.callTool({
          name: 'tb_call', arguments: { path: `${path}/list`, args: {} },
        })).resolves.toMatchObject({ structuredContent: { items: [] } })
        const written = await writer.callTool({
          name: 'tb_call', arguments: { path: `${path}/${item.write}`, args: item.args },
        })
        expect(written.isError).not.toBe(true)
        const listed = await reader.callTool({ name: 'tb_call', arguments: { path: `${path}/list`, args: {} } })
        expect((listed.structuredContent as { items: unknown[] }).items).toHaveLength(1)
        await expect(writer.callTool({
          name: 'tb_call', arguments: { path: `${path}-ro/${item.write}`, args: item.args },
        })).resolves.toMatchObject({ isError: true })
        await expect(writer.callTool({
          name: 'tb_call', arguments: { path: `${path}-ro/list`, args: {} },
        })).resolves.toMatchObject({ structuredContent: { items: [] } })
      }
      const annotation = { path: 'mcp-access/context', text: 'requires admin' }
      await expect(reader.callTool({
        name: 'tb_call', arguments: { path: '/system/annotation/set', args: annotation },
      })).resolves.toMatchObject({ isError: true })
      await expect(writer.callTool({
        name: 'tb_call', arguments: { path: '/system/annotation/set', args: annotation },
      })).resolves.toMatchObject({ structuredContent: { text: 'requires admin' } })
      await expect(reader.callTool({
        name: 'tb_call', arguments: { path: '/system/annotation/get', args: { path: annotation.path } },
      })).resolves.toMatchObject({ structuredContent: { text: 'requires admin' } })
    } finally {
      await postJson('system/annotation/remove', { path: 'mcp-access/context' }, admin())
      await reader.close()
      await writer.close()
    }
  })

  it('没有 write scope 的 MCP tools/list 不探测直传 signer', async () => {
    const objectsFactory = vi.fn(async () => {
      throw new Error('must not resolve object signer')
    })
    const isolated = await createTestApp()
    const register = await isolated.request('https://tb.test/mcp-read/context/~register', {
      method: 'POST',
      headers: {
        ...admin().headers,
        'accept': 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        path: 'mcp-read/context',
        kind: 'context',
        description: 'read-only caller view',
        config: { kind: 'context', provider: 'storage' },
      }),
    })
    expect(register.status).toBe(200)
    isolated.deps.objectStoreForBackend = objectsFactory
    const skResponse = await isolated.request('https://tb.test/system/sk/write', {
      method: 'POST',
      headers: {
        ...admin().headers,
        'accept': 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        owner: 'agent:mcp-read',
        scopes: [{ pattern: 'mcp-read/context', actions: ['read'] }],
      }),
    })
    expect(skResponse.status).toBe(200)
    const sk = ((await skResponse.json()) as { secret: string }).secret
    const client = await connectTestMcpClient(
      'https://tb.test/~mcp',
      sk,
      (input, init) => isolated.request(input, init),
    )
    try {
      const listed = await client.listTools()
      expect(listed.tools.map(tool => tool.name).sort()).toEqual([
        'tb_call', 'tb_device_operations', 'tb_help', 'tb_list_nodes',
      ])
      expect(objectsFactory).not.toHaveBeenCalled()
    } finally {
      await client.close()
    }
  })

  it('keeps fixed tool names while a narrower identity rejects previously visible command paths', async () => {
    await mountHttp('mcp-round16/allowed')
    await mountHttp('mcp-round16/admin-only')
    const upstream = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      }))
    vi.stubGlobal('fetch', upstream)

    const adminClient = await connectTestMcpClient(
      'https://tb.test/~mcp',
      TEST_ADMIN_SK,
      (input, init) => tb.request(input, init),
    )
    let adminNames: string[] = []
    try {
      adminNames = (await adminClient.listTools()).tools.map(tool => tool.name)
      await expect(adminClient.callTool({
        name: 'tb_help', arguments: { path: '/mcp-round16/admin-only/greet' },
      })).resolves.toMatchObject({ structuredContent: { cmds: [{ path: '/mcp-round16/admin-only/greet' }] } })
    } finally {
      await adminClient.close()
    }

    const narrowSk = await issueSk({
      owner: 'agent:mcp-round16-narrow',
      scopes: [{ pattern: 'mcp-round16/allowed', actions: ['read', 'call'] }],
    })
    const narrowClient = await connectTestMcpClient(
      'https://tb.test/~mcp',
      narrowSk,
      (input, init) => tb.request(input, init),
    )
    try {
      expect((await narrowClient.listTools()).tools.map(tool => tool.name)).toEqual(adminNames)
      await expect(narrowClient.callTool({
        name: 'tb_call',
        arguments: { path: '/mcp-round16/admin-only/greet', args: { name: 'forbidden' } },
      })).resolves.toMatchObject({ isError: true })
      expect(upstream).not.toHaveBeenCalled()
      await expect(narrowClient.callTool({
        name: 'tb_call',
        arguments: { path: '/mcp-round16/allowed/greet', args: { name: 'permitted' } },
      })).resolves.toMatchObject({ structuredContent: { ok: true } })
      expect(upstream).toHaveBeenCalledTimes(1)
    } finally {
      await narrowClient.close()
    }
  })

  it('invalid provider schemas fail closed only when that command is selected', async () => {
    await mountHttpTools('mcp-round15/invalid-schema', [
      {
        name: 'broken',
        method: 'POST',
        pathTemplate: '/broken',
        inputSchema: { type: 'object', properties: { value: 'not-a-schema' } },
      },
      {
        name: 'healthy', method: 'POST', pathTemplate: '/healthy',
        inputSchema: { type: 'object', properties: {} },
      },
    ])
    const upstream = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', upstream)
    const client = await connectTestMcpClient(
      'https://tb.test/~mcp',
      TEST_ADMIN_SK,
      (input, init) => tb.request(input, init),
    )
    try {
      await expect(client.listTools()).resolves.toMatchObject({ tools: expect.any(Array) })
      await expect(client.callTool({
        name: 'tb_help', arguments: { path: '/mcp-round15/invalid-schema/healthy' },
      })).resolves.toMatchObject({ structuredContent: { cmds: [{ path: '/mcp-round15/invalid-schema/healthy' }] } })
      await expect(client.callTool({
        name: 'tb_call', arguments: { path: '/mcp-round15/invalid-schema/healthy', args: {} },
      })).resolves.toMatchObject({ structuredContent: { ok: true } })
      expect(upstream).toHaveBeenCalledTimes(1)
      await expect(client.callTool({
        name: 'tb_call', arguments: { path: '/mcp-round15/invalid-schema/broken', args: {} },
      })).rejects.toThrow(/invalid tool metadata|invalid input schema/i)
      expect(upstream).toHaveBeenCalledTimes(1)
    } finally {
      await client.close()
    }
  })

  it('honors virtualized names and hidden tools when resolving a selected command', async () => {
    await mountHttpTools('mcp-virtualized', [{
      name: 'original', method: 'POST', pathTemplate: '/original',
      inputSchema: { type: 'object', properties: {} },
    }, {
      name: 'secret', method: 'POST', pathTemplate: '/secret',
      inputSchema: { type: 'object', properties: {} },
    }], { rename: { original: 'public' }, hide: ['secret'] })
    const upstream = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/original')
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', upstream)
    const client = await connectTestMcpClient('https://tb.test/~mcp', TEST_ADMIN_SK,
      (input, init) => tb.request(input, init))
    try {
      await expect(client.callTool({
        name: 'tb_help', arguments: { path: '/mcp-virtualized' },
      })).resolves.toMatchObject({ structuredContent: { cmds: [{ path: '/mcp-virtualized/public' }] } })
      for (const name of ['original', 'secret']) {
        await expect(client.callTool({
          name: 'tb_call', arguments: { path: `/mcp-virtualized/${name}`, args: {} },
        })).resolves.toMatchObject({ isError: true })
      }
      expect(upstream).not.toHaveBeenCalled()
      await expect(client.callTool({
        name: 'tb_call', arguments: { path: '/mcp-virtualized/public', args: {} },
      })).resolves.toMatchObject({ structuredContent: { ok: true } })
      expect(upstream).toHaveBeenCalledTimes(1)
    } finally {
      await client.close()
    }
  })

  it('preserves upstream MCP business errors, content blocks, and structured content', async () => {
    await mountMcp('mcp-round15/native-result')
    const upstream = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        id?: number | string
        method: string
        params?: { protocolVersion?: string }
      }
      const rpc = (result: unknown, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
          headers: { 'content-type': 'application/json', ...headers },
        })
      if (body.method === 'initialize') {
        return rpc(
          {
            protocolVersion: body.params?.protocolVersion ?? '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'round15-upstream', version: '1.0.0' },
          },
          { 'mcp-session-id': 'round15-session' },
        )
      }
      if (body.method === 'notifications/initialized') {
        return new Response(null, { status: 202 })
      }
      if (body.method === 'tools/list') {
        return rpc({
          tools: [{ name: 'fail-richly', inputSchema: { type: 'object' } }],
        })
      }
      if (body.method === 'tools/call') {
        return rpc({
          content: [
            { type: 'text', text: 'upstream rejected the operation' },
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
          ],
          structuredContent: { code: 'upstream_rejected' },
          isError: true,
        })
      }
      return new Response('unexpected MCP upstream request', { status: 500 })
    })
    vi.stubGlobal('fetch', upstream)

    const client = await connectTestMcpClient(
      'https://tb.test/~mcp',
      TEST_ADMIN_SK,
      (input, init) => tb.request(input, init),
    )
    try {
      const called = await client.callTool({
        name: 'tb_call', arguments: { path: '/mcp-round15/native-result/fail-richly', args: {} },
      })
      expect(called).toMatchObject({
        content: [
          { type: 'text', text: 'upstream rejected the operation' },
          { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
        ],
        structuredContent: { code: 'upstream_rejected' },
        isError: true,
      })
    } finally {
      await client.close()
    }
  })

  it('advertises CamelCase upstream tools as callable canonical paths and preserves call identity', async () => {
    await mountMcp('mcp-round15/camel-case')
    const { toolCalls } = stubSimpleMcpUpstream([{
      name: 'GetLiveContext',
      description: 'Get Home Assistant live context',
      inputSchema: {
        type: 'object',
        properties: { domain: { type: 'string' } },
      },
    }])

    const client = await connectTestMcpClient('https://tb.test/~mcp', TEST_ADMIN_SK,
      (input, init) => tb.request(input, init))
    try {
      const help = await client.callTool({
        name: 'tb_help', arguments: { path: '/mcp-round15/camel-case', format: 'json' },
      })
      const commands = (help.structuredContent as { cmds: Array<{ name: string, path: string }> }).cmds
      expect(commands).toEqual([
        expect.objectContaining({ name: 'getlivecontext', path: '/mcp-round15/camel-case/getlivecontext' }),
      ])
      const advertisedPath = commands[0]?.path
      await expect(client.callTool({
        name: 'tb_help', arguments: { path: advertisedPath },
      })).resolves.toMatchObject({
        structuredContent: { cmds: [{ name: 'getlivecontext', path: advertisedPath }] },
      })
      await client.callTool({
        name: 'tb_call', arguments: { path: advertisedPath, args: { domain: 'sensor' } },
      })
      expect(toolCalls).toEqual([{ name: 'GetLiveContext', arguments: { domain: 'sensor' } }])
    } finally {
      await client.close()
    }
  })

  it('fails discovery when upstream tool names collide after canonicalization', async () => {
    await mountMcp('mcp-round15/case-collision')
    stubSimpleMcpUpstream([
      { name: 'HassTurnOn', inputSchema: { type: 'object' } },
      { name: 'hassturnon', inputSchema: { type: 'object' } },
    ])

    const response = await tb.request(
      'https://tb.test/mcp-round15/case-collision/~help',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringMatching(/规范化后冲突.*显式 rename/),
      retryable: false,
    })
  })

  it('remote descendants are localized, schema-complete, and callable through the mount', async () => {
    await mountRemote('mcp-round15/peer')
    const remoteFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          headers: { 'content-type': 'application/json' },
        })

      if (init?.method === 'POST' && url.pathname === '/htbp/alpha/echo') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        expect(body).toEqual({ text: 'remote' })
        return json({ echoed: body.text })
      }
      if (url.pathname === '/htbp/~tree') {
        return json({
          path: '',
          kind: 'directory',
          description: 'peer root',
          children: [{ path: 'alpha', kind: 'http', description: 'remote alpha' }],
        })
      }
      if (url.pathname === '/htbp/alpha/~tree') {
        return json({ path: 'alpha', kind: 'http', description: 'remote alpha' })
      }
      if (url.pathname === '/htbp/~help') {
        return json({
          htbp: '0.1',
          node: { path: '', kind: 'directory', description: 'peer root' },
          cmds: [],
        })
      }
      if (url.pathname === '/htbp/alpha/~help') {
        return json({
          htbp: '0.1',
          node: { path: 'alpha', kind: 'http', description: 'remote alpha' },
          cmds: [
            {
              name: 'echo',
              method: 'POST',
              path: '/alpha/echo',
              scope: 'call',
              h: 'remote echo',
            },
          ],
        })
      }
      if (url.pathname === '/htbp/alpha/echo/~help') {
        return json({
          htbp: '0.1',
          node: { path: 'alpha/echo', kind: 'http', description: 'remote echo' },
          cmds: [
            {
              name: 'echo',
              method: 'POST',
              path: '/alpha/echo',
              scope: 'call',
              h: 'remote echo',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
            },
          ],
        })
      }
      return new Response('unexpected remote request', { status: 500 })
    })
    vi.stubGlobal('fetch', remoteFetch)

    const client = await connectTestMcpClient(
      'https://tb.test/~mcp',
      TEST_ADMIN_SK,
      (input, init) => tb.request(input, init),
    )
    try {
      await client.listTools()
      expect(remoteFetch).not.toHaveBeenCalled()
      const help = await client.callTool({
        name: 'tb_help', arguments: { path: '/mcp-round15/peer/alpha/echo' },
      })
      const command = (help.structuredContent as { cmds: Array<{ path: string }> }).cmds[0]
      expect(command?.path).toBe('/mcp-round15/peer/alpha/echo')
      const called = await client.callTool({
        name: 'tb_call', arguments: { path: command?.path, args: { text: 'remote' } },
      })
      expect(called).toMatchObject({ structuredContent: { echoed: 'remote' } })
      expect(
        remoteFetch.mock.calls.some(([input, init]) =>
          init?.method === 'POST' && new URL(String(input)).pathname === '/htbp/alpha/echo'),
      ).toBe(true)
    } finally {
      await client.close()
    }

    const noCallSk = await issueSk({
      owner: 'agent:mcp-round15-remote-read',
      scopes: [{ pattern: 'mcp-round15/peer/**', actions: ['read', 'write'] }],
    })
    const before = remoteFetch.mock.calls.length
    const noCallClient = await connectTestMcpClient(
      'https://tb.test/~mcp',
      noCallSk,
      (input, init) => tb.request(input, init),
    )
    try {
      await noCallClient.listTools()
      await expect(noCallClient.callTool({
        name: 'tb_call', arguments: { path: '/mcp-round15/peer/alpha/echo', args: { text: 'blocked' } },
      })).resolves.toMatchObject({ isError: true })
      expect(remoteFetch).toHaveBeenCalledTimes(before)
    } finally {
      await noCallClient.close()
    }
  })

  it('resolves the local longest-prefix command without exploring its remote parent', async () => {
    await mountRemote('mcp-round15/override')
    await mountHttp('mcp-round15/override/alpha')
    const remoteFetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          headers: { 'content-type': 'application/json' },
        })
      if (path === '/htbp/~tree') {
        return json({
          path: '',
          kind: 'directory',
          description: 'peer root',
          children: [{ path: 'alpha', kind: 'http', description: 'remote alpha' }],
        })
      }
      if (path === '/htbp/~help') {
        return json({
          htbp: '0.1',
          node: { path: '', kind: 'directory', description: 'peer root' },
          cmds: [],
        })
      }
      return new Response('remote descendant should be shadowed', { status: 500 })
    })
    vi.stubGlobal('fetch', remoteFetch)

    const client = await connectTestMcpClient(
      'https://tb.test/~mcp',
      TEST_ADMIN_SK,
      (input, init) => tb.request(input, init),
    )
    try {
      await client.listTools()
      await expect(client.callTool({
        name: 'tb_help', arguments: { path: '/mcp-round15/override/alpha/greet' },
      })).resolves.toMatchObject({
        structuredContent: { cmds: [{ path: '/mcp-round15/override/alpha/greet', name: 'greet' }] },
      })
      expect(remoteFetch).not.toHaveBeenCalled()
    } finally {
      await client.close()
    }
  })

  it('does not walk a wide remote tree when listing fixed tools', async () => {
    await mountRemote('mcp-round15/budget')
    const remoteFetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      const children = Array.from({ length: 40 }, (_, index) => ({
        path: `n${index.toString().padStart(2, '0')}`,
        kind: 'http',
        description: 'wide remote node',
      }))
      return new Response(JSON.stringify(
        path === '/htbp/~tree'
          ? { path: '', kind: 'directory', description: 'wide peer', children }
          : { path: path.split('/')[2], kind: 'http', description: 'wide remote node' },
      ), { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', remoteFetch)

    const client = await connectTestMcpClient(
      'https://tb.test/~mcp',
      TEST_ADMIN_SK,
      (input, init) => tb.request(input, init),
    )
    try {
      await expect(client.listTools()).resolves.toMatchObject({ tools: expect.any(Array) })
      expect(remoteFetch).not.toHaveBeenCalled()
    } finally {
      await client.close()
    }
  })

  it.each(['../admin', '%2e%2e/admin', '%25252e%25252e/admin'])(
    'rejects remote dot-segment path %s before a credentialed descendant fetch',
    async (childPath) => {
      await mountRemote('mcp-round15/path-escape')
      const remoteFetch = vi.fn(async () =>
        new Response(JSON.stringify({
          path: '',
          kind: 'directory',
          description: 'malicious peer',
          children: [{ path: childPath, kind: 'http', description: 'escape' }],
        }), { headers: { 'content-type': 'application/json' } }))
      vi.stubGlobal('fetch', remoteFetch)

      const client = await connectTestMcpClient(
        'https://tb.test/~mcp',
        TEST_ADMIN_SK,
        (input, init) => tb.request(input, init),
      )
      try {
        await client.listTools()
        expect(remoteFetch).not.toHaveBeenCalled()
        await expect(client.callTool({
          name: 'tb_list_nodes', arguments: { path: 'mcp-round15/path-escape' },
        })).resolves.toMatchObject({ isError: true })
        expect(remoteFetch).toHaveBeenCalledTimes(1)
      } finally {
        await client.close()
      }
    },
  )

  it('keeps a bounded tool catalog despite long paths and an unavailable unrelated upstream', async () => {
    const path = `mcp-on-demand/${'long'.repeat(30)}`
    await mountHttp(path)
    await mountMcp('mcp-on-demand/offline')
    const upstream = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('round15-mcp-upstream')) throw new Error('unrelated upstream offline')
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', upstream)
    const client = await connectTestMcpClient('https://tb.test/~mcp', TEST_ADMIN_SK,
      (input, init) => tb.request(input, init))
    try {
      const listed = await client.listTools()
      expect(listed.tools.map(tool => tool.name).sort()).toEqual([
        'tb_call', 'tb_device_operations', 'tb_help', 'tb_list_nodes', 'tb_search',
      ])
      expect(JSON.stringify(listed)).not.toContain(path)
      expect(upstream).not.toHaveBeenCalled()
      await expect(client.callTool({
        name: 'tb_help', arguments: { path: `/${path}/greet` },
      })).resolves.toMatchObject({ structuredContent: { cmds: [{ path: `/${path}/greet` }] } })
      expect(upstream).not.toHaveBeenCalled()
      await expect(client.callTool({
        name: 'tb_call', arguments: { path: `/${path}/greet`, args: { name: 'healthy' } },
      })).resolves.toMatchObject({ structuredContent: { ok: true } })
      expect(upstream).toHaveBeenCalledTimes(1)
    } finally {
      await client.close()
    }
  })

  it.each(['a\\b', 'a%2fb'])(
    'preserves logical path segment %s without redirecting writes to another node', async (segment) => {
      const path = `mcp-path/${segment}`
      await mountContext(path)
      await mountContext('mcp-path/a/b')
      const client = await connectTestMcpClient('https://tb.test/~mcp', TEST_ADMIN_SK,
        (input, init) => tb.request(input, init))
      try {
        await expect(client.callTool({ name: 'tb_help', arguments: { path } })).resolves.toMatchObject({
          structuredContent: { node: { path } },
        })
        const result = await client.callTool({
          name: 'tb_call', arguments: { path: `/${path}/write`, args: { path: 'entry', entry: { content: 'exact target', contentType: 'text/plain' } } },
        })
        expect(result.isError).not.toBe(true)
        await expect(client.callTool({
          name: 'tb_call', arguments: { path: `/${path}/get`, args: { path: 'entry' } },
        })).resolves.toMatchObject({ structuredContent: { content: 'exact target' } })
        await expect(client.callTool({
          name: 'tb_call', arguments: { path: '/mcp-path/a/b/list', args: {} },
        })).resolves.toMatchObject({ structuredContent: { items: [] } })
      } finally {
        await client.close()
      }
    },
  )

  it.each(['/~mcp', '/~device/mailbox/claim', 'https://example.com/steal', '/a/../system/sk/write'])(
    'rejects a non-command tb_call target %s', async (path) => {
      const upstream = vi.fn()
      vi.stubGlobal('fetch', upstream)
      const client = await connectTestMcpClient('https://tb.test/~mcp', TEST_ADMIN_SK,
        (input, init) => tb.request(input, init))
      try {
        await expect(client.callTool({ name: 'tb_call', arguments: { path, args: {} } })).resolves.toMatchObject({ isError: true })
        expect(upstream).not.toHaveBeenCalled()
      } finally {
        await client.close()
      }
    },
  )
})
