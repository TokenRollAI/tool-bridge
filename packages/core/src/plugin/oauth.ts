/**
 * Provider 型 OAuth2 的声明契约(与 mcp 上游的托管 OAuth 是**两套机制**)。
 *
 * mcp 那条(`app/src/oauth.ts`)靠 MCP SDK 的 `auth()`:从资源服务器 discovery 出授权服务器、
 * 再动态注册客户端(DCR)。provider 型没有这些 —— 授权/令牌端点是**写死的已知值**,
 * client_id/secret 是**用户自己去 provider 后台注册**的。两者只共用"授权码 + PKCE"这个骨架,
 * 强行合并会让两边都变形,故分开声明、共用底层的 state 密封与回调渲染。
 *
 * 对应上游 open-connector 的 `OAuth2AuthDefinition`:那边每个 provider 自带一份端点与字段名
 * 配置(不同 provider 的 token 请求字段名、响应信封形状都不一样),这里是它在 tool-bridge 侧
 * 的落点。
 */

import { z } from 'zod'
import { TBError } from '../errors'

/** 令牌端点的客户端认证方式。 */
export const OAUTH_CLIENT_AUTH_METHODS = ['client_secret_basic', 'client_secret_post', 'none'] as const
export type OAuthClientAuthMethod = (typeof OAUTH_CLIENT_AUTH_METHODS)[number]

const httpsUrl = z.string().url().refine(
  value => value.startsWith('https://'),
  'OAuth 端点必须是 https(授权码与令牌不得走明文)',
)

export const pluginOAuthSchema = z.object({
  /** 浏览器跳转的授权端点。 */
  authorizationUrl: httpsUrl,
  /** 兑换 code / 刷新令牌的端点。 */
  tokenUrl: httpsUrl,
  /** 刷新端点(缺省同 tokenUrl;个别 provider 分开)。 */
  refreshUrl: httpsUrl.optional(),
  /** 申请的 scope 列表。 */
  scopes: z.array(z.string().min(1)).optional(),
  /** scope 分隔符(缺省空格;个别 provider 用逗号)。 */
  scopeSeparator: z.enum([' ', ',']).optional(),
  /** 客户端认证方式(缺省 client_secret_post)。 */
  clientAuth: z.enum(OAUTH_CLIENT_AUTH_METHODS).optional(),
  /**
   * 授权 URL 的额外静态参数(如 Google 的 `access_type=offline`、
   * 飞书的 `state` 之外的自定义项)。不得覆盖协议参数。
   */
  authorizationParams: z.record(z.string(), z.string()).optional(),
  /**
   * 令牌响应被包了一层信封时的取值路径(如飞书 v2 的 `{code,msg,data:{...}}` → `'data'`)。
   * 缺省表示响应根就是令牌对象。
   */
  responseEnvelope: z.string().min(1).optional(),
  /** PKCE:缺省启用(S256)。个别老 provider 不支持,置 false。 */
  pkce: z.boolean().optional(),
})

/**
 * provider 型 OAuth2 的声明。
 *
 * client_id / client_secret **不在这里** —— 它们是每个部署自己的应用凭证,走
 * `authRef` 指向的 secret(多字段:`clientId` + `clientSecret`),与其他上游凭证同一通道。
 */
export type PluginOAuth = z.infer<typeof pluginOAuthSchema>

/** 授权流程需要的两个客户端字段(存在 authRef 指向的 secret 里)。 */
export const OAUTH_CLIENT_FIELDS = [
  {
    key: 'clientId',
    label: 'Client ID',
    required: true,
    description: '在 provider 后台注册应用后拿到的 client_id',
  },
  {
    key: 'clientSecret',
    label: 'Client Secret',
    required: true,
    secret: true,
    description: 'client_secret;clientAuth 为 none 时可留空',
  },
] as const

/** 令牌集合:授权/刷新的产物,存平台侧,不出网关。 */
export interface OAuthTokenSet {
  accessToken: string
  /** 绝对过期时刻(ISO);上游没给 expires_in 时缺省。 */
  expiresAt?: string
  refreshToken?: string
  /** 上游实际授予的 scope(可能少于申请的)。 */
  scope?: string
  tokenType: string
}

/** 把 `expires_in`(秒)换成绝对时刻:相对值跨存储/跨重启就没意义了。 */
export function expiresAtFrom(expiresIn: unknown, now: Date): string | undefined {
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) return undefined
  return new Date(now.getTime() + expiresIn * 1000).toISOString()
}

/**
 * 令牌是否该刷新了。留 60s 余量:掐着过期时刻用,请求在途中就可能失效。
 * 没有 expiresAt(上游没给 expires_in)→ 不主动刷新,靠 401 触发。
 */
export function shouldRefresh(tokens: OAuthTokenSet, now: Date): boolean {
  if (tokens.expiresAt === undefined) return false
  return new Date(tokens.expiresAt).getTime() - now.getTime() < 60_000
}

// ---------- 授权 URL 与令牌请求的构造(纯函数;I/O 在 app 侧) ----------

/** `application/x-www-form-urlencoded` 编码(空格为 `+`,与 URLSearchParams 一致)。 */
function encodeForm(entries: ReadonlyMap<string, string>): string {
  const encode = (raw: string): string => encodeURIComponent(raw).replaceAll('%20', '+')
  return [...entries].map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&')
}

