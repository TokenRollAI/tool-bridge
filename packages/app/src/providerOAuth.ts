/**
 * provider 型 OAuth2 的托管流程(I/O 层;纯逻辑在 core `plugin/oauth.ts`)。
 *
 * 与 mcp 那条(`oauth.ts`)的分工:两者共用 state 密封(`sealOAuthState`/`openOAuthState`)
 * 与回调页渲染,但**流程本身分开** —— mcp 靠 MCP SDK 的 `auth()` 做 discovery + DCR,
 * 这条的端点是 plugin 在 `~describe` 里声明的已知值、client 凭证是用户自己注册后存进
 * SecretStore 的。合并只会让两边都长出对方不需要的分支。
 *
 * KV 布局(与 mcp 的 `mcpoauth:` 前缀分开,免得两套流程互相踩):
 * - `puoauth:token:<path>` — 该挂载的令牌集合(access + refresh + 过期时刻)
 *
 * 令牌**不出网关**:插件侧只在调用时经 `X-TB-Upstream-Auth` 拿到 access token 明文,
 * 与其他上游凭证同一通道 —— 插件不知道也不需要知道它是 OAuth 换来的。
 */

import { buildAuthorizationUrl,
  buildTokenRequest,
  isTBError,
  OAUTH_CLIENT_FIELDS,
  type OAuthTokenSet,
  parseCredentialValues,
  parseTokenResponse,
  type PluginOAuth,
  type SecretStoreImpl,
  shouldRefresh,
  type StateStore,
  TBError } from '@tool-bridge/core'
import { sealOAuthState } from './oauth'

const KEY_TOKENS = 'puoauth:token:'

/** 授权跳转 → 回调的时限(与 mcp 那条一致:过期一律拒,不给 code 重放留窗口)。 */
const STATE_TTL_SEC = 600

/** 平台自持的回调路径(与 mcp 共用一个端点,靠 state 里的标记区分流程)。 */
export const PROVIDER_OAUTH_CALLBACK_PATH = '/~oauth/callback'

/** 删除某挂载的令牌(节点卸载时调用)。 */
export async function invalidateProviderOAuth(store: StateStore, nodePath: string): Promise<void> {
  await store.delete(KEY_TOKENS + nodePath)
}

/** 需要(重新)交互授权时的统一指引。 */
export function providerReauthorizeRequired(nodePath: string): TBError {
  return new TBError(
    'permission_denied',
    `上游 '${nodePath}' 需要(重新)授权:运行 \`tb tool auth ${nodePath}\``,
  )
}

/** 取 client 凭证(存在挂载 authRef 指向的 secret 里,固定两个字段)。 */
async function clientCredential(
  secrets: SecretStoreImpl,
  authRef: string,
): Promise<{ clientId: string, clientSecret?: string }> {
  const raw = await secrets.resolve(authRef)
  if (raw === undefined) {
    throw new TBError('unavailable', `secret '${authRef}' 不存在或无法解密`, { retryable: false })
  }
  const values = parseCredentialValues(raw, [...OAUTH_CLIENT_FIELDS])
  return {
    clientId: values.clientId!,
    // clientAuth 为 none 的公共客户端可以没有 secret。
    ...(values.clientSecret === undefined ? {} : { clientSecret: values.clientSecret }),
  }
}

/**
 * 落库。刷新响应常**不带新的 refresh token**(未启用轮换的 provider),此时必须保留旧的 ——
 * 否则下次就没得刷,用户被迫重新授权。
 */
async function writeTokens(
  store: StateStore,
  nodePath: string,
  next: OAuthTokenSet,
  previous?: OAuthTokenSet,
): Promise<void> {
  const merged: OAuthTokenSet = {
    ...next,
    ...(next.refreshToken === undefined && previous?.refreshToken !== undefined
      ? { refreshToken: previous.refreshToken }
      : {}),
  }
  await store.put(KEY_TOKENS + nodePath, merged)
}

