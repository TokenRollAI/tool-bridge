import { describe, expect, it } from 'vitest'
import { parsePluginManifest } from '../../src/plugin/manifest'
import { TBError } from '../../src/errors'
import { omit } from '../../src/omit'

/** 注册样例(feishu-docs)。 */
const FEISHU = {
  id: 'feishu-docs',
  protocolVersion: 'plugin/v2',
  endpoint: 'https://feishu-docs-provider.example.workers.dev',
  auth: { kind: 'platform-token' },
  healthPath: '/healthz',
  enabled: true,
}

function expectInvalid(value: unknown, opts?: { allowInsecureHttp?: boolean }): TBError {
  try {
    parsePluginManifest(value, opts)
  } catch (e) {
    expect(e).toBeInstanceOf(TBError)
    expect((e as TBError).code).toBe('invalid_argument')
    return e as TBError
  }
  throw new Error('expected parsePluginManifest to throw')
}

describe('合法 manifest', () => {
  it('feishu-docs 样例原样通过', () => {
    expect(parsePluginManifest(FEISHU)).toEqual(FEISHU)
  })

  it('tool-provider + bearer 通过', () => {
    const m = {
      ...FEISHU,
      id: 'orders',
      endpoint: 'https://orders.example.com',
      auth: { kind: 'bearer', secretRef: 'orders-token' },
    }
    expect(parsePluginManifest(m)).toEqual(m)
  })

  it('宿主显式装配的 binding endpoint 通过', () => {
    const manifest = { ...FEISHU, endpoint: 'binding:ORDERS_PROVIDER' }
    expect(parsePluginManifest(manifest)).toEqual(manifest)
  })

  it('未知字段拒绝，避免旧 manifest 被静默接受', () => {
    expectInvalid({ ...FEISHU, futureField: 42 })
  })
})

describe('endpoint 形状(HTTP(S) 或宿主 binding)', () => {
  it('裸 http 缺省拒,并提示 TB_ALLOW_INSECURE_HTTP', () => {
    const err = expectInvalid({ ...FEISHU, endpoint: 'http://127.0.0.1:8787' })
    expect(err.message).toContain('TB_ALLOW_INSECURE_HTTP')
  })

  it('allowInsecureHttp 时放行 http(本地开发逃生口,对齐上游 provider 先例)', () => {
    const m = { ...FEISHU, endpoint: 'http://127.0.0.1:8787' }
    expect(parsePluginManifest(m, { allowInsecureHttp: true }).endpoint).toBe(m.endpoint)
  })

  it.each([
    'ftp://x.example',
    'example.com',
    'binding:',
    'binding:has space',
    '',
  ])('非法 endpoint 拒:%j', (bad) => {
    expectInvalid({ ...FEISHU, endpoint: bad })
  })

  it('allowInsecureHttp 不放行 HTTP(S)/binding 之外的 scheme', () => {
    expectInvalid({ ...FEISHU, endpoint: 'ws://x.example' }, { allowInsecureHttp: true })
  })
})

describe('auth 两变体', () => {
  it('bearer 缺 secretRef → 拒', () => {
    expectInvalid({ ...FEISHU, auth: { kind: 'bearer' } })
  })

  it('bearer secretRef 空串 → 拒', () => {
    expectInvalid({ ...FEISHU, auth: { kind: 'bearer', secretRef: '' } })
  })

  it('未知 auth kind → 拒', () => {
    expectInvalid({ ...FEISHU, auth: { kind: 'oauth' } })
  })
})

describe('其余字段', () => {
  it.each(['', 'a/b', '~evil', 'plugin:x', 'a b'])('id 非 path-segment 安全字符拒:%j', (bad) => {
    expectInvalid({ ...FEISHU, id: bad })
  })

  it('healthPath 不以 / 开头 → 拒', () => {
    expectInvalid({ ...FEISHU, healthPath: 'healthz' })
  })

  it('enabled 缺失或非 boolean → 拒', () => {
    expectInvalid(omit(FEISHU, 'enabled'))
    expectInvalid({ ...FEISHU, enabled: 'true' })
  })

  it('非对象输入 → 拒', () => {
    expectInvalid('feishu-docs')
    expectInvalid(null)
    expectInvalid([FEISHU])
  })
})
