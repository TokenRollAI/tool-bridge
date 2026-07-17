import { describe, expect, it } from 'vitest'
import { parsePluginManifest, PLUGIN_KINDS } from '../../src/plugin/manifest'
import { TBError } from '../../src/errors'

/** 注册样例(feishu-docs)。 */
const FEISHU = {
  id: 'feishu-docs',
  kind: 'context-provider',
  interfaceVersion: 'context-provider/v1',
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

  it('tool-provider + bearer + binding endpoint 通过', () => {
    const m = {
      ...FEISHU,
      id: 'orders',
      kind: 'tool-provider',
      interfaceVersion: 'tool-provider/v1',
      endpoint: 'binding:ORDERS_PROVIDER',
      auth: { kind: 'bearer', secretRef: 'orders-token' },
    }
    expect(parsePluginManifest(m)).toEqual(m)
  })

  it('未知字段剥离(向前兼容:忽略未知字段)', () => {
    const parsed = parsePluginManifest({ ...FEISHU, futureField: 42 })
    expect(parsed).toEqual(FEISHU)
    expect('futureField' in parsed).toBe(false)
  })

  it('PLUGIN_KINDS 词表 = 两种 Provider', () => {
    expect(PLUGIN_KINDS).toEqual(['tool-provider', 'context-provider'])
  })
})

describe('kind ↔ interfaceVersion 一致性', () => {
  it('kind=tool-provider 配 context-provider/v1 → 拒', () => {
    const err = expectInvalid({
      ...FEISHU,
      kind: 'tool-provider',
      interfaceVersion: 'context-provider/v1',
    })
    expect(err.message).toContain('interfaceVersion')
  })

  it('kind=context-provider 配 tool-provider/v1 → 拒', () => {
    expectInvalid({ ...FEISHU, interfaceVersion: 'tool-provider/v1' })
  })

  it.each([
    'context-provider',
    'context-provider/1',
    'context-provider/v',
    'context-provider/v1.2',
  ])('形状不合 <kind>/v<major> 的 interfaceVersion 拒:%s', (bad) => {
    expectInvalid({ ...FEISHU, interfaceVersion: bad })
  })

  it('同 kind 的更高 major 合法(v2)', () => {
    const m = { ...FEISHU, interfaceVersion: 'context-provider/v2' }
    expect(parsePluginManifest(m).interfaceVersion).toBe('context-provider/v2')
  })

  it('未知 kind → 拒', () => {
    expectInvalid({ ...FEISHU, kind: 'widget-provider', interfaceVersion: 'widget-provider/v1' })
  })
})

describe('endpoint 形状(https:// 或 binding:<name>)', () => {
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

  it('allowInsecureHttp 不放行 https/binding 之外的其他 scheme', () => {
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
    const { enabled: _enabled, ...rest } = FEISHU
    expectInvalid(rest)
    expectInvalid({ ...FEISHU, enabled: 'true' })
  })

  it('非对象输入 → 拒', () => {
    expectInvalid('feishu-docs')
    expectInvalid(null)
    expectInvalid([FEISHU])
  })
})
