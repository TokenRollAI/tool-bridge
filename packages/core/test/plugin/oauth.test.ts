import { describe, expect, it } from 'vitest'
import {
  buildAuthorizationUrl,
  buildTokenRequest,
  expiresAtFrom,
  parseTokenResponse,
  type PluginOAuth,
  pluginOAuthSchema,
  shouldRefresh,
} from '../../src/plugin/oauth'
import { isTBError } from '../../src/errors'

/**
 * provider 型 OAuth2 的纯逻辑。这些函数的产物直接决定跳转 URL 与令牌请求长什么样,
 * 错一个参数名就是"授权流程走不通"或"凭证发错地方",故边界逐条钉。
 *
 * 断言用手写的 query 解析而不是 `URL`/`URLSearchParams`:core 的 tsconfig 是 `types: []`
 * 且无 DOM lib(纯逻辑层不依赖宿主 API)—— 被测代码守这条线,测试也守。
 */

/** `a=1&b=2` → Map(解 form 编码:`+` 是空格)。 */
function parseQuery(query: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const pair of query.split('&')) {
    if (pair === '') continue
    const at = pair.indexOf('=')
    const key = at < 0 ? pair : pair.slice(0, at)
    const raw = at < 0 ? '' : pair.slice(at + 1)
    out.set(decodeURIComponent(key), decodeURIComponent(raw.replaceAll('+', ' ')))
  }
  return out
}

/** 完整 URL → [端点, 参数表]。 */
function splitUrl(full: string): [string, Map<string, string>] {
  const at = full.indexOf('?')
  return at < 0 ? [full, new Map()] : [full.slice(0, at), parseQuery(full.slice(at + 1))]
}

/** ASCII → base64(测试侧独立实现一份,与被测代码互为交叉验证)。 */
function b64(ascii: string): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < ascii.length; i += 3) {
    const bytes = [ascii.charCodeAt(i), ascii.charCodeAt(i + 1), ascii.charCodeAt(i + 2)]
    out += table[bytes[0]! >> 2]
    out += table[((bytes[0]! & 0x03) << 4) | (Number.isNaN(bytes[1]!) ? 0 : bytes[1]! >> 4)]
    out += Number.isNaN(bytes[1]!)
      ? '='
      : table[((bytes[1]! & 0x0F) << 2) | (Number.isNaN(bytes[2]!) ? 0 : bytes[2]! >> 6)]
    out += Number.isNaN(bytes[2]!) ? '=' : table[bytes[2]! & 0x3F]
  }
  return out
}

const NOW = new Date('2026-01-01T00:00:00.000Z')

const BASE: PluginOAuth = {
  authorizationUrl: 'https://accounts.example.com/authorize',
  tokenUrl: 'https://api.example.com/token',
}

describe('配置校验', () => {
  it('端点必须 https(授权码与令牌不得走明文)', () => {
    expect(pluginOAuthSchema.safeParse({ ...BASE, authorizationUrl: 'http://a.example/x' }).success)
      .toBe(false)
    expect(pluginOAuthSchema.safeParse({ ...BASE, tokenUrl: 'http://a.example/t' }).success)
      .toBe(false)
  })

  it('最小配置只要两个端点', () => {
    expect(pluginOAuthSchema.safeParse(BASE).success).toBe(true)
  })
})

