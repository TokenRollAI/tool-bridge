import { describe, expect, it } from 'vitest'
import type { Scope } from '../../src/types'
import {
  assertSecretRefUse,
  SECRET_VAULT_PATH,
  secretRefsInConfig,
} from '../../src/auth/secretRef'
import { isTBError } from '../../src/errors'

const adminScopes: Scope[] = [{ pattern: '**', actions: ['read', 'write', 'call', 'register', 'admin'] }]
const registrantScopes: Scope[] = [
  { pattern: 'team/**', actions: ['read', 'call', 'register'] },
]
const secretAdminScopes: Scope[] = [
  { pattern: 'team/**', actions: ['read', 'call', 'register'] },
  { pattern: 'system/secret', actions: ['admin'] },
]

describe('secretRefsInConfig', () => {
  it('抽取 http/context/tool/skillhub 的 authRef', () => {
    expect(secretRefsInConfig({ kind: 'http', endpoint: 'https://x', tools: [], authRef: 'k1' })).toEqual(['k1'])
    expect(secretRefsInConfig({ kind: 'context', provider: 's3', authRef: 'k2' })).toEqual(['k2'])
    expect(secretRefsInConfig({ kind: 'tool', provider: 'feishu', authRef: 'k3' })).toEqual(['k3'])
  })

  it('抽取 remote 的 skRef', () => {
    expect(secretRefsInConfig({ kind: 'remote', baseUrl: 'https://x', skRef: 'r1' })).toEqual(['r1'])
  })

  it('mcp 静态 authRef 计入', () => {
    expect(secretRefsInConfig({ kind: 'mcp', url: 'https://x', authRef: 'm1' })).toEqual(['m1'])
  })

  it('mcp auth:oauth 忽略 authRef(网关托管,不计入授权门)', () => {
    expect(secretRefsInConfig({ kind: 'mcp', url: 'https://x', auth: 'oauth', authRef: 'ignored' })).toEqual([])
  })

  it('无引用 / 非对象 / 空串 → 空', () => {
    expect(secretRefsInConfig({ kind: 'context', provider: 'r2' })).toEqual([])
    expect(secretRefsInConfig(null)).toEqual([])
    expect(secretRefsInConfig('nope')).toEqual([])
    expect(secretRefsInConfig({ kind: 'http', endpoint: 'https://x', tools: [], authRef: '' })).toEqual([])
  })

  it('vault 路径常量是 system/secret', () => {
    expect(SECRET_VAULT_PATH).toBe('system/secret')
  })
})

describe('assertSecretRefUse', () => {
  it('无引用 → 放行(任何身份)', () => {
    expect(() => assertSecretRefUse(registrantScopes, { kind: 'context', provider: 'r2' })).not.toThrow()
  })

  it('admin(**)绑定引用 → 放行', () => {
    expect(() =>
      assertSecretRefUse(adminScopes, { kind: 'remote', baseUrl: 'https://x', skRef: 'r1' }),
    ).not.toThrow()
  })

  it('持 system/secret admin 的受限注册者 → 放行', () => {
    expect(() =>
      assertSecretRefUse(secretAdminScopes, { kind: 'http', endpoint: 'https://x', tools: [], authRef: 'k1' }),
    ).not.toThrow()
  })

  it('受限注册者(无 secret admin)绑定他人 Secret → permission_denied', () => {
    let caught: unknown
    try {
      assertSecretRefUse(registrantScopes, { kind: 'remote', baseUrl: 'https://x', skRef: 'victim' })
    } catch (err) {
      caught = err
    }
    expect(isTBError(caught)).toBe(true)
    expect((caught as { code: string }).code).toBe('permission_denied')
    expect((caught as { message: string }).message).toContain('victim')
  })

  it('mcp auth:oauth 即便带 authRef 也不触发授权门(受限注册者可挂)', () => {
    expect(() =>
      assertSecretRefUse(registrantScopes, {
        kind: 'mcp',
        url: 'https://x',
        auth: 'oauth',
        authRef: 'ignored',
      }),
    ).not.toThrow()
  })
})
