import { describe, expect, it } from 'vitest'
import {
  diagnoseMountError,
  initialMountSteps,
} from '../src/components/add-tool/mountDiagnostics'

/**
 * 挂载失败诊断:code → 分类 + 措辞。这层是"失败诊断 + 可见回滚"的核心,
 * 措辞会随后端语义演进,但 code→category 的映射不能错(错了会把权限问题说成配置问题)。
 */

describe('diagnoseMountError', () => {
  it('permission_denied 在写凭证阶段 → 指向 secret admin', () => {
    const d = diagnoseMountError({ code: 'permission_denied' }, 'secret')
    expect(d.category).toBe('permission')
    expect(d.hint).toMatch(/secret/)
    expect(d.retryable).toBe(false)
  })

  it('permission_denied 在挂载阶段 → 指向 register scope', () => {
    const d = diagnoseMountError({ code: 'permission_denied' }, 'mount')
    expect(d.category).toBe('permission')
    expect(d.hint).toMatch(/register/)
  })

  it('挂载阶段的 unavailable → 归类为凭证/连通探测失败', () => {
    const d = diagnoseMountError({ code: 'unavailable', message: 'probe failed' }, 'mount')
    expect(d.category).toBe('credential')
    expect(d.title).toMatch(/探测/)
    expect(d.retryable).toBe(true)
  })

  it('network → 连不上网关,可重试', () => {
    const d = diagnoseMountError({ code: 'network' }, 'mount')
    expect(d.category).toBe('unreachable')
    expect(d.retryable).toBe(true)
  })

  it('invalid_argument → 配置问题,不可重试,带上原始消息', () => {
    const d = diagnoseMountError({ code: 'invalid_argument', message: '缺必填 baseUrl' }, 'mount')
    expect(d.category).toBe('config')
    expect(d.hint).toMatch(/baseUrl/)
    expect(d.retryable).toBe(false)
  })

  it('conflict → 冲突类', () => {
    expect(diagnoseMountError({ code: 'conflict', message: 'x' }, 'mount').category).toBe('conflict')
  })

  it('未知 code → 保留原始消息 + 透传 retryable', () => {
    const d = diagnoseMountError({ code: 'internal', message: 'boom', retryable: true }, 'mount')
    expect(d.category).toBe('unknown')
    expect(d.hint).toBe('boom')
    expect(d.retryable).toBe(true)
  })
})

describe('initialMountSteps', () => {
  it('无凭证、无授权:只有挂载一步', () => {
    const steps = initialMountSteps({ hasSecret: false, needsAuthorize: false })
    expect(steps.map(s => s.key)).toEqual(['mount'])
  })

  it('有凭证 + 要授权:凭证 → 挂载 → 授权', () => {
    const steps = initialMountSteps({ hasSecret: true, needsAuthorize: true })
    expect(steps.map(s => s.key)).toEqual(['secret', 'mount', 'authorize'])
    expect(steps.every(s => s.state === 'pending')).toBe(true)
  })
})
