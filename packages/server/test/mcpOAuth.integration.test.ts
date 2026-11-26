import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testS3Config, testServerConfig } from './helpers/server'
import { createManagedServer } from '../src'

const issuer = 'https://bridge.example'
const resource = issuer + '/~mcp'
const clientId = 'https://chatgpt.com/oauth/client.json'
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect'

// Requests travel over a real Node socket behind a simulated TLS terminator.
// Only ChatGPT's public client metadata document is substituted.
describe('ChatGPT links its MCP session using a scoped gateway key', () => {
  let server: Awaited<ReturnType<typeof createManagedServer>>
  let directory: string
  let adminSk: string
  let local: string
  const transport = globalThis.fetch

  function wire(url: string, init?: RequestInit) {
    const target = new URL(url, issuer)
    expect(target.origin).toBe(issuer)
    return transport(local + target.pathname + target.search, { redirect: 'manual', ...init })
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tb-oauth-'))
    const config = await testServerConfig({ dataDir: directory })
    server = await createManagedServer({ directory, host: '127.0.0.1', port: 0 })
    local = 'http://127.0.0.1:' + (await server.start()).port
    await server.store.write('install-defaults.json', { databaseUrl: config.databaseUrl, storage: testS3Config() })
    const pairingToken = (await readFile(join(directory, 'pairing-token'), 'utf8')).trim()
    const setup = await wire('/~setup/configure', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-tb-setup-token': pairingToken },
      body: JSON.stringify({ settings: { canonicalOrigin: issuer } }),
    })
    expect(setup.status).toBe(200)
    adminSk = (await setup.json()).adminSk
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
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('discovers OAuth, consents, exchanges once, calls tools and observes revocation', async () => {
    const manageKey = (command: string, body: object) => wire('/system/sk/' + command, {
      method: 'POST', headers: { 'authorization': 'Bearer ' + adminSk, 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(body),
    })
    const created = await manageKey('write', {
      owner: 'user:chatgpt-test',
      scopes: [{ pattern: 'system/status', actions: ['read', 'call'] }],
    })
    expect(created.status).toBe(200)
    const { key, secret } = await created.json()
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
      state: 'opaque-client-state', resource, ui_locales: 'zh-CN',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    })
    const url = metadata.authorization_endpoint + '?' + query
    const duplicate = await wire(url + '&client_id=' + encodeURIComponent(clientId))
    expect(duplicate.status).toBe(400)
    const wrongTarget = new URL(url)
    wrongTarget.searchParams.set('resource', issuer + '/other')
    expect((await wire(wrongTarget.href)).status).toBe(400)
    const wrongCallback = new URL(url)
    wrongCallback.searchParams.set('redirect_uri', 'https://another.example/callback')
    expect((await wire(wrongCallback.href)).headers.has('location')).toBe(false)
    const page = await wire(url)
    expect(page.status).toBe(200)
    expect(page.headers.get('referrer-policy')).toBe('same-origin')
    const html = await page.text()
    expect(html).toMatch(/type="password"/)
    expect(html).not.toContain('ui_locales')
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
    expect((await manageKey('delete', { id: key.id })).status).toBe(200)
    expect((await rpc('tools/list', {})).status).toBe(401)
  })
})
