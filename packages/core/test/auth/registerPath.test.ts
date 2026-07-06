import { describe, expect, it } from 'vitest'
import { checkRegisterPath } from '../../src/auth/registerPath'
import type { Scope, SecretKey } from '../../src/types'

type SkArg = Pick<SecretKey, 'scopes' | 'registerPaths' | 'id'>

const registerAll: Scope[] = [{ pattern: '**', actions: ['register'] }]

const sk = (over: Partial<SkArg> = {}): SkArg => ({
  id: 'sk-self',
  scopes: registerAll,
  ...over,
})

describe('checkRegisterPath(Proto §2.4 反向注册路径规则)', () => {
  describe('规则 a:声明 registerPaths 后目标必须落在某前缀之下', () => {
    it('正例:registerPaths 内的目标放行', () => {
      const r = checkRegisterPath({
        sk: sk({ registerPaths: ['device/build-01'] }),
        targetPath: 'device/build-01/shell',
        action: 'write',
      })
      expect(r.allow).toBe(true)
    })

    it('正例:目标等于前缀本身也放行', () => {
      const r = checkRegisterPath({
        sk: sk({ registerPaths: ['device/build-01'] }),
        targetPath: 'device/build-01',
        action: 'write',
      })
      expect(r.allow).toBe(true)
    })

    it('反例:前缀之外 → permission_denied', () => {
      const r = checkRegisterPath({
        sk: sk({ registerPaths: ['device/build-01'] }),
        targetPath: 'device/build-02/shell',
        action: 'write',
      })
      expect(r.allow).toBe(false)
      if (!r.allow) expect(r.error.code).toBe('permission_denied')
    })

    it('反例:段级前缀,不被字符前缀误放行', () => {
      const r = checkRegisterPath({
        sk: sk({ registerPaths: ['device/build-01'] }),
        targetPath: 'device/build-011',
        action: 'write',
      })
      expect(r.allow).toBe(false)
    })

    it('registerPaths 为空数组 = 声明了但无任何允许前缀 → 一律 permission_denied', () => {
      const r = checkRegisterPath({
        sk: sk({ registerPaths: [] }),
        targetPath: 'device/x',
        action: 'write',
      })
      expect(r.allow).toBe(false)
      if (!r.allow) expect(r.error.code).toBe('permission_denied')
    })
  })

  describe('规则 b:未声明 registerPaths → 拒保留根、放行其余(TB.md 注意 3)', () => {
    it('正例:未声明时挂载保留根之外的路径放行', () => {
      const r = checkRegisterPath({ sk: sk(), targetPath: 'device/x', action: 'write' })
      expect(r.allow).toBe(true)
    })

    it('反例:未声明时挂载 system 保留根 → permission_denied', () => {
      const r = checkRegisterPath({ sk: sk(), targetPath: 'system/foo', action: 'write' })
      expect(r.allow).toBe(false)
      if (!r.allow) expect(r.error.code).toBe('permission_denied')
    })

    it('反例:ui 保留根同样拒绝', () => {
      const r = checkRegisterPath({ sk: sk(), targetPath: 'ui/panel', action: 'write' })
      expect(r.allow).toBe(false)
    })

    it('反例:部署追加的 reservedRoots 也拒绝', () => {
      const r = checkRegisterPath({
        sk: sk(),
        targetPath: 'custom/x',
        action: 'write',
        reservedRoots: ['custom'],
      })
      expect(r.allow).toBe(false)
      if (!r.allow) expect(r.error.code).toBe('permission_denied')
    })

    it('声明 registerPaths 后即使指向保留根,只要落在前缀内也放行(a 不叠加 b)', () => {
      const r = checkRegisterPath({
        sk: sk({ registerPaths: ['system/plugins'] }),
        targetPath: 'system/plugins/x',
        action: 'write',
      })
      expect(r.allow).toBe(true)
    })
  })

  describe('规则 c:两种情形都仍需 (path, register) scope 通过(收紧不是授权)', () => {
    it('反例:路径合法但无 register scope → permission_denied', () => {
      const r = checkRegisterPath({
        sk: sk({ scopes: [{ pattern: '**', actions: ['read'] }] }),
        targetPath: 'device/x',
        action: 'write',
      })
      expect(r.allow).toBe(false)
      if (!r.allow) expect(r.error.code).toBe('permission_denied')
    })

    it('反例:register scope 模式不覆盖目标 → permission_denied', () => {
      const r = checkRegisterPath({
        sk: sk({ scopes: [{ pattern: 'docs/**', actions: ['register'] }] }),
        targetPath: 'device/x',
        action: 'write',
      })
      expect(r.allow).toBe(false)
    })

    it('reg scope 被 deny 覆盖 → permission_denied', () => {
      const r = checkRegisterPath({
        sk: sk({
          scopes: [
            { pattern: '**', actions: ['register'] },
            { pattern: 'device/**', actions: ['register'], effect: 'deny' },
          ],
        }),
        targetPath: 'device/x',
        action: 'write',
      })
      expect(r.allow).toBe(false)
    })
  })

  describe('规则 d:已存在节点的 conflict 与幂等', () => {
    it('反例:目标已被他人注册 → conflict', () => {
      const r = checkRegisterPath({
        sk: sk(),
        targetPath: 'docs/x',
        action: 'write',
        existing: { registeredBy: 'other-key' },
      })
      expect(r.allow).toBe(false)
      if (!r.allow) expect(r.error.code).toBe('conflict')
    })

    it('正例:同 SK 重复注册同路径 = 幂等 upsert', () => {
      const r = checkRegisterPath({
        sk: sk(),
        targetPath: 'docs/x',
        action: 'write',
        existing: { registeredBy: 'sk-self' },
      })
      expect(r.allow).toBe(true)
    })

    it('正例:system:auto 物化的中间 directory 不触发 conflict', () => {
      const r = checkRegisterPath({
        sk: sk(),
        targetPath: 'docs/x',
        action: 'write',
        existing: { registeredBy: 'system:auto' },
      })
      expect(r.allow).toBe(true)
    })

    it('existing 为 null(不存在)不触发 conflict', () => {
      const r = checkRegisterPath({
        sk: sk(),
        targetPath: 'docs/x',
        action: 'write',
        existing: null,
      })
      expect(r.allow).toBe(true)
    })

    it('delete 他人节点同样 conflict', () => {
      const r = checkRegisterPath({
        sk: sk(),
        targetPath: 'docs/x',
        action: 'delete',
        existing: { registeredBy: 'other-key' },
      })
      expect(r.allow).toBe(false)
      if (!r.allow) expect(r.error.code).toBe('conflict')
    })
  })

  describe('保留段:~ 开头段出现在路径中 → invalid_argument', () => {
    it('反例:目标含 ~help 段', () => {
      const r = checkRegisterPath({ sk: sk(), targetPath: 'docs/~help', action: 'write' })
      expect(r.allow).toBe(false)
      if (!r.allow) expect(r.error.code).toBe('invalid_argument')
    })

    it('保留段先于路径/权限判定(即便同时缺 register scope)', () => {
      const r = checkRegisterPath({
        sk: sk({ scopes: [] }),
        targetPath: '~register/x',
        action: 'write',
      })
      expect(r.allow).toBe(false)
      if (!r.allow) expect(r.error.code).toBe('invalid_argument')
    })
  })
})
