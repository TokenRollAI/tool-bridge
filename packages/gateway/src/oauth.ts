/**
 * mcp 上游的网关托管 OAuth(authorization code + PKCE,MCP SDK `auth()` 编排)。
 *
 * 无头网关跑不了浏览器交互,流程拆两段、状态全在网关侧闭环(token 不出网关):
 * - **发起**(`POST /<path>/~authorize`,tbApp 挂接):SDK 做 discovery + 动态客户端注册
 *   (DCR)+ PKCE,`redirectToAuthorization` 捕获授权 URL 返回给调用方(CLI/Dashboard
 *   负责打开浏览器)。已有 refresh_token 且刷新成功 → 直接回 authorized,免交互。
 * - **回调**(`GET /~oauth/callback`,树外免认证):state 即凭证——`{nodePath,
 *   codeVerifier, exp}` 经 AES-256-GCM 加密后编进 state 参数本身(self-contained,
 *   零存储,天然绕开 KV 最终一致窗口;密钥派生自 TB_SECRET_ENCRYPTION_KEY)。
 *   解密还原 codeVerifier → 兑换 code → token 落 StateStore。
 * - **消费**(providers/mcp.ts):transport 挂同一 Provider(mode:'deny'),SDK 自动
 *   带 token / 过期自刷新;需要重新交互授权时抛 TBError 指引 `tb tool auth <path>`。
 *
 * KV 布局(节点注册面 delete 时经 invalidateMcpOAuth 清理):
 * - `mcpoauth:client:<path>` — DCR 客户端信息(client_id 等;刷新 token 也要用)
 * - `mcpoauth:token:<path>`  — OAuthTokens(access + refresh)
 * - `mcpoauth:as:<path>`     — discovery 缓存(授权服务器 metadata,省一趟发现)
 *
 * 已知限制:refresh token rotation 上游 + 多 isolate 并发刷新可能互相作废(KV 无 CAS);
 * 失败落回「重新授权」指引,可自救。多域名网关:redirect_uri 钉在发起授权时的 origin。
 */

import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { base64urlDecode, base64urlEncode, type StateStore, TBError } from '@tool-bridge/core'

/** 回调路径(固定值:DCR 注册的 redirect_uri 尾段;树外免认证,state 即凭证)。 */
export const OAUTH_CALLBACK_PATH = '/~oauth/callback'

const KEY_OAUTH_CLIENT = 'mcpoauth:client:'
const KEY_OAUTH_TOKENS = 'mcpoauth:token:'
const KEY_OAUTH_DISCOVERY = 'mcpoauth:as:'

/** 授权跳转 → 回调的时限(state 的 exp);过期一律拒,防 code 重放窗口拉长。 */
const STATE_TTL_SEC = 600

/** 删除某节点的全部 OAuth 记录(节点删除时调用;client/token/discovery 一体作废)。 */
export async function invalidateMcpOAuth(store: StateStore, nodePath: string): Promise<void> {
  await store.delete(KEY_OAUTH_CLIENT + nodePath)
  await store.delete(KEY_OAUTH_TOKENS + nodePath)
  await store.delete(KEY_OAUTH_DISCOVERY + nodePath)
}

/** 需要(重新)交互授权时的统一指引错误(消费端与回调校验共用)。 */
export function reauthorizeRequired(nodePath: string): TBError {
  return new TBError(
    'permission_denied',
    `mcp upstream '${nodePath}' requires (re)authorization: run \`tb tool auth ${nodePath}\``,
  )
}

// ---------- self-contained state(AES-256-GCM,零存储) ----------

/**
 * state 载荷:p = mcp 节点树路径,v = PKCE code_verifier,exp = 过期时刻(epoch 秒);
 * r = 本次授权用的 redirect_uri(仅非默认网关回调时携带——严格上游只放行 localhost
 * 回调时走 CLI 本地回调通道,token 兑换必须复用同一 redirect_uri)。
 */
