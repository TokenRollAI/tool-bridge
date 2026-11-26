import type { TbAppDeps } from '@tool-bridge/app'
import { getOAuthProtectedResourceMetadataUrl, oauthMetadataResponse } from '@modelcontextprotocol/server'
import { identify, type StateStore } from '@tool-bridge/core'
import OAuth2Server from '@node-oauth/oauth2-server'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  MCP_OAUTH_REDIRECT_URI as CALLBACK,
  MCP_OAUTH_CLIENT_ID as CLIENT,
  createMcpOAuthModel,
  identifyMcpToken,
  MCP_OAUTH_SCOPE as SCOPE,
} from './mcpOAuthModel'
import { consentPage } from './mcpOAuthPage'

export const MCP_AUTHORIZE_PATH = '/~oauth/mcp/authorize'
const TOKEN = '/~oauth/mcp/token'
const FORM_TYPE = 'application/x-www-form-urlencoded'
const MAX_REQUEST = 8192
const ACCESS_SECONDS = 3600
const commonFields = ['client_id', 'redirect_uri', 'resource', 'scope']
const authorizeFields = [...commonFields, 'response_type', 'state', 'code_challenge', 'code_challenge_method']
const tokenFields = [...commonFields, 'grant_type', 'code', 'code_verifier']
const noStore = { 'cache-control': 'no-store', 'pragma': 'no-cache' }

class EndpointError extends Error {
  constructor(code: string, readonly status = 400) {
    super(code)
  }
}

async function boundedText(message: Request | Response, limit: number): Promise<string> {
  if (Number(message.headers.get('content-length')) > limit) {
    void message.body?.cancel().catch(() => {})
    throw new EndpointError('invalid_request', 413)
  }
  const reader = message.body?.getReader()
  if (!reader) return ''
  const bytes = new Uint8Array(limit)
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (size + value.length > limit) {
        void reader.cancel().catch(() => {})
        throw new EndpointError('invalid_request', 413)
      }
      bytes.set(value, size)
      size += value.length
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))
  } catch (err) {
    if (err instanceof EndpointError) throw err
    throw new EndpointError('invalid_request')
  } finally {
    reader.releaseLock()
  }
}

function parameters(encoded: string, allowed: string[], ignoreExtensions = false): URLSearchParams {
  if (Buffer.byteLength(encoded) > MAX_REQUEST) throw new EndpointError('invalid_request', 413)
  if (encoded.startsWith('?')) throw new EndpointError('invalid_request')
  // URLSearchParams alone silently repairs malformed percent escapes and invalid UTF-8.
  try {
    decodeURIComponent(encoded)
  } catch {
    throw new EndpointError('invalid_request')
  }
  const params = new URLSearchParams()
  for (const [name, value] of new URLSearchParams(encoded)) {
    if (!allowed.includes(name)) {
      // RFC 6749 §3.1: ignore unrecognized authorization request parameters.
      if (ignoreExtensions) continue
      throw new EndpointError('invalid_request')
    }
    if (params.has(name) || (!value && name !== 'sk')) throw new EndpointError('invalid_request')
    params.append(name, value)
  }
  return params
}

async function form(request: Request, allowed: string[]) {
  const type = request.headers.get('content-type') ?? ''
  if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=(?:utf-8|"utf-8"))?$/i.test(type)) {
    throw new EndpointError('invalid_request', 415)
  }
  return parameters(await boundedText(request, MAX_REQUEST), allowed)
}

const clientDocument = z.object({
  client_id: z.literal(CLIENT),
  redirect_uris: z.array(z.string()).refine(uris => uris.includes(CALLBACK)),
  response_types: z.array(z.string()).default(['code']).refine(types => types.includes('code')),
  grant_types: z.array(z.string()).default(['authorization_code']).refine(types => types.includes('authorization_code')),
  token_endpoint_auth_method: z.string().optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
}).refine(doc => (doc.token_endpoint_auth_methods_supported ?? [doc.token_endpoint_auth_method]).includes('none'))

