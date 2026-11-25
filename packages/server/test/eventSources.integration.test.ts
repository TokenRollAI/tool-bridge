import { BUILTIN_CATALOG, builtinPluginBindings } from '@tool-bridge/plugins'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createToolBridgeClient, type ToolBridgeClient } from '../../sdk/src/client'
import { connectModernMcpClient } from '../../app/test/mcpClient'
import { createTbServer, type TbServer } from '../src/server'
import { testServerConfig } from './helpers/server'

describe('signed plugin event → PostgreSQL → MCP subscription', () => {
  const path = 'project/github'
  const uri = 'tb-event://topics/project/github'
  const signingKey = randomUUID()
  const sk = 'tbk_event_source_test_admin_only'
  let directory: string
  let server: TbServer
  let endpoint: string
  let api: ToolBridgeClient
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tb-signed-event-'))
    server = createTbServer({
      ...await testServerConfig({ adminSk: sk, dataDir: directory }),
      pluginBindings: builtinPluginBindings({}), pluginCatalog: BUILTIN_CATALOG,
    })
    const { port } = await server.start()
    endpoint = `http://127.0.0.1:${port}`
    api = createToolBridgeClient({ baseUrl: endpoint, sk })
    await api.invokeJson('system/secret/set', { name: 'hook-test', value: signingKey })
    await api.registerNode({ path, kind: 'topic', description: 'Push events', config: {
      kind: 'topic', provider: 'github_events', export: 'pushes', authRef: 'hook-test',
    } })
  })
  afterAll(async () => {
    await server?.close()
    if (directory) await rm(directory, { recursive: true, force: true })
  })
  it('accepts a signed push once and lets a modern MCP client replay after an update', async () => {
    const client = await connectModernMcpClient(endpoint + '/~mcp', sk, fetch)
    try {
      const { contents } = await client.readResource({ uri })
      const summary = contents[0]
      if (!summary || !('text' in summary)) throw new Error('expected a topic resource')
      const { cursor } = JSON.parse(summary.text)
      const notified = vi.fn()
      client.setNotificationHandler('notifications/resources/updated', (note) => {
        notified(note.params.uri)
      })
      const sub = await client.listen({ resourceSubscriptions: [uri] })
      try {
        expect(sub.honoredFilter.resourceSubscriptions).toEqual([uri])
        const body = JSON.stringify({ repository: { full_name: 'example/build' }, ref: 'refs/heads/main', after: '123' })
        const signature = 'sha256=' + createHmac('sha256', signingKey).update(body).digest('hex')
        const send = () => fetch(endpoint + '/~hooks/' + path, {
          method: 'POST', headers: { 'x-hub-signature-256': signature, 'content-type': 'application/json' }, body,
        })
        expect((await send()).status).toBe(204)
        expect((await send()).status).toBe(204)
        await vi.waitFor(() => expect(notified).toHaveBeenCalledWith(uri), { timeout: 4500 })
        const events = await api.events.read(path, { after: cursor })
        expect(events.events).toHaveLength(1)
        expect(events.events[0]).toMatchObject({ type: 'github.push', data: { repository: 'example/build' } })
      } finally { await sub.close() }
    } finally { await client.close() }
  }, 15_000)
  it('closes an open MCP subscription while the gateway drains', async () => {
    const client = await connectModernMcpClient(endpoint + '/~mcp', sk, fetch)
    const sub = await client.listen({ resourceSubscriptions: [uri] })
    try {
      await server.close()
    } finally {
      await sub.close()
      await client.close()
    }
  }, 6000)
})