describe('buildAuthorizationUrl', () => {
  it('带齐协议参数', () => {
    const [endpoint, params] = splitUrl(buildAuthorizationUrl({
      config: { ...BASE, scopes: ['read', 'write'] },
      clientId: 'cid',
      redirectUri: 'https://tb.test/~oauth/callback',
      state: 'st8',
      codeChallenge: 'chal',
    }))
    expect(endpoint).toBe('https://accounts.example.com/authorize')
    expect(params.get('response_type')).toBe('code')
    expect(params.get('client_id')).toBe('cid')
    expect(params.get('redirect_uri')).toBe('https://tb.test/~oauth/callback')
    expect(params.get('state')).toBe('st8')
    expect(params.get('scope')).toBe('read write')
    expect(params.get('code_challenge')).toBe('chal')
    expect(params.get('code_challenge_method')).toBe('S256')
  })

  it('scopeSeparator 支持逗号(个别 provider 用它)', () => {
    const [, params] = splitUrl(buildAuthorizationUrl({
      config: { ...BASE, scopes: ['a', 'b'], scopeSeparator: ',' },
      clientId: 'cid',
      redirectUri: 'https://tb.test/cb',
      state: 's',
    }))
    expect(params.get('scope')).toBe('a,b')
  })

  it('无 PKCE 时不带 challenge 参数', () => {
    const [, params] = splitUrl(buildAuthorizationUrl({
      config: BASE, clientId: 'c', redirectUri: 'https://tb.test/cb', state: 's',
    }))
    expect(params.has('code_challenge')).toBe(false)
  })

  it('authorizationParams 能加自定义项', () => {
    const [, params] = splitUrl(buildAuthorizationUrl({
      config: { ...BASE, authorizationParams: { access_type: 'offline' } },
      clientId: 'c', redirectUri: 'https://tb.test/cb', state: 's',
    }))
    expect(params.get('access_type')).toBe('offline')
  })

  it('**authorizationParams 不能覆盖协议参数**(否则可被改掉 redirect_uri / state)', () => {
    const [, params] = splitUrl(buildAuthorizationUrl({
      config: {
        ...BASE,
        authorizationParams: {
          redirect_uri: 'https://evil.example/steal',
          state: 'attacker',
          client_id: 'other',
          response_type: 'token',
        },
      },
      clientId: 'cid', redirectUri: 'https://tb.test/cb', state: 'real-state',
    }))
    expect(params.get('redirect_uri')).toBe('https://tb.test/cb')
    expect(params.get('state')).toBe('real-state')
    expect(params.get('client_id')).toBe('cid')
    expect(params.get('response_type')).toBe('code')
  })

  it('端点自带 query 时用 & 续接,不破坏原有参数', () => {
    const [, params] = splitUrl(buildAuthorizationUrl({
      config: { ...BASE, authorizationUrl: 'https://a.example/auth?tenant=t1' },
      clientId: 'c', redirectUri: 'https://tb.test/cb', state: 's',
    }))
    expect(params.get('tenant')).toBe('t1')
    expect(params.get('client_id')).toBe('c')
  })

  it('特殊字符被正确编码', () => {
    const [, params] = splitUrl(buildAuthorizationUrl({
      config: { ...BASE, scopes: ['a b', 'c/d'] },
      clientId: 'id with space', redirectUri: 'https://tb.test/cb?x=1', state: 's&t=2',
    }))
    expect(params.get('client_id')).toBe('id with space')
    expect(params.get('redirect_uri')).toBe('https://tb.test/cb?x=1')
    expect(params.get('state')).toBe('s&t=2')
    expect(params.get('scope')).toBe('a b c/d')
  })
})

describe('buildTokenRequest', () => {
  const form = parseQuery

  it('授权码兑换带 code / redirect_uri / code_verifier', () => {
    const { body } = buildTokenRequest({
      config: BASE,
      clientId: 'cid',
      clientSecret: 'sec',
      codeVerifier: 'verif',
      grant: { code: 'the-code', redirectUri: 'https://tb.test/cb' },
    })
    const f = form(body)
    expect(f.get('grant_type')).toBe('authorization_code')
    expect(f.get('code')).toBe('the-code')
    expect(f.get('redirect_uri')).toBe('https://tb.test/cb')
    expect(f.get('code_verifier')).toBe('verif')
  })

  it('刷新带 refresh_token,不带 code', () => {
    const { body } = buildTokenRequest({
      config: BASE, clientId: 'cid', clientSecret: 'sec', grant: { refreshToken: 'rt' },
    })
    const f = form(body)
    expect(f.get('grant_type')).toBe('refresh_token')
    expect(f.get('refresh_token')).toBe('rt')
    expect(f.has('code')).toBe(false)
  })

  it('client_secret_post(缺省):凭证进 body', () => {
    const { body, headers } = buildTokenRequest({
      config: BASE, clientId: 'cid', clientSecret: 'sec', grant: { refreshToken: 'rt' },
    })
    expect(form(body).get('client_secret')).toBe('sec')
    expect(headers.authorization).toBeUndefined()
  })

  it('client_secret_basic:凭证进 Authorization,不进 body', () => {
    const { body, headers } = buildTokenRequest({
      config: { ...BASE, clientAuth: 'client_secret_basic' },
      clientId: 'cid', clientSecret: 'sec', grant: { refreshToken: 'rt' },
    })
    expect(form(body).has('client_secret')).toBe(false)
    expect(form(body).has('client_id')).toBe(false)
    expect(headers.authorization).toBe(`Basic ${b64('cid:sec')}`)
  })

  it('clientAuth=none:只带 client_id,不带 secret(公共客户端)', () => {
    const { body } = buildTokenRequest({
      config: { ...BASE, clientAuth: 'none' },
      clientId: 'cid', clientSecret: 'sec', grant: { refreshToken: 'rt' },
    })
    expect(form(body).get('client_id')).toBe('cid')
    expect(form(body).has('client_secret')).toBe(false)
  })
})