async function checkClientDocument(fetchMetadata: typeof fetch) {
  let document: unknown
  try {
    const response = await fetchMetadata(CLIENT, {
      redirect: 'error',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok || response.redirected || (response.url && response.url !== CLIENT)) {
      void response.body?.cancel().catch(() => {})
      throw new Error()
    }
    document = JSON.parse(await boundedText(response, 16 * 1024))
  } catch {
    throw new EndpointError('temporarily_unavailable', 503)
  }
  if (!clientDocument.safeParse(document).success) throw new EndpointError('invalid_client')
}

function checkBinding(params: URLSearchParams, resource: string) {
  if (params.get('client_id') !== CLIENT) throw new EndpointError('invalid_client')
  if (params.get('redirect_uri') !== CALLBACK) throw new EndpointError('invalid_request')
  if (params.get('resource') !== resource) throw new EndpointError('invalid_target')
  if ((params.get('scope') ?? SCOPE) !== SCOPE) throw new EndpointError('invalid_scope')
}

function authorizationResponse(issuer: string, request: URLSearchParams, result: { code: string } | { error: string }) {
  const callback = new URL(CALLBACK)
  callback.search = new URLSearchParams({ ...result, iss: issuer }).toString()
  const state = request.get('state')
  if (state !== null) callback.searchParams.set('state', state)
  return new Response(null, { status: 303, headers: { ...noStore, 'referrer-policy': 'no-referrer', 'location': callback.href } })
}

function methodError(allow: string) {
  return Response.json({ error: 'invalid_request' }, { status: 405, headers: { ...noStore, allow } })
}

export function createMcpOAuth(
  state: StateStore,
  canonicalOrigin: string | undefined,
  fetchClientMetadata: typeof fetch,
): TbAppDeps['mcpOAuth'] {
  if (!canonicalOrigin) return undefined
  const origin = URL.parse(canonicalOrigin)
  if (origin?.protocol !== 'https:' || (canonicalOrigin !== origin.origin && canonicalOrigin !== origin.origin + '/')) return undefined
  const issuer = origin.origin
  const resourceServerUrl = new URL('/~mcp', issuer)
  const metadata = {
    resourceServerUrl,
    scopesSupported: [SCOPE],
    oauthMetadata: {
      issuer,
      authorization_endpoint: issuer + MCP_AUTHORIZE_PATH,
      token_endpoint: issuer + TOKEN,
      scopes_supported: [SCOPE],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
    },
  }
  const oauth = new OAuth2Server({
    model: createMcpOAuthModel(state, issuer),
    accessTokenLifetime: ACCESS_SECONDS,
    authorizationCodeLifetime: 300,
    requirePKCE: true,
    allowEmptyState: true,
    requireClientAuthentication: { authorization_code: false },
  })

  const routes = new Hono()
  routes.onError((err) => {
    if (err instanceof EndpointError) return Response.json({ error: err.message }, { status: err.status, headers: noStore })
    if (err instanceof OAuth2Server.OAuthError && err.code >= 400 && err.code < 500) {
      return Response.json({ error: err.name }, { status: err.code, headers: noStore })
    }
    return Response.json({ error: 'server_error' }, { status: 500, headers: noStore })
  })
  routes.all(MCP_AUTHORIZE_PATH, async (c) => {
    const request = c.req.raw
    if (!['GET', 'POST'].includes(request.method)) return methodError('GET, POST')
    if (request.method === 'POST' && request.headers.get('origin') !== issuer) {
      throw new EndpointError('access_denied', 403)
    }
    const search = new URL(request.url).search
    const params = parameters(search.slice(1), authorizeFields, true)
    checkBinding(params, resourceServerUrl.href)
    if (params.get('response_type') !== 'code') throw new EndpointError('unsupported_response_type')
    if (params.get('code_challenge_method') !== 'S256' || !/^[\w-]{43}$/.test(params.get('code_challenge') ?? '')) {
      throw new EndpointError('invalid_request')
    }
    if (params.has('state') && !/^[\x20-\x7e]+$/.test(params.get('state')!)) throw new EndpointError('invalid_request')
    const action = issuer + MCP_AUTHORIZE_PATH + '?' + params.toString()
    if (request.method === 'GET') return consentPage(action, CALLBACK)
    const body = await form(request, ['sk', 'decision'])
    if (body.get('decision') === 'deny') return authorizationResponse(issuer, params, { error: 'access_denied' })
    if (body.has('decision') || !body.has('sk')) throw new EndpointError('invalid_request')
    const ctx = await identify(state, body.get('sk')!, new Date().toISOString())
    if (!ctx) return consentPage(action, CALLBACK, true)
    await checkClientDocument(fetchClientMetadata)

    const query = { ...Object.fromEntries(params), scope: SCOPE }
    const code = await oauth.authorize(
      new OAuth2Server.Request({ method: 'POST', headers: {}, query }),
      new OAuth2Server.Response(),
      { authenticateHandler: { handle: () => ({ id: ctx.keyId }) } },
    )
    return authorizationResponse(issuer, params, { code: code.authorizationCode })
  })

  routes.all(TOKEN, async (c) => {
    const request = c.req.raw
    if (request.method !== 'POST') return methodError('POST')
    if (new URL(request.url).search || request.headers.has('authorization')) throw new EndpointError('invalid_request')
    const params = await form(request, tokenFields)
    if (params.get('grant_type') !== 'authorization_code') throw new EndpointError('unsupported_grant_type')
    checkBinding(params, resourceServerUrl.href)
    if (!params.has('code') || !/^[A-Za-z0-9._~-]{43,128}$/.test(params.get('code_verifier') ?? '')) {
      throw new EndpointError('invalid_request')
    }
    // type-is in oauth2-server needs framing even for a decoded, originally chunked form.
    const headers = { 'content-type': FORM_TYPE, 'content-length': String(Buffer.byteLength(params.toString())) }
    const token = await oauth.token(
      new OAuth2Server.Request({ headers, method: 'POST', query: {}, body: Object.fromEntries(params) }),
      new OAuth2Server.Response(),
    )
    return Response.json({ access_token: token.accessToken, token_type: 'Bearer', expires_in: ACCESS_SECONDS, scope: SCOPE }, { headers: noStore })
  })

  return {
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
    async handlePublic(request) {
      const path = new URL(request.url).pathname
      if (path === MCP_AUTHORIZE_PATH || path === TOKEN) return routes.fetch(request)
      return oauthMetadataResponse(request, metadata)
    },
    identify: (authorization, now) => identifyMcpToken(state, issuer, authorization, now),
  }
}