export interface OAuthStatePayload {
  p: string
  v: string
  exp: number
  r?: string
}

/**
 * state 加密密钥:SHA-256(域前缀 + TB_SECRET_ENCRYPTION_KEY)派生 32 字节。
 * 域前缀做密钥域分离(不与 SecretStore 主密钥/refToken HMAC 直接同 key)。
 */
async function stateCryptoKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`tb-mcp-oauth-state:${secret}`),
  )
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** 加密 state:base64url(iv) + '.' + base64url(ciphertext)。GCM 自带完整性,无需另签。 */
export async function sealOAuthState(payload: OAuthStatePayload, secret: string): Promise<string> {
  const key = await stateCryptoKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  )
  return `${base64urlEncode(iv)}.${base64urlEncode(new Uint8Array(ciphertext))}`
}

/** 解密 state;任何失败(格式/解密/形状)→ null。过期判定留给调用方(便于测钟)。 */
export async function openOAuthState(
  state: string,
  secret: string,
): Promise<OAuthStatePayload | null> {
  const dot = state.indexOf('.')
  if (dot <= 0) return null
  try {
    const key = await stateCryptoKey(secret)
    const iv = base64urlDecode(state.slice(0, dot))
    const ciphertext = base64urlDecode(state.slice(dot + 1))
    const plain = await crypto.subtle.decrypt(
      // Node 的 WebCrypto 类型要求 Uint8Array<ArrayBuffer>;base64urlDecode 产物满足但类型面是 ArrayBufferLike。
      { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> },
      key,
      ciphertext as Uint8Array<ArrayBuffer>,
    )
    const payload = JSON.parse(new TextDecoder().decode(plain)) as OAuthStatePayload
    if (
      typeof payload.p !== 'string' ||
      typeof payload.v !== 'string' ||
      typeof payload.exp !== 'number' ||
      (payload.r !== undefined && typeof payload.r !== 'string')
    ) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

// ---------- OAuthClientProvider(StateStore 支撑) ----------

export interface McpOAuthProviderOpts {
  store: StateStore
  nodePath: string
  /** TB_SECRET_ENCRYPTION_KEY 原文(state 加密密钥派生源)。 */
  encryptionKey: string
  /**
   * 'interactive':授权流(发起/回调),redirectToAuthorization 捕获 URL 并注入加密 state。
   * 'deny':数据面消费,只允许静默刷新;要走交互授权即抛 reauthorizeRequired。
   */
  mode: 'interactive' | 'deny'
  /**
   * 授权流所在网关 origin(redirect_uri = `<origin>/~oauth/callback`)。
   * deny 模式不发起交互,占位 .invalid 域仅用于满足 SDK 的非空判定(交互路径必抛)。
   */
  origin?: string
  /**
   * 显式 redirect_uri 覆盖(CLI 本地回调通道):严格上游的 DCR 只放行 localhost 回调时,
   * 授权跳本地临时端口,code 再由 CLI 转交网关 callback 兑换。覆盖时同时进 clientMetadata
   * 与 state 载荷(兑换必须复用同一 redirect_uri)。
   */
  redirectUri?: string
}

export class GatewayMcpOAuthProvider implements OAuthClientProvider {
  /** redirectToAuthorization 捕获的授权 URL(state 已替换为加密载荷)。 */
  capturedAuthorizationUrl: URL | undefined
  private verifier: string | undefined
  private readonly opts: McpOAuthProviderOpts

  constructor(opts: McpOAuthProviderOpts) {
    this.opts = opts
  }

  get redirectUrl(): string {
    if (this.opts.redirectUri !== undefined) return this.opts.redirectUri
    const origin = this.opts.origin ?? 'https://tool-bridge.invalid'
    return `${origin}${OAUTH_CALLBACK_PATH}`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'tool-bridge-gateway',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // public client,PKCE 保护
    }
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const raw = await this.opts.store.get(KEY_OAUTH_CLIENT + this.opts.nodePath)
    if (raw === null) {
      // 消费端无 client 记录 = 从未授权过 → 直接指引,免得 SDK 用占位 redirect_uri 去 DCR。
      if (this.opts.mode === 'deny') throw reauthorizeRequired(this.opts.nodePath)
      return undefined
    }
    return raw as OAuthClientInformationMixed
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await this.opts.store.put(KEY_OAUTH_CLIENT + this.opts.nodePath, info)
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const raw = await this.opts.store.get(KEY_OAUTH_TOKENS + this.opts.nodePath)
    return raw === null ? undefined : (raw as OAuthTokens)
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.opts.store.put(KEY_OAUTH_TOKENS + this.opts.nodePath, tokens)
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.verifier = codeVerifier
  }

  codeVerifier(): string {
    if (this.verifier === undefined) {
      throw new TBError('invalid_argument', 'OAuth code_verifier missing(state 未还原)')
    }
    return this.verifier
  }

  /** 回调段:把 state 解密出的 code_verifier 注入(兑换 code 时 SDK 经 codeVerifier() 取)。 */
  setCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.opts.mode === 'deny') throw reauthorizeRequired(this.opts.nodePath)
    // 此刻 SDK 已 saveCodeVerifier —— 把 {nodePath, codeVerifier, exp(, redirectUri)} 加密进
    // state,回调侧解密即得全部续跑状态(零存储,不吃 KV 一致性窗口)。
    const state = await sealOAuthState(
      {
        p: this.opts.nodePath,
        v: this.codeVerifier(),
        exp: Math.floor(Date.now() / 1000) + STATE_TTL_SEC,
        ...(this.opts.redirectUri !== undefined ? { r: this.opts.redirectUri } : {}),
      },
      this.opts.encryptionKey,
    )
    authorizationUrl.searchParams.set('state', state)
    this.capturedAuthorizationUrl = authorizationUrl
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const raw = await this.opts.store.get(KEY_OAUTH_DISCOVERY + this.opts.nodePath)
    return raw === null ? undefined : (raw as OAuthDiscoveryState)
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.opts.store.put(KEY_OAUTH_DISCOVERY + this.opts.nodePath, state)
  }

  /** SDK 对 InvalidClient/InvalidGrant 等可恢复错误的重试钩子:清对应缓存后重走。 */
  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    const { store, nodePath } = this.opts
    if (scope === 'all' || scope === 'client') await store.delete(KEY_OAUTH_CLIENT + nodePath)
    if (scope === 'all' || scope === 'tokens') await store.delete(KEY_OAUTH_TOKENS + nodePath)
    if (scope === 'all' || scope === 'discovery') await store.delete(KEY_OAUTH_DISCOVERY + nodePath)
    if (scope === 'all' || scope === 'verifier') this.verifier = undefined
  }
}