async function readTokens(store: StateStore, nodePath: string): Promise<OAuthTokenSet | undefined> {
  const record = await store.get(KEY_TOKENS + nodePath)
  return record === null ? undefined : (record as OAuthTokenSet)
}

/** 向令牌端点发一次请求并解析。非 2xx 与信封错误都归一成可读的 TBError。 */
async function requestTokens(opts: {
  clientId: string
  clientSecret?: string
  codeVerifier?: string
  config: PluginOAuth
  fetcher: typeof fetch
  grant: { code: string, redirectUri: string } | { refreshToken: string }
  now: Date
}): Promise<OAuthTokenSet> {
  const endpoint = 'refreshToken' in opts.grant
    ? opts.config.refreshUrl ?? opts.config.tokenUrl
    : opts.config.tokenUrl
  const { body, headers } = buildTokenRequest({
    config: opts.config,
    clientId: opts.clientId,
    grant: opts.grant,
    ...(opts.clientSecret === undefined ? {} : { clientSecret: opts.clientSecret }),
    ...(opts.codeVerifier === undefined ? {} : { codeVerifier: opts.codeVerifier }),
  })

  let response: Response
  try {
    response = await opts.fetcher(endpoint, { method: 'POST', headers, body })
  } catch {
    throw new TBError(
      'unavailable',
      '令牌端点不可达',
      { retryable: true },
    )
  }

  const text = await response.text()
  let payload: unknown = null
  try {
    payload = text === '' ? null : JSON.parse(text)
  } catch {
    payload = null
  }
  if (!response.ok) {
    // 令牌端点的 4xx 基本都是 client 凭证/授权码问题(配置错),5xx 才是上游故障。
    // 上游错误体不可信，且常会回显 client_secret/code/verifier；只暴露状态码。
    const detail = `HTTP ${response.status}`
    if (response.status >= 500) {
      throw new TBError('unavailable', `令牌端点返回 ${detail}`, { retryable: true })
    }
    throw new TBError('invalid_argument', `令牌端点拒绝了请求:${detail}`)
  }
  try {
    return parseTokenResponse(payload, opts.config, opts.now)
  } catch (err) {
    // 200 + 错误信封同样可能回显请求秘密；保留错误类别，不透传上游消息。
    if (isTBError(err) && err.code === 'invalid_argument') {
      throw new TBError('invalid_argument', '令牌端点返回了无效响应')
    }
    throw err
  }
}

