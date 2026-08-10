import { describe, expect, it } from 'vitest'
import { SELF } from 'cloudflare:test'
import pkg from '../package.json' with { type: 'json' }
import { connectTestMcpClient } from './mcpClient'
import { TEST_ADMIN_SK } from './fixtures'

describe('MCP consumer endpoint', () => {
  it('official SDK client completes initialize against the local gateway', async () => {
    const client = await connectTestMcpClient(
      'https://tb.test/mcp',
      TEST_ADMIN_SK,
      (input, init) => {
        // The SDK opens an optional long-lived SSE GET after initialized. workerd's test
        // harness rejects pending streaming subrequests, so keep the initialize POSTs real
        // and decline only that optional stream.
        if (init?.method === 'GET') return Promise.resolve(new Response(null, { status: 405 }))
        return SELF.fetch(input, init)
      },
    )

    try {
      expect(client.getServerVersion()).toEqual({ name: 'tool-bridge', version: pkg.version })
      expect(client.getServerCapabilities()).toEqual({})
    } finally {
      await client.close()
    }
  })
})