// ---------- 流程编排(tbApp 调用面) ----------

export interface McpOAuthFlowOpts {
  store: StateStore
  encryptionKey: string
  nodePath: string
  /** mcp 节点 config.url(资源服务器;discovery 起点)。 */
  serverUrl: string
  /** 当前请求的网关 origin。 */
  origin: string
  /** 显式 redirect_uri(CLI 本地回调通道;仅允许 localhost,startMcpAuthorization 校验)。 */
  redirectUri?: string
}

export type StartAuthorizationResult =
  | { status: 'authorized' }
  | { status: 'redirect'; authorizationUrl: string }

/**
 * 校验 CLI 本地回调通道的 redirect_uri:只放行 http://localhost|127.0.0.1|[::1](任意端口
 * 任意路径)。这不是网关持有的回调,授权 code 会落到用户本机——限定 loopback 防止把
 * code 引到任意第三方 URL。
 */
export function assertLocalRedirectUri(uri: string): void {
  let u: URL
  try {
    u = new URL(uri)
  } catch {
    throw new TBError('invalid_argument', `redirectUri 不是合法 URL:'${uri}'`)
  }
  const host = u.hostname.toLowerCase()
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !isLoopback) {
    throw new TBError(
      'invalid_argument',
      'redirectUri 仅允许 localhost/127.0.0.1 回调(CLI 本地回调通道)',
    )
  }
}