// ---------- PKCE ----------

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** 生成 PKCE 对(S256)。 */
async function createPkce(): Promise<{ challenge: string, verifier: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

// ---------- 流程编排 ----------

export interface ProviderAuthorizeOpts {
  authRef: string
  config: PluginOAuth
  encryptionKey: string
  /** 宿主显式注入的安全出站通道；undefined 必须 fail closed。 */
  fetcher: typeof fetch | undefined
  nodePath: string
  now: Date
  /** 网关 origin(拼默认回调地址)。 */
  origin: string
  secrets: SecretStoreImpl
  store: StateStore
}

export type ProviderAuthorizeResult
  = | { authorizationUrl: string, status: 'redirect' }
    | { status: 'authorized' }

function requireProviderOAuthFetch(fetcher: typeof fetch | undefined): typeof fetch {
  if (fetcher === undefined) {
    throw new TBError('unavailable', 'Provider OAuth 出站通道未配置', { retryable: false })
  }
  return fetcher
}

/**
 * 发起授权。已有可用令牌(或能静默刷新)→ 直接 authorized,免交互;
 * 否则产出跳转 URL,PKCE verifier 密封在 state 里(零存储,天然绕开 KV 最终一致窗口)。
 */
export async function startProviderAuthorization(
  opts: ProviderAuthorizeOpts,
): Promise<ProviderAuthorizeResult> {
  const fetcher = requireProviderOAuthFetch(opts.fetcher)
  const existing = await readTokens(opts.store, opts.nodePath)
  if (existing !== undefined && !shouldRefresh(existing, opts.now)) {
    return { status: 'authorized' }
  }
  // 有 refresh token 就先试静默刷新:用户已经授权过一次,不该再被弹一次浏览器。
  if (existing?.refreshToken !== undefined) {
    try {
      const client = await clientCredential(opts.secrets, opts.authRef)
      const refreshed = await requestTokens({
        config: opts.config,
        fetcher,
        now: opts.now,
        grant: { refreshToken: existing.refreshToken },
        ...client,
      })
      await writeTokens(opts.store, opts.nodePath, refreshed, existing)
      return { status: 'authorized' }
    } catch {
      // 刷新失败(refresh token 被吊销/轮换)→ 落回交互授权,不是错误。
    }
  }

  const client = await clientCredential(opts.secrets, opts.authRef)
  const usePkce = opts.config.pkce !== false
  const pkce = usePkce ? await createPkce() : undefined
  const state = await sealOAuthState(
    {
      p: opts.nodePath,
      v: pkce?.verifier ?? '',
      exp: Math.floor(opts.now.getTime() / 1000) + STATE_TTL_SEC,
    },
    opts.encryptionKey,
  )
  return {
    status: 'redirect',
    authorizationUrl: buildAuthorizationUrl({
      config: opts.config,
      clientId: client.clientId,
      redirectUri: opts.origin + PROVIDER_OAUTH_CALLBACK_PATH,
      state,
      ...(pkce === undefined ? {} : { codeChallenge: pkce.challenge }),
    }),
  }
}

/** 回调段:还原 state → 兑换 code → 落库。 */
export async function finishProviderAuthorization(opts: ProviderAuthorizeOpts & {
  code: string
  codeVerifier: string
}): Promise<void> {
  const fetcher = requireProviderOAuthFetch(opts.fetcher)
  const client = await clientCredential(opts.secrets, opts.authRef)
  const tokens = await requestTokens({
    config: opts.config,
    fetcher,
    now: opts.now,
    grant: { code: opts.code, redirectUri: opts.origin + PROVIDER_OAUTH_CALLBACK_PATH },
    ...(opts.codeVerifier === '' ? {} : { codeVerifier: opts.codeVerifier }),
    ...client,
  })
  await writeTokens(opts.store, opts.nodePath, tokens)
}

/**
 * 取调用时用的 access token,过期则先刷新。
 *
 * 拿不到(从未授权 / refresh 失败)→ `permission_denied` 并指引重新授权,而不是笼统的
 * unavailable:这不是上游故障,是这个挂载缺一次人工授权。
 *
 * `force` 由调用方在收到上游 401 时给出:此时不看过期时刻、直接刷新一次(见
 * pluginClient 的 401 重试)。
 */
export async function resolveProviderAccessToken(
  opts: ProviderAuthorizeOpts & { force?: boolean },
): Promise<string> {
  const fetcher = requireProviderOAuthFetch(opts.fetcher)
  const tokens = await readTokens(opts.store, opts.nodePath)
  if (tokens === undefined) throw providerReauthorizeRequired(opts.nodePath)
  // force:调用方收到 401 了。上游可能在过期时刻前就作废了令牌(密钥轮换),而不返回
  // expires_in 的 provider 压根没有过期时刻 —— 那种情况 shouldRefresh 恒为 false,
  // 只有这条路径能让它自愈。
  if (opts.force !== true && !shouldRefresh(tokens, opts.now)) return tokens.accessToken
  if (tokens.refreshToken === undefined) throw providerReauthorizeRequired(opts.nodePath)

  const client = await clientCredential(opts.secrets, opts.authRef)
  let refreshed: OAuthTokenSet
  try {
    refreshed = await requestTokens({
      config: opts.config,
      fetcher,
      now: opts.now,
      grant: { refreshToken: tokens.refreshToken },
      ...client,
    })
  } catch (err) {
    // 上游临时故障不该被说成"要重新授权"(那会让用户白跑一趟浏览器)。
    if (isTBError(err) && err.code === 'unavailable') throw err
    throw providerReauthorizeRequired(opts.nodePath)
  }
  await writeTokens(opts.store, opts.nodePath, refreshed, tokens)
  return refreshed.accessToken
}