/** ASCII → base64(core 无 DOM lib,不能用 btoa;Basic 认证的输入已被 encodeURIComponent 收成 ASCII)。 */
function base64(ascii: string): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < ascii.length; i += 3) {
    const a = ascii.charCodeAt(i)
    const b = i + 1 < ascii.length ? ascii.charCodeAt(i + 1) : Number.NaN
    const c = i + 2 < ascii.length ? ascii.charCodeAt(i + 2) : Number.NaN
    out += table[a >> 2]
    out += table[((a & 0x03) << 4) | (Number.isNaN(b) ? 0 : b >> 4)]
    out += Number.isNaN(b) ? '=' : table[((b & 0x0F) << 2) | (Number.isNaN(c) ? 0 : c >> 6)]
    out += Number.isNaN(c) ? '=' : table[c & 0x3F]
  }
  return out
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** 从令牌错误响应里挑一句可读消息(OAuth 规范字段优先,再退回信封字段)。 */
function tokenErrorMessage(payload: Record<string, unknown> | undefined): string | undefined {
  if (payload === undefined) return undefined
  for (const key of ['error_description', 'error', 'msg', 'message']) {
    const value = payload[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/** 构造浏览器跳转的授权 URL。 */
export function buildAuthorizationUrl(opts: {
  clientId: string
  codeChallenge?: string
  config: PluginOAuth
  redirectUri: string
  state: string
}): string {
  // 手写 query 拼接而不用 URLSearchParams:core 是纯逻辑层(tsconfig `types: []`、无 DOM lib),
  // 不依赖任何宿主 API —— 这条约束保证同一份逻辑在 Workers/Node/Deno 下行为一致。
  const params: Array<[string, string]> = []
  // 静态参数先入,协议参数后入 —— 同名时后者胜,authorizationParams 不能覆盖协议语义。
  for (const [key, value] of Object.entries(opts.config.authorizationParams ?? {})) {
    params.push([key, value])
  }
  params.push(['response_type', 'code'])
  params.push(['client_id', opts.clientId])
  params.push(['redirect_uri', opts.redirectUri])
  params.push(['state', opts.state])
  const scopes = opts.config.scopes ?? []
  if (scopes.length > 0) {
    params.push(['scope', scopes.join(opts.config.scopeSeparator ?? ' ')])
  }
  if (opts.codeChallenge !== undefined) {
    params.push(['code_challenge', opts.codeChallenge])
    params.push(['code_challenge_method', 'S256'])
  }

  // 后入的同名参数覆盖先入的。
  const merged = new Map<string, string>()
  for (const [key, value] of params) merged.set(key, value)

  const base = opts.config.authorizationUrl
  const joiner = base.includes('?') ? '&' : '?'
  return base + joiner + encodeForm(merged)
}

/** 令牌请求的 body 与 headers(按 clientAuth 决定 client 凭证放哪)。 */
export function buildTokenRequest(opts: {
  clientId: string
  clientSecret?: string
  codeVerifier?: string
  config: PluginOAuth
  /** 授权码兑换给 code + redirectUri;刷新给 refreshToken。 */
  grant: { code: string, redirectUri: string } | { refreshToken: string }
}): { body: string, headers: Record<string, string> } {
  const form = new Map<string, string>()
  if ('code' in opts.grant) {
    form.set('grant_type', 'authorization_code')
    form.set('code', opts.grant.code)
    form.set('redirect_uri', opts.grant.redirectUri)
    if (opts.codeVerifier !== undefined) form.set('code_verifier', opts.codeVerifier)
  } else {
    form.set('grant_type', 'refresh_token')
    form.set('refresh_token', opts.grant.refreshToken)
  }

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    'accept': 'application/json',
  }
  const method = opts.config.clientAuth ?? 'client_secret_post'
  if (method === 'client_secret_basic') {
    const raw = `${encodeURIComponent(opts.clientId)}:${encodeURIComponent(opts.clientSecret ?? '')}`
    headers.authorization = `Basic ${base64(raw)}`
  } else {
    form.set('client_id', opts.clientId)
    // none:公共客户端,只带 client_id 不带 secret。
    if (method === 'client_secret_post' && opts.clientSecret !== undefined) {
      form.set('client_secret', opts.clientSecret)
    }
  }
  return { body: encodeForm(form), headers }
}

/**
 * 令牌响应 → OAuthTokenSet。`responseEnvelope` 给出时先剥一层信封
 * (飞书 v2 是 `{code,msg,data:{access_token,...}}`)。
 *
 * @throws invalid_argument 响应里没有 access_token(含上游用 200 + 信封报错的情况)
 */
export function parseTokenResponse(
  payload: unknown,
  config: PluginOAuth,
  now: Date,
): OAuthTokenSet {
  let source = payload
  if (config.responseEnvelope !== undefined) {
    const outer = asRecord(payload)
    const inner = outer?.[config.responseEnvelope]
    // 信封在但内层缺失 → 多半是上游用 200 + {code!=0} 报错,把它的消息带出去。
    if (inner === undefined) {
      throw new TBError('invalid_argument', tokenErrorMessage(outer) ?? '令牌响应缺少令牌数据')
    }
    source = inner
  }
  const record = asRecord(source)
  const accessToken = typeof record?.access_token === 'string' ? record.access_token : undefined
  if (accessToken === undefined || accessToken === '') {
    throw new TBError('invalid_argument', tokenErrorMessage(asRecord(payload)) ?? '令牌响应缺少 access_token')
  }
  return {
    accessToken,
    tokenType: typeof record?.token_type === 'string' && record.token_type !== ''
      ? record.token_type
      : 'Bearer',
    ...(typeof record?.refresh_token === 'string' && record.refresh_token !== ''
      ? { refreshToken: record.refresh_token }
      : {}),
    ...(typeof record?.scope === 'string' ? { scope: record.scope } : {}),
    ...(() => {
      const at = expiresAtFrom(record?.expires_in, now)
      return at === undefined ? {} : { expiresAt: at }
    })(),
  }
}
