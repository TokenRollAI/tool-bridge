import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryStateStore, SKRegistryStore } from '@tool-bridge/core'
import OAuth2Server from '@node-oauth/oauth2-server'
import { createHash } from 'node:crypto'
import { createMcpOAuthModel, identifyMcpToken } from '../src/mcpOAuthModel'

const ISSUER = 'https://bridge.example'
const OTHER_ISSUER = 'https://other.example'
const CLIENT_ID = 'https://chatgpt.com/oauth/client.json'
const REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect'
const PKCE_VERIFIER = 'a'.repeat(43)
const PKCE_CHALLENGE = createHash('sha256').update(PKCE_VERIFIER).digest('base64url')
const NOW = '2026-11-26T00:00:00.000Z'
const CODE_EXPIRY = '2026-11-26T00:05:00.000Z'
const TOKEN_EXPIRY = '2026-11-26T01:00:00.000Z'

async function setup() {
  const state = new MemoryStateStore()
  const registry = new SKRegistryStore(state)
  const { key, secret } = await registry.write({
    owner: 'user:alice',
    scopes: [{ pattern: 'docs/**', actions: ['call'] }],
  }, NOW)
  const model = createMcpOAuthModel(state, ISSUER)
  const server = new OAuth2Server({
    model,
    requireClientAuthentication: { authorization_code: false },
    requirePKCE: true,
    authenticateHandler: { handle: async () => ({ id: key.id }) },
  })
  return { state, registry, key, secret, model, server }
}

function authorize(server: OAuth2Server) {
  return server.authorize(new OAuth2Server.Request({
    headers: {},
    method: 'GET',
    query: {
      client_id: CLIENT_ID,
      code_challenge: PKCE_CHALLENGE,
      code_challenge_method: 'S256',
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      state: 'request-state',
    },
  }), new OAuth2Server.Response())
}

function exchange(server: OAuth2Server, code: string, verifier = PKCE_VERIFIER) {
  const response = new OAuth2Server.Response()
  const token = server.token(new OAuth2Server.Request({
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '1' },
    method: 'POST',
    query: {},
    body: {
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    },
  }), response)
  return { token, response }
}