/** OAuth 编排错误归一:TBError 原样;其余 → unavailable(上游 AS/网络问题)。 */
async function guardOAuth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof TBError) throw err
    throw new TBError(
      'unavailable',
      `OAuth flow failed: ${err instanceof Error ? err.message : String(err)}`,
      { retryable: false },
    )
  }
}

/**
 * 发起授权:SDK `auth()` 一次编排 discovery + DCR + PKCE。
 * 已有 refresh_token 且静默刷新成功 → authorized(免交互);否则捕获授权 URL 返回。
 * `redirectUri`(CLI 本地回调通道)仅允许 loopback;与缓存 client 注册的 redirect_uris
 * 不符时清 client 强制重 DCR(AS 按注册值精确校验 redirect_uri)。
 */
export async function startMcpAuthorization(
  opts: McpOAuthFlowOpts,
): Promise<StartAuthorizationResult> {
  if (opts.redirectUri !== undefined) {
    assertLocalRedirectUri(opts.redirectUri)
    const cached = (await opts.store.get(KEY_OAUTH_CLIENT + opts.nodePath)) as {
      redirect_uris?: string[]
    } | null
    if (cached !== null && !(cached.redirect_uris ?? []).includes(opts.redirectUri)) {
      await opts.store.delete(KEY_OAUTH_CLIENT + opts.nodePath)
    }
  }
  const provider = new GatewayMcpOAuthProvider({
    store: opts.store,
    nodePath: opts.nodePath,
    encryptionKey: opts.encryptionKey,
    mode: 'interactive',
    origin: opts.origin,
    ...(opts.redirectUri !== undefined ? { redirectUri: opts.redirectUri } : {}),
  })
  return await guardOAuth(async () => {
    const result = await auth(provider, { serverUrl: opts.serverUrl })
    if (result === 'AUTHORIZED') return { status: 'authorized' }
    const url = provider.capturedAuthorizationUrl
    if (url === undefined) {
      throw new TBError('internal', 'authorization URL not captured')
    }
    return { status: 'redirect', authorizationUrl: url.toString() }
  })
}

/**
 * 回调段:注入 state 还原的 code_verifier(与 redirect_uri,如走本地回调通道),
 * 兑换 code → token 落 StateStore。
 */
export async function finishMcpAuthorization(
  opts: McpOAuthFlowOpts & { code: string; codeVerifier: string },
): Promise<void> {
  const provider = new GatewayMcpOAuthProvider({
    store: opts.store,
    nodePath: opts.nodePath,
    encryptionKey: opts.encryptionKey,
    mode: 'interactive',
    origin: opts.origin,
    ...(opts.redirectUri !== undefined ? { redirectUri: opts.redirectUri } : {}),
  })
  provider.setCodeVerifier(opts.codeVerifier)
  await guardOAuth(async () => {
    const result = await auth(provider, {
      serverUrl: opts.serverUrl,
      authorizationCode: opts.code,
    })
    if (result !== 'AUTHORIZED') {
      throw new TBError('internal', 'authorization did not complete')
    }
  })
}

/** 回调结果页(浏览器一次性展示;不含任何机密)。 */
export function renderOAuthCallbackHtml(ok: boolean, detail: string): Response {
  const title = ok ? 'Authorization complete' : 'Authorization failed'
  const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>${title} · tool-bridge</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:80vh;margin:0}
main{text-align:center}h1{font-size:1.4rem}p{color:#555}</style></head>
<body><main><h1>${ok ? '✅' : '❌'} ${title}</h1><p>${detail}</p>
<p>You can close this tab.</p></main></body></html>`
  return new Response(body, {
    status: ok ? 200 : 400,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
