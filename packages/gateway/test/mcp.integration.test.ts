import { mcpToolIdentity, mcpToolName } from '@tool-bridge/app'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SELF } from 'cloudflare:test'
import { connectModernMcpClient, connectTestMcpClient } from './mcpClient'
import pkg from '../package.json' with { type: 'json' }
import { TEST_ADMIN_SK } from './fixtures'

const admin = (extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, ...(extra.headers ?? {}) },
})

let mountedPaths: string[] = []

async function postJson(path: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://tb.test/${path}`, {
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
  const response = await postJson(
    'system/sk',
    { tool: 'write', arguments: input },
    admin(),
  )
  expect(response.status).toBe(200)
  return ((await response.json()) as { secret: string }).secret
}

async function mountHttpTools(path: string, tools: unknown[]): Promise<void> {
  const response = await postJson(
    'system/registry',
    {
      tool: 'write',
      arguments: {
        path,
        kind: 'http',
        description: `${path} tools`,
        config: {
          kind: 'http',
          endpoint: 'https://mcp-exit-upstream.test',
          tools,
        },
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
  const response = await postJson(
    'system/registry',
    {
      tool: 'write',
      arguments: {
        path,
        kind: 'mcp',
        description: `${path} MCP`,
        config: { kind: 'mcp', url: 'https://round15-mcp-upstream.test/mcp' },
      },
    },
    admin(),
  )
  expect(response.status).toBe(200)
  mountedPaths.push(path)
}

async function mountContext(path: string): Promise<void> {
  const response = await postJson(
    'system/registry',
    {
      tool: 'write',
      arguments: {
        path,
        kind: 'context',
        description: `${path} context`,
        config: { kind: 'context', provider: 'r2' },
      },
    },
    admin(),
  )
  expect(response.status).toBe(200)
  mountedPaths.push(path)
}

async function mountRemote(path: string): Promise<void> {
  const response = await postJson(
    'system/registry',
    {
      tool: 'write',
      arguments: {
        path,
        kind: 'remote',
        description: `${path} remote`,
        config: { kind: 'remote', baseUrl: 'https://api.example.com/htbp' },
      },
    },
    admin(),
  )
  expect(response.status).toBe(200)
  mountedPaths.push(path)
}

afterEach(async () => {
  for (const path of mountedPaths.reverse()) {
    await postJson(
      'system/registry',
      { tool: 'delete', arguments: { path } },
      admin(),
    )
  }
  mountedPaths = []
  vi.unstubAllGlobals()
})

describe('MCP consumer endpoint', () => {
  it('rejects unauthenticated MCP requests before protocol dispatch', async () => {
    const response = await SELF.fetch('https://tb.test/~mcp', {
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
      (input, init) => SELF.fetch(input, init),
    )

    try {
      expect(client.getServerVersion()).toEqual({ name: 'tool-bridge', version: pkg.version })
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
      (input, init) => SELF.fetch(input, init),
    )

    try {
      const listed = await client.listTools()
      expect(listed.tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
        'tb_search',
        'tb_help',
        'tb_list_nodes',
      ]))

      await expect(client.callTool({
        name: 'tb_search',
        arguments: { query: 'controlcatalogunique', limit: 20 },
      })).resolves.toMatchObject({
        structuredContent: {
          items: [{
            path: 'mcp-controls-visible',
            tool: { name: 'discover_calendar' },
          }],
        },
      })

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
      await expect(client.callTool({
        name: 'tb_search',
        arguments: { query: 'controlcatalogunique', unexpected: true },
      })).rejects.toThrow(/unexpected|additional/i)
    } finally {
      await client.close()
    }
  })

  it('serves the 2026-07-28 era without a handshake and caches tools/list privately', async () => {
    await mountHttp('mcp-modern/basic')
    const client = await connectModernMcpClient(
      'https://tb.test/~mcp',
      TEST_ADMIN_SK,
      (input, init) => SELF.fetch(input, init),
    )

    try {
      const listed = await client.listTools()
      expect(listed.tools.length).toBeGreaterThan(0)
      // SEP-2549:modern 结果必带缓存字段。scope 必须是 private——工具清单按调用方
      // scope 裁剪过,public 等于允许共享中间层跨身份复用目录。
      const cacheable = listed as unknown as { cacheScope?: string, ttlMs?: number }
      expect(cacheable.cacheScope).toBe('private')
      expect(cacheable.ttlMs).toBe(300_000)
    } finally {
      await client.close()
    }
  })

  it('keeps cache fields off the 2025-era wire', async () => {
    await mountHttp('mcp-modern/legacy-clean')
    const client = await connectTestMcpClient(
      'https://tb.test/~mcp',
      TEST_ADMIN_SK,
      (input, init) => SELF.fetch(input, init),
    )

    try {
      const listed = await client.listTools() as Record<string, unknown>
      expect(listed).not.toHaveProperty('ttlMs')
      expect(listed).not.toHaveProperty('cacheScope')
    } finally {
      await client.close()
    }
  })

  it('tools/list clips by command scope and tools/call reuses the HTBP provider path', async () => {
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
      (input, init) => SELF.fetch(input, init),
    )
    try {
      const listed = await client.listTools()
      const allowed = listed.tools.find(
        tool => tool._meta?.['io.tool-bridge/path'] === 'mcp-round15/allowed',
      )
      expect(allowed).toMatchObject({
        description: expect.stringContaining('greet through mcp-round15/allowed'),
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
        _meta: { 'io.tool-bridge/command': 'greet' },
      })
      expect(
        listed.tools.some(
          tool => tool._meta?.['io.tool-bridge/path'] === 'mcp-round15/read-only',
        ),
      ).toBe(false)
      const contextCommands = listed.tools
        .filter(tool => tool._meta?.['io.tool-bridge/path'] === 'mcp-round15/context')
        .map(tool => tool._meta?.['io.tool-bridge/command'])
      expect(contextCommands).toContain('List')
      expect(contextCommands).not.toContain('Write')

      await expect(client.callTool({
        name: allowed?.name ?? '',
        arguments: {},
      })).rejects.toThrow(/name|required/i)
      await expect(client.callTool({
        name: allowed?.name ?? '',
        arguments: { name: 42 },
      })).rejects.toThrow(/name|string/i)
      expect(upstream).not.toHaveBeenCalled()

      const called = await client.callTool({
        name: allowed?.name ?? '',
        arguments: { name: 'Ada' },
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

  it('reconnects with a narrow SK to shrink the exact tool set and reject stale names', async () => {
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
      (input, init) => SELF.fetch(input, init),
    )
    let adminOnlyName = ''
    let allowedName = ''
    try {
      const listed = await adminClient.listTools()
      const phasePaths = listed.tools
        .filter(tool => String(tool._meta?.['io.tool-bridge/path']).startsWith('mcp-round16/'))
        .map(tool => String(tool._meta?.['io.tool-bridge/path']))
        .sort()
      expect(phasePaths).toEqual(['mcp-round16/admin-only', 'mcp-round16/allowed'])
      adminOnlyName = listed.tools.find(
        tool => tool._meta?.['io.tool-bridge/path'] === 'mcp-round16/admin-only',
      )?.name ?? ''
      allowedName = listed.tools.find(
        tool => tool._meta?.['io.tool-bridge/path'] === 'mcp-round16/allowed',
      )?.name ?? ''
      expect(adminOnlyName).not.toBe('')
      expect(allowedName).not.toBe('')
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
      (input, init) => SELF.fetch(input, init),
    )
    try {
      const listed = await narrowClient.listTools()
      const phaseTools = listed.tools.filter(
        tool => String(tool._meta?.['io.tool-bridge/path']).startsWith('mcp-round16/'),
      )
      expect(phaseTools.map(tool => tool._meta?.['io.tool-bridge/path'])).toEqual([
        'mcp-round16/allowed',
      ])
      expect(phaseTools[0]?.name).toBe(allowedName)

      await expect(narrowClient.callTool({
        name: adminOnlyName,
        arguments: { name: 'forbidden' },
      })).rejects.toThrow(/tool not found/i)
      expect(upstream).not.toHaveBeenCalled()

      await expect(narrowClient.callTool({
        name: allowedName,
        arguments: { name: 'permitted' },
      })).resolves.toMatchObject({ structuredContent: { ok: true } })
      expect(upstream).toHaveBeenCalledTimes(1)
    } finally {
      await narrowClient.close()
    }
  })

  it('invalid provider schemas fail closed before they reach an MCP client', async () => {
    await mountHttpTools('mcp-round15/invalid-schema', [
      {
        name: 'broken',
        method: 'POST',
        pathTemplate: '/broken',
        inputSchema: { type: 'object', properties: { value: 'not-a-schema' } },
      },
    ])
    const client = await connectTestMcpClient(
      'https://tb.test/~mcp',
      TEST_ADMIN_SK,
      (input, init) => SELF.fetch(input, init),
    )
    try {
      await expect(client.listTools()).rejects.toThrow(/invalid tool metadata|invalid input schema/i)
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
      (input, init) => SELF.fetch(input, init),
    )
    try {
      const listed = await client.listTools()
      const tool = listed.tools.find(
        item => item._meta?.['io.tool-bridge/path'] === 'mcp-round15/native-result',
      )
      const called = await client.callTool({ name: tool?.name ?? '', arguments: {} })
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

  it('remote descendants are localized, schema-complete, and callable through the mount', async () => {
    await mountRemote('mcp-round15/peer')
    const remoteFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          headers: { 'content-type': 'application/json' },
        })

      if (init?.method === 'POST' && url.pathname === '/htbp/alpha') {
        const body = JSON.parse(String(init.body)) as {
          arguments?: Record<string, unknown>
          tool?: string
        }
        expect(body).toEqual({ tool: 'echo', arguments: { text: 'remote' } })
        return json({ echoed: body.arguments?.text })
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
      (input, init) => SELF.fetch(input, init),
    )
    try {
      const listed = await client.listTools()
      const remote = listed.tools.find(
        tool => tool._meta?.['io.tool-bridge/path'] === 'mcp-round15/peer/alpha',
      )
      expect(remote).toMatchObject({
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        _meta: { 'io.tool-bridge/command': 'echo' },
      })
      const called = await client.callTool({
        name: remote?.name ?? '',
        arguments: { text: 'remote' },
      })
      expect(called).toMatchObject({ structuredContent: { echoed: 'remote' } })
      expect(
        remoteFetch.mock.calls.some(([input, init]) =>
          init?.method === 'POST' && new URL(String(input)).pathname === '/htbp/alpha'),
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
      (input, init) => SELF.fetch(input, init),
    )
    try {
      const listed = await noCallClient.listTools()
      expect(
        listed.tools.some(
          tool => tool._meta?.['io.tool-bridge/path'] === 'mcp-round15/peer/alpha',
        ),
      ).toBe(false)
      expect(remoteFetch).toHaveBeenCalledTimes(before)
    } finally {
      await noCallClient.close()
    }
  })

  it('local longest-prefix nodes override remote descendants in the projected tree', async () => {
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
      (input, init) => SELF.fetch(input, init),
    )
    try {
      const listed = await client.listTools()
      const overridden = listed.tools.filter(
        tool => tool._meta?.['io.tool-bridge/path'] === 'mcp-round15/override/alpha',
      )
      expect(overridden).toHaveLength(1)
      expect(overridden[0]?._meta?.['io.tool-bridge/command']).toBe('greet')
      expect(remoteFetch).toHaveBeenCalledTimes(2)
    } finally {
      await client.close()
    }
  })

  it('fails closed within a fixed remote discovery request budget', async () => {
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
      (input, init) => SELF.fetch(input, init),
    )
    try {
      await expect(client.listTools()).rejects.toThrow()
      expect(remoteFetch.mock.calls.length).toBeLessThanOrEqual(32)
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
        (input, init) => SELF.fetch(input, init),
      )
      try {
        await expect(client.listTools()).rejects.toThrow()
        expect(remoteFetch).toHaveBeenCalledTimes(1)
      } finally {
        await client.close()
      }
    },
  )

  it('flat names are collision-safe, client-compatible, and length bounded', async () => {
    const slash = await mcpToolName(mcpToolIdentity('/a', 'b\0c', true))
    const shiftedNul = await mcpToolName(mcpToolIdentity('/a\0b', 'c', true))
    const escapedLiteral = await mcpToolName(mcpToolIdentity('/a_2Fb', 'c', true))
    const long = await mcpToolName(mcpToolIdentity(`/${'很长'.repeat(100)}`, '工具', true))
    expect(slash).not.toBe(shiftedNul)
    expect(slash).not.toBe(escapedLiteral)
    expect(long).toMatch(/^[A-Za-z0-9._-]{1,128}$/)
    expect(long).toHaveLength(128)
  })
})