describe('parseTokenResponse', () => {
  it('平坦响应', () => {
    const tokens = parseTokenResponse(
      { access_token: 'at', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt', scope: 'a b' },
      BASE, NOW,
    )
    expect(tokens).toEqual({
      accessToken: 'at',
      tokenType: 'Bearer',
      refreshToken: 'rt',
      scope: 'a b',
      expiresAt: '2026-01-01T01:00:00.000Z',
    })
  })

  it('信封响应(飞书 v2 的 {code,msg,data})', () => {
    const tokens = parseTokenResponse(
      { code: 0, msg: 'success', data: { access_token: 'at', expires_in: 7200 } },
      { ...BASE, responseEnvelope: 'data' }, NOW,
    )
    expect(tokens.accessToken).toBe('at')
    expect(tokens.expiresAt).toBe('2026-01-01T02:00:00.000Z')
  })

  it('**上游用 200 + 信封报错也要识别为失败**,并带出它的消息', () => {
    try {
      parseTokenResponse(
        { code: 20001, msg: 'invalid client_secret' },
        { ...BASE, responseEnvelope: 'data' }, NOW,
      )
      expect.unreachable('应当抛出')
    } catch (err) {
      expect(isTBError(err) && err.code).toBe('invalid_argument')
      expect((err as Error).message).toContain('invalid client_secret')
    }
  })

  it('缺 access_token → invalid_argument,带出 error_description', () => {
    try {
      parseTokenResponse({ error: 'invalid_grant', error_description: 'code expired' }, BASE, NOW)
      expect.unreachable('应当抛出')
    } catch (err) {
      expect((err as Error).message).toContain('code expired')
    }
  })

  it('token_type 缺省为 Bearer(不少 provider 不回这个字段)', () => {
    expect(parseTokenResponse({ access_token: 'at' }, BASE, NOW).tokenType).toBe('Bearer')
  })

  it('没有 expires_in 就没有 expiresAt(不臆造过期时刻)', () => {
    expect(parseTokenResponse({ access_token: 'at' }, BASE, NOW).expiresAt).toBeUndefined()
  })
})

describe('过期判定', () => {
  it('expires_in 换成绝对时刻(相对值跨存储/重启没意义)', () => {
    expect(expiresAtFrom(60, NOW)).toBe('2026-01-01T00:01:00.000Z')
  })

  it('非法或非正的 expires_in 一律无过期时刻', () => {
    expect(expiresAtFrom(0, NOW)).toBeUndefined()
    expect(expiresAtFrom(-1, NOW)).toBeUndefined()
    expect(expiresAtFrom('3600', NOW)).toBeUndefined()
    expect(expiresAtFrom(Number.NaN, NOW)).toBeUndefined()
  })

  it('留 60s 余量:掐着过期时刻用,请求在途就可能失效', () => {
    const at = (offsetMs: number): { accessToken: string, expiresAt: string, tokenType: string } => ({
      accessToken: 'at',
      tokenType: 'Bearer',
      expiresAt: new Date(NOW.getTime() + offsetMs).toISOString(),
    })
    expect(shouldRefresh(at(120_000), NOW)).toBe(false)
    expect(shouldRefresh(at(30_000), NOW)).toBe(true)
    expect(shouldRefresh(at(-1), NOW)).toBe(true)
  })

  it('没有 expiresAt → 不主动刷新(靠 401 触发)', () => {
    expect(shouldRefresh({ accessToken: 'at', tokenType: 'Bearer' }, NOW)).toBe(false)
  })
})