describe('MCP inbound OAuth model', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
  })

  afterEach(() => vi.useRealTimers())

  it('allows only the fixed public client, redirect URI and scope', async () => {
    const { model, key } = await setup()
    const client = await model.getClient(CLIENT_ID)
    if (!client) throw new Error('missing MCP client')
    expect(client).toMatchObject({ id: CLIENT_ID, grants: ['authorization_code'], redirectUris: [REDIRECT_URI] })
    expect(await model.getClient('wrong-client')).toBeNull()
    expect(await model.getClient(CLIENT_ID, 'client-secret')).toBeNull()
    expect(await model.validateRedirectUri?.(REDIRECT_URI, client)).toBe(true)
    expect(await model.validateRedirectUri?.(`${REDIRECT_URI}?other`, client)).toBe(false)
    expect(await model.validateScope?.({ id: key.id }, client, ['mcp', 'admin'])).toBe(false)
  })

  it('uses the library S256 exchange and persists only hashes and scoped grant metadata', async () => {
    const { key, model, secret, server, state } = await setup()
    const code = await authorize(server)
    expect(code.user).toEqual({ id: key.id })
    expect(code.authorizationCode).toMatch(/^[a-f0-9]{64}$/)
    expect(await model.getAuthorizationCode(code.authorizationCode)).toMatchObject({
      codeChallenge: PKCE_CHALLENGE,
      codeChallengeMethod: 'S256',
    })
    const codes = (await state.list('mcp-inbound:code:')).items
    expect(codes).toHaveLength(1)
    expect(codes[0]?.value).toMatchObject({ issuer: ISSUER, resource: `${ISSUER}/~mcp`, expiresAt: CODE_EXPIRY })
    expect(JSON.stringify(codes)).not.toContain(code.authorizationCode)
    expect(JSON.stringify(codes)).not.toContain(secret)
    expect(await identifyMcpToken(state, ISSUER, `Bearer ${code.authorizationCode}`, NOW)).toBeNull()

    const { token, response } = exchange(server, code.authorizationCode)
    const issued = await token
    expect(response.body).toEqual({ access_token: issued.accessToken, expires_in: 3600, scope: 'mcp', token_type: 'Bearer' })
    expect(issued.accessToken).toMatch(/^[a-f0-9]{64}$/)
    expect(issued.refreshToken).toBeUndefined()
    expect(await model.getAuthorizationCode(issued.accessToken)).toBeNull()

    const tokens = (await state.list('mcp-inbound:')).items
    expect(tokens).toEqual([{
      key: expect.stringMatching(/^mcp-inbound:token:[a-f0-9]{64}$/),
      value: { clientId: CLIENT_ID, expiresAt: TOKEN_EXPIRY, issuer: ISSUER, keyId: key.id, resource: `${ISSUER}/~mcp`, revision: 0, scope: 'mcp' },
    }])
    expect(JSON.stringify(tokens)).not.toContain(issued.accessToken)
    expect(JSON.stringify(tokens)).not.toContain(secret)
    expect(await model.getAccessToken(issued.accessToken)).toMatchObject({ user: { id: key.id } })
    expect(await identifyMcpToken(state, ISSUER, issued.accessToken, NOW)).toBeNull()
    expect(await identifyMcpToken(state, ISSUER, `Basic ${issued.accessToken}`, NOW)).toBeNull()
    expect(await identifyMcpToken(state, ISSUER, `Bearer ${issued.accessToken}`, NOW)).toMatchObject({
      keyId: key.id, owner: key.owner, scopes: key.scopes, traceId: expect.any(String),
    })
  })

  it('allows one concurrent redemption and consumes a code on failed PKCE verification', async () => {
    const { server, state } = await setup()
    const code = await authorize(server)
    const results = await Promise.allSettled([
      exchange(server, code.authorizationCode).token,
      exchange(server, code.authorizationCode).token,
    ])
    expect(results).toEqual(expect.arrayContaining([
      { status: 'fulfilled', value: expect.objectContaining({ accessToken: expect.any(String) }) },
      { status: 'rejected', reason: expect.objectContaining({ name: 'invalid_grant' }) },
    ]))
    expect((await state.list('mcp-inbound:token:')).items).toHaveLength(1)

    const another = await authorize(server)
    await expect(exchange(server, another.authorizationCode, 'b'.repeat(43)).token).rejects.toMatchObject({ name: 'invalid_grant' })
    await expect(exchange(server, another.authorizationCode).token).rejects.toMatchObject({ name: 'invalid_grant' })
  })

  it('isolates issuers and enforces code and token expiry at the boundary', async () => {
    const { model, server, state } = await setup()
    const code = await authorize(server)
    const other = createMcpOAuthModel(state, OTHER_ISSUER)
    expect(await other.getAuthorizationCode(code.authorizationCode)).toBeNull()
    expect(await other.revokeAuthorizationCode(code)).toBe(false)

    const token = await exchange(server, code.authorizationCode).token
    const bearer = `Bearer ${token.accessToken}`
    expect(await identifyMcpToken(state, OTHER_ISSUER, bearer, NOW)).toBeNull()
    expect(await identifyMcpToken(state, ISSUER, bearer, TOKEN_EXPIRY)).toBeNull()

    const expiringCode = await authorize(server)
    vi.setSystemTime(new Date(CODE_EXPIRY))
    expect(await model.getAuthorizationCode(expiringCode.authorizationCode)).toBeNull()
    await expect(exchange(server, expiringCode.authorizationCode).token).rejects.toMatchObject({ name: 'invalid_grant' })
  })

  it('rechecks the backing SK for code exchange and every token lookup', async () => {
    const { key, model, registry, server, state } = await setup()
    const code = await authorize(server)
    const token = await exchange(server, code.authorizationCode).token
    const pendingCode = await authorize(server)
    const bearer = `Bearer ${token.accessToken}`

    const updated = await registry.update(key.id, { scopes: [], registerPaths: ['docs'] })
    expect(await identifyMcpToken(state, ISSUER, bearer, NOW)).toMatchObject({
      scopes: updated.scopes, registerPaths: updated.registerPaths,
    })
    await registry.update(key.id, { expiresAt: CODE_EXPIRY })
    expect(await identifyMcpToken(state, ISSUER, bearer, CODE_EXPIRY)).toBeNull()
    await registry.update(key.id, { disabled: true })
    expect(await identifyMcpToken(state, ISSUER, bearer, NOW)).toBeNull()
    expect(await model.getAccessToken(token.accessToken)).toBeNull()
    await expect(exchange(server, pendingCode.authorizationCode).token).rejects.toMatchObject({ name: 'invalid_grant' })
    await registry.delete(key.id)
    expect(await identifyMcpToken(state, ISSUER, bearer, NOW)).toBeNull()
  })
})
