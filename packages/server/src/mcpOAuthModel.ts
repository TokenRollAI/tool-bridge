import type OAuth2Server from '@node-oauth/oauth2-server'
import {
  type CallContext,
  isKeyActive,
  KEY_SK_HASH,
  KEY_SK_ID,
  type SecretKey,
  sha256Hex,
  type StateStore,
  TBError,
} from '@tool-bridge/core'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

export const MCP_OAUTH_CLIENT_ID = 'https://chatgpt.com/oauth/client.json'
export const MCP_OAUTH_REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect'
export const MCP_OAUTH_SCOPE = 'mcp'
const ACCESS_TOKEN_LIFETIME = 3600
const RECORD_PREFIX = 'mcp-inbound:'

const grantRecord = z.object({
  clientId: z.literal(MCP_OAUTH_CLIENT_ID),
  expiresAt: z.iso.datetime(),
  issuer: z.string(),
  keyId: z.string().min(1),
  resource: z.string(),
  revision: z.literal(0),
  scope: z.literal(MCP_OAUTH_SCOPE),
})

const codeRecord = grantRecord.extend({
  codeChallenge: z.string().min(1),
  codeChallengeMethod: z.literal('S256'),
  redirectUri: z.literal(MCP_OAUTH_REDIRECT_URI),
})

function mcpClient(): OAuth2Server.Client {
  return {
    id: MCP_OAUTH_CLIENT_ID,
    redirectUris: [MCP_OAUTH_REDIRECT_URI],
    grants: ['authorization_code'],
    accessTokenLifetime: ACCESS_TOKEN_LIFETIME,
  }
}

function isMcpScope(scope: string[] | undefined): boolean {
  return scope?.length === 1 && scope[0] === MCP_OAUTH_SCOPE
}

function mcpResource(issuer: string): string {
  return `${issuer}/~mcp`
}

async function recordKey(kind: 'code' | 'token', issuer: string, value: string): Promise<string> {
  const hash = await sha256Hex(JSON.stringify([issuer, value]))
  return `${RECORD_PREFIX}${kind}:${hash}`
}

function newGrant(issuer: string, keyId: string, expiresAt: Date): z.infer<typeof grantRecord> {
  return {
    clientId: MCP_OAUTH_CLIENT_ID,
    expiresAt: expiresAt.toISOString(),
    issuer,
    keyId,
    resource: mcpResource(issuer),
    revision: 0,
    scope: MCP_OAUTH_SCOPE,
  }
}

function isCurrentGrant(record: z.infer<typeof grantRecord>, issuer: string, now: string): boolean {
  return record.issuer === issuer
    && record.resource === mcpResource(issuer)
    && Date.parse(record.expiresAt) > Date.parse(now)
}

async function activeKey(state: StateStore, keyId: string, now: string): Promise<SecretKey | null> {
  const hash = await state.get(KEY_SK_ID + keyId)
  if (typeof hash !== 'string') return null
  const key = await state.get(KEY_SK_HASH + hash) as SecretKey | null
  return key?.id === keyId && key.hash === hash && isKeyActive(key, now) ? key : null
}

async function readAccessToken(state: StateStore, issuer: string, token: string, now: string) {
  const parsed = grantRecord.safeParse(await state.get(await recordKey('token', issuer, token)))
  if (!parsed.success || !isCurrentGrant(parsed.data, issuer, now)) return null
  const key = await activeKey(state, parsed.data.keyId, now)
  return key && { record: parsed.data, key }
}

