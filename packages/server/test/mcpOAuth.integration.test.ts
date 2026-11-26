import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { SKRegistryStore } from '@tool-bridge/core'
import { createTbServer, type TbServer } from '../src'
import { testServerConfig } from './helpers/server'

const issuer = 'https://bridge.example'
const resource = issuer + '/~mcp'
const clientId = 'https://chatgpt.com/oauth/client.json'
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect'

// Requests travel over a real Node socket behind a simulated TLS terminator.
// Only ChatGPT's public client metadata document is substituted.
describe('ChatGPT links its MCP session using a scoped gateway key', () => {
  let server: TbServer
  let local: string
  const transport = globalThis.fetch

  beforeAll(async () => {
    server = createTbServer(await testServerConfig({ canonicalOrigin: issuer }))
    local = 'http://127.0.0.1:' + (await server.start()).port
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if ((input instanceof Request ? input.url : String(input)) === clientId) {
        return Response.json({
          client_id: clientId,
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          client_name: 'ChatGPT',
          token_endpoint_auth_method: 'private_key_jwt',
          token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
        })
      }
      return transport(input, init)
    })
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await server?.close()
  })

  function wire(url: string, init?: RequestInit) {
    const target = new URL(url, issuer)
    expect(target.origin).toBe(issuer)
    return transport(local + target.pathname + target.search, { redirect: 'manual', ...init })
  }

  it('discovers OAuth, consents, exchanges once, calls tools and observes revocation', async () => {
    const registry = new SKRegistryStore(server.state)
    const { key, secret } = await registry.write({
      owner: 'user:chatgpt-test',
      scopes: [{ pattern: 'system/status', actions: ['read', 'call'] }],
    }, new Date().toISOString())
    const challenge = await wire(resource)
    expect(challenge.status).toBe(401)
    const metadataUrl = challenge.headers.get('www-authenticate')?.match(/resource_metadata="([^"]+)"/)?.[1]
    expect(metadataUrl).toBe(issuer + '/.well-known/oauth-protected-resource/~mcp')
    expect(await (await wire(metadataUrl!)).json()).toMatchObject({ resource, authorization_servers: [issuer] })
    const metadata = await (await wire('/.well-known/oauth-authorization-server')).json()
    expect(metadata).toMatchObject({
      issuer, client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true, code_challenge_methods_supported: ['S256'],
    })
    const verifier = randomBytes(48).toString('base64url')
    const query = new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
      state: 'opaque-client-state', resource,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    })
    const url = metadata.authorization_endpoint + '?' + query
    const wrongTarget = new URL(url)
    wrongTarget.searchParams.set('resource', issuer + '/other')
    expect((await wire(wrongTarget.href)).status).toBe(400)
    const wrongCallback = new URL(url)
    wrongCallback.searchParams.set('redirect_uri', 'https://another.example/callback')
    expect((await wire(wrongCallback.href)).headers.has('location')).toBe(false)
    const page = await wire(url)
    expect(page.status).toBe(200)
    expect(page.headers.get('referrer-policy')).toBe('same-origin')
    expect(await page.text()).toMatch(/type="password"/)
    const denied = await wire(url, {
      method: 'POST', headers: { origin: issuer }, body: new URLSearchParams({ sk: '', decision: 'deny' }),
    })
    expect(denied.status).toBe(303)
    const deniedCallback = new URL(denied.headers.get('location')!)
    expect(Object.fromEntries(deniedCallback.searchParams)).toEqual({ error: 'access_denied', state: query.get('state'), iss: issuer })
    const consent = (origin: string, sk: string) => wire(url, {
      method: 'POST', headers: { origin }, body: new URLSearchParams({ sk }),
    })
    expect((await consent('https://another.example', secret)).status).toBe(403)
    const granted = await consent(issuer, secret)
    expect([302, 303]).toContain(granted.status)
    const callback = new URL(granted.headers.get('location')!)
    expect(callback.origin + callback.pathname).toBe(redirectUri)
    expect(callback.searchParams.get('state')).toBe(query.get('state'))
    expect(callback.searchParams.get('iss')).toBe(issuer)
    const code = callback.searchParams.get('code')
    expect(code).toBeTruthy()
    const exchange = () => wire(metadata.token_endpoint, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri,
        resource, code_verifier: verifier, code: code!,
      }),
    })
    const attempts = await Promise.all([exchange(), exchange()])
    expect(attempts.map(r => r.status).sort()).toEqual([200, 400])
    const grant = await attempts.find(r => r.ok)!.json()
    expect(grant.access_token).toBeTruthy()
    expect(grant.access_token).not.toBe(secret)
    expect(grant.refresh_token).toBeUndefined()
    const authorization = 'Bearer ' + grant.access_token
    const rpc = (method: string, params: object) => wire(resource, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    expect((await (await rpc('initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'oauth-smoke', version: '1' },
    })).json()).result.serverInfo.name).toBe('tool-bridge')
    expect((await (await rpc('tools/list', {})).json()).result.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({
        name: 'tb_help', _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['mcp'] }] },
      })]),
    )
    const help = async (path: string) => (await (await rpc('tools/call', {
      name: 'tb_help', arguments: { path },
    })).json()).result
    expect((await help('system/status')).structuredContent.node.path).toBe('system/status')
    expect((await help('system/sk')).isError).toBe(true)
    expect((await wire('/system/status/~help', { headers: { authorization } })).status).toBe(401)
    await registry.delete(key.id)
    expect((await rpc('tools/list', {})).status).toBe(401)
  })
})