export function createMcpOAuthModel(state: StateStore, issuer: string): OAuth2Server.AuthorizationCodeModel {
  if (!state.compareAndSwap) {
    throw new TBError('unavailable', 'MCP OAuth requires StateStore.compareAndSwap')
  }
  const cas = state.compareAndSwap.bind(state)

  return {
    async getClient(clientId, clientSecret) {
      return clientId === MCP_OAUTH_CLIENT_ID && !clientSecret ? mcpClient() : null
    },

    async validateRedirectUri(redirectUri, client) {
      return client.id === MCP_OAUTH_CLIENT_ID && redirectUri === MCP_OAUTH_REDIRECT_URI
    },

    async validateScope(_user, client, scope) {
      return client.id === MCP_OAUTH_CLIENT_ID && (scope === undefined || isMcpScope(scope)) ? [MCP_OAUTH_SCOPE] : false
    },

    async saveAuthorizationCode(code, client, user) {
      const now = new Date()
      const keyId: unknown = user.id
      if (client.id !== MCP_OAUTH_CLIENT_ID || code.redirectUri !== MCP_OAUTH_REDIRECT_URI || !isMcpScope(code.scope)
        || !code.codeChallenge || code.codeChallengeMethod !== 'S256' || !(code.expiresAt > now)
        || typeof keyId !== 'string' || !await activeKey(state, keyId, now.toISOString())) return null

      const record = {
        ...newGrant(issuer, keyId, code.expiresAt),
        codeChallenge: code.codeChallenge,
        codeChallengeMethod: code.codeChallengeMethod,
        redirectUri: MCP_OAUTH_REDIRECT_URI,
      }
      const key = await recordKey('code', issuer, code.authorizationCode)
      if (!await cas(key, null, record)) return null
      return { ...code, client: mcpClient(), user: { id: keyId } }
    },

    async getAuthorizationCode(authorizationCode) {
      const key = await recordKey('code', issuer, authorizationCode)
      const parsed = codeRecord.safeParse(await state.get(key))
      const now = new Date().toISOString()
      if (!parsed.success || !isCurrentGrant(parsed.data, issuer, now)
        || !await activeKey(state, parsed.data.keyId, now)) return null

      const record = parsed.data
      return {
        authorizationCode,
        client: mcpClient(),
        codeChallenge: record.codeChallenge,
        codeChallengeMethod: record.codeChallengeMethod,
        expiresAt: new Date(record.expiresAt),
        redirectUri: record.redirectUri,
        scope: [record.scope],
        user: { id: record.keyId },
      }
    },

    async revokeAuthorizationCode(code) {
      if (!(code.expiresAt.getTime() > Date.now())) return false
      const key = await recordKey('code', issuer, code.authorizationCode)
      return cas(key, 0, null)
    },

    async saveToken(token, client, user) {
      const now = new Date()
      const keyId: unknown = user.id
      const { accessToken, accessTokenExpiresAt } = token
      if (client.id !== MCP_OAUTH_CLIENT_ID || !isMcpScope(token.scope) || !accessToken || !accessTokenExpiresAt
        || !(accessTokenExpiresAt > now) || typeof keyId !== 'string'
        || !await activeKey(state, keyId, now.toISOString())) return null

      const record = newGrant(issuer, keyId, accessTokenExpiresAt)
      const key = await recordKey('token', issuer, accessToken)
      if (!await cas(key, null, record)) return null

      // Project only the access token. The library also generates refresh data for this grant.
      return { accessToken, accessTokenExpiresAt, client: mcpClient(), scope: [MCP_OAUTH_SCOPE], user: { id: keyId } }
    },

    async getAccessToken(accessToken) {
      const hit = await readAccessToken(state, issuer, accessToken, new Date().toISOString())
      if (!hit) return null
      return {
        accessToken,
        accessTokenExpiresAt: new Date(hit.record.expiresAt),
        client: mcpClient(),
        scope: [hit.record.scope],
        user: { id: hit.key.id },
      }
    },

    async verifyScope(token, scope) {
      return isMcpScope(token.scope) && isMcpScope(scope)
    },
  }
}

export async function identifyMcpToken(
  state: StateStore,
  issuer: string,
  bearer: string | undefined,
  now: string,
): Promise<CallContext | null> {
  const token = bearer?.trim().match(/^Bearer +([^\s]+)$/i)?.[1]
  if (!token) return null
  const hit = await readAccessToken(state, issuer, token, now)
  if (!hit) return null
  const { key } = hit
  return {
    keyId: key.id,
    owner: key.owner,
    scopes: key.scopes,
    ...(key.registerPaths !== undefined && { registerPaths: key.registerPaths }),
    traceId: randomUUID(),
  }
}
